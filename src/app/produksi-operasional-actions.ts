"use server";

// Server action Produksi Es Balok — Operasional (PMPersada & PMPakis).
// Spec: docs/superpowers/specs/2026-11-09-produksi-es-balok-operasional-design.md §4, §5, §9.
//
// File "use server": HANYA mengekspor fungsi async (lihat
// src/lib/__tests__/use-server-exports.test.ts). Tipe diimpor langsung dari
// src/lib/produksi-operasional.ts / src/lib/queries/produksi-operasional.ts.
//
// Setiap action lewat gerbang(kode, tingkat): sesi → kode ∈ KODE_SAH → akses
// perusahaan (pola simpanDenahAction) → bolehAksiProduksi ("aksi") atau
// bolehKelolaProduksi ("kelola", action admin). Aturan peran ditegakkan di
// sini, bukan hanya di UI (dicek src/lib/__tests__/produksi-operasional-akses.test.ts).
// Input klien tidak dipercaya: bentuknya diperiksa dan dibangun ulang di sini
// sebelum diteruskan; aturan bisnis (kapasitas, minimal 1 can, dll.) tetap di
// lapisan transaksi.
import { cache } from "react";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";
import { bolehAksiProduksi, bolehKelolaProduksi, peranProduksi } from "@/lib/permissions";
import { canAccessGrup } from "@/lib/require-access";
import { isPmpDeployment } from "@/lib/tenant";
import { denahKosong, type BakElemen, type DenahDokumen, type KodeProduksi, type Varian } from "@/lib/produksi-denah";
import {
  cocokkanMuatan,
  keadaanPabrik,
  peringatanDari,
  ringkasStok,
  tanggalBisnisPanen,
  type BarisCocok,
  type DoKendaraan,
  type KeadaanRek,
  type KendaraanPilihan,
  type MuatanInput,
  type PanenInput,
  type Peringatan,
  type RingkasanStok,
} from "@/lib/produksi-operasional";
import {
  batalkanPanen,
  buangBabonan,
  GalatAksiProduksi,
  getDataPabrik,
  getKendaraanAktif,
  getLog,
  getMuatanHarian,
  getRiwayatOperator,
  isiAir,
  koreksiIsian,
  mulaiMaintenance,
  panen,
  selesaiMaintenance,
  setKendaraanAktif,
  tandaiBabonan,
  type BarisLog,
  type DataPabrik,
  type KodeGalatProduksi,
  type MuatanHarian,
  type Pelaku,
} from "@/lib/queries/produksi-operasional";
import { cariAgen, getDoPerKendaraan, getKendaraanArmada, type KendaraanArmada } from "@/lib/queries/produksi-do-erp";

const KODE_SAH: readonly string[] = ["pmpersada", "pmpakis"];
const BATAS_TEKS = 1000;
const BATAS_CARI_AGEN = 60; // pola LIKE ber-escape harus muat di VarChar(200)
const BATAS_MUATAN = 50; // kendaraan per satu panen
const AKSI_LOG: readonly string[] = [
  "isi_air",
  "panen",
  "tandai_babonan",
  "buang_babonan",
  "mulai_maintenance",
  "selesai_maintenance",
  "koreksi_isian",
  "batal_panen",
];
const JAM_MS = 3_600_000;
const WIB_OFFSET_MS = 7 * JAM_MS;

type HasilAksi<T> = ActionResult<T> | { success: false; error: string; kodeGalat: KodeGalatProduksi };

// ── Gerbang & pembungkus ───────────────────────────────────────────────────

async function gerbang(kode: unknown, tingkat: "aksi" | "kelola"): Promise<{ kode: KodeProduksi; pelaku: Pelaku; admin: boolean }> {
  const session = await auth();
  if (!session?.user) throw new AppError("Sesi berakhir. Silakan masuk kembali.");
  const user = session.user;

  if (typeof kode !== "string" || !KODE_SAH.includes(kode)) throw new AppError("Perusahaan tidak dikenal.");
  if (!isPmpDeployment() || (user.accountScope !== kode && !canAccessGrup(user))) {
    throw new AppError("Anda tidak punya akses ke perusahaan ini.");
  }
  const admin = bolehKelolaProduksi(user);
  if (tingkat === "kelola" ? !admin : !bolehAksiProduksi(user)) {
    throw new AppError(
      tingkat === "kelola" ? "Hanya admin produksi yang boleh melakukan ini." : "Anda tidak punya izin operasional produksi.",
    );
  }
  const nama = user.name?.trim() || user.username;
  return { kode: kode as KodeProduksi, pelaku: { akunId: user.id, nama, peran: peranProduksi(user) }, admin };
}

// runAction + kodeGalat GalatAksiProduksi ikut sampai ke UI (mis. BELUM_SIAP
// → dialog konfirmasi), pola yang sama dengan simpanDenahAction.
async function jalankan<T>(fn: () => Promise<T>): Promise<HasilAksi<T>> {
  let tolak: GalatAksiProduksi | null = null;
  const hasil = await runAction(async () => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GalatAksiProduksi) tolak = err;
      throw err;
    }
  });
  if (hasil.success || !tolak) return hasil;
  const g: GalatAksiProduksi = tolak;
  return { success: false, error: g.message, kodeGalat: g.kodeGalat };
}

function segarkan(kode: KodeProduksi): void {
  revalidatePath(`/${kode}/produksi`);
  revalidatePath(`/${kode}/produksi-app`);
}

// ── Validasi bentuk input ──────────────────────────────────────────────────

function teks(v: unknown, nama: string, maks = BATAS_TEKS): string {
  if (typeof v !== "string") throw new AppError(`${nama} tidak sah.`);
  const t = v.trim();
  if (t.length > maks) throw new AppError(`${nama} terlalu panjang (maks. ${maks} karakter).`);
  return t;
}

function teksWajib(v: unknown, nama: string, maks = BATAS_TEKS): string {
  const t = teks(v, nama, maks);
  if (!t) throw new AppError(`${nama} wajib diisi.`);
  return t;
}

function teksAtauNull(v: unknown, nama: string, maks = BATAS_TEKS): string | null {
  if (v === null || v === undefined) return null;
  return teks(v, nama, maks) || null;
}

function bulat(v: unknown, nama: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new AppError(`${nama} harus bilangan bulat ≥ 0.`);
  return v;
}

function cekBool(v: unknown, nama: string): boolean {
  if (typeof v !== "boolean") throw new AppError(`${nama} tidak sah.`);
  return v;
}

function cekTanggalBisnis(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new AppError("Tanggal harus berformat YYYY-MM-DD.");
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new AppError("Tanggal tidak sah.");
  return v;
}

function cekKendaraan(v: unknown): KendaraanPilihan {
  if (!v || typeof v !== "object") throw new AppError("Kendaraan tidak sah.");
  const o = v as Record<string, unknown>;
  if (o.jenis !== "armada" && o.jenis !== "pembeli") throw new AppError("Jenis kendaraan tidak sah.");
  return {
    jenis: o.jenis,
    kendaraanErpId: teksAtauNull(o.kendaraanErpId, "Kendaraan"),
    plat: o.plat === null || o.plat === undefined ? "" : teks(o.plat, "Plat kendaraan"),
    agenId: teksAtauNull(o.agenId, "Agen"),
    agenNama: teksAtauNull(o.agenNama, "Nama agen"),
  };
}

function cekPanenInput(v: unknown): PanenInput {
  if (!v || typeof v !== "object") throw new AppError("Data panen tidak sah.");
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.muatan) || o.muatan.length > BATAS_MUATAN) throw new AppError("Daftar muatan tidak sah.");
  const muatan: MuatanInput[] = o.muatan.map((m: unknown) => ({
    ...cekKendaraan(m),
    jumlah: bulat((m as Record<string, unknown>).jumlah, "Jumlah muatan"),
  }));
  return {
    isianId: teksWajib(o.isianId, "Isian"),
    muatan,
    babonan: bulat(o.babonan, "Jumlah Babonan"),
    pecah: bulat(o.pecah, "Jumlah pecah"),
    isiUlang: cekBool(o.isiUlang, "Pilihan isi ulang"),
    konfirmasiBelumSiap: cekBool(o.konfirmasiBelumSiap, "Konfirmasi belum siap"),
  };
}

function cekUbahIsian(v: unknown): { mulaiAt?: string; varian?: Varian; sisa?: number } {
  if (!v || typeof v !== "object") throw new AppError("Data koreksi tidak sah.");
  const o = v as Record<string, unknown>;
  const ubah: { mulaiAt?: string; varian?: Varian; sisa?: number } = {};
  if (o.mulaiAt !== undefined) ubah.mulaiAt = teksWajib(o.mulaiAt, "Waktu isi air", 100);
  if (o.varian !== undefined) {
    if (o.varian !== "kecil" && o.varian !== "besar") throw new AppError("Varian tidak sah.");
    ubah.varian = o.varian;
  }
  if (o.sisa !== undefined) ubah.sisa = bulat(o.sisa, "Sisa can");
  return ubah;
}

// ── Waktu ──────────────────────────────────────────────────────────────────

function geserTanggal(tanggal: string, hari: number): string {
  const [y, m, d] = tanggal.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + hari)).toISOString().slice(0, 10);
}

/** Awal shift yang sedang berjalan (selaras shiftDari: 07:00 / 15:00 / 23:00 WIB). */
function awalShift(t: Date): Date {
  const w = new Date(t.getTime() + WIB_OFFSET_MS);
  const jam = w.getUTCHours();
  const mulaiJam = jam >= 23 || jam < 7 ? 23 : jam >= 15 ? 15 : 7;
  const geserHari = jam < 7 ? -1 : 0;
  return new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate() + geserHari, mulaiJam) - WIB_OFFSET_MS);
}

// ── Pencocokan ─────────────────────────────────────────────────────────────

function doBersih(dos: DoKendaraan[]): DoKendaraan[] {
  return dos.map((d) => ({ ...d, plat: d.plat ?? "" }));
}

async function hitungPencocokan(kode: KodeProduksi, tanggalBisnis: string): Promise<{ baris: BarisCocok[]; muatan: MuatanHarian }> {
  const [muatan, dos] = await Promise.all([getMuatanHarian(kode, tanggalBisnis), getDoPerKendaraan(kode, tanggalBisnis)]);
  return { baris: cocokkanMuatan(muatan.armada, doBersih(dos)), muatan };
}

// Selisih muatan untuk peringatan: hari bisnis terakhir yang SUDAH closing.
// Di-cache per request saja (React cache), tanpa job terjadwal. ERP yang
// tidak terjangkau tidak boleh mematikan peta: peringatan selisih dilewati.
const selisihClosingTerakhir = cache(async (kode: KodeProduksi, tanggalBisnis: string): Promise<BarisCocok[]> => {
  try {
    return (await hitungPencocokan(kode, tanggalBisnis)).baris;
  } catch (err) {
    console.error("[produksi-operasional] gagal menghitung selisih muatan", err);
    return [];
  }
});

function pembuatLabel(denah: DenahDokumen): (kolomId: string) => string {
  const peta = new Map<string, string>();
  for (const e of denah.elemen) {
    if (e.tipe !== "bak") continue;
    const bak = e as BakElemen;
    for (const k of bak.kolom) peta.set(k.id, `${bak.nama} – Rek ${k.nomor}`);
  }
  return (kolomId) => peta.get(kolomId) ?? "Rek tidak dikenal";
}

// ── Baca ───────────────────────────────────────────────────────────────────

export async function getKeadaanAction(
  kode: KodeProduksi,
): Promise<HasilAksi<{ data: DataPabrik; keadaan: KeadaanRek[]; peringatan: Peringatan[]; ringkasan: RingkasanStok }>> {
  return jalankan(async () => {
    const g = await gerbang(kode, "aksi");
    const data = await getDataPabrik(g.kode);
    const sekarang = new Date(data.sekarang);
    const denah = data.denah ?? denahKosong();
    const keadaan = keadaanPabrik(denah, data.isian, data.maintenance, sekarang);
    // Data DO bersifat pengawasan (spec §9): selisih muatan hanya untuk admin.
    const selisih = g.admin ? await selisihClosingTerakhir(g.kode, geserTanggal(tanggalBisnisPanen(sekarang), -1)) : [];
    const peringatan = peringatanDari({
      keadaan,
      kosongSejak: data.kosongSejak,
      panenBelumSiap: data.panenBelumSiap,
      selisih,
      sekarang,
      label: pembuatLabel(denah),
    });
    return { data, keadaan, peringatan, ringkasan: ringkasStok(denah, keadaan) };
  });
}

export async function getPilihanKendaraanAction(
  kode: KodeProduksi,
): Promise<HasilAksi<{ armada: KendaraanArmada[]; aktif: KendaraanPilihan | null }>> {
  return jalankan(async () => {
    const g = await gerbang(kode, "aksi");
    const [armada, aktif] = await Promise.all([getKendaraanArmada(g.kode), getKendaraanAktif(g.pelaku.akunId, g.kode)]);
    return { armada: armada.map((a) => ({ ...a, plat: a.plat ?? "" })), aktif };
  });
}

export async function cariAgenAction(kode: KodeProduksi, q: string): Promise<HasilAksi<{ agenId: string; nama: string }[]>> {
  return jalankan(async () => {
    const g = await gerbang(kode, "aksi");
    return cariAgen(g.kode, teks(q, "Kata kunci", BATAS_CARI_AGEN));
  });
}

export async function getRiwayatSayaAction(kode: KodeProduksi): Promise<HasilAksi<{ log: BarisLog[]; muatanHariIni: MuatanHarian }>> {
  return jalankan(async () => {
    const g = await gerbang(kode, "aksi");
    const sekarang = new Date();
    const [log, muatanHariIni] = await Promise.all([
      getRiwayatOperator(g.kode, g.pelaku.akunId, awalShift(sekarang).toISOString()),
      getMuatanHarian(g.kode, tanggalBisnisPanen(sekarang)),
    ]);
    return { log, muatanHariIni };
  });
}

export async function getPencocokanAction(
  kode: KodeProduksi,
  tanggalBisnis: string,
): Promise<HasilAksi<{ baris: BarisCocok[]; muatan: MuatanHarian; sementara: boolean }>> {
  return jalankan(async () => {
    const g = await gerbang(kode, "kelola");
    const tanggal = cekTanggalBisnis(tanggalBisnis);
    const { baris, muatan } = await hitungPencocokan(g.kode, tanggal);
    return { baris, muatan, sementara: tanggal >= tanggalBisnisPanen(new Date()) };
  });
}

export async function getLogAction(
  kode: KodeProduksi,
  filter: { dari: string; sampai: string; akunId?: string; bakId?: string; aksi?: string; batas?: number },
): Promise<HasilAksi<BarisLog[]>> {
  return jalankan(async () => {
    const g = await gerbang(kode, "kelola");
    if (!filter || typeof filter !== "object") throw new AppError("Filter log tidak sah.");
    const aksi = teksAtauNull(filter.aksi, "Aksi") ?? undefined;
    if (aksi !== undefined && !AKSI_LOG.includes(aksi)) throw new AppError("Jenis aksi tidak dikenal.");
    const batas = filter.batas === undefined ? 1000 : bulat(filter.batas, "Batas baris");
    return getLog(
      g.kode,
      {
        dari: teksWajib(filter.dari, "Tanggal awal", 100),
        sampai: teksWajib(filter.sampai, "Tanggal akhir", 100),
        akunId: teksAtauNull(filter.akunId, "Operator") ?? undefined,
        bakId: teksAtauNull(filter.bakId, "Bak") ?? undefined,
        aksi,
      },
      batas,
    );
  });
}

// ── Tulis (operator & admin) ───────────────────────────────────────────────

export async function isiAirAction(kode: KodeProduksi, kolomId: string, jumlah: number | null): Promise<HasilAksi<{ isianId: string }>> {
  return jalankan(async () => {
    const g = await gerbang(kode, "aksi");
    const r = await isiAir(g.kode, teksWajib(kolomId, "Rek"), jumlah === null ? null : bulat(jumlah, "Jumlah can"), g.pelaku);
    segarkan(g.kode);
    return r;
  });
}

export async function panenAction(kode: KodeProduksi, input: PanenInput): Promise<HasilAksi<{ panenId: string; isianBaruId: string | null }>> {
  return jalankan(async () => {
    const g = await gerbang(kode, "aksi");
    const r = await panen(g.kode, cekPanenInput(input), g.pelaku);
    segarkan(g.kode);
    return r;
  });
}

export async function tandaiBabonanAction(kode: KodeProduksi, isianId: string, jumlah: number): Promise<HasilAksi<void>> {
  return jalankan(async () => {
    const g = await gerbang(kode, "aksi");
    await tandaiBabonan(g.kode, teksWajib(isianId, "Isian"), bulat(jumlah, "Jumlah can Babonan"), g.pelaku);
    segarkan(g.kode);
  });
}

export async function buangBabonanAction(kode: KodeProduksi, kolomId: string, jumlah: number, alasan: string): Promise<HasilAksi<void>> {
  return jalankan(async () => {
    const g = await gerbang(kode, "aksi");
    await buangBabonan(g.kode, teksWajib(kolomId, "Rek"), bulat(jumlah, "Jumlah can dibuang"), teks(alasan ?? "", "Alasan"), g.pelaku);
    segarkan(g.kode);
  });
}

export async function mulaiMaintenanceAction(kode: KodeProduksi, kolomId: string, catatan: string): Promise<HasilAksi<void>> {
  return jalankan(async () => {
    const g = await gerbang(kode, "aksi");
    await mulaiMaintenance(g.kode, teksWajib(kolomId, "Rek"), teks(catatan ?? "", "Catatan"), g.pelaku);
    segarkan(g.kode);
  });
}

export async function selesaiMaintenanceAction(kode: KodeProduksi, kolomId: string): Promise<HasilAksi<void>> {
  return jalankan(async () => {
    const g = await gerbang(kode, "aksi");
    await selesaiMaintenance(g.kode, teksWajib(kolomId, "Rek"), g.pelaku);
    segarkan(g.kode);
  });
}

export async function setKendaraanAktifAction(kode: KodeProduksi, k: KendaraanPilihan): Promise<HasilAksi<void>> {
  return jalankan(async () => {
    const g = await gerbang(kode, "aksi");
    await setKendaraanAktif(g.pelaku.akunId, g.kode, cekKendaraan(k));
    segarkan(g.kode);
  });
}

export async function koreksiIsianAction(
  kode: KodeProduksi,
  isianId: string,
  ubah: { mulaiAt?: string; varian?: Varian; sisa?: number },
  alasan: string,
): Promise<HasilAksi<void>> {
  return jalankan(async () => {
    const g = await gerbang(kode, "kelola");
    await koreksiIsian(g.kode, teksWajib(isianId, "Isian"), cekUbahIsian(ubah), teksWajib(alasan, "Alasan koreksi"), g.pelaku);
    segarkan(g.kode);
  });
}

export async function batalkanPanenAction(kode: KodeProduksi, panenId: string, alasan: string): Promise<HasilAksi<void>> {
  return jalankan(async () => {
    const g = await gerbang(kode, "kelola");
    await batalkanPanen(g.kode, teksWajib(panenId, "Panen"), teksWajib(alasan, "Alasan pembatalan"), g.pelaku);
    segarkan(g.kode);
  });
}
