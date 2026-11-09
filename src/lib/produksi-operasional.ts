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
  canKosong: number;
  babonan: number;
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

export interface PanenInput {
  isianId: string;
  muatan: MuatanInput[];
  babonan: number;
  pecah: number;
  isiUlang: boolean;
  konfirmasiBelumSiap: boolean;
}

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
): KeadaanRek {
  const milikRek = isian.filter((i) => i.kolomId === kolom.id && i.sisa > 0);
  const isianProduksi = milikRek
    .filter((i) => i.jenis === "produksi")
    .map((i) => ({ ...i, durasiBekuJam: durasiIsian(bak, i) }))
    .sort((a, b) => Date.parse(a.mulaiAt) - Date.parse(b.mulaiAt));
  const daftarBabonan = milikRek.filter((i) => i.jenis === "babonan");
  const babonan = daftarBabonan.reduce((s, i) => s + i.sisa, 0);
  const terisi = milikRek.reduce((s, i) => s + i.sisa, 0);
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
    canKosong: Math.max(0, kolom.jumlahIceCan - terisi),
    babonan,
    isianProduksi,
    isianBabonan: daftarBabonan[0] ?? null,
    maintenance,
  };
}

function daftarBak(denah: DenahDokumen): BakElemen[] {
  return denah.elemen.filter((e): e is BakElemen => e.tipe === "bak");
}

export function keadaanPabrik(
  denah: DenahDokumen,
  isian: IsianAktif[],
  mt: MaintenanceAktif[],
  sekarang: Date,
): KeadaanRek[] {
  const isianPerKolom = new Map<string, IsianAktif[]>();
  for (const i of isian) {
    const l = isianPerKolom.get(i.kolomId);
    if (l) l.push(i);
    else isianPerKolom.set(i.kolomId, [i]);
  }
  const mtPerKolom = new Map(mt.map((m) => [m.kolomId, m]));
  return daftarBak(denah).flatMap((bak) =>
    bak.kolom.map((kolom) =>
      keadaanRek(bak, kolom, isianPerKolom.get(kolom.id) ?? [], mtPerKolom.get(kolom.id) ?? null, sekarang),
    ),
  );
}

// ── Validasi panen ─────────────────────────────────────────────────────────

function bulatTakNegatif(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/** null = sah; selain itu pesan untuk operator. */
export function validasiPanen(
  jenis: JenisIsian,
  sisa: number,
  input: Pick<PanenInput, "muatan" | "babonan" | "pecah">,
): string | null {
  const { muatan, babonan, pecah } = input;
  if (!bulatTakNegatif(babonan) || !bulatTakNegatif(pecah)) return "Jumlah Babonan dan pecah harus bilangan bulat ≥ 0.";

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

  const dimuat = muatan.reduce((s, m) => s + m.jumlah, 0);
  if (jenis === "babonan") {
    if (babonan !== 0 || pecah !== 0) return "Can Babonan tidak bisa dipindah lagi ke Babonan atau pecah.";
    if (dimuat <= 0) return "Belum ada can Babonan yang dimuat.";
    if (dimuat > sisa) return `Babonan di rek ini tinggal ${sisa} can (diminta ${dimuat}).`;
    return null;
  }

  const total = dimuat + babonan + pecah;
  if (total !== sisa) return `Jumlah dimuat + Babonan + pecah harus ${sisa} can (sekarang ${total}).`;
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

// Tahap seluruh can produksi di satu rek mengikuti tahap rek (isian tertua) —
// sama dengan yang tampil di kartu rek.
export function ringkasStok(denah: DenahDokumen, keadaan: KeadaanRek[]): RingkasanStok {
  const r: RingkasanStok = { sehat: 0, air: 0, proses: 0, matang: 0, babonan: 0, maintenance: 0, perBak: [] };
  const perBak = new Map<string, { kapasitas: number; terisi: number }>();
  let kapasitasAktif = 0;

  for (const k of keadaan) {
    const produksi = k.isianProduksi.reduce((s, i) => s + i.sisa, 0);
    if (k.tahap === "air") r.air += produksi;
    else if (k.tahap === "jadi") r.matang += produksi;
    else if (k.tahap !== null) r.proses += produksi;
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

// ── Peringatan ─────────────────────────────────────────────────────────────

export type KodePeringatan =
  | "TERLAMBAT_PANEN"
  | "BABONAN_LAMA"
  | "MAINTENANCE_LAMA"
  | "KOSONG_LAMA"
  | "PANEN_BELUM_SIAP"
  | "SELISIH_MUATAN";

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
  sekarang: Date;
  label: (kolomId: string) => string;
}): Peringatan[] {
  const { keadaan, kosongSejak, panenBelumSiap, selisih, sekarang, label } = a;
  const hasil: Peringatan[] = [];

  for (const k of keadaan) {
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

  return hasil;
}
