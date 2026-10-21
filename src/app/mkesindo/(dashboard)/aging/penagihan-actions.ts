"use server";

import { requireModuleAccess } from "@/lib/require-access";
import { runAction, type ActionResult } from "@/lib/action-result";
import { getMkesindoPerusahaanId } from "@/lib/queries/perusahaan";
import { getByChatKoneksi } from "@/lib/queries/perusahaan-bychat";
import { getPgPool } from "@/lib/pg";
import { getRekeningPembayaran } from "@/lib/bychat/mitra";
import { tglIndo } from "@/lib/bychat/kirim-util";
import { susunJadwal, waktuWib, type Pengaturan } from "@/lib/penagihan/logika";
import { CONTOH_TEMPLAT, formatBlokRekening, formatRupiah, type NilaiTemplat } from "@/lib/penagihan/templat";
import {
  batalkanRonde, getPenagihanAktif, jadwalUlangAntrean, getPengaturan, getRonde, hapusOptout, lepasJeda, listAntrean, listOptout,
  listRiwayat, setujuiRonde, simpanPengaturan, tambahOptout, type AntreanRow,
} from "@/lib/penagihan/repo";

// Tab "Penagihan ByChat" di modul Piutang MKEsindo: pengaturan, ronde/antrean,
// hasil, opt-out. Tombol aktif/nonaktif per PT ada di /grup/perusahaan.

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export interface AntreanView extends Omit<AntreanRow, "jadwalRencana" | "diprosesPada"> {
  jadwalRencana: string | null;
  diprosesPada: string | null;
}
const view = (a: AntreanRow): AntreanView => ({ ...a, jadwalRencana: iso(a.jadwalRencana), diprosesPada: iso(a.diprosesPada) });

export interface PenagihanState {
  koneksiAda: boolean;
  inboxAda: boolean;
  aktif: boolean;
  pengaturan: Pengaturan;
  contohTemplat: NilaiTemplat;
  contohMitraAsli: boolean;
  jedaSampai: string | null;
  gagalBeruntun: number;
  ronde: { id: number; tanggal: string; status: string; disetujuiOleh: string | null } | null;
  antrean: AntreanView[];
  riwayat: (AntreanView & { tanggalRonde: string })[];
  optout: { id: number; nomor: string; alasan: string | null; sumber: string; dicatatOleh: string | null; createdAt: string }[];
}

export async function getPenagihanStateAction(): Promise<ActionResult<PenagihanState>> {
  return runAction(async () => {
    await requireModuleAccess("aging");
    const pid = await getMkesindoPerusahaanId();
    const [koneksi, aktif, p, ronde, riwayat, optout] = await Promise.all([
      getByChatKoneksi(pid),
      getPenagihanAktif(pid),
      getPengaturan(pid),
      getRonde(pid, waktuWib(new Date()).tanggal),
      listRiwayat(pid, 100),
      listOptout(pid),
    ]);
    const { jedaSampai, gagalBeruntun, tersimpan: _t, ...pengaturan } = p;
    void _t;
    const antrean = ronde ? await listAntrean(ronde.id) : [];
    const [ptRow, rekening] = await Promise.all([
      getPgPool().query<{ nama: string }>(`SELECT nama FROM perusahaan WHERE id = $1`, [pid]),
      getRekeningPembayaran(pid),
    ]);
    // Pratinjau memakai data sungguhan (PT, rekening, tanggal hari ini). Mitra/total/jumlah faktur
    // diambil dari kandidat pertama ronde hari ini bila ada; jika tidak, tetap contoh.
    const kandidat = antrean.find((a) => a.nomor);
    const contohTemplat: NilaiTemplat = {
      ...CONTOH_TEMPLAT,
      pt: ptRow.rows[0].nama,
      tanggal: tglIndo(waktuWib(new Date()).tanggal),
      rekening: formatBlokRekening(rekening),
      ...(kandidat && { mitra: kandidat.mitraNama, total: formatRupiah(kandidat.totalPiutang), jumlah_faktur: String(kandidat.jumlahFaktur) }),
    };
    return {
      contohTemplat,
      contohMitraAsli: kandidat != null,
      koneksiAda: koneksi != null && koneksi.aktif,
      inboxAda: koneksi?.inboxId != null,
      aktif,
      pengaturan,
      jedaSampai: jedaSampai && jedaSampai > new Date() ? jedaSampai.toISOString() : null,
      gagalBeruntun,
      ronde: ronde ? { id: ronde.id, tanggal: ronde.tanggal, status: ronde.status, disetujuiOleh: ronde.disetujuiOleh } : null,
      antrean: antrean.map(view),
      riwayat: riwayat.map((r) => ({ ...view(r), tanggalRonde: r.tanggalRonde })),
      optout: optout.map((o) => ({ id: o.id, nomor: o.nomor, alasan: o.alasan, sumber: o.sumber, dicatatOleh: o.dicatatOleh, createdAt: o.createdAt.toISOString() })),
    };
  });
}

export async function simpanPengaturanPenagihanAction(input: Partial<Pengaturan>): Promise<ActionResult<void>> {
  return runAction(async () => {
    const s = await requireModuleAccess("aging");
    await simpanPengaturan(await getMkesindoPerusahaanId(), input, s.user.email ?? s.user.name ?? "");
  });
}

export async function setujuiRondeAction(rondeId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const s = await requireModuleAccess("aging");
    const pid = await getMkesindoPerusahaanId();
    await setujuiRonde(pid, rondeId, s.user.email ?? s.user.name ?? "");
    const menunggu = (await listAntrean(rondeId)).filter((a) => a.status === "menunggu").length;
    await jadwalUlangAntrean(rondeId, susunJadwal(menunggu, new Date(), await getPengaturan(pid)));
  });
}

export async function batalkanRondeAction(rondeId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireModuleAccess("aging");
    await batalkanRonde(await getMkesindoPerusahaanId(), rondeId);
  });
}

export async function lepasJedaAction(): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireModuleAccess("aging");
    await lepasJeda(await getMkesindoPerusahaanId());
  });
}

export async function tambahOptoutAction(nomor: string, alasan: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const s = await requireModuleAccess("aging");
    await tambahOptout(await getMkesindoPerusahaanId(), nomor, alasan.trim() || null, s.user.email ?? s.user.name ?? "");
  });
}

export async function hapusOptoutAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireModuleAccess("aging");
    await hapusOptout(await getMkesindoPerusahaanId(), id);
  });
}
