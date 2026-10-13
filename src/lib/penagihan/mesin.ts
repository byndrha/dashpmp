import { getPool } from "@/lib/db";
import { getPgPool } from "@/lib/pg";
import { AppError } from "@/lib/action-result";
import { getAgingReceivables } from "@/lib/queries/aging";
import { resolveByChatByAccountId, type ResolvedByChat } from "@/lib/queries/perusahaan-bychat";
import { extractPhones } from "@/lib/bychat/phone";
import { ambilStatusPesan } from "@/lib/bychat/client";
import { kirimKartuOtomatis } from "@/lib/bychat/kirim";
import {
  dalamJendela, pilihKandidat, susunJadwal, waktuWib,
  type KandidatMentah, type Pengaturan,
} from "@/lib/penagihan/logika";
import {
  batalkanRonde, buatRonde, catatHasilKirim, getPengaturan, getRonde, kedaluwarsakanRondeLama, klaimJatuhTempo, listPerluCekStatus, catatCekStatus,
  listPenagihanAktif, selesaikanRondeBilaHabis, setOptout, tandaiAntrean, terakhirDitagih,
} from "@/lib/penagihan/repo";

// Mesin penagihan otomatis. Dipanggil tiap menit oleh Scheduled Task Coolify lewat
// POST /api/penagihan/tick. Idempoten: aman dipanggil berulang/tumpang-tindih.
// Saat ini hanya MKEsindo (PMP_Agen Es Balok belum punya nomor telepon).

const PT_DIDUKUNG = new Set(["mkesindo"]);
const MAKS_PER_TICK = 5;

export interface HasilTickPt {
  perusahaanId: number;
  ptKode?: string;
  catatan: string;
  rondeBaru?: boolean;
  terkirim: number;
  dilewati: number;
  gagal: number;
}

// ------------------------------------------------------------------ data kandidat (ERP)

// Mitra berpiutang, dikelompokkan per mitra.
export async function muatKandidatMkesindo(): Promise<KandidatMentah[]> {
  const rows = await getAgingReceivables();
  const peta = new Map<string, KandidatMentah>();
  for (const r of rows) {
    if (!r.BusinessPartnerID) continue;
    const k = peta.get(r.BusinessPartnerID);
    if (k) {
      k.total += Number(r.Outstanding);
      k.jumlahFaktur += 1;
      k.hariLewatMaks = Math.max(k.hariLewatMaks, Number(r.DaysOverdue));
    } else {
      peta.set(r.BusinessPartnerID, {
        mitraId: r.BusinessPartnerID,
        nama: r.CustomerName ?? r.BusinessPartnerID,
        kontak: r.Kontak,
        total: Number(r.Outstanding),
        jumlahFaktur: 1,
        hariLewatMaks: Number(r.DaysOverdue),
      });
    }
  }
  return [...peta.values()];
}

// nomor kanonik -> berapa mitra (SELURUH mitra aktif, bukan hanya yang berpiutang)
// yang memakainya di MobileNo/PhoneNo; sama dengan dasar pencocokan getKartuPiutang.
export async function muatJumlahMitraPerNomor(): Promise<Map<string, number>> {
  const pool = await getPool();
  const r = await pool.request().query(`SELECT BusinessPartnerID, MobileNo, PhoneNo FROM BusinessPartner WITH (NOLOCK) WHERE IsDeleted = 0`);
  const hitung = new Map<string, Set<string>>();
  for (const b of r.recordset as { BusinessPartnerID: string; MobileNo: string | null; PhoneNo: string | null }[]) {
    for (const n of [...extractPhones(b.MobileNo), ...extractPhones(b.PhoneNo)]) {
      let s = hitung.get(n);
      if (!s) hitung.set(n, (s = new Set()));
      s.add(b.BusinessPartnerID);
    }
  }
  return new Map([...hitung].map(([n, s]) => [n, s.size]));
}

// ------------------------------------------------------------------ ronde

async function susunRonde(koneksi: ResolvedByChat, p: Pengaturan, sekarang: Date, tanggal: string): Promise<boolean> {
  const [mentah, perNomor, optout, terakhir] = await Promise.all([
    muatKandidatMkesindo(),
    muatJumlahMitraPerNomor(),
    setOptout(koneksi.perusahaanId),
    terakhirDitagih(koneksi.perusahaanKode),
  ]);
  const { terpilih, dilewati } = pilihKandidat(mentah, p, { jumlahMitraPerNomor: perNomor, optout, terakhirDitagih: terakhir, sekarang });
  const jadwal = susunJadwal(terpilih.length, sekarang, p);
  const ronde = await buatRonde({
    perusahaanId: koneksi.perusahaanId,
    tanggal,
    status: p.mode === "otomatis" ? "berjalan" : "pratinjau",
    terjadwal: jadwal.map((j, i) => ({ kandidat: terpilih[i], jadwal: j })),
    tertunda: terpilih.slice(jadwal.length),
    dilewati,
  });
  return ronde != null;
}

// ------------------------------------------------------------------ proses satu PT

type Penggolong = { status: "dilewati"; alasan: string } | { status: "gagal"; alasan: string };

export function golongkanGalat(err: unknown): Penggolong {
  const pesan = err instanceof Error ? err.message : "galat tak terduga";
  if (err instanceof AppError) {
    if (pesan === "SUDAH_LUNAS") return { status: "dilewati", alasan: "Sudah lunas saat akan dikirim" };
    if (pesan === "SUDAH_DIKIRIM_24JAM") return { status: "dilewati", alasan: "Sudah dikirim dalam 24 jam terakhir" };
    if (pesan.startsWith("Mitra tidak cocok")) return { status: "dilewati", alasan: "Nomor tidak lagi cocok tepat satu mitra" };
    return { status: "gagal", alasan: pesan.slice(0, 500) };
  }
  console.error("Penagihan: galat tak terduga", pesan);
  return { status: "gagal", alasan: "Galat tak terduga di server" };
}

async function prosesPt(perusahaanId: number, bychatAccountId: number, sekarang: Date): Promise<HasilTickPt> {
  const hasil: HasilTickPt = { perusahaanId, catatan: "", terkirim: 0, dilewati: 0, gagal: 0 };
  const koneksi = await resolveByChatByAccountId(bychatAccountId);
  if (!koneksi) return { ...hasil, catatan: "Koneksi ByChat tidak aktif" };
  hasil.ptKode = koneksi.perusahaanKode;
  if (!PT_DIDUKUNG.has(koneksi.perusahaanKode)) return { ...hasil, catatan: "PT belum didukung penagihan otomatis" };
  if (koneksi.inboxId == null) return { ...hasil, catatan: "ID inbox belum diatur" };

  // Status akhir pesan dicek di luar jendela kirim juga.
  hasil.gagal += await periksaStatus(koneksi, sekarang);

  const p = await getPengaturan(perusahaanId);
  if (p.jedaSampai && p.jedaSampai > sekarang) return { ...hasil, catatan: `Dijeda otomatis sampai ${p.jedaSampai.toISOString()}` };
  if (!dalamJendela(sekarang, p)) return { ...hasil, catatan: "Di luar jendela hari/jam" };

  const { tanggal } = waktuWib(sekarang);
  await kedaluwarsakanRondeLama(perusahaanId, tanggal);
  let ronde = await getRonde(perusahaanId, tanggal);
  if (!ronde) {
    hasil.rondeBaru = await susunRonde(koneksi, p, sekarang, tanggal);
    ronde = await getRonde(perusahaanId, tanggal);
  }
  if (!ronde) return { ...hasil, catatan: "Ronde tidak terbentuk" };
  if (ronde.status !== "berjalan") return { ...hasil, catatan: `Ronde ${ronde.status}` };

  const due = await klaimJatuhTempo(perusahaanId, sekarang, MAKS_PER_TICK);
  const optout = due.length > 0 ? await setOptout(perusahaanId) : new Set<string>();
  let berhenti = false;
  for (const a of due) {
    if (berhenti) {
      // Klaim dilepas agar diproses tick berikutnya setelah jeda selesai.
      await tandaiLepas(a.id);
      continue;
    }
    if (a.nomor && optout.has(a.nomor)) {
      await tandaiAntrean(a.id, "dilewati", "Opt-out");
      hasil.dilewati++;
      continue;
    }
    if (!a.nomor) {
      await tandaiAntrean(a.id, "dilewati", "Nomor kosong");
      hasil.dilewati++;
      continue;
    }
    try {
      const h = await kirimKartuOtomatis(koneksi, a.mitraId, a.nomor);
      await tandaiAntrean(a.id, "terkirim", h.replayed ? "Sudah terkirim sebelumnya (replay)" : null, h.messageId, h.conversationId);
      await catatHasilKirim(perusahaanId, true);
      hasil.terkirim++;
    } catch (err) {
      const g = golongkanGalat(err);
      await tandaiAntrean(a.id, g.status, g.alasan);
      if (g.status === "dilewati") {
        hasil.dilewati++;
      } else {
        hasil.gagal++;
        const { autoPause } = await catatHasilKirim(perusahaanId, false);
        if (autoPause) {
          berhenti = true;
          hasil.catatan = "Auto-pause: gagal beruntun";
        }
      }
    }
  }
  await selesaikanRondeBilaHabis(ronde.id);
  return hasil;
}

// Kembalikan jumlah pesan yang ternyata gagal di WhatsApp; kegagalan itu ikut hitungan auto-pause.
async function periksaStatus(koneksi: ResolvedByChat, sekarang: Date): Promise<number> {
  let gagal = 0;
  for (const c of await listPerluCekStatus(koneksi.perusahaanId, sekarang)) {
    try {
      const h = await ambilStatusPesan(koneksi.bychatUrl, koneksi.apiToken, koneksi.bychatAccountId, c.conversationId, c.messageId);
      await catatCekStatus(c.id, c.jumlahCek, h.status, h.galat);
      if (h.status === "failed") {
        gagal++;
        await catatHasilKirim(koneksi.perusahaanId, false);
      }
    } catch (err) {
      console.error("Penagihan: cek status pesan gagal:", (err as Error).message);
      break;
    }
  }
  return gagal;
}

async function tandaiLepas(id: number): Promise<void> {
  await getPgPool().query(`UPDATE penagihan_antrean SET diproses_pada = NULL WHERE id = $1 AND status = 'menunggu'`, [id]);
}

// Titik masuk tick: semua PT dengan penagihan aktif. Kegagalan satu PT tidak
// menghentikan PT lain.
export async function jalankanTick(sekarang: Date = new Date()): Promise<HasilTickPt[]> {
  const daftar = await listPenagihanAktif();
  const keluar: HasilTickPt[] = [];
  for (const k of daftar) {
    try {
      keluar.push(await prosesPt(k.perusahaanId, k.bychatAccountId, sekarang));
    } catch (err) {
      console.error(`Penagihan: tick PT ${k.perusahaanId} gagal:`, (err as Error).message);
      keluar.push({ perusahaanId: k.perusahaanId, catatan: "Galat internal (lihat log server)", terkirim: 0, dilewati: 0, gagal: 0 });
    }
  }
  return keluar;
}

export { batalkanRonde };
