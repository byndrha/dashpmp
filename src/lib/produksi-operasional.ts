// Logika murni modul Produksi Es Balok — Operasional (siklus rek, panen per
// muatan, pencocokan panen ↔ DO, peringatan). Tidak boleh mengimpor apa pun
// dari server (pg, mssql, next/*) — dipakai di server action DAN di klien.
//
// "Rek" = DenahKolom. Satu rek bisa memuat beberapa isian (kelompok can yang
// diisi air bersamaan): isian `produksi` biasa dan paling banyak satu isian
// `babonan` (can penjaga suhu, termasuk es pecah).

import { getBusinessDateWithRollover, ROLLOVER_HOUR } from "./business-date";
import type { BakElemen, DenahDokumen, DenahKolom, Varian } from "./produksi-denah";

// Jam closing hari bisnis panen & DO (13:59 masih hari ini, 14:00 sudah besok).
// Dipisah dari ROLLOVER_HOUR app-wide supaya bisa diganti sendiri.
export const ROLLOVER_PANEN_JAM = ROLLOVER_HOUR;

// Semua ambang peringatan (jam/persen) di satu tempat.
export const AMBANG = {
  terlambatTambahJam: 12,
  babonanJam: 48,
  maintenanceJam: 72,
  kosongJam: 6,
  panenBelumSiapPersen: 75,
  panenBelumSiapJendelaJam: 24,
} as const;

export type JenisIsian = "produksi" | "babonan";
export type Tahap = "air" | "mulai" | "kristal" | "siap" | "jadi";

export interface IsianAktif {
  id: string;
  kolomId: string;
  bakId: string;
  jenis: JenisIsian;
  varian: Varian;
  jumlahAwal: number;
  sisa: number;
  pecah: number;
  mulaiAt: string;
  durasiBekuJam: number | null;
  diisiOlehNama: string;
  /** Posisi can yang ditempati (1..jumlahIceCan); panjang = sisa. */
  slot: number[];
  /** Can pecah yang tetap di can (⊆ slot); selalu [] untuk produksi. */
  slotPecah: number[];
}

// Susunan tampilan can per rek (hanya konstanta tampilan): BK 12 × 3, BB 9 × 2.
export const SUSUNAN_CAN: Record<Varian, { kolom: number; baris: number }> = {
  kecil: { kolom: 12, baris: 3 },
  besar: { kolom: 9, baris: 2 },
};

/** Can rusak aktif (belum "Sudah diperbaiki"). Slot rusak dilewati saat Isi Air. */
export interface SlotRusak {
  id: string;
  kolomId: string;
  slot: number;
  mulaiAt: string;
  catatan: string;
}

export type JenisCan = "kosong" | "produksi" | "babonan" | "pecah" | "rusak";

export interface KeadaanCan {
  slot: number;
  jenis: JenisCan;
  isianId: string | null;
  pct: number | null;
  tahap: Tahap | null;
}

export interface MaintenanceAktif {
  id: string;
  kolomId: string;
  mulaiAt: string;
  catatan: string;
  dibukaOlehNama: string;
}

export type KeadaanUtama = "kosong" | "berisi" | "babonan" | "maintenance" | "nonaktif";

export interface KeadaanRek {
  kolomId: string;
  bakId: string;
  nomor: number;
  varian: Varian;
  kapasitas: number;
  utama: KeadaanUtama;
  pct: number | null;
  tahap: Tahap | null;
  usiaMenit: number | null;
  estimasiMatang: string | null;
  /** = slotKosong.length */
  canKosong: number;
  babonan: number;
  /** Satu entri per slot 1..kapasitas. */
  can: KeadaanCan[];
  /** Slot kosong yang tidak rusak (target Isi Air). */
  slotKosong: number[];
  /** Jumlah slot rusak (tidak ditempati isian). */
  rusak: number;
  /**
   * Ada isian aktif yang slotnya belum dicatat (|slot| ≠ sisa, atau Babonan
   * |slotPecah| ≠ pecah — mis. sebelum backfill slot can). Grid can rek ini
   * tidak bisa dipercaya: slotKosong dikosongkan, rek tidak masuk tugas
   * isi air/panen, dan server menolak aksi slot di rek ini.
   */
  slotBelumSiap: boolean;
  /** Urut FIFO (mulaiAt tertua dulu); durasiBekuJam null sudah diisi dari bak. */
  isianProduksi: IsianAktif[];
  isianBabonan: IsianAktif | null;
  maintenance: MaintenanceAktif | null;
}

export interface KendaraanPilihan {
  jenis: "armada" | "pembeli";
  kendaraanErpId: string | null;
  plat: string;
  agenId: string | null;
  agenNama: string | null;
}

export interface MuatanInput extends KendaraanPilihan {
  jumlah: number;
}

/** Pesan bila rek punya isian aktif yang slotnya belum dicatat (lihat KeadaanRek.slotBelumSiap). */
export const PESAN_SLOT_BELUM_SIAP = "Data slot rek belum siap — hubungi admin (jalankan backfill slot).";

const JAM_MS = 3_600_000;
const WIB_OFFSET_MS = 7 * JAM_MS;

// ── Kematangan ─────────────────────────────────────────────────────────────

export function hitungKematangan(mulaiAt: Date, durasiBekuJam: number, sekarang: Date): number {
  if (!(durasiBekuJam > 0)) return 100;
  const pct = Math.round(((sekarang.getTime() - mulaiAt.getTime()) / (durasiBekuJam * JAM_MS)) * 100);
  return Math.min(100, Math.max(0, pct));
}

export function tahapDari(pct: number): Tahap {
  if (pct <= 0) return "air";
  if (pct < 50) return "mulai";
  if (pct < 75) return "kristal";
  if (pct < 100) return "siap";
  return "jadi";
}

// ── Waktu: shift & tanggal bisnis ──────────────────────────────────────────

/** Shift 1 07:00–14:59, Shift 2 15:00–22:59, Shift 3 23:00–06:59 (jam WIB). */
export function shiftDari(t: Date): 1 | 2 | 3 {
  const jamWib = new Date(t.getTime() + WIB_OFFSET_MS).getUTCHours();
  if (jamWib >= 7 && jamWib < 15) return 1;
  if (jamWib >= 15 && jamWib < 23) return 2;
  return 3;
}

/** Tanggal bisnis "YYYY-MM-DD" sebuah instant nyata (mis. panen_at), WIB, closing ROLLOVER_PANEN_JAM. */
export function tanggalBisnisPanen(t: Date): string {
  return getBusinessDateWithRollover(ROLLOVER_PANEN_JAM, t).toISOString().slice(0, 10);
}

/** Sama, untuk DATETIME ERP naive WIB (komponen UTC = jam dinding WIB, mis. PMP_Penjadwalan.Tanggal). */
export function tanggalBisnisNaive(naiveWib: Date): string {
  const geser = naiveWib.getUTCHours() >= ROLLOVER_PANEN_JAM ? 1 : 0;
  return new Date(Date.UTC(naiveWib.getUTCFullYear(), naiveWib.getUTCMonth(), naiveWib.getUTCDate() + geser))
    .toISOString()
    .slice(0, 10);
}

// ── Keadaan rek ────────────────────────────────────────────────────────────

function durasiIsian(bak: BakElemen, i: IsianAktif): number {
  return i.durasiBekuJam ?? bak.durasiBekuJam[i.varian];
}

export function keadaanRek(
  bak: BakElemen,
  kolom: DenahKolom,
  isian: IsianAktif[],
  mt: MaintenanceAktif | null,
  sekarang: Date,
  rusak: SlotRusak[] = [],
): KeadaanRek {
  const milikRek = isian.filter((i) => i.kolomId === kolom.id && i.sisa > 0);
  const isianProduksi = milikRek
    .filter((i) => i.jenis === "produksi")
    .map((i) => ({ ...i, durasiBekuJam: durasiIsian(bak, i) }))
    .sort((a, b) => Date.parse(a.mulaiAt) - Date.parse(b.mulaiAt));
  const daftarBabonan = milikRek.filter((i) => i.jenis === "babonan");
  const babonan = daftarBabonan.reduce((s, i) => s + i.sisa, 0);
  const can = susunCan(kolom, isianProduksi, daftarBabonan, rusak, sekarang);
  const slotBelumSiap = milikRek.some(
    (i) => i.slot.length !== i.sisa || (i.jenis === "babonan" && i.slotPecah.length !== i.pecah),
  );
  const slotKosong = slotBelumSiap ? [] : can.filter((c) => c.jenis === "kosong").map((c) => c.slot);
  const maintenance = mt && mt.kolomId === kolom.id ? mt : null;

  let pct: number | null = null;
  let usiaMenit: number | null = null;
  let estimasiMatang: string | null = null;
  const tertua = isianProduksi[0];
  if (tertua) {
    const mulai = new Date(tertua.mulaiAt);
    const durasi = tertua.durasiBekuJam;
    pct = hitungKematangan(mulai, durasi, sekarang);
    usiaMenit = Math.floor((sekarang.getTime() - mulai.getTime()) / 60_000);
    estimasiMatang = new Date(mulai.getTime() + durasi * JAM_MS).toISOString();
  }

  let utama: KeadaanUtama = "kosong";
  if (kolom.nonaktif) utama = "nonaktif";
  else if (maintenance) utama = "maintenance";
  else if (isianProduksi.length > 0) utama = "berisi";
  else if (daftarBabonan.length > 0) utama = "babonan";

  return {
    kolomId: kolom.id,
    bakId: bak.id,
    nomor: kolom.nomor,
    varian: kolom.varian,
    kapasitas: kolom.jumlahIceCan,
    utama,
    pct,
    tahap: pct === null ? null : tahapDari(pct),
    usiaMenit,
    estimasiMatang,
    canKosong: slotKosong.length,
    babonan,
    can,
    slotKosong,
    rusak: can.filter((c) => c.jenis === "rusak").length,
    slotBelumSiap,
    isianProduksi,
    isianBabonan: daftarBabonan[0] ?? null,
    maintenance,
  };
}

// Bangun keadaan per slot: isian produksi (FIFO, yang tertua menang bila data
// beririsan), lalu Babonan/pecah, lalu rusak, sisanya kosong. Slot di luar
// 1..kapasitas diabaikan.
function susunCan(
  kolom: DenahKolom,
  isianProduksi: IsianAktif[],
  daftarBabonan: IsianAktif[],
  rusak: SlotRusak[],
  sekarang: Date,
): KeadaanCan[] {
  const kapasitas = kolom.jumlahIceCan;
  const can: KeadaanCan[] = Array.from({ length: kapasitas }, (_, i) => ({
    slot: i + 1,
    jenis: "kosong",
    isianId: null,
    pct: null,
    tahap: null,
  }));
  const isi = (slot: number, c: Omit<KeadaanCan, "slot">) => {
    if (!Number.isInteger(slot) || slot < 1 || slot > kapasitas) return;
    if (can[slot - 1].jenis !== "kosong") return;
    can[slot - 1] = { slot, ...c };
  };

  for (const i of isianProduksi) {
    const pct = hitungKematangan(new Date(i.mulaiAt), i.durasiBekuJam ?? 0, sekarang);
    const tahap = tahapDari(pct);
    for (const s of i.slot) isi(s, { jenis: "produksi", isianId: i.id, pct, tahap });
  }
  for (const i of daftarBabonan) {
    const pecah = new Set(i.slotPecah);
    for (const s of i.slot) isi(s, { jenis: pecah.has(s) ? "pecah" : "babonan", isianId: i.id, pct: null, tahap: null });
  }
  for (const r of rusak) {
    if (r.kolomId !== kolom.id) continue;
    isi(r.slot, { jenis: "rusak", isianId: null, pct: null, tahap: null });
  }
  return can;
}

function daftarBak(denah: DenahDokumen): BakElemen[] {
  return denah.elemen.filter((e): e is BakElemen => e.tipe === "bak");
}

function kelompokkan<T extends { kolomId: string }>(daftar: T[]): Map<string, T[]> {
  const peta = new Map<string, T[]>();
  for (const x of daftar) {
    const l = peta.get(x.kolomId);
    if (l) l.push(x);
    else peta.set(x.kolomId, [x]);
  }
  return peta;
}

export function keadaanPabrik(
  denah: DenahDokumen,
  isian: IsianAktif[],
  mt: MaintenanceAktif[],
  sekarang: Date,
  rusak: SlotRusak[] = [],
): KeadaanRek[] {
  const isianPerKolom = kelompokkan(isian);
  const rusakPerKolom = kelompokkan(rusak);
  const mtPerKolom = new Map(mt.map((m) => [m.kolomId, m]));
  return daftarBak(denah).flatMap((bak) =>
    bak.kolom.map((kolom) =>
      keadaanRek(
        bak,
        kolom,
        isianPerKolom.get(kolom.id) ?? [],
        mtPerKolom.get(kolom.id) ?? null,
        sekarang,
        rusakPerKolom.get(kolom.id) ?? [],
      ),
    ),
  );
}

// ── Ringkasan bak & tugas sekarang ─────────────────────────────────────────

export interface RingkasanBak {
  bakId: string;
  siap: number;
  kosong: number;
  babonan: number;
  rusak: number;
}

function adaProduksiSiap(k: KeadaanRek): boolean {
  return k.pct !== null && k.pct >= AMBANG.panenBelumSiapPersen;
}

/**
 * Jumlah REK per kategori per bak, urut bak sesuai `keadaan`. Rek nonaktif
 * tidak dihitung; rek maintenance tidak dihitung siap/kosong (sama dengan
 * tugasSekarang). kosong = ada slot kosong tak rusak yang bisa diisi
 * (termasuk rek terisi sebagian dan rek Babonan saja).
 */
export function ringkasBak(keadaan: KeadaanRek[]): RingkasanBak[] {
  const peta = new Map<string, RingkasanBak>();
  for (const k of keadaan) {
    let r = peta.get(k.bakId);
    if (!r) {
      r = { bakId: k.bakId, siap: 0, kosong: 0, babonan: 0, rusak: 0 };
      peta.set(k.bakId, r);
    }
    if (k.utama === "nonaktif") continue;
    const bisaDikerjakan = k.utama !== "maintenance" && !k.slotBelumSiap;
    if (bisaDikerjakan && adaProduksiSiap(k)) r.siap++;
    if (bisaDikerjakan && k.slotKosong.length > 0) r.kosong++;
    if (k.isianBabonan) r.babonan++;
    if (k.rusak > 0) r.rusak++;
  }
  return [...peta.values()];
}

export type JenisTugas = "panen" | "isi-air" | "babonan-lama";

export interface Tugas {
  jenis: JenisTugas;
  kolomId: string;
  bakId: string;
  nomor: number;
  pct: number | null;
  sejak: string;
}

/**
 * Daftar "apa yang harus dikerjakan sekarang" (rek nonaktif & maintenance
 * dilewati): panen (isian produksi tertua ≥ ambang siap, FIFO tertua dulu) →
 * isi air (rek yang punya slot kosong tak rusak, termasuk rek terisi
 * sebagian / Babonan saja; paling lama kosong dulu — `sejak` =
 * kosongSejak[kolomId] bila ada, selain itu `sekarang` sehingga di urutan akhir)
 * → Babonan lama (> AMBANG.babonanJam, tertua dulu).
 */
export function tugasSekarang(keadaan: KeadaanRek[], kosongSejak: Record<string, string>, sekarang: Date): Tugas[] {
  const panen: Tugas[] = [];
  const isiAir: Tugas[] = [];
  const babonanLama: Tugas[] = [];
  for (const k of keadaan) {
    if (k.utama === "nonaktif" || k.utama === "maintenance") continue;
    const dasar = { kolomId: k.kolomId, bakId: k.bakId, nomor: k.nomor };
    const tertua = k.isianProduksi[0];
    // Slot belum dicatat: aksi slot ditolak server; tampil sebagai peringatan.
    if (!k.slotBelumSiap && tertua && adaProduksiSiap(k)) panen.push({ jenis: "panen", ...dasar, pct: k.pct, sejak: tertua.mulaiAt });
    if (!k.slotBelumSiap && k.slotKosong.length > 0) {
      isiAir.push({ jenis: "isi-air", ...dasar, pct: null, sejak: kosongSejak[k.kolomId] ?? sekarang.toISOString() });
    }
    if (k.isianBabonan && lebihDariJam(k.isianBabonan.mulaiAt, AMBANG.babonanJam, sekarang)) {
      babonanLama.push({ jenis: "babonan-lama", ...dasar, pct: null, sejak: k.isianBabonan.mulaiAt });
    }
  }
  const tertuaDulu = (a: Tugas, b: Tugas) => Date.parse(a.sejak) - Date.parse(b.sejak);
  return [...panen.sort(tertuaDulu), ...isiAir.sort(tertuaDulu), ...babonanLama.sort(tertuaDulu)];
}

// ── Validasi panen per slot ────────────────────────────────────────────────

export interface PanenSlotInput {
  muatan: MuatanInput[];
  /** Isian produksi: slot yang dipindah ke Babonan. */
  slotBabonan: number[];
  /** Isian produksi: slot pecah (ikut ke Babonan sebagai pecah). */
  slotPecah: number[];
  /** Isian Babonan: slot yang dimuat ke kendaraan. */
  slotDimuat?: number[];
}

// Daftar slot sah: integer, unik, ⊆ boleh. `nama` untuk pesan. null = sah.
function cekSubsetSlot(pilihan: number[], boleh: Set<number>, nama: string): string | null {
  const terpakai = new Set<number>();
  for (const s of pilihan) {
    if (!Number.isInteger(s)) return `Nomor slot ${nama} harus bilangan bulat.`;
    if (terpakai.has(s)) return `Slot ${s} dipilih dua kali sebagai ${nama}.`;
    if (!boleh.has(s)) return `Slot ${s} tidak bisa dipilih sebagai ${nama}.`;
    terpakai.add(s);
  }
  return null;
}

/** Pilihan slot sah: tidak kosong, integer, unik, ⊆ boleh. null = sah. */
export function validasiPilihSlot(pilihan: number[], boleh: number[]): string | null {
  if (pilihan.length === 0) return "Pilih minimal satu can.";
  return cekSubsetSlot(pilihan, new Set(boleh), "pilihan");
}

/** Slot yang dimuat ke kendaraan (urut naik). */
export function slotDimuatDari(isian: Pick<IsianAktif, "jenis" | "slot">, input: PanenSlotInput): number[] {
  if (isian.jenis === "babonan") return [...(input.slotDimuat ?? [])].sort((a, b) => a - b);
  const keluar = new Set([...input.slotBabonan, ...input.slotPecah]);
  return isian.slot.filter((s) => !keluar.has(s)).sort((a, b) => a - b);
}

/**
 * Validasi panen berbasis slot. Produksi: slotBabonan & slotPecah ⊆ slot,
 * saling lepas, Σ muatan = |slot| − |slotBabonan| − |slotPecah|. Babonan:
 * slotDimuat ⊆ slot \ slotPecah (es pecah tidak dijual), Σ muatan =
 * |slotDimuat|. Bentuk muatan: lihat cekDaftarMuatan. null = sah.
 */
export function validasiPanenSlot(
  isian: Pick<IsianAktif, "jenis" | "slot" | "slotPecah">,
  input: PanenSlotInput,
): string | null {
  const { muatan, slotBabonan, slotPecah } = input;
  const galatMuatan = cekDaftarMuatan(muatan);
  if (galatMuatan) return galatMuatan;
  const dimuat = muatan.reduce((s, m) => s + m.jumlah, 0);
  const milik = new Set(isian.slot);

  if (isian.jenis === "babonan") {
    if (slotBabonan.length > 0 || slotPecah.length > 0) return "Can Babonan tidak bisa dipindah lagi ke Babonan atau pecah.";
    const slotDimuat = input.slotDimuat ?? [];
    if (slotDimuat.length === 0) return "Belum ada can Babonan yang dimuat.";
    const pecah = new Set(isian.slotPecah);
    for (const s of slotDimuat) if (pecah.has(s)) return `Slot ${s} berisi es pecah dan tidak bisa dimuat.`;
    const galat = cekSubsetSlot(slotDimuat, milik, "dimuat");
    if (galat) return galat;
    if (dimuat !== slotDimuat.length) return `Jumlah muatan harus ${slotDimuat.length} can (sekarang ${dimuat}).`;
    return null;
  }

  const galatBab = cekSubsetSlot(slotBabonan, milik, "Babonan") ?? cekSubsetSlot(slotPecah, milik, "pecah");
  if (galatBab) return galatBab;
  const setBabonan = new Set(slotBabonan);
  for (const s of slotPecah) if (setBabonan.has(s)) return `Slot ${s} tidak bisa sekaligus Babonan dan pecah.`;
  const harus = isian.slot.length - slotBabonan.length - slotPecah.length;
  if (dimuat !== harus) return `Jumlah dimuat harus ${harus} can (sekarang ${dimuat}).`;
  return null;
}

/**
 * Koreksi admin "Ubah kendaraan" sebuah panen: daftar muatan baru harus sah
 * (jumlah > 0, kendaraan unik) dan Σ jumlah = dimuat panen (dimuat tidak
 * berubah — yang dikoreksi hanya pembagian ke kendaraan). null = sah.
 */
export function validasiKoreksiMuatan(dimuat: number, muatan: MuatanInput[]): string | null {
  if (!(dimuat > 0)) return "Panen ini tidak memuat can ke kendaraan; tidak ada muatan untuk dikoreksi.";
  if (muatan.length === 0) return "Tambahkan minimal satu kendaraan.";
  const galatMuatan = cekDaftarMuatan(muatan);
  if (galatMuatan) return galatMuatan;
  const total = muatan.reduce((s, m) => s + m.jumlah, 0);
  if (total !== dimuat) return `Jumlah muatan harus ${dimuat} can (sama dengan yang dipanen), sekarang ${total}.`;
  return null;
}

// Bentuk daftar muatan: jumlah > 0, kendaraan terisi, kendaraan unik.
function cekDaftarMuatan(muatan: MuatanInput[]): string | null {
  const kunciTerpakai = new Set<string>();
  for (const m of muatan) {
    if (!Number.isInteger(m.jumlah) || m.jumlah <= 0) return "Jumlah setiap muatan harus bilangan bulat lebih dari 0.";
    const plat = m.plat.trim();
    let kunci: string;
    if (m.jenis === "armada") {
      if (!m.kendaraanErpId) return "Kendaraan armada belum dipilih.";
      kunci = `armada:${m.kendaraanErpId}`;
    } else {
      if (!plat) return "Plat kendaraan pembeli wajib diisi.";
      kunci = `pembeli:${plat.toUpperCase().replace(/\s+/g, " ")}`;
    }
    if (kunciTerpakai.has(kunci)) return `Kendaraan ${plat || m.kendaraanErpId} tercatat dua kali dalam satu panen.`;
    kunciTerpakai.add(kunci);
  }
  return null;
}

// ── Ringkasan stok ─────────────────────────────────────────────────────────

export interface RingkasanStok {
  sehat: number;
  air: number;
  proses: number;
  matang: number;
  babonan: number;
  maintenance: number;
  perBak: { bakId: string; nama: string; kapasitas: number; terisi: number }[];
}

// Tahap dihitung PER ISIAN (mulaiAt + durasi beku masing-masing), bukan
// mengikuti tahap rek: rek berisi 34 can jadi + 2 can yang baru diisi air
// terhitung 34 matang + 2 air. `sekarang` = jam server keadaan (wajib).
export function ringkasStok(denah: DenahDokumen, keadaan: KeadaanRek[], sekarang: Date): RingkasanStok {
  const r: RingkasanStok = { sehat: 0, air: 0, proses: 0, matang: 0, babonan: 0, maintenance: 0, perBak: [] };
  const perBak = new Map<string, { kapasitas: number; terisi: number }>();
  let kapasitasAktif = 0;

  for (const k of keadaan) {
    let produksi = 0;
    for (const i of k.isianProduksi) {
      if (i.sisa <= 0) continue;
      produksi += i.sisa;
      const tahap = tahapDari(hitungKematangan(new Date(i.mulaiAt), i.durasiBekuJam ?? 0, sekarang));
      if (tahap === "air") r.air += i.sisa;
      else if (tahap === "jadi") r.matang += i.sisa;
      else r.proses += i.sisa;
    }
    r.babonan += k.babonan;

    const b = perBak.get(k.bakId) ?? { kapasitas: 0, terisi: 0 };
    b.terisi += produksi + k.babonan;
    if (k.utama !== "nonaktif") {
      b.kapasitas += k.kapasitas;
      kapasitasAktif += k.kapasitas;
      if (k.utama === "maintenance") r.maintenance += k.kapasitas;
    }
    perBak.set(k.bakId, b);
  }

  r.sehat = kapasitasAktif - r.maintenance;
  r.perBak = daftarBak(denah).map((bak) => ({
    bakId: bak.id,
    nama: bak.nama,
    kapasitas: perBak.get(bak.id)?.kapasitas ?? 0,
    terisi: perBak.get(bak.id)?.terisi ?? 0,
  }));
  return r;
}

/**
 * Estimasi can yang "jadi" dalam `jam` ke depan (perencanaan muatan, spec §8):
 * Σ sisa isian produksi dengan mulaiAt + durasi beku ≤ sekarang + jam.
 * Termasuk can yang sudah jadi (`sudahJadi`) — keduanya siap dimuat.
 */
export function estimasiCanJadi(keadaan: KeadaanRek[], sekarang: Date, jam: number): { total: number; sudahJadi: number } {
  const batas = sekarang.getTime() + jam * JAM_MS;
  let total = 0;
  let sudahJadi = 0;
  for (const k of keadaan) {
    for (const i of k.isianProduksi) {
      if (i.sisa <= 0) continue;
      const matang = Date.parse(i.mulaiAt) + (i.durasiBekuJam ?? 0) * JAM_MS;
      if (matang <= batas) total += i.sisa;
      if (matang <= sekarang.getTime()) sudahJadi += i.sisa;
    }
  }
  return { total, sudahJadi };
}

// ── Pencocokan panen ↔ DO ──────────────────────────────────────────────────

export interface MuatanKendaraan {
  kendaraanErpId: string;
  plat: string;
  kecil: number;
  besar: number;
  jumlahPanen: number;
  operator: string[];
}

export interface DoKendaraan {
  kendaraanErpId: string;
  plat: string;
  kecil: number;
  besar: number;
  noDo: string[];
}

export type StatusCocok = "cocok" | "panen-lebih" | "do-lebih" | "hanya-do" | "hanya-panen";

export interface BarisCocok {
  kendaraanErpId: string;
  plat: string;
  panenKecil: number;
  panenBesar: number;
  doKecil: number;
  doBesar: number;
  selisihKecil: number;
  selisihBesar: number;
  status: StatusCocok;
  noDo: string[];
  operator: string[];
}

const URUTAN_STATUS: Record<StatusCocok, number> = {
  "panen-lebih": 0,
  "hanya-panen": 1,
  "do-lebih": 2,
  "hanya-do": 3,
  cocok: 4,
};

export function cocokkanMuatan(panen: MuatanKendaraan[], dos: DoKendaraan[]): BarisCocok[] {
  const baris = new Map<string, BarisCocok & { adaPanen: boolean; adaDo: boolean }>();
  const ambil = (id: string, plat: string) => {
    let b = baris.get(id);
    if (!b) {
      b = {
        kendaraanErpId: id, plat, panenKecil: 0, panenBesar: 0, doKecil: 0, doBesar: 0,
        selisihKecil: 0, selisihBesar: 0, status: "cocok", noDo: [], operator: [], adaPanen: false, adaDo: false,
      };
      baris.set(id, b);
    }
    return b;
  };

  for (const p of panen) {
    const b = ambil(p.kendaraanErpId, p.plat);
    b.adaPanen = true;
    b.plat = p.plat;
    b.panenKecil += p.kecil;
    b.panenBesar += p.besar;
    for (const o of p.operator) if (!b.operator.includes(o)) b.operator.push(o);
  }
  for (const d of dos) {
    const b = ambil(d.kendaraanErpId, d.plat);
    b.adaDo = true;
    b.doKecil += d.kecil;
    b.doBesar += d.besar;
    for (const n of d.noDo) if (!b.noDo.includes(n)) b.noDo.push(n);
  }

  const hasil: BarisCocok[] = [];
  for (const { adaPanen, adaDo, ...b } of baris.values()) {
    b.selisihKecil = b.panenKecil - b.doKecil;
    b.selisihBesar = b.panenBesar - b.doBesar;
    if (!adaDo) b.status = "hanya-panen";
    else if (!adaPanen) b.status = "hanya-do";
    // Panen > DO didahulukan: es keluar tanpa nota adalah risiko utama.
    else if (b.selisihKecil > 0 || b.selisihBesar > 0) b.status = "panen-lebih";
    else if (b.selisihKecil < 0 || b.selisihBesar < 0) b.status = "do-lebih";
    else b.status = "cocok";
    hasil.push(b);
  }
  return hasil.sort((a, b) => URUTAN_STATUS[a.status] - URUTAN_STATUS[b.status] || a.plat.localeCompare(b.plat));
}

// ── Kendaraan pembeli ↔ DO "Ambil Sendiri" ─────────────────────────────────
//
// Keputusan controller: kendaraan ERP bernama "Ambil Sendiri" (tanpa beda
// huruf besar/kecil, di-trim) adalah pasangan sisi DO untuk muatan
// "kendaraan pembeli". DO-nya tidak dicocokkan per kendaraan; totalnya
// (K/B) dibandingkan dengan total muatan pembeli hari itu.

export const NAMA_AMBIL_SENDIRI = "Ambil Sendiri";

export function adalahAmbilSendiri(plat: string | null | undefined): boolean {
  return (plat ?? "").trim().replace(/\s+/g, " ").toLowerCase() === NAMA_AMBIL_SENDIRI.toLowerCase();
}

export interface PencocokanPembeli {
  panenKecil: number;
  panenBesar: number;
  doKecil: number;
  doBesar: number;
  selisihKecil: number;
  selisihBesar: number;
  noDo: string[];
  cocok: boolean;
}

/**
 * Pencocokan satu hari bisnis: armada per kendaraan (tanpa DO "Ambil
 * Sendiri"), lalu total muatan pembeli vs total DO "Ambil Sendiri". Muatan
 * armada yang (data lama) tercatat ke kendaraan "Ambil Sendiri" ikut sisi
 * pembeli.
 */
export function cocokkanHarian(
  panenArmada: MuatanKendaraan[],
  panenPembeli: { kecil: number; besar: number }[],
  dos: DoKendaraan[],
): { baris: BarisCocok[]; pembeli: PencocokanPembeli } {
  const doArmada = dos.filter((d) => !adalahAmbilSendiri(d.plat));
  const doAmbil = dos.filter((d) => adalahAmbilSendiri(d.plat));
  const armada = panenArmada.filter((p) => !adalahAmbilSendiri(p.plat));
  const armadaKePembeli = panenArmada.filter((p) => adalahAmbilSendiri(p.plat));

  const pb: PencocokanPembeli = {
    panenKecil: 0, panenBesar: 0, doKecil: 0, doBesar: 0, selisihKecil: 0, selisihBesar: 0, noDo: [], cocok: true,
  };
  for (const p of [...panenPembeli, ...armadaKePembeli]) {
    pb.panenKecil += p.kecil;
    pb.panenBesar += p.besar;
  }
  for (const d of doAmbil) {
    pb.doKecil += d.kecil;
    pb.doBesar += d.besar;
    for (const n of d.noDo) if (!pb.noDo.includes(n)) pb.noDo.push(n);
  }
  pb.selisihKecil = pb.panenKecil - pb.doKecil;
  pb.selisihBesar = pb.panenBesar - pb.doBesar;
  pb.cocok = pb.selisihKecil === 0 && pb.selisihBesar === 0;
  return { baris: cocokkanMuatan(armada, doArmada), pembeli: pb };
}

// ── Log ────────────────────────────────────────────────────────────────────

/**
 * Apakah baris log `batal_panen` membatalkan "Tandai Babonan" (bukan panen
 * sungguhan)? Aturan sama dengan server (getPanenTerakhir): dimuat = 0 DAN
 * persen NULL DAN isian asal berjenis produksi. Log lama (sebelum `persen` /
 * `jenisIsian` ikut dicatat) memakai heuristik lama: dimuat 0 dan ada can ke
 * Babonan.
 */
export function batalAdalahTandaiBabonan(sebelum: unknown): boolean {
  const a = sebelum && typeof sebelum === "object" ? (sebelum as Record<string, unknown>) : {};
  const dimuat = typeof a.dimuat === "number" ? a.dimuat : 0;
  if ("persen" in a && typeof a.jenisIsian === "string") {
    return dimuat === 0 && a.persen === null && a.jenisIsian === "produksi";
  }
  const keBab = (typeof a.keBabonan === "number" ? a.keBabonan : 0) + (typeof a.pecah === "number" ? a.pecah : 0);
  return dimuat === 0 && keBab > 0;
}

// ── Peringatan ─────────────────────────────────────────────────────────────

export type KodePeringatan =
  | "TERLAMBAT_PANEN"
  | "BABONAN_LAMA"
  | "MAINTENANCE_LAMA"
  | "KOSONG_LAMA"
  | "PANEN_BELUM_SIAP"
  | "SELISIH_MUATAN"
  | "SLOT_BELUM_SIAP";

export interface Peringatan {
  kode: KodePeringatan;
  kolomId: string | null;
  pesan: string;
  sejak: string;
}

function lebihDariJam(sejakIso: string, jam: number, sekarang: Date): boolean {
  return sekarang.getTime() - Date.parse(sejakIso) > jam * JAM_MS;
}

function teksJam(sejakIso: string, sekarang: Date): string {
  return `${Math.floor((sekarang.getTime() - Date.parse(sejakIso)) / JAM_MS)} jam`;
}

const LABEL_STATUS: Record<StatusCocok, string> = {
  cocok: "cocok",
  "panen-lebih": "panen lebih banyak dari DO",
  "do-lebih": "DO lebih banyak dari panen",
  "hanya-do": "ada DO tanpa panen tercatat",
  "hanya-panen": "ada panen tanpa DO",
};

export function peringatanDari(a: {
  keadaan: KeadaanRek[];
  kosongSejak: Record<string, string>;
  panenBelumSiap: { kolomId: string; panenAt: string; persen: number }[];
  selisih: BarisCocok[];
  /** Total kendaraan pembeli vs DO "Ambil Sendiri" (hari yang sama dengan `selisih`). */
  selisihPembeli?: PencocokanPembeli | null;
  sekarang: Date;
  label: (kolomId: string) => string;
}): Peringatan[] {
  const { keadaan, kosongSejak, panenBelumSiap, selisih, selisihPembeli, sekarang, label } = a;
  const hasil: Peringatan[] = [];

  for (const k of keadaan) {
    if (k.slotBelumSiap) {
      hasil.push({
        kode: "SLOT_BELUM_SIAP",
        kolomId: k.kolomId,
        pesan: `${label(k.kolomId)}: ${PESAN_SLOT_BELUM_SIAP}`,
        sejak: sekarang.toISOString(),
      });
    }
    for (const i of k.isianProduksi) {
      const durasi = i.durasiBekuJam;
      if (durasi === null || i.sisa <= 0) continue;
      const batas = durasi + AMBANG.terlambatTambahJam;
      if (lebihDariJam(i.mulaiAt, batas, sekarang)) {
        hasil.push({
          kode: "TERLAMBAT_PANEN",
          kolomId: k.kolomId,
          pesan: `${label(k.kolomId)}: ${i.sisa} can belum dipanen, sudah ${teksJam(i.mulaiAt, sekarang)} (beku ${durasi} jam).`,
          sejak: new Date(Date.parse(i.mulaiAt) + batas * JAM_MS).toISOString(),
        });
      }
    }
    if (k.isianBabonan && lebihDariJam(k.isianBabonan.mulaiAt, AMBANG.babonanJam, sekarang)) {
      hasil.push({
        kode: "BABONAN_LAMA",
        kolomId: k.kolomId,
        pesan: `${label(k.kolomId)}: Babonan ${k.babonan} can sudah ${teksJam(k.isianBabonan.mulaiAt, sekarang)}.`,
        sejak: k.isianBabonan.mulaiAt,
      });
    }
    if (k.maintenance && lebihDariJam(k.maintenance.mulaiAt, AMBANG.maintenanceJam, sekarang)) {
      hasil.push({
        kode: "MAINTENANCE_LAMA",
        kolomId: k.kolomId,
        pesan: `${label(k.kolomId)}: maintenance belum selesai sejak ${teksJam(k.maintenance.mulaiAt, sekarang)} lalu.`,
        sejak: k.maintenance.mulaiAt,
      });
    }
    const sejakKosong = kosongSejak[k.kolomId];
    if (k.utama === "kosong" && sejakKosong && lebihDariJam(sejakKosong, AMBANG.kosongJam, sekarang)) {
      hasil.push({
        kode: "KOSONG_LAMA",
        kolomId: k.kolomId,
        pesan: `${label(k.kolomId)}: kosong ${teksJam(sejakKosong, sekarang)}, kapasitas terbuang.`,
        sejak: sejakKosong,
      });
    }
  }

  for (const p of panenBelumSiap) {
    if (p.persen >= AMBANG.panenBelumSiapPersen) continue;
    if (lebihDariJam(p.panenAt, AMBANG.panenBelumSiapJendelaJam, sekarang)) continue;
    hasil.push({
      kode: "PANEN_BELUM_SIAP",
      kolomId: p.kolomId,
      pesan: `${label(p.kolomId)}: dipanen saat kematangan ${p.persen}%.`,
      sejak: p.panenAt,
    });
  }

  for (const b of selisih) {
    if (b.status === "cocok") continue;
    hasil.push({
      kode: "SELISIH_MUATAN",
      kolomId: null,
      pesan: `${b.plat}: ${LABEL_STATUS[b.status]} (selisih kecil ${b.selisihKecil}, besar ${b.selisihBesar}).`,
      sejak: sekarang.toISOString(),
    });
  }
  if (selisihPembeli && !selisihPembeli.cocok) {
    const lebih = selisihPembeli.selisihKecil > 0 || selisihPembeli.selisihBesar > 0;
    hasil.push({
      kode: "SELISIH_MUATAN",
      kolomId: null,
      pesan: `Kendaraan pembeli: ${lebih ? "muatan pembeli lebih banyak dari DO Ambil Sendiri" : "DO Ambil Sendiri lebih banyak dari muatan pembeli"} (selisih kecil ${selisihPembeli.selisihKecil}, besar ${selisihPembeli.selisihBesar}).`,
      sejak: sekarang.toISOString(),
    });
  }

  return hasil;
}
