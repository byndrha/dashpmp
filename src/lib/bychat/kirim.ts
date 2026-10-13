import { getPgPool } from "@/lib/pg";
import { AppError } from "@/lib/action-result";
import type { BychatClaims } from "@/lib/bychat/token";
import type { ResolvedByChat } from "@/lib/queries/perusahaan-bychat";
import { postIntegrationMessage } from "@/lib/bychat/client";
import { assertPtKode, cariMitraByNomor, getKartuPiutang, nomorKanonikDariKontak, type KartuPiutangData, type MitraRingkas } from "@/lib/bychat/mitra";
import { renderKartuPng } from "@/lib/bychat/kartu-image";
import { bolehKirimUlang, buatPengantar, idempotencyKey, type KirimTerakhir } from "@/lib/bychat/kirim-util";
import { ambilAtauBuatTautan } from "@/lib/bychat/tautan";

// Orkestrasi: nomor dari klaim token (BUKAN dari klien) -> mitra di database
// PT akun itu -> kartu -> kirim lewat ByChat -> audit. Setiap upaya kirim
// (berhasil, replay, gagal) tercatat di bychat_kirim_audit.

export interface KontakMitra {
  nomor: string | null; // kanonik 62..., null bila kontak tak punya nomor asli (LID)
  mitra: MitraRingkas[];
}

export async function cariMitraUntukKontak(koneksi: ResolvedByChat, claims: BychatClaims): Promise<KontakMitra> {
  const nomor = nomorKanonikDariKontak(claims.contact.phoneNumber, claims.contact.identifier);
  if (!nomor) return { nomor: null, mitra: [] };
  const pt = assertPtKode(koneksi.perusahaanKode);
  return { nomor, mitra: await cariMitraByNomor(pt, nomor) };
}

export async function ambilKartu(koneksi: ResolvedByChat, claims: BychatClaims, mitraId: string): Promise<KartuPiutangData> {
  const { nomor } = await cariMitraUntukKontak(koneksi, claims);
  if (!nomor) throw new AppError("Kontak percakapan ini tidak memiliki nomor WhatsApp yang dapat dikenali.");
  return getKartuPiutang(assertPtKode(koneksi.perusahaanKode), koneksi.perusahaanNama, koneksi.perusahaanId, nomor, mitraId);
}

export async function pratinjauKartu(koneksi: ResolvedByChat, claims: BychatClaims, mitraId: string): Promise<Uint8Array> {
  return renderKartuPng(await ambilKartu(koneksi, claims, mitraId));
}

export async function kirimTerakhir24Jam(ptKode: string, mitraId: string): Promise<KirimTerakhir | null> {
  const r = await getPgPool().query(
    `SELECT agen_nama, created_at FROM bychat_kirim_audit
     WHERE perusahaan_kode = $1 AND mitra_id = $2 AND status = 'terkirim' AND created_at > now() - interval '24 hours'
     ORDER BY created_at DESC LIMIT 1`,
    [ptKode, mitraId]
  );
  const row = r.rows[0];
  return row ? { waktu: new Date(row.created_at), agenNama: row.agen_nama ?? "" } : null;
}

interface AuditInput {
  koneksi: ResolvedByChat;
  claims: BychatClaims;
  mitra: MitraRingkas;
  nomor: string;
  idemKey: string;
  status: "terkirim" | "replay" | "gagal";
  httpStatus: number | null;
  conversationId: number | null;
  messageId: number | null;
  pesanGalat: string | null;
  totalPiutang: number | null;
  tanggalPosisi: string;
}

async function catatAudit(a: AuditInput): Promise<void> {
  try {
    await getPgPool().query(
      `INSERT INTO bychat_kirim_audit
        (perusahaan_kode, mitra_id, mitra_nama, nomor, agen_id, agen_nama, agen_email, bychat_account_id,
         conversation_id, message_id, idempotency_key, status, http_status, pesan_galat, total_piutang, tanggal_posisi)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        a.koneksi.perusahaanKode, a.mitra.id, a.mitra.nama, a.nomor, a.claims.agent.id, a.claims.agent.name, a.claims.agent.email,
        a.koneksi.bychatAccountId, a.conversationId, a.messageId, a.idemKey, a.status, a.httpStatus, a.pesanGalat, a.totalPiutang, a.tanggalPosisi,
      ]
    );
  } catch (err) {
    // Audit gagal tidak boleh menutupi hasil kirim yang sudah terjadi; dicatat di log server (tanpa token).
    console.error("Gagal mencatat audit ByChat:", (err as Error).message);
  }
}

export interface KirimKartuHasil {
  replayed: boolean;
  conversationId: number | null;
  messageId: number | null;
  total: number;
  jumlahFaktur: number;
}

export async function kirimKartu(koneksi: ResolvedByChat, claims: BychatClaims, mitraId: string): Promise<KirimKartuHasil> {
  const nomor = nomorKanonikDariKontak(claims.contact.phoneNumber, claims.contact.identifier);
  if (!nomor) throw new AppError("Kontak percakapan ini tidak memiliki nomor WhatsApp yang dapat dikenali (kontak tanpa nomor asli). Kartu tidak dikirim.");
  if (koneksi.inboxId == null) throw new AppError("ID inbox WhatsApp belum diatur untuk PT ini di pengaturan Integrasi ByChat.");
  if (claims.inboxId !== koneksi.inboxId) {
    throw new AppError("Percakapan ini bukan di inbox penagihan PT. Kartu hanya dapat dikirim dari inbox yang diatur untuk PT ini.");
  }

  const kartu = await getKartuPiutang(assertPtKode(koneksi.perusahaanKode), koneksi.perusahaanNama, koneksi.perusahaanId, nomor, mitraId);
  if (kartu.totalPiutang <= 0 || kartu.faktur.length === 0) {
    throw new AppError("Mitra ini tidak memiliki piutang outstanding, jadi kartu tidak dikirim.");
  }

  const idemKey = idempotencyKey(koneksi.perusahaanKode, kartu.mitra.id, kartu.tanggalPosisi);
  const batas = bolehKirimUlang(await kirimTerakhir24Jam(koneksi.perusahaanKode, kartu.mitra.id), new Date(), claims.agent.role);
  if (!batas.boleh) throw new AppError(batas.alasan ?? "Batas frekuensi pengiriman tercapai.");

  const tautan = await ambilAtauBuatTautan({
    ptKode: koneksi.perusahaanKode,
    perusahaanId: koneksi.perusahaanId,
    mitraId: kartu.mitra.id,
    agenNama: claims.agent.name,
    agenEmail: claims.agent.email,
  });
  const png = await renderKartuPng(kartu);
  const form = new FormData();
  form.append("inbox_id", String(koneksi.inboxId));
  form.append("phone", nomor);
  form.append("name", kartu.mitra.nama);
  form.append(
    "content",
    buatPengantar({ mitra: kartu.mitra.nama, pt: kartu.ptNama, tanggal: kartu.tanggalPosisi, total: kartu.totalPiutang, jumlahFaktur: kartu.faktur.length, rekening: kartu.rekening, tautan: tautan.url })
  );
  form.append("attachments[]", new Blob([png as BlobPart], { type: "image/png" }), `kartu-piutang-${kartu.tanggalPosisi}.png`);
  form.append("idempotency_key", idemKey);
  form.append("audit_note", `Kartu piutang dikirim oleh ${claims.agent.name} (${claims.agent.email}) via dashpmp`);
  form.append("source", "dashpmp");

  const dasarAudit = { koneksi, claims, mitra: kartu.mitra, nomor, idemKey, totalPiutang: kartu.totalPiutang, tanggalPosisi: kartu.tanggalPosisi };
  try {
    const hasil = await postIntegrationMessage(koneksi.bychatUrl, koneksi.apiToken, koneksi.bychatAccountId, form);
    await catatAudit({
      ...dasarAudit,
      status: hasil.replayed ? "replay" : "terkirim",
      httpStatus: hasil.status,
      conversationId: hasil.conversationId,
      messageId: hasil.messageId,
      pesanGalat: null,
    });
    return { replayed: hasil.replayed, conversationId: hasil.conversationId, messageId: hasil.messageId, total: kartu.totalPiutang, jumlahFaktur: kartu.faktur.length };
  } catch (err) {
    await catatAudit({
      ...dasarAudit,
      status: "gagal",
      httpStatus: null,
      conversationId: null,
      messageId: null,
      pesanGalat: err instanceof AppError ? err.message : "galat tak terduga",
    });
    throw err;
  }
}
