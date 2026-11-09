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
//   hitung ulang di server → tulis → INSERT produksi_log → COMMIT.
//   Error apa pun → ROLLBACK. Tidak ada DELETE di modul ini.
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
import { getPgPool } from "@/lib/pg";
import { AppError } from "@/lib/action-result";
import { getWibTimeHHmm } from "@/lib/business-date";
import type { BakElemen, DenahDokumen, DenahKolom, Varian } from "@/lib/produksi-denah";
import { migrasiDenah } from "@/lib/produksi-denah";
import {
  AMBANG,
  hitungKematangan,
  ROLLOVER_PANEN_JAM,
  shiftDari,
  tanggalBisnisPanen,
  validasiPanen,
  type IsianAktif,
  type JenisIsian,
  type KendaraanPilihan,
  type MaintenanceAktif,
  type MuatanInput,
  type MuatanKendaraan,
  type PanenInput,
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
  kosongSejak: Record<string, string>;
  panenBelumSiap: { kolomId: string; panenAt: string; persen: number }[];
  sekarang: string;
}

export interface MuatanHarian {
  armada: MuatanKendaraan[];
  pembeli: (KendaraanPilihan & { kecil: number; besar: number })[];
  ringkasan: { dimuat: number; keBabonan: number; pecah: number; babonanDibuang: number };
}

export interface BarisLog {
  id: string;
  at: string;
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
  batal_panen: "batal panen",
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
  try {
    await client.query("BEGIN");
    // now() Postgres = awal transaksi; dipakai untuk semua cap waktu aksi ini.
    const { rows } = await client.query<{ sekarang: Date }>(`SELECT now() AS sekarang`);
    const hasil = await fn(client, rows[0].sekarang);
    await client.query("COMMIT");
    return hasil;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw terjemahkanGalatPg(err);
  } finally {
    client.release();
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
  await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`produksi-operasional:${kode}:${kolomId}`]);
  return ketemu;
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
};

async function kunciIsian(c: PoolClient, kode: string, kolomId: string): Promise<BarisIsian[]> {
  const { rows } = await c.query<BarisIsian>(
    `SELECT id::text AS id, kolom_id, bak_id, jenis, varian, jumlah_awal, sisa, pecah, mulai_at, durasi_beku_jam
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

function totalSisa(aktif: BarisIsian[]): number {
  return aktif.reduce((s, i) => s + i.sisa, 0);
}

function snapshotIsian(i: BarisIsian) {
  return {
    id: i.id,
    jenis: i.jenis,
    varian: i.varian,
    jumlahAwal: i.jumlah_awal,
    sisa: i.sisa,
    pecah: i.pecah,
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

// Ubah sisa; selesai_at diisi begitu sisa 0. pecah (babonan) tidak boleh
// melebihi sisa.
async function setSisa(c: PoolClient, isianId: string, sisaBaru: number, akunId: string): Promise<void> {
  await c.query(
    `UPDATE produksi_kolom_isi
        SET sisa = $2,
            pecah = LEAST(pecah, $2),
            selesai_at = CASE WHEN $2 = 0 THEN now() ELSE NULL END,
            ditutup_oleh_akun_id = CASE WHEN $2 = 0 THEN $3 ELSE ditutup_oleh_akun_id END
      WHERE id = $1`,
    [isianId, sisaBaru, akunId],
  );
}

async function buatIsianProduksi(c: PoolClient, kode: string, ctx: KonteksKolom, jumlah: number, p: Pelaku): Promise<string> {
  const varian = ctx.kolom.varian;
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO produksi_kolom_isi
       (perusahaan_kode, kolom_id, mulai_at, jenis, bak_id, varian, jumlah_awal, sisa, pecah, durasi_beku_jam, diisi_oleh_akun_id)
     VALUES ($1, $2, now(), 'produksi', $3, $4, $5, $5, 0, $6, $7)
     RETURNING id::text AS id`,
    [kode, ctx.kolom.id, ctx.bak.id, varian, jumlah, ctx.bak.durasiBekuJam[varian], p.akunId],
  );
  return rows[0].id;
}

// Pindahkan n can (pecah di antaranya) ke isian Babonan aktif rek; buat baru
// bila belum ada (mulai_at = sekarang = babonan_sejak).
async function tambahKeBabonan(
  c: PoolClient,
  kode: string,
  asal: BarisIsian,
  aktif: BarisIsian[],
  n: number,
  pecah: number,
  p: Pelaku,
): Promise<string> {
  const ada = aktif.find((i) => i.jenis === "babonan");
  if (ada) {
    await c.query(
      `UPDATE produksi_kolom_isi SET sisa = sisa + $2, jumlah_awal = jumlah_awal + $2, pecah = pecah + $3 WHERE id = $1`,
      [ada.id, n, pecah],
    );
    return ada.id;
  }
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO produksi_kolom_isi
       (perusahaan_kode, kolom_id, mulai_at, jenis, bak_id, varian, jumlah_awal, sisa, pecah, durasi_beku_jam, diisi_oleh_akun_id)
     VALUES ($1, $2, now(), 'babonan', $3, $4, $5, $5, $6, NULL, $7)
     RETURNING id::text AS id`,
    [kode, asal.kolom_id, asal.bak_id, asal.varian, n, pecah, p.akunId],
  );
  return rows[0].id;
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
  v: { dimuat: number; keBabonan: number; pecah: number; persen: number | null },
  p: Pelaku,
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO produksi_panen
       (perusahaan_kode, isian_id, kolom_id, bak_id, varian, panen_at, tanggal_bisnis, dimuat, ke_babonan, pecah,
        persen_saat_panen, operator_akun_id, shift)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, $12, $13)
     RETURNING id::text AS id`,
    [
      kode,
      asal.id,
      asal.kolom_id,
      asal.bak_id,
      asal.varian,
      sekarang,
      tanggalBisnisPanen(sekarang),
      v.dimuat,
      v.keBabonan,
      v.pecah,
      v.persen,
      p.akunId,
      shiftDari(sekarang),
    ],
  );
  return rows[0].id;
}

// ── Aksi operator ──────────────────────────────────────────────────────────

export async function isiAir(kode: string, kolomId: string, jumlah: number | null, p: Pelaku): Promise<{ isianId: string }> {
  cekPelaku(p);
  teksWajib(kolomId, "Rek");
  if (jumlah !== null && (!Number.isInteger(jumlah) || jumlah < 1)) {
    throw galat("VALIDASI", "Jumlah can harus bilangan bulat minimal 1.");
  }
  return transaksi(async (c, sekarang) => {
    const ctx = await kunciKolom(c, kode, kolomId);
    const aktif = await kunciIsian(c, kode, kolomId);
    if (await maintenanceTerbuka(c, kode, kolomId)) {
      throw galat("VALIDASI", "Rek sedang maintenance. Selesaikan maintenance dulu sebelum isi air.");
    }
    const terisi = totalSisa(aktif);
    const kosong = ctx.kolom.jumlahIceCan - terisi;
    if (kosong <= 0) throw galat("KAPASITAS", `Rek sudah penuh (${terisi}/${ctx.kolom.jumlahIceCan} can).`);
    const n = jumlah ?? kosong;
    if (n > kosong) throw galat("KAPASITAS", `Can kosong di rek ini tinggal ${kosong} (diminta ${n}).`);

    const isianId = await buatIsianProduksi(c, kode, ctx, n, p);
    await tulisLog(c, kode, p, sekarang, {
      aksi: "isi_air",
      kolomId,
      ctx,
      rujukanId: isianId,
      sesudah: { isianId, jumlah: n, varian: ctx.kolom.varian, durasiBekuJam: ctx.bak.durasiBekuJam[ctx.kolom.varian] },
    });
    return { isianId };
  });
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

export async function panen(kode: string, input: PanenInput, p: Pelaku): Promise<{ panenId: string; isianBaruId: string | null }> {
  cekPelaku(p);
  const isianId = cekId(input?.isianId, "Isian");
  const muatan = normalisasiMuatan(input.muatan);
  const babonan = typeof input.babonan === "number" ? input.babonan : Number.NaN;
  const pecah = typeof input.pecah === "number" ? input.pecah : Number.NaN;
  const isiUlang = input.isiUlang === true;
  const konfirmasi = input.konfirmasiBelumSiap === true;
  const bersih = { muatan, babonan, pecah };

  return transaksi(async (c, sekarang) => {
    const kolomId = await kolomDariIsian(c, kode, isianId);
    const ctx = await kunciKolom(c, kode, kolomId);
    const aktif = await kunciIsian(c, kode, kolomId);
    const asal = aktif.find((i) => i.id === isianId);
    if (!asal) throw await galatBerubah(c, kode, kolomId, "Isian ini sudah tidak aktif (sudah dipanen atau dikoreksi).");

    const jenis = asal.jenis;
    const dimuat = muatan.reduce((s, m) => s + m.jumlah, 0);
    const keluar = jenis === "produksi" ? dimuat + babonan + pecah : dimuat;
    // Cek bentuk input dulu (VALIDASI), terlepas dari sisa terkini.
    const galatBentuk = validasiPanen(jenis, jenis === "produksi" ? keluar : Number.MAX_SAFE_INTEGER, bersih);
    if (galatBentuk) throw galat("VALIDASI", galatBentuk);
    if (keluar > asal.sisa) {
      throw await galatBerubah(c, kode, kolomId, `Rek ini tinggal ${asal.sisa} can (diminta ${keluar}).`);
    }
    const galatJumlah = validasiPanen(jenis, asal.sisa, bersih);
    if (galatJumlah) throw galat("VALIDASI", galatJumlah);

    let persen: number | null = null;
    if (jenis === "produksi") {
      const durasi = asal.durasi_beku_jam === null ? ctx.bak.durasiBekuJam[asal.varian] : Number(asal.durasi_beku_jam);
      persen = hitungKematangan(asal.mulai_at, durasi, sekarang);
      if (persen < AMBANG.panenBelumSiapPersen && !konfirmasi) {
        throw galat("BELUM_SIAP", `Es belum siap (kematangan ${persen}%). Tetap panen?`);
      }
    }

    const keBabonan = jenis === "produksi" ? babonan + pecah : 0;
    const isiUlangJumlah = isiUlang ? dimuat : 0;
    if (isiUlangJumlah > 0) {
      if (await maintenanceTerbuka(c, kode, kolomId)) {
        throw galat("VALIDASI", "Rek sedang maintenance; panen tanpa isi ulang.");
      }
      const terisiSesudah = totalSisa(aktif) - keluar + keBabonan + isiUlangJumlah;
      if (terisiSesudah > ctx.kolom.jumlahIceCan) {
        throw galat("KAPASITAS", `Isi ulang ${isiUlangJumlah} can melebihi kapasitas rek (${terisiSesudah}/${ctx.kolom.jumlahIceCan}).`);
      }
    }

    await setSisa(c, asal.id, asal.sisa - keluar, p.akunId);
    const panenId = await insertPanen(
      c,
      kode,
      asal,
      sekarang,
      { dimuat, keBabonan: jenis === "produksi" ? babonan : 0, pecah: jenis === "produksi" ? pecah : 0, persen },
      p,
    );
    for (const m of muatan) {
      await c.query(
        `INSERT INTO produksi_muatan (panen_id, jenis, kendaraan_erp_id, plat, agen_id, agen_nama, jumlah)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [panenId, m.jenis, m.kendaraanErpId, m.plat, m.agenId, m.agenNama, m.jumlah],
      );
    }
    const babonanIsianId = keBabonan > 0 ? await tambahKeBabonan(c, kode, asal, aktif, keBabonan, pecah, p) : null;
    const isianBaruId = isiUlangJumlah > 0 ? await buatIsianProduksi(c, kode, ctx, isiUlangJumlah, p) : null;

    await tulisLog(c, kode, p, sekarang, {
      aksi: "panen",
      kolomId,
      ctx,
      rujukanId: panenId,
      sebelum: snapshotIsian(asal),
      sesudah: {
        panenId,
        muatan,
        dimuat,
        babonan: jenis === "produksi" ? babonan : 0,
        pecah: jenis === "produksi" ? pecah : 0,
        sisa: asal.sisa - keluar,
        persen,
        belumSiap: persen !== null && persen < AMBANG.panenBelumSiapPersen,
        babonanIsianId,
        isiUlang,
        isianBaruId,
        tanggalBisnis: tanggalBisnisPanen(sekarang),
      },
    });
    return { panenId, isianBaruId };
  });
}

// Pindah n can isian produksi ke Babonan tanpa panen. Dicatat juga sebagai
// baris produksi_panen (dimuat 0, ke_babonan n, persen NULL) supaya invarian
// jumlah_awal = sisa + Σ dimuat + Σ ke_babonan + Σ pecah tetap berlaku.
export async function tandaiBabonan(kode: string, isianId: string, jumlah: number, p: Pelaku): Promise<void> {
  cekPelaku(p);
  const id = cekId(isianId, "Isian");
  if (!Number.isInteger(jumlah) || jumlah < 1) throw galat("VALIDASI", "Jumlah can Babonan harus bilangan bulat minimal 1.");
  await transaksi(async (c, sekarang) => {
    const kolomId = await kolomDariIsian(c, kode, id);
    const ctx = await kunciKolom(c, kode, kolomId);
    const aktif = await kunciIsian(c, kode, kolomId);
    const asal = aktif.find((i) => i.id === id);
    if (!asal) throw await galatBerubah(c, kode, kolomId, "Isian ini sudah tidak aktif.");
    if (asal.jenis !== "produksi") throw galat("VALIDASI", "Isian ini sudah Babonan.");
    if (jumlah > asal.sisa) throw await galatBerubah(c, kode, kolomId, `Rek ini tinggal ${asal.sisa} can (diminta ${jumlah}).`);

    await setSisa(c, asal.id, asal.sisa - jumlah, p.akunId);
    const panenId = await insertPanen(c, kode, asal, sekarang, { dimuat: 0, keBabonan: jumlah, pecah: 0, persen: null }, p);
    const babonanIsianId = await tambahKeBabonan(c, kode, asal, aktif, jumlah, 0, p);
    await tulisLog(c, kode, p, sekarang, {
      aksi: "tandai_babonan",
      kolomId,
      ctx,
      rujukanId: panenId,
      sebelum: snapshotIsian(asal),
      sesudah: { panenId, jumlah, sisa: asal.sisa - jumlah, babonanIsianId },
    });
  });
}

// Babonan dibuang/dilebur (tidak dimuat; tidak ikut pencocokan DO).
export async function buangBabonan(kode: string, kolomId: string, jumlah: number, alasan: string, p: Pelaku): Promise<void> {
  cekPelaku(p);
  teksWajib(kolomId, "Rek");
  if (!Number.isInteger(jumlah) || jumlah < 1) throw galat("VALIDASI", "Jumlah can dibuang harus bilangan bulat minimal 1.");
  const alasanBersih = teksOpsional(alasan);
  await transaksi(async (c, sekarang) => {
    const ctx = await kunciKolom(c, kode, kolomId);
    const aktif = await kunciIsian(c, kode, kolomId);
    const bab = aktif.find((i) => i.jenis === "babonan");
    if (!bab) throw await galatBerubah(c, kode, kolomId, "Rek ini tidak punya Babonan.");
    if (jumlah > bab.sisa) throw await galatBerubah(c, kode, kolomId, `Babonan di rek ini tinggal ${bab.sisa} can (diminta ${jumlah}).`);

    await setSisa(c, bab.id, bab.sisa - jumlah, p.akunId);
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO produksi_babonan_keluar (isian_id, at, jumlah, alasan, akun_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id`,
      [bab.id, sekarang, jumlah, alasanBersih, p.akunId],
    );
    await tulisLog(c, kode, p, sekarang, {
      aksi: "buang_babonan",
      kolomId,
      ctx,
      rujukanId: rows[0].id,
      sebelum: snapshotIsian(bab),
      sesudah: { jumlah, sisa: bab.sisa - jumlah },
      alasan: alasanBersih,
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
    await kunciIsian(c, kode, kolomId);
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

// Mengubah sisa menggeser jumlah_awal dengan selisih yang sama, supaya
// invarian jumlah_awal = sisa + Σ keluar tetap berlaku (salah hitung can).
export async function koreksiIsian(
  kode: string,
  isianId: string,
  ubah: { mulaiAt?: string; varian?: Varian; sisa?: number },
  alasan: string,
  p: Pelaku,
): Promise<void> {
  const alasanBersih = cekAdmin(p, alasan);
  const id = cekId(isianId, "Isian");
  const u = ubah ?? {};
  if (u.mulaiAt === undefined && u.varian === undefined && u.sisa === undefined) throw galat("VALIDASI", "Tidak ada yang dikoreksi.");
  const mulaiBaru = u.mulaiAt === undefined ? null : cekTanggalIso(u.mulaiAt, "Waktu isi air");
  if (u.varian !== undefined && u.varian !== "kecil" && u.varian !== "besar") throw galat("VALIDASI", "Varian tidak sah.");
  if (u.sisa !== undefined && (!Number.isInteger(u.sisa) || u.sisa < 0)) throw galat("VALIDASI", "Sisa can harus bilangan bulat ≥ 0.");

  await transaksi(async (c, sekarang) => {
    const kolomId = await kolomDariIsian(c, kode, id);
    const ctx = await kunciKolom(c, kode, kolomId);
    const aktif = await kunciIsian(c, kode, kolomId);
    const lama = aktif.find((i) => i.id === id);
    if (!lama) throw await galatBerubah(c, kode, kolomId, "Isian ini sudah tidak aktif.");
    if (mulaiBaru && mulaiBaru.getTime() > sekarang.getTime()) throw galat("VALIDASI", "Waktu isi air tidak boleh di masa depan.");

    const sisaBaru = u.sisa ?? lama.sisa;
    const terisi = totalSisa(aktif) - lama.sisa + sisaBaru;
    if (terisi > ctx.kolom.jumlahIceCan) {
      throw galat("KAPASITAS", `Total can di rek menjadi ${terisi}, melebihi kapasitas ${ctx.kolom.jumlahIceCan}.`);
    }
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
    const jumlahAwalBaru = lama.jumlah_awal + (sisaBaru - lama.sisa);

    await c.query(
      `UPDATE produksi_kolom_isi
          SET mulai_at = $2, varian = $3, durasi_beku_jam = $4, jumlah_awal = $5
        WHERE id = $1`,
      [id, mulaiAt, varianBaru, durasiBaru, jumlahAwalBaru],
    );
    if (sisaBaru !== lama.sisa) await setSisa(c, id, sisaBaru, p.akunId);

    const baru: BarisIsian = {
      ...lama,
      mulai_at: mulaiAt,
      varian: varianBaru,
      durasi_beku_jam: durasiBaru === null ? null : String(durasiBaru),
      jumlah_awal: jumlahAwalBaru,
      sisa: sisaBaru,
      pecah: Math.min(lama.pecah, sisaBaru),
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

// Batal panen ≤ 7 hari. Bila isian asal masih aktif, can dikembalikan ke
// sisa (can yang tadinya dipindah ke Babonan ditarik lagi dari isian Babonan
// aktif). Bila tidak bisa dikembalikan (isian sudah selesai, Babonan sudah
// berkurang, kapasitas penuh, rek tidak lagi aktif) panen hanya ditandai.
// Isian baru hasil isiUlang TIDAK diubah; admin mengoreksinya terpisah.
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
    const { rows } = await c.query<{
      isian_id: string;
      dimuat: number;
      ke_babonan: number;
      pecah: number;
      panen_at: Date;
      dibatalkan_at: Date | null;
    }>(
      `SELECT isian_id::text AS isian_id, dimuat, ke_babonan, pecah, panen_at, dibatalkan_at
         FROM produksi_panen WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const pn = rows[0];
    if (pn.dibatalkan_at) throw await galatBerubah(c, kode, kolomId, "Panen ini sudah dibatalkan.");
    if (sekarang.getTime() - pn.panen_at.getTime() > BATAS_HARI_BATAL * 24 * JAM_MS) {
      throw galat("VALIDASI", `Panen lebih dari ${BATAS_HARI_BATAL} hari tidak bisa dibatalkan.`);
    }

    const asal = aktif.find((i) => i.id === pn.isian_id) ?? null;
    const tarikBabonan = pn.ke_babonan + pn.pecah;
    const bab = aktif.find((i) => i.jenis === "babonan" && i.id !== asal?.id) ?? null;
    const babonanCukup = tarikBabonan === 0 || (bab !== null && bab.sisa >= tarikBabonan);
    const muat = ctx !== null && !ctx.kolom.nonaktif && totalSisa(aktif) + pn.dimuat <= ctx.kolom.jumlahIceCan;
    const dikembalikan = asal !== null && babonanCukup && muat;

    if (dikembalikan) {
      await setSisa(c, asal.id, asal.sisa + pn.dimuat + tarikBabonan, p.akunId);
      if (tarikBabonan > 0 && bab) {
        await c.query(
          `UPDATE produksi_kolom_isi SET jumlah_awal = jumlah_awal - $2, pecah = GREATEST(0, pecah - $3) WHERE id = $1`,
          [bab.id, tarikBabonan, pn.pecah],
        );
        await setSisa(c, bab.id, bab.sisa - tarikBabonan, p.akunId);
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
        panenAt: pn.panen_at.toISOString(),
        isian: asal ? snapshotIsian(asal) : null,
      },
      sesudah: {
        dibatalkan: true,
        dikembalikan,
        sisaIsian: asal ? (dikembalikan ? asal.sisa + pn.dimuat + tarikBabonan : asal.sisa) : null,
      },
      alasan: alasanBersih,
    });
  });
}

// ── Kendaraan aktif operator ───────────────────────────────────────────────

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
     ON CONFLICT (akun_id) DO UPDATE
       SET perusahaan_kode = EXCLUDED.perusahaan_kode, jenis = EXCLUDED.jenis,
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
  const [denahTersimpan, isianQ, mtQ, kosongQ, belumSiapQ, nowQ] = await Promise.all([
    getDenahUntukKode(kode),
    pool.query<BarisIsian & { diisi_oleh_akun_id: string }>(
      `SELECT id::text AS id, kolom_id, bak_id, jenis, varian, jumlah_awal, sisa, pecah, mulai_at, durasi_beku_jam,
              diisi_oleh_akun_id
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
    // Rek kosong sejak isian terakhirnya selesai — atau maintenance terakhirnya
    // ditutup, bila lebih baru (supaya rek tidak langsung "kosong lama" begitu
    // maintenance panjang selesai).
    pool.query<{ kolom_id: string; sejak: Date }>(
      `SELECT kolom_id, max(t) AS sejak FROM (
         SELECT kolom_id, selesai_at AS t FROM produksi_kolom_isi WHERE perusahaan_kode = $1 AND selesai_at IS NOT NULL
         UNION ALL
         SELECT kolom_id, selesai_at AS t FROM produksi_maintenance WHERE perusahaan_kode = $1 AND selesai_at IS NOT NULL
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
  }));
  const maintenance: MaintenanceAktif[] = mtQ.rows.map((r) => ({
    id: r.id,
    kolomId: r.kolom_id,
    mulaiAt: r.mulai_at.toISOString(),
    catatan: r.catatan ?? "",
    dibukaOlehNama: nama.get(r.dibuka_oleh_akun_id) ?? r.dibuka_oleh_akun_id,
  }));

  const sibuk = new Set([...isian.map((i) => i.kolomId), ...maintenance.map((m) => m.kolomId)]);
  const kosongSejak: Record<string, string> = {};
  for (const r of kosongQ.rows) if (!sibuk.has(r.kolom_id)) kosongSejak[r.kolom_id] = r.sejak.toISOString();

  return {
    denah: denahTersimpan && !denahTersimpan.rusak ? denahTersimpan.data : null,
    isian,
    maintenance,
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
    `SELECT id::text AS id, at, akun_nama, peran, shift, aksi, bak_nama, kolom_nomor, sebelum, sesudah, alasan
       FROM produksi_log
      WHERE ${syarat.join(" AND ")}
      ORDER BY at DESC, id DESC
      LIMIT $${nilai.length}`,
    nilai,
  );
  return rows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
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
