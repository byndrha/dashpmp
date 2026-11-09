// Produksi Es Balok — Operasional: query baca + transaksi aksi (Postgres
// direktori, tabel produksi_* — lihat scripts/create-produksi-operasional-tables.ts).
// Spec: docs/superpowers/specs/2026-11-09-produksi-es-balok-operasional-design.md §1–3, §11.
//
// Fungsi di sini TIDAK membaca sesi: pemanggil (server action / page) wajib
// sudah memeriksa scope perusahaan dan hak akses, lalu meneruskan Pelaku.
// `kode` sengaja bertipe string agar skrip uji bisa memakai kode uji
// ('uji-operasional') tanpa menyentuh baris pabrik sungguhan.
//
// Aturan transaksi SETIAP fungsi tulis:
//   BEGIN → kunci baris produksi_denah (FOR SHARE) + validasi kolom →
//   kunci advisory per (kode, kolom) → kunci isian aktif rek (FOR UPDATE) →
//   kunci can rusak aktif rek (FOR UPDATE) → hitung ulang keadaan slot di
//   server + cek invarian slot (cekInvarianRek) → tulis → INSERT
//   produksi_log → COMMIT.
//   Error apa pun → ROLLBACK. Satu-satunya DELETE di modul ini ada di
//   koreksiMuatan: baris anak produksi_muatan milik SATU panen diganti utuh
//   (DELETE + INSERT) di transaksi yang juga mencatat daftar muatan lama di
//   produksi_log.sebelum — jejaknya tidak hilang. Panen, isian, dan log tidak
//   pernah dihapus.
//
// Kunci advisory per kolom dipakai selain FOR UPDATE karena rek kosong tidak
// punya baris untuk dikunci: tanpa itu dua Isi Air bersamaan di rek kosong
// sama-sama lolos cek kapasitas.
//
// Nama akun (IsianAktif.diisiOlehNama, operator muatan) diambil dari
// produksi_log: setiap aksi tulis selalu mencatat akun_id + akun_nama di
// transaksi yang sama, jadi setiap akun_id di tabel produksi_* pasti punya
// baris log. Ini berlaku untuk semua sumber akun (akun, akun_direktori).
import type { PoolClient } from "pg";
import { getPgPool, pantauClient } from "@/lib/pg";
import { AppError } from "@/lib/action-result";
import { getWibTimeHHmm } from "@/lib/business-date";
import type { BakElemen, DenahDokumen, DenahKolom, Varian } from "@/lib/produksi-denah";
import { migrasiDenah } from "@/lib/produksi-denah";
import {
  AMBANG,
  hitungKematangan,
  PESAN_SLOT_BELUM_SIAP,
  ROLLOVER_PANEN_JAM,
  shiftDari,
  slotDimuatDari,
  tanggalBisnisPanen,
  validasiKoreksiMuatan,
  validasiPanenSlot,
  type IsianAktif,
  type JenisIsian,
  type KendaraanPilihan,
  type MaintenanceAktif,
  type MuatanInput,
  type MuatanKendaraan,
  type PanenSlotInput,
  type SlotRusak,
} from "@/lib/produksi-operasional";
import { getDenahUntukKode } from "@/lib/queries/produksi-denah";

// ── Tipe publik ────────────────────────────────────────────────────────────

export type KodeGalatProduksi = "TIDAK_DITEMUKAN" | "KEADAAN_BERUBAH" | "VALIDASI" | "BELUM_SIAP" | "KOLOM_TIDAK_SAH" | "KAPASITAS";

// Turunan AppError: runAction meneruskan pesannya ke pengguna; UI membaca
// kodeGalat (mis. BELUM_SIAP → dialog "Es belum siap, tetap panen?").
export class GalatAksiProduksi extends AppError {
  readonly kodeGalat: KodeGalatProduksi;
  constructor(message: string, kodeGalat: KodeGalatProduksi) {
    super(message);
    this.name = "GalatAksiProduksi";
    this.kodeGalat = kodeGalat;
  }
}

export interface Pelaku {
  akunId: string;
  nama: string;
  peran: "operator" | "admin";
}

export interface DataPabrik {
  denah: DenahDokumen | null;
  isian: IsianAktif[];
  maintenance: MaintenanceAktif[];
  /** Can rusak aktif (belum "Sudah diperbaiki"). */
  rusak: SlotRusak[];
  /**
   * Sejak kapan rek punya slot kosong yang bisa diisi: rek kosong total →
   * isian/maintenance terakhir selesai; rek terisi sebagian → saat terakhir
   * slot dikosongkan (panen, buang Babonan, isian selesai). Rek maintenance
   * atau tanpa slot kosong tidak punya entri.
   */
  kosongSejak: Record<string, string>;
  panenBelumSiap: { kolomId: string; panenAt: string; persen: number }[];
  sekarang: string;
}

export interface MuatanHarian {
  armada: MuatanKendaraan[];
  pembeli: (KendaraanPilihan & { kecil: number; besar: number })[];
  ringkasan: { dimuat: number; keBabonan: number; pecah: number; babonanDibuang: number };
}

export interface PanenTerakhir {
  id: string;
  panenAt: string;
  varian: Varian;
  dimuat: number;
  keBabonan: number;
  pecah: number;
  /** Baris dari Tandai Babonan (dimuat 0, persen NULL, isian produksi), bukan panen sungguhan. */
  tandaiBabonan: boolean;
  /** Isian asal masih aktif (pembatalan bisa mengembalikan can). */
  isianAktif: boolean;
  operatorNama: string;
  /** Muatan per kendaraan (urut input) — dipakai juga untuk mengisi dialog "Ubah kendaraan". */
  kendaraan: MuatanInput[];
}

export interface BarisLog {
  id: string;
  at: string;
  akunId: string;
  akunNama: string;
  peran: string;
  shift: number;
  aksi: string;
  bakNama: string | null;
  kolomNomor: number | null;
  sebelum: unknown;
  sesudah: unknown;
  alasan: string | null;
}

// ── Konstanta & util ───────────────────────────────────────────────────────

const JAM_MS = 3_600_000;
const BATAS_HARI_BATAL = 7;
const BATAS_LOG_MAKS = 1000;
const BATAS_RIWAYAT = 200;

const LABEL_AKSI: Record<string, string> = {
  isi_air: "isi air",
  panen: "panen",
  tandai_babonan: "tandai Babonan",
  buang_babonan: "buang Babonan",
  mulai_maintenance: "mulai maintenance",
  selesai_maintenance: "selesai maintenance",
  koreksi_isian: "koreksi isian",
  koreksi_muatan: "koreksi kendaraan",
  batal_panen: "batal panen",
  tandai_rusak: "tandai can rusak",
  perbaiki_rusak: "perbaiki can rusak",
};

function galat(kode: KodeGalatProduksi, pesan: string): GalatAksiProduksi {
  return new GalatAksiProduksi(pesan, kode);
}

function teksWajib(v: unknown, nama: string): string {
  if (typeof v !== "string" || !v.trim()) throw galat("VALIDASI", `${nama} wajib diisi.`);
  return v.trim();
}

function teksOpsional(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// ID bigserial dikirim sebagai string; selain angka pasti tidak ada di tabel
// (dan akan membuat Postgres melempar 22P02).
function cekId(v: unknown, nama: string): string {
  if (typeof v !== "string" || !/^\d{1,18}$/.test(v)) throw galat("TIDAK_DITEMUKAN", `${nama} tidak ditemukan.`);
  return v;
}

function cekPelaku(p: Pelaku): void {
  if (
    !p ||
    typeof p.akunId !== "string" ||
    !p.akunId.trim() ||
    typeof p.nama !== "string" ||
    !p.nama.trim() ||
    (p.peran !== "operator" && p.peran !== "admin")
  ) {
    throw galat("VALIDASI", "Data pelaku aksi tidak sah.");
  }
}

function cekAdmin(p: Pelaku, alasan: unknown): string {
  cekPelaku(p);
  if (p.peran !== "admin") throw galat("VALIDASI", "Hanya admin yang boleh melakukan koreksi.");
  if (typeof alasan !== "string" || !alasan.trim()) throw galat("VALIDASI", "Alasan koreksi wajib diisi.");
  return alasan.trim();
}

function cekTanggalIso(v: unknown, nama: string): Date {
  const d = typeof v === "string" ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) throw galat("VALIDASI", `${nama} bukan tanggal/waktu yang sah.`);
  return d;
}

function normalisasiPlat(plat: string): string {
  return plat.trim().toUpperCase().replace(/\s+/g, " ");
}

// ── Transaksi ──────────────────────────────────────────────────────────────

function terjemahkanGalatPg(err: unknown): unknown {
  if (err instanceof AppError) return err;
  const kode = (err as { code?: unknown } | null)?.code;
  // 23505 unique (babonan/maintenance aktif ganda), 23514 check (sisa < 0),
  // 40P01 deadlock, 40001 serialisasi: semuanya akibat aksi bersamaan.
  if (kode === "23505" || kode === "23514" || kode === "40P01" || kode === "40001") {
    return galat("KEADAAN_BERUBAH", "Rek baru saja diubah orang lain. Muat ulang lalu coba lagi.");
  }
  return err;
}

async function transaksi<T>(fn: (c: PoolClient, sekarang: Date) => Promise<T>): Promise<T> {
  const client = await getPgPool().connect();
  // Pendengar 'error' + buang client yang diputus backend (lihat pantauClient).
  const lepas = pantauClient(client, "produksi-operasional");
  let rollbackGagal: Error | undefined;
  try {
    await client.query("BEGIN");
    // now() Postgres = awal transaksi; dipakai untuk semua cap waktu aksi ini.
    // idle_in_transaction_session_timeout (khusus transaksi ini): bila koneksi
    // putus diam-diam di tengah transaksi, server menutup sesinya dalam 30 dtk
    // sehingga kunci advisory/baris rek tidak tertahan sampai TCP keepalive
    // (2 jam) — terlihat saat uji integrasi 2026-11-09.
    const { rows } = await client.query<{ sekarang: Date }>(
      `SELECT now() AS sekarang, set_config('idle_in_transaction_session_timeout', '30s', true)`,
    );
    const hasil = await fn(client, rows[0].sekarang);
    await client.query("COMMIT");
    return hasil;
  } catch (err) {
    await client.query("ROLLBACK").catch((e: unknown) => {
      rollbackGagal = e instanceof Error ? e : new Error(String(e));
    });
    throw terjemahkanGalatPg(err);
  } finally {
    lepas(rollbackGagal);
  }
}

interface KonteksKolom {
  bak: BakElemen;
  kolom: DenahKolom;
}

// Kunci denah (FOR SHARE) lalu cari kolom + bak induknya, lalu kunci advisory
// rek tersebut. `longgar` = aksi penutup/penanda (selesai maintenance, batal
// panen) yang tetap boleh jalan walau kolom sudah dinonaktifkan/dihapus dari
// denah; hasilnya bisa null.
async function kunciKolomDasar(c: PoolClient, kode: string, kolomId: string, longgar: boolean): Promise<KonteksKolom | null> {
  const { rows } = await c.query<{ data: unknown }>(
    `SELECT data FROM produksi_denah WHERE perusahaan_kode = $1 FOR SHARE`,
    [kode],
  );
  let ketemu: KonteksKolom | null = null;
  if (rows[0]) {
    try {
      const denah = migrasiDenah(rows[0].data);
      for (const e of denah.elemen) {
        if (e.tipe !== "bak") continue;
        const kolom = e.kolom.find((k) => k.id === kolomId);
        if (kolom) {
          ketemu = { bak: e, kolom };
          break;
        }
      }
    } catch (err) {
      console.error(`produksi_denah ${kode} tidak bisa dibaca saat aksi operasional:`, err);
    }
  }
  if (!longgar && (!ketemu || ketemu.kolom.nonaktif)) {
    throw galat("KOLOM_TIDAK_SAH", ketemu ? "Rek ini nonaktif di denah." : "Rek tidak ditemukan di denah pabrik.");
  }
  await kunciAdvisoryKolom(c, kode, kolomId);
  return ketemu;
}

// Kunci advisory per (kode, kolom), berlaku sampai akhir transaksi. Diekspor
// agar skrip (mis. scripts/backfill-slot-can.ts) memakai hash yang identik.
export async function kunciAdvisoryKolom(c: PoolClient, kode: string, kolomId: string): Promise<void> {
  await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`produksi-operasional:${kode}:${kolomId}`]);
}

async function kunciKolom(c: PoolClient, kode: string, kolomId: string): Promise<KonteksKolom> {
  return (await kunciKolomDasar(c, kode, kolomId, false))!;
}

type BarisIsian = {
  id: string;
  kolom_id: string;
  bak_id: string;
  jenis: JenisIsian;
  varian: Varian;
  jumlah_awal: number;
  sisa: number;
  pecah: number;
  mulai_at: Date;
  durasi_beku_jam: string | null;
  slot: number[];
  slot_pecah: number[];
};

const KOLOM_ISIAN = `id::text AS id, kolom_id, bak_id, jenis, varian, jumlah_awal, sisa, pecah, mulai_at, durasi_beku_jam,
       slot, slot_pecah`;

/** Baris isian aktif yang slotnya belum dicatat (mis. sebelum backfill slot can). */
function slotBelumSiap(i: Pick<BarisIsian, "jenis" | "sisa" | "pecah" | "slot" | "slot_pecah">): boolean {
  return i.slot.length !== i.sisa || (i.jenis === "babonan" && i.slot_pecah.length !== i.pecah);
}

// Kunci isian aktif rek. Bawaan KETAT: bila ada isian aktif yang slotnya
// belum dicatat (slot '{}' padahal sisa > 0 — antara deploy dan backfill,
// atau ditulis kontainer lama saat pergantian), aksi ditolak; tanpa ini can
// tersebut dianggap kosong (Isi Air menimpa rek penuh, panen menutup isian
// dengan Σ=0). `longgar` = aksi yang tidak menghitung slot isian
// (selesai maintenance, perbaiki can rusak) dan koreksi admin (jalur
// perbaikan data).
async function kunciIsian(c: PoolClient, kode: string, kolomId: string, longgar = false): Promise<BarisIsian[]> {
  const rows = await kunciIsianMentah(c, kode, kolomId);
  if (!longgar && rows.some(slotBelumSiap)) throw galat("KEADAAN_BERUBAH", PESAN_SLOT_BELUM_SIAP);
  return rows;
}

async function kunciIsianMentah(c: PoolClient, kode: string, kolomId: string): Promise<BarisIsian[]> {
  const { rows } = await c.query<BarisIsian>(
    `SELECT ${KOLOM_ISIAN}
       FROM produksi_kolom_isi
      WHERE perusahaan_kode = $1 AND kolom_id = $2 AND selesai_at IS NULL
      ORDER BY mulai_at, id
      FOR UPDATE`,
    [kode, kolomId],
  );
  return rows;
}

// Kolom milik sebuah isian (tanpa kunci; kunci diambil sesudahnya).
async function kolomDariIsian(c: PoolClient, kode: string, isianId: string): Promise<string> {
  const { rows } = await c.query<{ kolom_id: string }>(
    `SELECT kolom_id FROM produksi_kolom_isi WHERE id = $1 AND perusahaan_kode = $2`,
    [isianId, kode],
  );
  if (!rows[0]) throw galat("TIDAK_DITEMUKAN", "Isian tidak ditemukan.");
  return rows[0].kolom_id;
}

async function maintenanceTerbuka(c: PoolClient, kode: string, kolomId: string) {
  const { rows } = await c.query<{ id: string; mulai_at: Date; catatan: string | null }>(
    `SELECT id::text AS id, mulai_at, catatan FROM produksi_maintenance
      WHERE perusahaan_kode = $1 AND kolom_id = $2 AND selesai_at IS NULL FOR UPDATE`,
    [kode, kolomId],
  );
  return rows[0] ?? null;
}

type BarisRusak = { id: string; slot: number; mulai_at: Date; catatan: string | null };

// Can rusak aktif rek (dikunci; urutan kunci: sesudah isian aktif).
async function kunciRusak(c: PoolClient, kode: string, kolomId: string): Promise<BarisRusak[]> {
  const { rows } = await c.query<BarisRusak>(
    `SELECT id::text AS id, slot, mulai_at, catatan FROM produksi_slot_rusak
      WHERE perusahaan_kode = $1 AND kolom_id = $2 AND selesai_at IS NULL
      ORDER BY slot
      FOR UPDATE`,
    [kode, kolomId],
  );
  return rows;
}

// ── Slot can ───────────────────────────────────────────────────────────────
// Invarian (spec slot can §1): setiap isian aktif cardinality(slot) = sisa;
// slot isian aktif satu rek tidak beririsan; semua slot di 1..jumlahIceCan;
// slot rusak aktif tidak ditempati; Babonan slot_pecah ⊆ slot dan
// pecah = cardinality(slot_pecah); produksi slot_pecah = '{}'.
//
// Pembedaan galat: daftar slot dari klien yang CACAT (bukan bilangan bulat,
// ganda, < 1, di luar kapasitas) → VALIDASI; slot yang sah bentuknya tapi
// tidak cocok dengan keadaan rek terkini (sudah ditempati, bukan milik isian,
// rusak) → KEADAAN_BERUBAH (klien basi).

function urutUnik(a: Iterable<number>): number[] {
  return [...new Set(a)].sort((x, y) => x - y);
}

function kurangi(a: number[], b: Iterable<number>): number[] {
  const buang = new Set(b);
  return a.filter((s) => !buang.has(s));
}

function daftarSlot(a: number[]): string {
  return a.join(", ");
}

// Bentuk daftar slot dari klien: array bilangan bulat ≥ 1, unik → urut naik.
// Rentang atas (≤ kapasitas) dicek sesudah kolom dikunci (cekRentang).
function normalisasiSlot(raw: unknown, nama: string, bolehKosong: boolean): number[] {
  if (!Array.isArray(raw)) throw galat("VALIDASI", `Daftar slot ${nama} tidak sah.`);
  const lihat = new Set<number>();
  for (const s of raw as unknown[]) {
    if (typeof s !== "number" || !Number.isInteger(s) || s < 1) throw galat("VALIDASI", `Nomor slot ${nama} harus bilangan bulat ≥ 1.`);
    if (lihat.has(s)) throw galat("VALIDASI", `Slot ${s} dipilih dua kali (${nama}).`);
    lihat.add(s);
  }
  if (!bolehKosong && lihat.size === 0) throw galat("VALIDASI", "Pilih minimal satu can.");
  return urutUnik(lihat);
}

function cekRentang(slot: number[], kapasitas: number, kode: KodeGalatProduksi = "VALIDASI"): void {
  const luar = slot.filter((s) => s > kapasitas);
  if (luar.length > 0) throw galat(kode, `Slot ${daftarSlot(luar)} di luar kapasitas rek (1–${kapasitas}).`);
}

function slotTerisi(aktif: BarisIsian[], kecualiId?: string): Set<number> {
  return new Set(aktif.filter((i) => i.id !== kecualiId).flatMap((i) => i.slot));
}

/** Slot 1..kapasitas yang tidak ditempati isian aktif dan tidak rusak. */
function slotBebas(kapasitas: number, aktif: BarisIsian[], rusak: BarisRusak[]): number[] {
  const tidakBoleh = new Set([...slotTerisi(aktif), ...rusak.map((r) => r.slot)]);
  const hasil: number[] = [];
  for (let s = 1; s <= kapasitas; s++) if (!tidakBoleh.has(s)) hasil.push(s);
  return hasil;
}

type KeadaanSlotIsian = { id: string; jenis: JenisIsian; slot: number[]; slot_pecah: number[] };

function salinSlot(aktif: BarisIsian[]): Map<string, KeadaanSlotIsian> {
  return new Map(aktif.map((i) => [i.id, { id: i.id, jenis: i.jenis, slot: [...i.slot], slot_pecah: [...i.slot_pecah] }]));
}

// Jaring pengaman: keadaan slot rek SESUDAH aksi (dihitung di memori dari
// baris yang sudah dikunci) wajib memenuhi invarian sebelum apa pun ditulis.
// Pelanggaran di sini berarti keadaan bergeser di bawah aksi → KEADAAN_BERUBAH.
function cekInvarianRek(kapasitas: number | null, isian: Iterable<KeadaanSlotIsian>, rusak: BarisRusak[]): void {
  const slotRusak = new Set(rusak.map((r) => r.slot));
  const dipakai = new Set<number>();
  const gagal = (pesan: string) => galat("KEADAAN_BERUBAH", `${pesan} Muat ulang lalu coba lagi.`);
  for (const i of isian) {
    for (const s of i.slot) {
      if (!Number.isInteger(s) || s < 1 || (kapasitas !== null && s > kapasitas)) throw gagal(`Slot ${s} di luar kapasitas rek.`);
      if (dipakai.has(s)) throw gagal(`Slot ${s} akan terisi dua kali.`);
      if (slotRusak.has(s)) throw gagal(`Slot ${s} sedang rusak.`);
      dipakai.add(s);
    }
    if (i.jenis === "produksi" && i.slot_pecah.length > 0) throw gagal("Isian produksi tidak boleh punya slot pecah.");
    const milik = new Set(i.slot);
    if (i.slot_pecah.some((s) => !milik.has(s))) throw gagal("Slot pecah Babonan tidak sesuai slot isiannya.");
  }
}

function snapshotIsian(i: BarisIsian) {
  return {
    id: i.id,
    jenis: i.jenis,
    varian: i.varian,
    jumlahAwal: i.jumlah_awal,
    sisa: i.sisa,
    pecah: i.pecah,
    slot: i.slot,
    slotPecah: i.slot_pecah,
    mulaiAt: i.mulai_at.toISOString(),
    durasiBekuJam: i.durasi_beku_jam === null ? null : Number(i.durasi_beku_jam),
  };
}

// KEADAAN_BERUBAH menyebut siapa & kapan aksi terakhir di rek itu.
async function galatBerubah(c: PoolClient, kode: string, kolomId: string, awal: string): Promise<GalatAksiProduksi> {
  const { rows } = await c.query<{ akun_nama: string; aksi: string; at: Date }>(
    `SELECT akun_nama, aksi, at FROM produksi_log
      WHERE perusahaan_kode = $1 AND kolom_id = $2 ORDER BY at DESC, id DESC LIMIT 1`,
    [kode, kolomId],
  );
  const r = rows[0];
  const ekor = r ? ` Baru saja ${LABEL_AKSI[r.aksi] ?? r.aksi} oleh ${r.akun_nama} pukul ${getWibTimeHHmm(r.at)} WIB.` : "";
  return galat("KEADAAN_BERUBAH", `${awal}${ekor}`);
}

// Tulis slot isian; sisa = |slot|, pecah = |slot_pecah|. selesai_at diisi
// begitu slot kosong. `deltaJumlahAwal` menggeser jumlah_awal (Babonan yang
// bertambah/berkurang, koreksi admin).
async function tulisSlotIsian(c: PoolClient, i: KeadaanSlotIsian, akunId: string, deltaJumlahAwal = 0): Promise<void> {
  await c.query(
    `UPDATE produksi_kolom_isi
        SET slot = $2::int[],
            slot_pecah = $3::int[],
            sisa = cardinality($2::int[]),
            pecah = cardinality($3::int[]),
            jumlah_awal = jumlah_awal + $5,
            selesai_at = CASE WHEN cardinality($2::int[]) = 0 THEN now() ELSE NULL END,
            ditutup_oleh_akun_id = CASE WHEN cardinality($2::int[]) = 0 THEN $4 ELSE ditutup_oleh_akun_id END
      WHERE id = $1`,
    [i.id, urutUnik(i.slot), urutUnik(i.slot_pecah), akunId, deltaJumlahAwal],
  );
}

async function buatIsian(
  c: PoolClient,
  kode: string,
  v: { kolomId: string; bakId: string; varian: Varian; jenis: JenisIsian; slot: number[]; slotPecah: number[]; durasiBekuJam: number | null },
  p: Pelaku,
): Promise<string> {
  const slot = urutUnik(v.slot);
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO produksi_kolom_isi
       (perusahaan_kode, kolom_id, mulai_at, jenis, bak_id, varian, jumlah_awal, sisa, pecah, durasi_beku_jam, diisi_oleh_akun_id,
        slot, slot_pecah)
     VALUES ($1, $2, now(), $3, $4, $5, $6, $6, $7, $8, $9, $10::int[], $11::int[])
     RETURNING id::text AS id`,
    [kode, v.kolomId, v.jenis, v.bakId, v.varian, slot.length, v.slotPecah.length, v.durasiBekuJam, p.akunId, slot, urutUnik(v.slotPecah)],
  );
  return rows[0].id;
}

function buatIsianProduksi(c: PoolClient, kode: string, ctx: KonteksKolom, slot: number[], p: Pelaku): Promise<string> {
  const varian = ctx.kolom.varian;
  return buatIsian(
    c,
    kode,
    { kolomId: ctx.kolom.id, bakId: ctx.bak.id, varian, jenis: "produksi", slot, slotPecah: [], durasiBekuJam: ctx.bak.durasiBekuJam[varian] },
    p,
  );
}

// Pindahkan slot (pecah di antaranya) ke isian Babonan aktif rek: slot
// digabung; buat isian baru bila belum ada (mulai_at = sekarang = babonan_sejak).
// `sesudah` (keadaan di memori) sudah memuat hasilnya dan sudah lolos
// cekInvarianRek.
async function tambahKeBabonan(
  c: PoolClient,
  kode: string,
  asal: BarisIsian,
  bab: KeadaanSlotIsian | null,
  pindah: number[],
  pecah: number[],
  p: Pelaku,
): Promise<string> {
  if (bab) {
    await tulisSlotIsian(c, bab, p.akunId, pindah.length);
    return bab.id;
  }
  return buatIsian(
    c,
    kode,
    { kolomId: asal.kolom_id, bakId: asal.bak_id, varian: asal.varian, jenis: "babonan", slot: pindah, slotPecah: pecah, durasiBekuJam: null },
    p,
  );
}

// Gabungkan slot pindahan ke keadaan Babonan rek di memori (atau buat
// keadaan Babonan baru berid null). Dipakai panen & Tandai Babonan.
function rencanaBabonan(
  sesudah: Map<string, KeadaanSlotIsian>,
  asalId: string,
  pindah: number[],
  pecah: number[],
): { bab: KeadaanSlotIsian | null; baru: KeadaanSlotIsian | null } {
  if (pindah.length === 0) return { bab: null, baru: null };
  const bab = [...sesudah.values()].find((i) => i.jenis === "babonan" && i.id !== asalId) ?? null;
  if (bab) {
    bab.slot = urutUnik([...bab.slot, ...pindah]);
    bab.slot_pecah = urutUnik([...bab.slot_pecah, ...pecah]);
    return { bab, baru: null };
  }
  return { bab: null, baru: { id: "babonan-baru", jenis: "babonan", slot: urutUnik(pindah), slot_pecah: urutUnik(pecah) } };
}

async function tulisLog(
  c: PoolClient,
  kode: string,
  p: Pelaku,
  sekarang: Date,
  l: {
    aksi: string;
    kolomId: string;
    ctx: KonteksKolom | null;
    rujukanId: string | null;
    sebelum?: unknown;
    sesudah?: unknown;
    alasan?: string | null;
  },
): Promise<void> {
  const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
  await c.query(
    `INSERT INTO produksi_log
       (perusahaan_kode, at, akun_id, akun_nama, peran, shift, aksi, kolom_id, bak_id, bak_nama, kolom_nomor,
        rujukan_id, sebelum, sesudah, alasan)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15)`,
    [
      kode,
      sekarang,
      p.akunId,
      p.nama.trim(),
      p.peran,
      shiftDari(sekarang),
      l.aksi,
      l.kolomId,
      l.ctx?.bak.id ?? null,
      l.ctx?.bak.nama ?? null,
      l.ctx?.kolom.nomor ?? null,
      l.rujukanId,
      json(l.sebelum),
      json(l.sesudah),
      l.alasan ?? null,
    ],
  );
}

async function insertPanen(
  c: PoolClient,
  kode: string,
  asal: BarisIsian,
  sekarang: Date,
  v: { slotDimuat: number[]; slotBabonan: number[]; slotPecah: number[]; persen: number | null },
  p: Pelaku,
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO produksi_panen
       (perusahaan_kode, isian_id, kolom_id, bak_id, varian, panen_at, tanggal_bisnis, dimuat, ke_babonan, pecah,
        persen_saat_panen, operator_akun_id, shift, slot_dimuat, slot_babonan, slot_pecah)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, cardinality($8::int[]), cardinality($9::int[]), cardinality($10::int[]),
             $11, $12, $13, $8::int[], $9::int[], $10::int[])
     RETURNING id::text AS id`,
    [
      kode,
      asal.id,
      asal.kolom_id,
      asal.bak_id,
      asal.varian,
      sekarang,
      tanggalBisnisPanen(sekarang),
      urutUnik(v.slotDimuat),
      urutUnik(v.slotBabonan),
      urutUnik(v.slotPecah),
      v.persen,
      p.akunId,
      shiftDari(sekarang),
    ],
  );
  return rows[0].id;
}

// ── Aksi operator ──────────────────────────────────────────────────────────

// slot null = semua slot kosong yang tidak rusak (satu ketukan); daftar
// eksplisit wajib ⊆ slot kosong non-rusak.
export async function isiAir(
  kode: string,
  kolomId: string,
  slot: number[] | null,
  p: Pelaku,
): Promise<{ isianId: string; jumlah: number }> {
  cekPelaku(p);
  teksWajib(kolomId, "Rek");
  const pilihan = slot === null || slot === undefined ? null : normalisasiSlot(slot, "isi air", false);
  return transaksi(async (c, sekarang) => {
    const ctx = await kunciKolom(c, kode, kolomId);
    const aktif = await kunciIsian(c, kode, kolomId);
    const rusak = await kunciRusak(c, kode, kolomId);
    if (await maintenanceTerbuka(c, kode, kolomId)) {
      throw galat("VALIDASI", "Rek sedang maintenance. Selesaikan maintenance dulu sebelum isi air.");
    }
    const kapasitas = ctx.kolom.jumlahIceCan;
    const bebas = slotBebas(kapasitas, aktif, rusak);
    let isi: number[];
    if (pilihan === null) {
      if (bebas.length === 0) {
        const ket = rusak.length > 0 ? `, ${rusak.length} can rusak` : "";
        throw galat("KAPASITAS", `Rek sudah penuh: tidak ada can kosong (${totalTerisi(aktif)}/${kapasitas} terisi${ket}).`);
      }
      isi = bebas;
    } else {
      cekRentang(pilihan, kapasitas);
      const setBebas = new Set(bebas);
      const tidakBebas = pilihan.filter((s) => !setBebas.has(s));
      if (tidakBebas.length > 0) {
        throw await galatBerubah(c, kode, kolomId, `Slot ${daftarSlot(tidakBebas)} sudah terisi atau rusak.`);
      }
      isi = pilihan;
    }
    const sesudah = salinSlot(aktif);
    sesudah.set("baru", { id: "baru", jenis: "produksi", slot: isi, slot_pecah: [] });
    cekInvarianRek(kapasitas, sesudah.values(), rusak);

    const isianId = await buatIsianProduksi(c, kode, ctx, isi, p);
    await tulisLog(c, kode, p, sekarang, {
      aksi: "isi_air",
      kolomId,
      ctx,
      rujukanId: isianId,
      sesudah: {
        isianId,
        jumlah: isi.length,
        slot: isi,
        varian: ctx.kolom.varian,
        durasiBekuJam: ctx.bak.durasiBekuJam[ctx.kolom.varian],
      },
    });
    return { isianId, jumlah: isi.length };
  });
}

function totalTerisi(aktif: BarisIsian[]): number {
  return aktif.reduce((s, i) => s + i.slot.length, 0);
}

function normalisasiMuatan(raw: unknown): MuatanInput[] {
  if (!Array.isArray(raw)) throw galat("VALIDASI", "Daftar muatan tidak sah.");
  return raw.map((m: unknown) => {
    const o = (m ?? {}) as Record<string, unknown>;
    if (o.jenis !== "armada" && o.jenis !== "pembeli") throw galat("VALIDASI", "Jenis kendaraan muatan tidak sah.");
    return {
      jenis: o.jenis,
      kendaraanErpId: o.jenis === "armada" ? teksOpsional(o.kendaraanErpId) : null,
      plat: typeof o.plat === "string" ? o.plat.trim() : "",
      agenId: teksOpsional(o.agenId),
      agenNama: teksOpsional(o.agenNama),
      jumlah: typeof o.jumlah === "number" ? o.jumlah : Number.NaN,
    };
  });
}

export interface PanenInputSlot extends PanenSlotInput {
  isianId: string;
  isiUlang: boolean;
  konfirmasiBelumSiap: boolean;
}

// Panen isian produksi: slotBabonan + slotPecah pindah ke isian Babonan rek
// (slot digabung), sisanya dimuat; isian produksi selesai. Panen isian
// Babonan: slotDimuat keluar dari Babonan. isiUlang mengisi PERSIS slot
// yang dimuat (bebas & tidak rusak karena tadinya ditempati) sebagai isian
// produksi baru.
export async function panen(kode: string, input: PanenInputSlot, p: Pelaku): Promise<{ panenId: string; isianBaruId: string | null }> {
  cekPelaku(p);
  const isianId = cekId(input?.isianId, "Isian");
  const muatan = normalisasiMuatan(input.muatan);
  const slotBabonan = normalisasiSlot(input.slotBabonan ?? [], "Babonan", true);
  const slotPecah = normalisasiSlot(input.slotPecah ?? [], "pecah", true);
  const slotDimuatKlien = input.slotDimuat === undefined || input.slotDimuat === null ? null : normalisasiSlot(input.slotDimuat, "dimuat", true);
  const isiUlang = input.isiUlang === true;
  const konfirmasi = input.konfirmasiBelumSiap === true;
  const setBabonan = new Set(slotBabonan);
  const ganda = slotPecah.filter((s) => setBabonan.has(s));
  if (ganda.length > 0) throw galat("VALIDASI", `Slot ${daftarSlot(ganda)} tidak bisa sekaligus Babonan dan pecah.`);

  return transaksi(async (c, sekarang) => {
    const kolomId = await kolomDariIsian(c, kode, isianId);
    const ctx = await kunciKolom(c, kode, kolomId);
    const aktif = await kunciIsian(c, kode, kolomId);
    const asal = aktif.find((i) => i.id === isianId);
    if (!asal) throw await galatBerubah(c, kode, kolomId, "Isian ini sudah tidak aktif (sudah dipanen atau dikoreksi).");
    const rusak = await kunciRusak(c, kode, kolomId);
    const kapasitas = ctx.kolom.jumlahIceCan;
    cekRentang([...slotBabonan, ...slotPecah, ...(slotDimuatKlien ?? [])], kapasitas);

    const jenis = asal.jenis;
    const milik = new Set(asal.slot);
    const dimuatJumlah = muatan.reduce((s, m) => s + m.jumlah, 0);
    if (jenis === "babonan") {
      if (slotBabonan.length > 0 || slotPecah.length > 0) throw galat("VALIDASI", "Can Babonan tidak bisa dipindah lagi ke Babonan atau pecah.");
      if (!slotDimuatKlien || slotDimuatKlien.length === 0) throw galat("VALIDASI", "Belum ada can Babonan yang dimuat.");
      const bukan = slotDimuatKlien.filter((s) => !milik.has(s));
      if (bukan.length > 0) throw await galatBerubah(c, kode, kolomId, `Slot ${daftarSlot(bukan)} bukan lagi Babonan di rek ini.`);
    } else {
      const bukan = [...slotBabonan, ...slotPecah].filter((s) => !milik.has(s));
      if (bukan.length > 0) throw await galatBerubah(c, kode, kolomId, `Slot ${daftarSlot(urutUnik(bukan))} bukan lagi milik isian ini.`);
      const diminta = dimuatJumlah + slotBabonan.length + slotPecah.length;
      if (diminta > asal.slot.length) {
        throw await galatBerubah(c, kode, kolomId, `Rek ini tinggal ${asal.slot.length} can (diminta ${diminta}).`);
      }
    }
    const masukan: PanenSlotInput = { muatan, slotBabonan, slotPecah, slotDimuat: slotDimuatKlien ?? undefined };
    const galatSlot = validasiPanenSlot({ jenis, slot: asal.slot, slotPecah: asal.slot_pecah }, masukan);
    if (galatSlot) throw galat("VALIDASI", galatSlot);
    const slotDimuat = slotDimuatDari({ jenis, slot: asal.slot }, masukan);
    // Produksi: slotDimuat dari klien (opsional) harus sama dengan hasil hitungan server.
    if (jenis === "produksi" && slotDimuatKlien && slotDimuatKlien.length > 0 && daftarSlot(slotDimuatKlien) !== daftarSlot(slotDimuat)) {
      throw await galatBerubah(c, kode, kolomId, "Slot yang dimuat tidak cocok dengan isi rek terkini.");
    }

    let persen: number | null = null;
    if (jenis === "produksi") {
      const durasi = asal.durasi_beku_jam === null ? ctx.bak.durasiBekuJam[asal.varian] : Number(asal.durasi_beku_jam);
      persen = hitungKematangan(asal.mulai_at, durasi, sekarang);
      if (persen < AMBANG.panenBelumSiapPersen && !konfirmasi) {
        throw galat("BELUM_SIAP", `Es belum siap (kematangan ${persen}%). Tetap panen?`);
      }
    }

    const slotIsiUlang = isiUlang ? slotDimuat : [];
    if (slotIsiUlang.length > 0 && (await maintenanceTerbuka(c, kode, kolomId))) {
      throw galat("VALIDASI", "Rek sedang maintenance; panen tanpa isi ulang.");
    }

    // Keadaan sesudah di memori → cek invarian → tulis.
    const sesudah = salinSlot(aktif);
    const asalSesudah = sesudah.get(asal.id)!;
    const pindah = jenis === "produksi" ? urutUnik([...slotBabonan, ...slotPecah]) : [];
    asalSesudah.slot = kurangi(asal.slot, [...slotDimuat, ...pindah]);
    asalSesudah.slot_pecah = kurangi(asal.slot_pecah, [...slotDimuat, ...pindah]);
    const { bab, baru } = rencanaBabonan(sesudah, asal.id, pindah, jenis === "produksi" ? slotPecah : []);
    if (baru) sesudah.set(baru.id, baru);
    if (slotIsiUlang.length > 0) sesudah.set("isi-ulang", { id: "isi-ulang", jenis: "produksi", slot: slotIsiUlang, slot_pecah: [] });
    cekInvarianRek(kapasitas, sesudah.values(), rusak);

    await tulisSlotIsian(c, asalSesudah, p.akunId);
    const slotBabonanPanen = jenis === "produksi" ? slotBabonan : [];
    const slotPecahPanen = jenis === "produksi" ? slotPecah : [];
    const panenId = await insertPanen(
      c,
      kode,
      asal,
      sekarang,
      { slotDimuat, slotBabonan: slotBabonanPanen, slotPecah: slotPecahPanen, persen },
      p,
    );
    for (const m of muatan) {
      await c.query(
        `INSERT INTO produksi_muatan (panen_id, jenis, kendaraan_erp_id, plat, agen_id, agen_nama, jumlah)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [panenId, m.jenis, m.kendaraanErpId, m.plat, m.agenId, m.agenNama, m.jumlah],
      );
    }
    const babonanIsianId = pindah.length > 0 ? await tambahKeBabonan(c, kode, asal, bab, pindah, slotPecahPanen, p) : null;
    const isianBaruId = slotIsiUlang.length > 0 ? await buatIsianProduksi(c, kode, ctx, slotIsiUlang, p) : null;

    await tulisLog(c, kode, p, sekarang, {
      aksi: "panen",
      kolomId,
      ctx,
      rujukanId: panenId,
      sebelum: snapshotIsian(asal),
      sesudah: {
        panenId,
        muatan,
        dimuat: slotDimuat.length,
        babonan: slotBabonanPanen.length,
        pecah: slotPecahPanen.length,
        slotDimuat,
        slotBabonan: slotBabonanPanen,
        slotPecah: slotPecahPanen,
        sisa: asalSesudah.slot.length,
        slotSisa: asalSesudah.slot,
        persen,
        belumSiap: persen !== null && persen < AMBANG.panenBelumSiapPersen,
        babonanIsianId,
        isiUlang,
        isianBaruId,
        slotIsiUlang,
        tanggalBisnis: tanggalBisnisPanen(sekarang),
      },
    });
    return { panenId, isianBaruId };
  });
}

// Pindah slot terpilih isian produksi ke Babonan tanpa panen. Dicatat juga
// sebagai baris produksi_panen (dimuat 0, ke_babonan |slot|, persen NULL)
// supaya invarian jumlah_awal = sisa + Σ dimuat + Σ ke_babonan + Σ pecah
// tetap berlaku.
export async function tandaiBabonan(kode: string, isianId: string, slot: number[], p: Pelaku): Promise<void> {
  cekPelaku(p);
  const id = cekId(isianId, "Isian");
  const pilihan = normalisasiSlot(slot, "Babonan", false);
  await transaksi(async (c, sekarang) => {
    const kolomId = await kolomDariIsian(c, kode, id);
    const ctx = await kunciKolom(c, kode, kolomId);
    const aktif = await kunciIsian(c, kode, kolomId);
    const asal = aktif.find((i) => i.id === id);
    if (!asal) throw await galatBerubah(c, kode, kolomId, "Isian ini sudah tidak aktif.");
    if (asal.jenis !== "produksi") throw galat("VALIDASI", "Isian ini sudah Babonan.");
    const rusak = await kunciRusak(c, kode, kolomId);
    const kapasitas = ctx.kolom.jumlahIceCan;
    cekRentang(pilihan, kapasitas);
    const milik = new Set(asal.slot);
    const bukan = pilihan.filter((s) => !milik.has(s));
    if (bukan.length > 0) throw await galatBerubah(c, kode, kolomId, `Slot ${daftarSlot(bukan)} bukan lagi milik isian ini.`);

    const sesudah = salinSlot(aktif);
    const asalSesudah = sesudah.get(asal.id)!;
    asalSesudah.slot = kurangi(asal.slot, pilihan);
    const { bab, baru } = rencanaBabonan(sesudah, asal.id, pilihan, []);
    if (baru) sesudah.set(baru.id, baru);
    cekInvarianRek(kapasitas, sesudah.values(), rusak);

    await tulisSlotIsian(c, asalSesudah, p.akunId);
    const panenId = await insertPanen(c, kode, asal, sekarang, { slotDimuat: [], slotBabonan: pilihan, slotPecah: [], persen: null }, p);
    const babonanIsianId = await tambahKeBabonan(c, kode, asal, bab, pilihan, [], p);
    await tulisLog(c, kode, p, sekarang, {
      aksi: "tandai_babonan",
      kolomId,
      ctx,
      rujukanId: panenId,
      sebelum: snapshotIsian(asal),
      sesudah: { panenId, jumlah: pilihan.length, slot: pilihan, sisa: asalSesudah.slot.length, slotSisa: asalSesudah.slot, babonanIsianId },
    });
  });
}

// Babonan dibuang/dilebur (tidak dimuat; tidak ikut pencocokan DO). Slot
// terpilih ⊆ slot Babonan (boleh termasuk pecah).
export async function buangBabonan(kode: string, kolomId: string, slot: number[], alasan: string, p: Pelaku): Promise<void> {
  cekPelaku(p);
  teksWajib(kolomId, "Rek");
  const pilihan = normalisasiSlot(slot, "dibuang", false);
  const alasanBersih = teksOpsional(alasan);
  await transaksi(async (c, sekarang) => {
    const ctx = await kunciKolom(c, kode, kolomId);
    const aktif = await kunciIsian(c, kode, kolomId);
    const bab = aktif.find((i) => i.jenis === "babonan");
    if (!bab) throw await galatBerubah(c, kode, kolomId, "Rek ini tidak punya Babonan.");
    const rusak = await kunciRusak(c, kode, kolomId);
    const kapasitas = ctx.kolom.jumlahIceCan;
    cekRentang(pilihan, kapasitas);
    const milik = new Set(bab.slot);
    const bukan = pilihan.filter((s) => !milik.has(s));
    if (bukan.length > 0) throw await galatBerubah(c, kode, kolomId, `Slot ${daftarSlot(bukan)} bukan lagi Babonan di rek ini.`);

    const sesudah = salinSlot(aktif);
    const babSesudah = sesudah.get(bab.id)!;
    babSesudah.slot = kurangi(bab.slot, pilihan);
    babSesudah.slot_pecah = kurangi(bab.slot_pecah, pilihan);
    cekInvarianRek(kapasitas, sesudah.values(), rusak);

    await tulisSlotIsian(c, babSesudah, p.akunId);
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO produksi_babonan_keluar (isian_id, at, jumlah, alasan, akun_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id`,
      [bab.id, sekarang, pilihan.length, alasanBersih, p.akunId],
    );
    const pecahDibuang = pilihan.filter((s) => bab.slot_pecah.includes(s));
    await tulisLog(c, kode, p, sekarang, {
      aksi: "buang_babonan",
      kolomId,
      ctx,
      rujukanId: rows[0].id,
      sebelum: snapshotIsian(bab),
      sesudah: {
        jumlah: pilihan.length,
        slot: pilihan,
        slotPecah: pecahDibuang,
        sisa: babSesudah.slot.length,
        slotSisa: babSesudah.slot,
        slotPecahSisa: babSesudah.slot_pecah,
      },
      alasan: alasanBersih,
    });
  });
}

// Tandai can rusak: hanya slot yang tidak ditempati isian aktif (can berisi
// es tidak bisa ditandai rusak — panen/buang dulu). Slot rusak dilewati Isi
// Air dan mengunci kolom di denah sampai diperbaiki.
export async function tandaiRusak(kode: string, kolomId: string, slot: number[], catatan: string, p: Pelaku): Promise<void> {
  cekPelaku(p);
  teksWajib(kolomId, "Rek");
  const pilihan = normalisasiSlot(slot, "rusak", false);
  const catatanBersih = teksOpsional(catatan);
  await transaksi(async (c, sekarang) => {
    const ctx = await kunciKolom(c, kode, kolomId);
    const aktif = await kunciIsian(c, kode, kolomId);
    const rusak = await kunciRusak(c, kode, kolomId);
    cekRentang(pilihan, ctx.kolom.jumlahIceCan);
    const terisi = slotTerisi(aktif);
    const berisi = pilihan.filter((s) => terisi.has(s));
    if (berisi.length > 0) throw await galatBerubah(c, kode, kolomId, `Slot ${daftarSlot(berisi)} masih berisi can es.`);
    const sudahRusak = new Set(rusak.map((r) => r.slot));
    const ganda = pilihan.filter((s) => sudahRusak.has(s));
    if (ganda.length > 0) throw await galatBerubah(c, kode, kolomId, `Slot ${daftarSlot(ganda)} sudah ditandai rusak.`);

    const ids: string[] = [];
    for (const s of pilihan) {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO produksi_slot_rusak (perusahaan_kode, kolom_id, slot, mulai_at, catatan, dibuka_oleh_akun_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text AS id`,
        [kode, kolomId, s, sekarang, catatanBersih, p.akunId],
      );
      ids.push(rows[0].id);
    }
    await tulisLog(c, kode, p, sekarang, {
      aksi: "tandai_rusak",
      kolomId,
      ctx,
      rujukanId: ids[0],
      sebelum: { slotRusak: rusak.map((r) => r.slot) },
      sesudah: { slot: pilihan, rusakId: ids, catatan: catatanBersih, slotRusak: urutUnik([...sudahRusak, ...pilihan]) },
    });
  });
}

// "Sudah diperbaiki": tutup can rusak aktif pada slot terpilih. Longgar:
// rek yang dinonaktifkan/dihapus dari denah tetap bisa dibersihkan.
export async function perbaikiRusak(kode: string, kolomId: string, slot: number[], p: Pelaku): Promise<void> {
  cekPelaku(p);
  teksWajib(kolomId, "Rek");
  const pilihan = normalisasiSlot(slot, "diperbaiki", false);
  await transaksi(async (c, sekarang) => {
    const ctx = await kunciKolomDasar(c, kode, kolomId, true);
    await kunciIsian(c, kode, kolomId, true);
    const rusak = await kunciRusak(c, kode, kolomId);
    const perSlot = new Map(rusak.map((r) => [r.slot, r]));
    const bukan = pilihan.filter((s) => !perSlot.has(s));
    if (bukan.length > 0) throw await galatBerubah(c, kode, kolomId, `Slot ${daftarSlot(bukan)} tidak sedang ditandai rusak.`);

    const ditutup = pilihan.map((s) => perSlot.get(s)!);
    await c.query(
      `UPDATE produksi_slot_rusak SET selesai_at = $2, ditutup_oleh_akun_id = $3 WHERE id = ANY($1::bigint[])`,
      [ditutup.map((r) => r.id), sekarang, p.akunId],
    );
    await tulisLog(c, kode, p, sekarang, {
      aksi: "perbaiki_rusak",
      kolomId,
      ctx,
      rujukanId: ditutup[0].id,
      sebelum: {
        slot: pilihan,
        rusak: ditutup.map((r) => ({ id: r.id, slot: r.slot, mulaiAt: r.mulai_at.toISOString(), catatan: r.catatan })),
        slotRusak: rusak.map((r) => r.slot),
      },
      sesudah: { slotRusak: kurangi(rusak.map((r) => r.slot), pilihan) },
    });
  });
}

export async function mulaiMaintenance(kode: string, kolomId: string, catatan: string, p: Pelaku): Promise<void> {
  cekPelaku(p);
  teksWajib(kolomId, "Rek");
  const catatanBersih = teksOpsional(catatan);
  await transaksi(async (c, sekarang) => {
    const ctx = await kunciKolom(c, kode, kolomId);
    const aktif = await kunciIsian(c, kode, kolomId);
    if (aktif.some((i) => i.jenis === "produksi")) {
      throw galat("VALIDASI", "Rek masih berisi es produksi. Panen dulu (tanpa isi ulang) sebelum maintenance.");
    }
    if (await maintenanceTerbuka(c, kode, kolomId)) throw await galatBerubah(c, kode, kolomId, "Rek ini sudah dalam maintenance.");
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO produksi_maintenance (perusahaan_kode, kolom_id, mulai_at, catatan, dibuka_oleh_akun_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id`,
      [kode, kolomId, sekarang, catatanBersih, p.akunId],
    );
    await tulisLog(c, kode, p, sekarang, {
      aksi: "mulai_maintenance",
      kolomId,
      ctx,
      rujukanId: rows[0].id,
      sesudah: { maintenanceId: rows[0].id, catatan: catatanBersih },
    });
  });
}

export async function selesaiMaintenance(kode: string, kolomId: string, p: Pelaku): Promise<void> {
  cekPelaku(p);
  teksWajib(kolomId, "Rek");
  await transaksi(async (c, sekarang) => {
    // Longgar: rek yang dinonaktifkan selama maintenance tetap bisa ditutup.
    const ctx = await kunciKolomDasar(c, kode, kolomId, true);
    await kunciIsian(c, kode, kolomId, true);
    const mt = await maintenanceTerbuka(c, kode, kolomId);
    if (!mt) throw await galatBerubah(c, kode, kolomId, "Rek ini tidak sedang maintenance.");
    await c.query(
      `UPDATE produksi_maintenance SET selesai_at = $2, ditutup_oleh_akun_id = $3 WHERE id = $1`,
      [mt.id, sekarang, p.akunId],
    );
    await tulisLog(c, kode, p, sekarang, {
      aksi: "selesai_maintenance",
      kolomId,
      ctx,
      rujukanId: mt.id,
      sebelum: { maintenanceId: mt.id, mulaiAt: mt.mulai_at.toISOString(), catatan: mt.catatan },
    });
  });
}

// ── Koreksi admin ──────────────────────────────────────────────────────────

// `slot` mengganti himpunan slot isian (sisa = |slot|). jumlah_awal digeser
// dengan selisih yang sama, supaya invarian jumlah_awal = sisa + Σ keluar
// tetap berlaku (salah hitung can). Slot harus dalam kapasitas (KAPASITAS),
// tidak ditempati isian aktif lain dan tidak rusak (KEADAAN_BERUBAH). Slot
// pecah Babonan yang tidak lagi ada di slot ikut dibuang. Slot kosong = isian
// selesai (sama seperti koreksi sisa 0 dulu).
//
// `slotDiharapkan` = himpunan slot isian yang dilihat klien saat mulai
// mengedit. Bila diberikan dan berbeda dari slot terkini (mis. operator
// memanen saat dialog terbuka) → KEADAAN_BERUBAH, supaya can yang sudah
// dipanen tidak dikembalikan diam-diam.
//
// Koreksi boleh berjalan di rek yang slotnya belum siap (jalur perbaikan
// data), tetapi mengganti slot ditolak bila isian aktif LAIN di rek itu
// belum punya slot (cek bentrok tidak bisa dipercaya).
export async function koreksiIsian(
  kode: string,
  isianId: string,
  ubah: { mulaiAt?: string; varian?: Varian; slot?: number[]; slotDiharapkan?: number[] },
  alasan: string,
  p: Pelaku,
): Promise<void> {
  const alasanBersih = cekAdmin(p, alasan);
  const id = cekId(isianId, "Isian");
  const u = ubah ?? {};
  if (u.mulaiAt === undefined && u.varian === undefined && u.slot === undefined) throw galat("VALIDASI", "Tidak ada yang dikoreksi.");
  const mulaiBaru = u.mulaiAt === undefined ? null : cekTanggalIso(u.mulaiAt, "Waktu isi air");
  if (u.varian !== undefined && u.varian !== "kecil" && u.varian !== "besar") throw galat("VALIDASI", "Varian tidak sah.");
  const slotBaru = u.slot === undefined ? null : normalisasiSlot(u.slot, "isian", true);
  const slotDiharapkan = u.slotDiharapkan === undefined ? null : normalisasiSlot(u.slotDiharapkan, "diharapkan", true);

  await transaksi(async (c, sekarang) => {
    const kolomId = await kolomDariIsian(c, kode, id);
    const ctx = await kunciKolom(c, kode, kolomId);
    const aktif = await kunciIsian(c, kode, kolomId, true);
    const lama = aktif.find((i) => i.id === id);
    if (!lama) throw await galatBerubah(c, kode, kolomId, "Isian ini sudah tidak aktif.");
    if (slotDiharapkan && daftarSlot(slotDiharapkan) !== daftarSlot(urutUnik(lama.slot))) {
      throw await galatBerubah(c, kode, kolomId, "Slot isian ini berubah sejak dialog dibuka.");
    }
    if (slotBaru && aktif.some((i) => i.id !== lama.id && slotBelumSiap(i))) throw galat("KEADAAN_BERUBAH", PESAN_SLOT_BELUM_SIAP);
    const rusak = await kunciRusak(c, kode, kolomId);
    if (mulaiBaru && mulaiBaru.getTime() > sekarang.getTime()) throw galat("VALIDASI", "Waktu isi air tidak boleh di masa depan.");

    const kapasitas = ctx.kolom.jumlahIceCan;
    const slot = slotBaru ?? lama.slot;
    if (slotBaru) {
      cekRentang(slotBaru, kapasitas, "KAPASITAS");
      const lain = slotTerisi(aktif, lama.id);
      const bentrok = slotBaru.filter((s) => lain.has(s));
      if (bentrok.length > 0) throw await galatBerubah(c, kode, kolomId, `Slot ${daftarSlot(bentrok)} sudah ditempati isian lain.`);
      const slotRusak = new Set(rusak.map((r) => r.slot));
      const kenaRusak = slotBaru.filter((s) => slotRusak.has(s));
      if (kenaRusak.length > 0) throw await galatBerubah(c, kode, kolomId, `Slot ${daftarSlot(kenaRusak)} sedang rusak.`);
    }
    const slotPecah = lama.slot_pecah.filter((s) => slot.includes(s));
    const sesudah = salinSlot(aktif);
    const isianSesudah = sesudah.get(lama.id)!;
    isianSesudah.slot = slot;
    isianSesudah.slot_pecah = slotPecah;
    if (slotBaru) cekInvarianRek(kapasitas, sesudah.values(), rusak);

    const varianBaru = u.varian ?? lama.varian;
    const durasiBaru =
      lama.jenis === "babonan"
        ? null
        : varianBaru !== lama.varian
          ? ctx.bak.durasiBekuJam[varianBaru]
          : lama.durasi_beku_jam === null
            ? null
            : Number(lama.durasi_beku_jam);
    const mulaiAt = mulaiBaru ?? lama.mulai_at;
    const deltaJumlah = slotBaru ? slotBaru.length - lama.sisa : 0;

    await c.query(
      `UPDATE produksi_kolom_isi
          SET mulai_at = $2, varian = $3, durasi_beku_jam = $4
        WHERE id = $1`,
      [id, mulaiAt, varianBaru, durasiBaru],
    );
    if (slotBaru) await tulisSlotIsian(c, isianSesudah, p.akunId, deltaJumlah);

    const baru: BarisIsian = {
      ...lama,
      mulai_at: mulaiAt,
      varian: varianBaru,
      durasi_beku_jam: durasiBaru === null ? null : String(durasiBaru),
      jumlah_awal: lama.jumlah_awal + deltaJumlah,
      sisa: slotBaru ? slot.length : lama.sisa,
      pecah: slotBaru ? slotPecah.length : lama.pecah,
      slot,
      slot_pecah: slotPecah,
    };
    await tulisLog(c, kode, p, sekarang, {
      aksi: "koreksi_isian",
      kolomId,
      ctx,
      rujukanId: id,
      sebelum: snapshotIsian(lama),
      sesudah: snapshotIsian(baru),
      alasan: alasanBersih,
    });
  });
}

// Batal panen ≤ 7 hari. Slot dikembalikan PERSIS bila semua syarat ini
// terpenuhi: isian asal masih aktif, slot_dimuat panen itu masih kosong dan
// tidak rusak, slot_babonan/slot_pecah panen itu masih ada di isian Babonan
// rek, dan rek masih aktif di denah. Selain itu panen hanya ditandai batal.
// Panen sebelum slot dicatat (slot_* kosong padahal jumlahnya > 0) juga
// hanya ditandai. Isian baru hasil isiUlang TIDAK diubah; admin
// mengoreksinya terpisah.
export async function batalkanPanen(kode: string, panenId: string, alasan: string, p: Pelaku): Promise<void> {
  const alasanBersih = cekAdmin(p, alasan);
  const id = cekId(panenId, "Panen");
  await transaksi(async (c, sekarang) => {
    const awal = await c.query<{ kolom_id: string }>(
      `SELECT kolom_id FROM produksi_panen WHERE id = $1 AND perusahaan_kode = $2`,
      [id, kode],
    );
    if (!awal.rows[0]) throw galat("TIDAK_DITEMUKAN", "Panen tidak ditemukan.");
    const kolomId = awal.rows[0].kolom_id;
    const ctx = await kunciKolomDasar(c, kode, kolomId, true);
    const aktif = await kunciIsian(c, kode, kolomId);
    const rusak = await kunciRusak(c, kode, kolomId);
    const { rows } = await c.query<{
      isian_id: string;
      dimuat: number;
      ke_babonan: number;
      pecah: number;
      slot_dimuat: number[];
      slot_babonan: number[];
      slot_pecah: number[];
      panen_at: Date;
      dibatalkan_at: Date | null;
      persen_saat_panen: number | null;
      jenis_isian: JenisIsian;
    }>(
      `SELECT p.isian_id::text AS isian_id, p.dimuat, p.ke_babonan, p.pecah, p.slot_dimuat, p.slot_babonan, p.slot_pecah,
              p.panen_at, p.dibatalkan_at, p.persen_saat_panen, ki.jenis AS jenis_isian
         FROM produksi_panen p JOIN produksi_kolom_isi ki ON ki.id = p.isian_id
        WHERE p.id = $1 FOR UPDATE OF p`,
      [id],
    );
    const pn = rows[0];
    if (pn.dibatalkan_at) throw await galatBerubah(c, kode, kolomId, "Panen ini sudah dibatalkan.");
    if (sekarang.getTime() - pn.panen_at.getTime() > BATAS_HARI_BATAL * 24 * JAM_MS) {
      throw galat("VALIDASI", `Panen lebih dari ${BATAS_HARI_BATAL} hari tidak bisa dibatalkan.`);
    }

    const asal = aktif.find((i) => i.id === pn.isian_id) ?? null;
    const tarik = urutUnik([...pn.slot_babonan, ...pn.slot_pecah]);
    const bab = tarik.length > 0 ? (aktif.find((i) => i.jenis === "babonan" && i.id !== asal?.id) ?? null) : null;
    const slotTercatat =
      pn.slot_dimuat.length === pn.dimuat && pn.slot_babonan.length === pn.ke_babonan && pn.slot_pecah.length === pn.pecah;
    const babonanMasih = tarik.length === 0 || (bab !== null && tarik.every((s) => bab.slot.includes(s)));
    const terisi = slotTerisi(aktif);
    const slotRusak = new Set(rusak.map((r) => r.slot));
    const kapasitas = ctx?.kolom.jumlahIceCan ?? 0;
    const dimuatKosong = pn.slot_dimuat.every((s) => !terisi.has(s) && !slotRusak.has(s) && s <= kapasitas);
    const rekAktif = ctx !== null && !ctx.kolom.nonaktif;
    let dikembalikan = asal !== null && slotTercatat && babonanMasih && dimuatKosong && rekAktif;

    let asalSesudah: KeadaanSlotIsian | null = null;
    if (dikembalikan && asal) {
      const sesudah = salinSlot(aktif);
      asalSesudah = sesudah.get(asal.id)!;
      asalSesudah.slot = urutUnik([...asal.slot, ...pn.slot_dimuat, ...tarik]);
      if (bab) {
        const babSesudah = sesudah.get(bab.id)!;
        babSesudah.slot = kurangi(bab.slot, tarik);
        babSesudah.slot_pecah = kurangi(bab.slot_pecah, tarik);
      }
      try {
        cekInvarianRek(kapasitas, sesudah.values(), rusak);
      } catch {
        dikembalikan = false;
        asalSesudah = null;
      }
      if (asalSesudah) {
        await tulisSlotIsian(c, asalSesudah, p.akunId);
        if (bab) await tulisSlotIsian(c, sesudah.get(bab.id)!, p.akunId, -tarik.length);
      }
    }
    await c.query(`UPDATE produksi_panen SET dibatalkan_at = $2, alasan_batal = $3 WHERE id = $1`, [id, sekarang, alasanBersih]);

    await tulisLog(c, kode, p, sekarang, {
      aksi: "batal_panen",
      kolomId,
      ctx,
      rujukanId: id,
      sebelum: {
        panenId: id,
        isianId: pn.isian_id,
        dimuat: pn.dimuat,
        keBabonan: pn.ke_babonan,
        pecah: pn.pecah,
        slotDimuat: pn.slot_dimuat,
        slotBabonan: pn.slot_babonan,
        slotPecah: pn.slot_pecah,
        // persen + jenisIsian: label "Tandai Babonan" di log memakai aturan
        // yang sama dengan server (dimuat 0, persen NULL, isian produksi).
        persen: pn.persen_saat_panen,
        jenisIsian: pn.jenis_isian,
        panenAt: pn.panen_at.toISOString(),
        isian: asal ? snapshotIsian(asal) : null,
        babonan: bab ? snapshotIsian(bab) : null,
      },
      sesudah: {
        dibatalkan: true,
        dikembalikan,
        sisaIsian: asal ? (asalSesudah ? asalSesudah.slot.length : asal.sisa) : null,
        slotIsian: asal ? (asalSesudah ? asalSesudah.slot : asal.slot) : null,
      },
      alasan: alasanBersih,
    });
  });
}

// Koreksi admin "Ubah kendaraan": ganti daftar muatan sebuah panen yang
// belum dibatalkan dan ≤ 7 hari (mis. dicatat ke kendaraan yang salah).
// dimuat tidak berubah (Σ muatan baru wajib = dimuat), jadi isian, Babonan,
// dan invarian jumlah tidak tersentuh. Baris produksi_muatan lama panen itu
// dihapus lalu diganti di transaksi yang sama; daftar lama utuh tersimpan di
// produksi_log.sebelum. Panen sendiri tidak pernah dihapus.
export async function koreksiMuatan(kode: string, panenId: string, muatanBaru: MuatanInput[], alasan: string, p: Pelaku): Promise<void> {
  const alasanBersih = cekAdmin(p, alasan);
  const id = cekId(panenId, "Panen");
  const muatan = normalisasiMuatan(muatanBaru);
  await transaksi(async (c, sekarang) => {
    const awal = await c.query<{ kolom_id: string }>(
      `SELECT kolom_id FROM produksi_panen WHERE id = $1 AND perusahaan_kode = $2`,
      [id, kode],
    );
    if (!awal.rows[0]) throw galat("TIDAK_DITEMUKAN", "Panen tidak ditemukan.");
    const kolomId = awal.rows[0].kolom_id;
    // Longgar: rek yang sudah dinonaktifkan/dihapus dari denah tetap bisa dikoreksi.
    const ctx = await kunciKolomDasar(c, kode, kolomId, true);
    const { rows } = await c.query<{ dimuat: number; panen_at: Date; dibatalkan_at: Date | null; tanggal_bisnis: string }>(
      `SELECT dimuat, panen_at, dibatalkan_at, tanggal_bisnis::text AS tanggal_bisnis
         FROM produksi_panen WHERE id = $1 AND perusahaan_kode = $2 FOR UPDATE`,
      [id, kode],
    );
    const pn = rows[0];
    if (pn.dibatalkan_at) throw await galatBerubah(c, kode, kolomId, "Panen ini sudah dibatalkan.");
    if (sekarang.getTime() - pn.panen_at.getTime() > BATAS_HARI_BATAL * 24 * JAM_MS) {
      throw galat("VALIDASI", `Panen lebih dari ${BATAS_HARI_BATAL} hari tidak bisa dikoreksi.`);
    }
    const galatMuatan = validasiKoreksiMuatan(pn.dimuat, muatan);
    if (galatMuatan) throw galat("VALIDASI", galatMuatan);

    const lama = await c.query<{
      jenis: "armada" | "pembeli";
      kendaraan_erp_id: string | null;
      plat: string;
      agen_id: string | null;
      agen_nama: string | null;
      jumlah: number;
    }>(
      `SELECT jenis, kendaraan_erp_id, plat, agen_id, agen_nama, jumlah
         FROM produksi_muatan WHERE panen_id = $1 ORDER BY id FOR UPDATE`,
      [id],
    );
    await c.query(`DELETE FROM produksi_muatan WHERE panen_id = $1`, [id]);
    for (const m of muatan) {
      await c.query(
        `INSERT INTO produksi_muatan (panen_id, jenis, kendaraan_erp_id, plat, agen_id, agen_nama, jumlah)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, m.jenis, m.kendaraanErpId, m.plat, m.agenId, m.agenNama, m.jumlah],
      );
    }
    await tulisLog(c, kode, p, sekarang, {
      aksi: "koreksi_muatan",
      kolomId,
      ctx,
      rujukanId: id,
      sebelum: {
        panenId: id,
        dimuat: pn.dimuat,
        tanggalBisnis: pn.tanggal_bisnis,
        muatan: lama.rows.map((m) => ({
          jenis: m.jenis,
          kendaraanErpId: m.kendaraan_erp_id,
          plat: m.plat,
          agenId: m.agen_id,
          agenNama: m.agen_nama,
          jumlah: m.jumlah,
        })),
      },
      sesudah: { panenId: id, dimuat: pn.dimuat, tanggalBisnis: pn.tanggal_bisnis, muatan },
      alasan: alasanBersih,
    });
  });
}

// ── Kendaraan aktif operator ───────────────────────────────────────────────

// Kunci (akun_id, perusahaan_kode): satu akun (mis. Direktur/Super Admin) bisa
// punya kendaraan aktif berbeda di tiap pabrik.
// Catatan: tabel tidak punya kolom agen_id, jadi agenId selalu null saat dibaca.
export async function getKendaraanAktif(akunId: string, kode: string): Promise<KendaraanPilihan | null> {
  const { rows } = await getPgPool().query<{
    jenis: "armada" | "pembeli";
    kendaraan_erp_id: string | null;
    plat: string;
    agen_nama: string | null;
  }>(
    `SELECT jenis, kendaraan_erp_id, plat, agen_nama FROM produksi_kendaraan_aktif
      WHERE akun_id = $1 AND perusahaan_kode = $2`,
    [akunId, kode],
  );
  const r = rows[0];
  if (!r) return null;
  return { jenis: r.jenis, kendaraanErpId: r.kendaraan_erp_id, plat: r.plat, agenId: null, agenNama: r.agen_nama };
}

export async function setKendaraanAktif(akunId: string, kode: string, k: KendaraanPilihan): Promise<void> {
  const akun = teksWajib(akunId, "Akun");
  if (!k || (k.jenis !== "armada" && k.jenis !== "pembeli")) throw galat("VALIDASI", "Jenis kendaraan tidak sah.");
  const plat = teksWajib(k.plat, "Plat kendaraan");
  const erpId = k.jenis === "armada" ? teksOpsional(k.kendaraanErpId) : null;
  if (k.jenis === "armada" && !erpId) throw galat("VALIDASI", "Kendaraan armada belum dipilih.");
  await getPgPool().query(
    `INSERT INTO produksi_kendaraan_aktif (akun_id, perusahaan_kode, jenis, kendaraan_erp_id, plat, agen_nama, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (akun_id, perusahaan_kode) DO UPDATE
       SET jenis = EXCLUDED.jenis,
           kendaraan_erp_id = EXCLUDED.kendaraan_erp_id, plat = EXCLUDED.plat,
           agen_nama = EXCLUDED.agen_nama, updated_at = now()`,
    [akun, kode, k.jenis, erpId, plat, teksOpsional(k.agenNama)],
  );
}

// ── Baca ───────────────────────────────────────────────────────────────────

// Nama terbaru tiap akun_id menurut produksi_log (lihat catatan di kepala file).
async function namaAkun(kode: string, ids: string[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids)];
  if (unik.length === 0) return new Map();
  const { rows } = await getPgPool().query<{ akun_id: string; akun_nama: string }>(
    `SELECT DISTINCT ON (akun_id) akun_id, akun_nama FROM produksi_log
      WHERE perusahaan_kode = $1 AND akun_id = ANY($2::text[])
      ORDER BY akun_id, at DESC, id DESC`,
    [kode, unik],
  );
  return new Map(rows.map((r) => [r.akun_id, r.akun_nama]));
}

export async function getDataPabrik(kode: string): Promise<DataPabrik> {
  const pool = getPgPool();
  const [denahTersimpan, isianQ, mtQ, rusakQ, kosongQ, belumSiapQ, nowQ] = await Promise.all([
    getDenahUntukKode(kode),
    pool.query<BarisIsian & { diisi_oleh_akun_id: string }>(
      `SELECT ${KOLOM_ISIAN}, diisi_oleh_akun_id
         FROM produksi_kolom_isi
        WHERE perusahaan_kode = $1 AND selesai_at IS NULL
        ORDER BY mulai_at, id`,
      [kode],
    ),
    pool.query<{ id: string; kolom_id: string; mulai_at: Date; catatan: string | null; dibuka_oleh_akun_id: string }>(
      `SELECT id::text AS id, kolom_id, mulai_at, catatan, dibuka_oleh_akun_id FROM produksi_maintenance
        WHERE perusahaan_kode = $1 AND selesai_at IS NULL ORDER BY mulai_at`,
      [kode],
    ),
    pool.query<{ id: string; kolom_id: string; slot: number; mulai_at: Date; catatan: string | null }>(
      `SELECT id::text AS id, kolom_id, slot, mulai_at, catatan FROM produksi_slot_rusak
        WHERE perusahaan_kode = $1 AND selesai_at IS NULL ORDER BY kolom_id, slot`,
      [kode],
    ),
    // total: rek kosong total sejak isian terakhirnya selesai — atau
    // maintenance terakhirnya ditutup, bila lebih baru (supaya rek tidak
    // langsung "kosong lama" begitu maintenance panjang selesai).
    // sebagian: rek terisi sebagian sejak slot terakhir dikosongkan (panen
    // yang memuat can, buang Babonan, isian selesai, can rusak diperbaiki).
    pool.query<{ kolom_id: string; total: Date | null; sebagian: Date | null }>(
      `SELECT kolom_id, max(t) FILTER (WHERE total) AS total, max(t) FILTER (WHERE sebagian) AS sebagian FROM (
         SELECT kolom_id, selesai_at AS t, true AS total, true AS sebagian
           FROM produksi_kolom_isi WHERE perusahaan_kode = $1 AND selesai_at IS NOT NULL
         UNION ALL
         SELECT kolom_id, selesai_at, true, false
           FROM produksi_maintenance WHERE perusahaan_kode = $1 AND selesai_at IS NOT NULL
         UNION ALL
         SELECT kolom_id, panen_at, false, true
           FROM produksi_panen WHERE perusahaan_kode = $1 AND dibatalkan_at IS NULL AND dimuat > 0
         UNION ALL
         SELECT ki.kolom_id, bk.at, false, true
           FROM produksi_babonan_keluar bk JOIN produksi_kolom_isi ki ON ki.id = bk.isian_id
          WHERE ki.perusahaan_kode = $1
         UNION ALL
         SELECT kolom_id, selesai_at, false, true
           FROM produksi_slot_rusak WHERE perusahaan_kode = $1 AND selesai_at IS NOT NULL
       ) x GROUP BY kolom_id`,
      [kode],
    ),
    pool.query<{ kolom_id: string; panen_at: Date; persen_saat_panen: number }>(
      `SELECT kolom_id, panen_at, persen_saat_panen FROM produksi_panen
        WHERE perusahaan_kode = $1 AND dibatalkan_at IS NULL
          AND persen_saat_panen IS NOT NULL AND persen_saat_panen < $2
          AND panen_at > now() - make_interval(hours => $3)
        ORDER BY panen_at DESC`,
      [kode, AMBANG.panenBelumSiapPersen, AMBANG.panenBelumSiapJendelaJam],
    ),
    pool.query<{ sekarang: Date }>(`SELECT now() AS sekarang`),
  ]);

  const nama = await namaAkun(kode, [
    ...isianQ.rows.map((r) => r.diisi_oleh_akun_id),
    ...mtQ.rows.map((r) => r.dibuka_oleh_akun_id),
  ]);

  const isian: IsianAktif[] = isianQ.rows.map((r) => ({
    id: r.id,
    kolomId: r.kolom_id,
    bakId: r.bak_id,
    jenis: r.jenis,
    varian: r.varian,
    jumlahAwal: r.jumlah_awal,
    sisa: r.sisa,
    pecah: r.pecah,
    mulaiAt: r.mulai_at.toISOString(),
    durasiBekuJam: r.durasi_beku_jam === null ? null : Number(r.durasi_beku_jam),
    diisiOlehNama: nama.get(r.diisi_oleh_akun_id) ?? r.diisi_oleh_akun_id,
    slot: r.slot,
    slotPecah: r.slot_pecah,
  }));
  const maintenance: MaintenanceAktif[] = mtQ.rows.map((r) => ({
    id: r.id,
    kolomId: r.kolom_id,
    mulaiAt: r.mulai_at.toISOString(),
    catatan: r.catatan ?? "",
    dibukaOlehNama: nama.get(r.dibuka_oleh_akun_id) ?? r.dibuka_oleh_akun_id,
  }));

  const rusak: SlotRusak[] = rusakQ.rows.map((r) => ({
    id: r.id,
    kolomId: r.kolom_id,
    slot: r.slot,
    mulaiAt: r.mulai_at.toISOString(),
    catatan: r.catatan ?? "",
  }));
  const denah = denahTersimpan && !denahTersimpan.rusak ? denahTersimpan.data : null;

  // Kapasitas per kolom dari denah: rek terisi sebagian hanya mendapat
  // kosongSejak bila masih punya slot kosong yang tidak rusak.
  const kapasitas = new Map<string, number>();
  for (const e of denah?.elemen ?? []) if (e.tipe === "bak") for (const k of e.kolom) kapasitas.set(k.id, k.jumlahIceCan);
  const terisi = new Map<string, number>();
  for (const i of isian) terisi.set(i.kolomId, (terisi.get(i.kolomId) ?? 0) + i.slot.length);
  for (const r of rusak) terisi.set(r.kolomId, (terisi.get(r.kolomId) ?? 0) + 1);
  const adaIsian = new Set(isian.map((i) => i.kolomId));
  const maint = new Set(maintenance.map((m) => m.kolomId));
  const kosongSejak: Record<string, string> = {};
  for (const r of kosongQ.rows) {
    if (maint.has(r.kolom_id)) continue;
    if (!adaIsian.has(r.kolom_id)) {
      if (r.total) kosongSejak[r.kolom_id] = r.total.toISOString();
      continue;
    }
    const kap = kapasitas.get(r.kolom_id);
    if (r.sebagian && kap !== undefined && (terisi.get(r.kolom_id) ?? 0) < kap) kosongSejak[r.kolom_id] = r.sebagian.toISOString();
  }

  return {
    denah,
    isian,
    maintenance,
    rusak,
    kosongSejak,
    panenBelumSiap: belumSiapQ.rows.map((r) => ({
      kolomId: r.kolom_id,
      panenAt: r.panen_at.toISOString(),
      persen: r.persen_saat_panen,
    })),
    sekarang: nowQ.rows[0].sekarang.toISOString(),
  };
}

/** Rentang instant [awal, akhir) yang tanggalBisnisPanen-nya = tanggal (WIB, closing ROLLOVER_PANEN_JAM). */
function rentangTanggalBisnis(tanggal: string): { awal: Date; akhir: Date } {
  const tengahMalamUtc = Date.parse(`${tanggal}T00:00:00Z`);
  // D-1 pukul ROLLOVER WIB = D 00:00Z − 24 jam + (ROLLOVER − 7) jam.
  const awal = new Date(tengahMalamUtc - 24 * JAM_MS + (ROLLOVER_PANEN_JAM - 7) * JAM_MS);
  return { awal, akhir: new Date(awal.getTime() + 24 * JAM_MS) };
}

export async function getMuatanHarian(kode: string, tanggalBisnis: string): Promise<MuatanHarian> {
  if (typeof tanggalBisnis !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(tanggalBisnis) || Number.isNaN(Date.parse(tanggalBisnis))) {
    throw galat("VALIDASI", "Tanggal bisnis harus berformat YYYY-MM-DD.");
  }
  const pool = getPgPool();
  const { awal, akhir } = rentangTanggalBisnis(tanggalBisnis);
  const [muatanQ, ringkasQ, buangQ] = await Promise.all([
    pool.query<{
      jenis: "armada" | "pembeli";
      kendaraan_erp_id: string | null;
      plat: string;
      agen_id: string | null;
      agen_nama: string | null;
      jumlah: number;
      varian: Varian;
      panen_id: string;
      operator_akun_id: string;
    }>(
      `SELECT m.jenis, m.kendaraan_erp_id, m.plat, m.agen_id, m.agen_nama, m.jumlah,
              p.varian, p.id::text AS panen_id, p.operator_akun_id
         FROM produksi_muatan m
         JOIN produksi_panen p ON p.id = m.panen_id
        WHERE p.perusahaan_kode = $1 AND p.tanggal_bisnis = $2::date AND p.dibatalkan_at IS NULL
        ORDER BY p.panen_at, m.id`,
      [kode, tanggalBisnis],
    ),
    pool.query<{ dimuat: number; ke_babonan: number; pecah: number }>(
      `SELECT COALESCE(sum(dimuat), 0)::int AS dimuat, COALESCE(sum(ke_babonan), 0)::int AS ke_babonan,
              COALESCE(sum(pecah), 0)::int AS pecah
         FROM produksi_panen
        WHERE perusahaan_kode = $1 AND tanggal_bisnis = $2::date AND dibatalkan_at IS NULL`,
      [kode, tanggalBisnis],
    ),
    pool.query<{ jumlah: number }>(
      `SELECT COALESCE(sum(bk.jumlah), 0)::int AS jumlah
         FROM produksi_babonan_keluar bk
         JOIN produksi_kolom_isi ki ON ki.id = bk.isian_id
        WHERE ki.perusahaan_kode = $1 AND bk.at >= $2 AND bk.at < $3`,
      [kode, awal, akhir],
    ),
  ]);

  const nama = await namaAkun(kode, muatanQ.rows.map((r) => r.operator_akun_id));
  const armada = new Map<string, MuatanKendaraan & { panen: Set<string> }>();
  const pembeli = new Map<string, KendaraanPilihan & { kecil: number; besar: number }>();

  for (const r of muatanQ.rows) {
    if (r.jenis === "armada" && r.kendaraan_erp_id) {
      let a = armada.get(r.kendaraan_erp_id);
      if (!a) {
        a = { kendaraanErpId: r.kendaraan_erp_id, plat: r.plat, kecil: 0, besar: 0, jumlahPanen: 0, operator: [], panen: new Set() };
        armada.set(r.kendaraan_erp_id, a);
      }
      a.plat = r.plat; // plat terbaru
      a[r.varian] += r.jumlah;
      a.panen.add(r.panen_id);
      const op = nama.get(r.operator_akun_id) ?? r.operator_akun_id;
      if (!a.operator.includes(op)) a.operator.push(op);
    } else {
      const kunci = normalisasiPlat(r.plat);
      let b = pembeli.get(kunci);
      if (!b) {
        b = { jenis: "pembeli", kendaraanErpId: null, plat: r.plat, agenId: null, agenNama: null, kecil: 0, besar: 0 };
        pembeli.set(kunci, b);
      }
      b.agenId ??= r.agen_id;
      b.agenNama ??= r.agen_nama;
      b[r.varian] += r.jumlah;
    }
  }

  const ringkas = ringkasQ.rows[0];
  return {
    armada: [...armada.values()].map(({ panen: daftarPanen, ...a }) => ({ ...a, jumlahPanen: daftarPanen.size })),
    pembeli: [...pembeli.values()],
    ringkasan: {
      dimuat: ringkas.dimuat,
      keBabonan: ringkas.ke_babonan,
      pecah: ringkas.pecah,
      babonanDibuang: buangQ.rows[0].jumlah,
    },
  };
}

type BarisLogDb = {
  id: string;
  at: Date;
  akun_id: string;
  akun_nama: string;
  peran: string;
  shift: number | null;
  aksi: string;
  bak_nama: string | null;
  kolom_nomor: number | null;
  sebelum: unknown;
  sesudah: unknown;
  alasan: string | null;
};

async function bacaLog(
  kode: string,
  f: { dari: Date; sampai: Date | null; akunId?: string; bakId?: string; aksi?: string },
  batas: number,
): Promise<BarisLog[]> {
  const syarat = ["perusahaan_kode = $1", "at >= $2"];
  const nilai: unknown[] = [kode, f.dari];
  const tambah = (kolom: string, op: string, v: unknown) => {
    nilai.push(v);
    syarat.push(`${kolom} ${op} $${nilai.length}`);
  };
  if (f.sampai) tambah("at", "<", f.sampai);
  if (f.akunId) tambah("akun_id", "=", f.akunId);
  if (f.bakId) tambah("bak_id", "=", f.bakId);
  if (f.aksi) tambah("aksi", "=", f.aksi);
  nilai.push(Math.min(BATAS_LOG_MAKS, Math.max(1, Math.floor(Number(batas) || 1))));
  const { rows } = await getPgPool().query<BarisLogDb>(
    `SELECT id::text AS id, at, akun_id, akun_nama, peran, shift, aksi, bak_nama, kolom_nomor, sebelum, sesudah, alasan
       FROM produksi_log
      WHERE ${syarat.join(" AND ")}
      ORDER BY at DESC, id DESC
      LIMIT $${nilai.length}`,
    nilai,
  );
  return rows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    akunId: r.akun_id,
    akunNama: r.akun_nama,
    peran: r.peran,
    shift: r.shift ?? 0,
    aksi: r.aksi,
    bakNama: r.bak_nama,
    kolomNomor: r.kolom_nomor,
    sebelum: r.sebelum,
    sesudah: r.sesudah,
    alasan: r.alasan,
  }));
}

/** Log urut terbaru dulu; rentang [dari, sampai) berupa instant ISO. */
export async function getLog(
  kode: string,
  f: { dari: string; sampai: string; akunId?: string; bakId?: string; aksi?: string },
  batas: number,
): Promise<BarisLog[]> {
  return bacaLog(
    kode,
    {
      dari: cekTanggalIso(f?.dari, "Tanggal awal"),
      sampai: cekTanggalIso(f?.sampai, "Tanggal akhir"),
      akunId: teksOpsional(f.akunId) ?? undefined,
      bakId: teksOpsional(f.bakId) ?? undefined,
      aksi: teksOpsional(f.aksi) ?? undefined,
    },
    batas,
  );
}

export async function getRiwayatOperator(kode: string, akunId: string, sejak: string): Promise<BarisLog[]> {
  return bacaLog(kode, { dari: cekTanggalIso(sejak, "Sejak"), sampai: null, akunId: teksWajib(akunId, "Akun") }, BATAS_RIWAYAT);
}

/**
 * Panen (dan Tandai Babonan) yang belum dibatalkan di satu rek, ≤ BATAS_HARI_BATAL
 * hari terakhir, terbaru dulu — untuk tombol "Batalkan panen" admin.
 */
export async function getPanenTerakhir(kode: string, kolomId: string): Promise<PanenTerakhir[]> {
  const kolom = teksWajib(kolomId, "Rek");
  const { rows } = await getPgPool().query<{
    id: string;
    panen_at: Date;
    varian: Varian;
    dimuat: number;
    ke_babonan: number;
    pecah: number;
    tandai: boolean;
    isian_aktif: boolean;
    operator_akun_id: string;
    kendaraan: MuatanInput[] | null;
  }>(
    `SELECT p.id::text AS id, p.panen_at, p.varian, p.dimuat, p.ke_babonan, p.pecah,
            (p.dimuat = 0 AND p.persen_saat_panen IS NULL AND ki.jenis = 'produksi') AS tandai,
            (ki.selesai_at IS NULL) AS isian_aktif,
            p.operator_akun_id,
            (SELECT json_agg(json_build_object('jenis', m.jenis, 'kendaraanErpId', m.kendaraan_erp_id, 'plat', m.plat,
                                               'agenId', m.agen_id, 'agenNama', m.agen_nama, 'jumlah', m.jumlah) ORDER BY m.id)
               FROM produksi_muatan m WHERE m.panen_id = p.id) AS kendaraan
       FROM produksi_panen p
       JOIN produksi_kolom_isi ki ON ki.id = p.isian_id
      WHERE p.perusahaan_kode = $1 AND p.kolom_id = $2 AND p.dibatalkan_at IS NULL
        AND p.panen_at >= now() - make_interval(days => $3)
      ORDER BY p.panen_at DESC, p.id DESC
      LIMIT 50`,
    [kode, kolom, BATAS_HARI_BATAL],
  );
  const nama = await namaAkun(kode, rows.map((r) => r.operator_akun_id));
  return rows.map((r) => ({
    id: r.id,
    panenAt: r.panen_at.toISOString(),
    varian: r.varian,
    dimuat: r.dimuat,
    keBabonan: r.ke_babonan,
    pecah: r.pecah,
    tandaiBabonan: r.tandai,
    isianAktif: r.isian_aktif,
    operatorNama: nama.get(r.operator_akun_id) ?? r.operator_akun_id,
    kendaraan: r.kendaraan ?? [],
  }));
}
