// src/lib/queries/mitra-es-balok.ts
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import { AppError } from "@/lib/action-result";
import type { AlamatFields, PinFields } from "@/lib/mitra-lokasi";

export type SumberAgen = "utama" | "logistik";

// Maps a LOGICAL (kode, sumber) pair to the PHYSICAL database connection.
// Not 1:1 with kode: pmpersada's and pmpakis's "logistik" both resolve to
// the SAME physical database (FINAC_PMP_LOGISTIC) -- confirmed live: that
// database's PMP_Agen has no BranchID column at all, and 56/159 active
// AgenID rows transact under BOTH BranchID='011' (pmpakis) and '012'
// (pmpersada) in PMP_Pemesanan, so no clean per-Agen split is possible.
// User decision: show it as-is, badged "Logistik (Bersama)" in the UI, with
// pmpersada and pmpakis BOTH reading/writing this one shared connection.
// pmputra's "logistik" is its own separate, non-shared database
// (FINAC_LOGISTIC_PO) -- only the pmpersada/pmpakis pair is special-cased.
export function resolveAgenKoneksi(kode: string, sumber: SumberAgen): { kode: string; label: CompanyKoneksiLabel } {
  if (sumber === "logistik" && (kode === "pmpersada" || kode === "pmpakis")) {
    return { kode: "pmpersada", label: "logistik" };
  }
  return { kode, label: sumber === "logistik" ? "logistik" : "utama" };
}

// pmputra merges utama+logistik into one MitraCard per AgenID (verified
// live: AgenID matches exactly between pmputra's two databases). pmpersada
// and pmpakis do NOT merge -- AgenID does not match between pmpersada's own
// utama and its (shared-with-pmpakis) logistik, confirmed live via a 10/10
// mismatch sample -- so each (sumber, AgenID) pair is its own card.
function sourcesForKode(kode: string): SumberAgen[] {
  if (kode === "pmputra") return ["utama"]; // "logistik" folded into the utama card by getMitraList below
  return ["utama", "logistik"];
}

// Es Balok's own customer-classification scheme -- confirmed NOT present
// anywhere in the ERP schema (live-checked: no column/table anywhere holds
// this), unlike Es Kristal's PartnerType (which repurposes a real ERP
// column). Purely dashboard-owned, stored in DashboardAgenProfil.
// Type/options live in "@/lib/segmentasi-mitra" (client-safe, no `sql`
// import) -- Client Components must import SEGMENTASI_OPTIONS from there
// directly, never from this module, or mssql/tedious ends up in their bundle.
import type { Segmentasi } from "@/lib/segmentasi-mitra";
export type { Segmentasi } from "@/lib/segmentasi-mitra";

// Baris lokasi pengiriman tambahan Es Balok (DashboardAgenLokasiPengiriman).
// `wilayah` berisi WilayahID (bukan nama) — slot Wilayah Es Balok = RegionID.
export interface LokasiAgenRow extends AlamatFields, PinFields {
  LokasiPengirimanID: number;
  Urutan: number;
  Label: string | null;
  // PMP_Wilayah.Nama untuk `wilayah` (WilayahID) — hanya untuk tampilan.
  wilayahNama: string | null;
}

// Alamat mitra Es Balok (DashboardAgenAlamat); `wilayah` = WilayahID.
export type AlamatMitraAgen = AlamatFields & { wilayahNama: string | null };

export interface MitraCard {
  agenId: string;
  // Satu kartu = satu pasangan (AgenID, AgenDetailID). Agen dengan >1 baris
  // PMP_AgenDetail aktif tampil sebagai beberapa kartu (keputusan pengguna
  // 2026-10-23: semua dipertahankan, masing-masing dengan alamatnya sendiri),
  // jadi setiap penulisan lokasi utama (Address1/RegionID) wajib menyasar
  // AgenDetailID kartu ini. null = Agen belum punya baris detail.
  agenDetailId: string | null;
  sumber: SumberAgen;
  nama: string;
  telepon: string | null;
  isActive: boolean;
  wilayah: string | null;
  wilayahId: string | null;
  alamat: string | null;
  // Kecamatan lokasi utama (DashboardAgenProfil.Kecamatan, opsional).
  kecamatan: string | null;
  hargaBalokKecil: number;
  hargaBalokBesar: number;
  maksimumHutang: number;
  kapasitasBalokKecil: number | null;
  kapasitasBalokBesar: number | null;
  segmentasi: Segmentasi | null;
  latitude: number | null;
  longitude: number | null;
  // DashboardAgenLocation.Alamat (hasil reverse-geocode pin utama).
  geoAlamat: string | null;
  // Kotak "Lokasi Pengiriman Berbeda dengan Mitra" = ada baris DashboardAgenAlamat.
  // Alamat mitra, lokasi tambahan, pin, dan profil dikunci per AgenID — kartu
  // ganda dari Agen yang sama berbagi nilai-nilai ini.
  lokasiBerbeda: boolean;
  alamatMitra: AlamatMitraAgen | null;
  lokasiTambahan: LokasiAgenRow[];
}

interface AgenRow {
  AgenID: string;
  AgenDetailID: string | null;
  Nama: string;
  Telepon: string | null;
  IsActive: boolean;
  BalokKecil: number;
  BalokBesar: number;
  MaksimumHutang: number;
  Wilayah: string | null;
  WilayahId: string | null;
  Alamat: string | null;
  Kecamatan: string | null;
  KapasitasBalokKecil: number | null;
  KapasitasBalokBesar: number | null;
  Segmentasi: Segmentasi | null;
  Latitude: number | null;
  Longitude: number | null;
  GeoAlamat: string | null;
}

export type ExecAgen = sql.ConnectionPool | sql.Transaction;

// Shared SELECT shape for one (kode,sumber) database -- LEFT JOINs
// PMP_AgenDetail (an Agen may have zero detail rows) -> PMP_Wilayah,
// DashboardAgenLocation (an Agen may have zero saved pins), and
// DashboardAgenProfil (an Agen may have zero saved Kapasitas/Segmentasi --
// dashboard-owned, no ERP equivalent exists). IsDeleted=0 only -- deleted
// Agen never appear in the list, matching Es Kristal's getMitraList
// (deleteMitra there is also a soft IsDeleted=1).
// `agenId` (opsional) membatasi ke satu Agen — dipakai memuat ulang satu kartu.
async function getAgenRows(pool: sql.ConnectionPool, agenId?: string): Promise<AgenRow[]> {
  const req = pool.request();
  let where = "";
  if (agenId !== undefined) {
    req.input("agenId", sql.VarChar(16), agenId);
    where = "AND a.AgenID = @agenId";
  }
  const result = await req.query(`
    SELECT a.AgenID, ad.AgenDetailID, a.Nama, a.Telepon, a.IsActive, a.BalokKecil, a.BalokBesar, a.MaksimumHutang,
           w.Nama AS Wilayah, ad.RegionID AS WilayahId, ad.Address1 AS Alamat,
           prof.Kecamatan, prof.KapasitasBalokKecil, prof.KapasitasBalokBesar, prof.Segmentasi,
           loc.Latitude, loc.Longitude, loc.Alamat AS GeoAlamat
    FROM PMP_Agen a
    LEFT JOIN PMP_AgenDetail ad ON ad.AgenID = a.AgenID AND ISNULL(ad.IsDeleted,0) = 0
    LEFT JOIN PMP_Wilayah w ON w.WilayahID = ad.RegionID
    LEFT JOIN DashboardAgenProfil prof ON prof.AgenID = a.AgenID
    LEFT JOIN DashboardAgenLocation loc ON loc.AgenID = a.AgenID
    WHERE ISNULL(a.IsDeleted,0) = 0 ${where}
    ORDER BY a.Nama, a.AgenID, ad.AgenDetailID
  `);
  return result.recordset as AgenRow[];
}

const angkaAtauNull = (v: unknown): number | null => (v == null ? null : Number(v));

/**
 * Muat alamat mitra (DashboardAgenAlamat) + lokasi tambahan AKTIF
 * (DashboardAgenLokasiPengiriman) satu DB fisik dalam satu batch, lalu
 * dikelompokkan per AgenID di JS (tanpa N+1).
 */
export async function muatAlamatDanLokasiAgen(
  exec: ExecAgen,
  agenId?: string
): Promise<{ alamat: Map<string, AlamatMitraAgen>; lokasi: Map<string, LokasiAgenRow[]> }> {
  const req = exec.request();
  let filterAlamat = "";
  let filterLokasi = "";
  if (agenId !== undefined) {
    req.input("agenId", sql.VarChar(16), agenId);
    filterAlamat = "WHERE AgenID = @agenId";
    filterLokasi = "AND AgenID = @agenId";
  }
  const res = await req.query(`
    SELECT aa.AgenID, aa.WilayahID AS wilayah, w.Nama AS wilayahNama, aa.Kecamatan AS kecamatan, aa.Alamat AS alamat, aa.Kontak AS kontak
    FROM DashboardAgenAlamat aa
    LEFT JOIN PMP_Wilayah w ON w.WilayahID = aa.WilayahID
    ${filterAlamat.replace("AgenID", "aa.AgenID")};
    SELECT lp.AgenID, lp.LokasiPengirimanID, lp.Urutan, lp.Label,
           lp.WilayahID AS wilayah, w.Nama AS wilayahNama, lp.Kecamatan AS kecamatan, lp.Alamat AS alamat, lp.Kontak AS kontak,
           lp.Latitude AS latitude, lp.Longitude AS longitude, lp.GeoAlamat AS geoAlamat
    FROM DashboardAgenLokasiPengiriman lp
    LEFT JOIN PMP_Wilayah w ON w.WilayahID = lp.WilayahID
    WHERE lp.IsDeleted = 0 ${filterLokasi.replace("AgenID", "lp.AgenID")}
    ORDER BY lp.AgenID, lp.Urutan, lp.LokasiPengirimanID;
  `);
  const rs = res.recordsets as unknown as [
    Array<AlamatMitraAgen & { AgenID: string }>,
    Array<LokasiAgenRow & { AgenID: string }>,
  ];
  const alamat = new Map<string, AlamatMitraAgen>();
  for (const { AgenID, ...a } of rs[0]) alamat.set(AgenID, a);
  const lokasi = new Map<string, LokasiAgenRow[]>();
  for (const { AgenID, ...r } of rs[1]) {
    const daftar = lokasi.get(AgenID) ?? [];
    daftar.push({ ...r, latitude: angkaAtauNull(r.latitude), longitude: angkaAtauNull(r.longitude) });
    lokasi.set(AgenID, daftar);
  }
  return { alamat, lokasi };
}

function toCard(
  row: AgenRow,
  sumber: SumberAgen,
  tambahan: { alamat: Map<string, AlamatMitraAgen>; lokasi: Map<string, LokasiAgenRow[]> }
): MitraCard {
  const alamatMitra = tambahan.alamat.get(row.AgenID) ?? null;
  return {
    agenId: row.AgenID,
    agenDetailId: row.AgenDetailID,
    sumber,
    nama: row.Nama,
    telepon: row.Telepon || null,
    isActive: row.IsActive,
    wilayah: row.Wilayah,
    wilayahId: row.WilayahId || null,
    alamat: row.Alamat,
    kecamatan: row.Kecamatan,
    hargaBalokKecil: row.BalokKecil,
    hargaBalokBesar: row.BalokBesar,
    maksimumHutang: row.MaksimumHutang,
    kapasitasBalokKecil: row.KapasitasBalokKecil,
    kapasitasBalokBesar: row.KapasitasBalokBesar,
    segmentasi: row.Segmentasi,
    latitude: angkaAtauNull(row.Latitude),
    longitude: angkaAtauNull(row.Longitude),
    geoAlamat: row.GeoAlamat,
    lokasiBerbeda: alamatMitra !== null,
    alamatMitra,
    lokasiTambahan: tambahan.lokasi.get(row.AgenID) ?? [],
  };
}

async function getCardsSatuSumber(kode: string, sumber: SumberAgen, agenId?: string): Promise<MitraCard[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const [rows, tambahan] = await Promise.all([getAgenRows(pool, agenId), muatAlamatDanLokasiAgen(pool, agenId)]);
  return rows.map((r) => toCard(r, sumber, tambahan));
}

export async function getMitraList(kode: string): Promise<MitraCard[]> {
  if (kode === "pmputra") {
    // Merged: one card per AgenID, values taken from "utama" (kantong/GL
    // already established elsewhere in this codebase to source from utama
    // only for pmputra -- see penjualan-piutang.ts's kantong fix). Only
    // "utama" is fetched here since the two databases' PMP_Agen rows for
    // the SAME AgenID carry identical descriptive fields (Nama/Telepon/
    // harga) -- there is nothing additive to merge from logistik for the
    // list view itself; per-Agen order/piutang totals (Task 4) DO combine
    // both databases, since kantong volume, not Agen metadata, is what
    // differs between them.
    return getCardsSatuSumber("pmputra", "utama");
  }
  const sources = sourcesForKode(kode);
  const perSource = await Promise.all(sources.map((s) => getCardsSatuSumber(kode, s)));
  return perSource.flat();
}

/**
 * Satu kartu (Agen + AgenDetailID tertentu) — dipakai form untuk memuat ulang
 * setelah "Jadikan Utama". agenDetailId null = kartu Agen tanpa baris detail.
 */
export async function getMitraCard(
  kode: string,
  sumber: SumberAgen,
  agenId: string,
  agenDetailId: string | null
): Promise<MitraCard | null> {
  const cards = await getCardsSatuSumber(kode, kode === "pmputra" ? "utama" : sumber, agenId);
  return cards.find((c) => c.agenDetailId === agenDetailId) ?? null;
}

export interface WilayahOption {
  wilayahId: string;
  nama: string;
}

export async function getWilayahOptions(kode: string, sumber: SumberAgen): Promise<WilayahOption[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const result = await pool.request().query(`
    SELECT WilayahID, Nama FROM PMP_Wilayah WHERE ISNULL(IsDeleted,0) = 0 ORDER BY Nama
  `);
  return (result.recordset as { WilayahID: string; Nama: string }[]).map((r) => ({ wilayahId: r.WilayahID, nama: r.Nama }));
}

export interface MitraInput {
  nama: string;
  telepon: string;
  wilayahId: string | null;
  alamat: string;
  hargaBalokKecil: number;
  hargaBalokBesar: number;
  maksimumHutang: number;
  kapasitasBalokKecil: number | null;
  kapasitasBalokBesar: number | null;
  segmentasi: Segmentasi | null;
}

// Computes the next '01'+sequential ID for either PMP_Agen.AgenID or
// PMP_AgenDetail.AgenDetailID -- both tables share this exact generation
// rule (confirmed live: '01' + MAX(TRY_CAST(SUBSTRING(id,3,10) AS INT))+1,
// no padding, no per-group scoping despite the misleading-looking
// MitraBisnisID column). Runs inside the caller's already-open transaction
// so the MAX() read and the INSERT that follows are atomic within that
// transaction, but a genuinely concurrent second transaction can still
// compute the same "next" value before either commits -- that's what the
// 2627-retry loop in createMitra is for, not this function.
export async function nextSequentialId(
  transaction: sql.Transaction,
  tableName: "PMP_Agen" | "PMP_AgenDetail" | "PMP_Pembayaran",
  idColumn: string
): Promise<string> {
  const result = await new sql.Request(transaction).query(`
    SELECT '01' + CAST(ISNULL(MAX(TRY_CAST(SUBSTRING(${idColumn},3,10) AS INT)), 0) + 1 AS VARCHAR) AS NextId
    FROM ${tableName}
  `);
  return (result.recordset[0] as { NextId: string }).NextId;
}

const MAX_ID_RETRY_ATTEMPTS = 5;
const SQL_PK_VIOLATION = 2627;

const isPkViolation = (err: unknown) =>
  typeof err === "object" && err !== null && "number" in err && (err as { number: number }).number === SQL_PK_VIOLATION;

// Retries the whole (compute-ID, insert) pair on a PK collision (error
// 2627) -- confirmed live that AgenID/AgenDetailID are plain varchar PKs,
// NOT identity columns, so a duplicate insert fails loudly rather than
// silently duplicating, and two near-simultaneous creates CAN legitimately
// race to compute the same "next" ID before either commits.
export async function withIdRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ID_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isPkViolation(err)) throw err;
    }
  }
  throw new Error(`Gagal membuat ID unik setelah ${MAX_ID_RETRY_ATTEMPTS} percobaan: ${String(lastErr)}`);
}

// Varian withIdRetry di DALAM transaksi pemanggil: (hitung ID, INSERT) diulang
// pada tabrakan PK. Galat 2627 hanya membatalkan satu pernyataan (XACT_ABORT
// OFF, bawaan), jadi transaksi tetap bisa dipakai; MAX() berikutnya sudah
// melihat baris milik transaksi lain yang menang.
async function sisipkanDenganIdBaru(
  tx: sql.Transaction,
  tableName: "PMP_Agen" | "PMP_AgenDetail",
  idColumn: string,
  sisipkan: (id: string) => Promise<void>
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ID_RETRY_ATTEMPTS; attempt++) {
    const id = await nextSequentialId(tx, tableName, idColumn);
    try {
      await sisipkan(id);
      return id;
    } catch (err) {
      lastErr = err;
      if (!isPkViolation(err)) throw err;
    }
  }
  throw new Error(`Gagal membuat ID unik setelah ${MAX_ID_RETRY_ATTEMPTS} percobaan: ${String(lastErr)}`);
}

async function sisipkanAgenDetail(tx: sql.Transaction, agenId: string, alamat: string | null, wilayahId: string | null): Promise<string> {
  return sisipkanDenganIdBaru(tx, "PMP_AgenDetail", "AgenDetailID", async (detailId) => {
    await new sql.Request(tx)
      .input("detailId", sql.VarChar(16), detailId)
      .input("id", sql.VarChar(16), agenId)
      .input("address1", sql.VarChar(256), alamat)
      .input("regionId", sql.VarChar(16), wilayahId).query(`
        INSERT INTO PMP_AgenDetail (AgenDetailID, AgenID, Address1, RegionID, IsDeleted, ModifiedDate)
        VALUES (@detailId, @id, @address1, @regionId, 0, GETDATE())
      `);
  });
}

async function denganTransaksi<T>(pool: sql.ConnectionPool, fn: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const hasil = await fn(tx);
    await tx.commit();
    return hasil;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

async function createMitraDalamTx(tx: sql.Transaction, input: MitraInput): Promise<string> {
  const agenId = await sisipkanDenganIdBaru(tx, "PMP_Agen", "AgenID", async (id) => {
    await new sql.Request(tx)
      .input("id", sql.VarChar(16), id)
      .input("nama", sql.VarChar(128), input.nama)
      .input("telepon", sql.VarChar(16), input.telepon)
      .input("kecil", sql.Decimal(18, 2), input.hargaBalokKecil)
      .input("besar", sql.Decimal(18, 2), input.hargaBalokBesar)
      .input("maksHutang", sql.Decimal(18, 2), input.maksimumHutang).query(`
        INSERT INTO PMP_Agen
          (AgenID, Nama, MitraBisnisID, Telepon, IsActive, BalokKecil, BalokBesar, MaksimumHutang,
           PiutangSaatIni, PiutangSaldoAwal, TabunganSaatIni, TabunganSaldoAwal, IsDeleted, ModifiedDate)
        VALUES
          (@id, @nama, '011', @telepon, 1, @kecil, @besar, @maksHutang, 0, 0, 0, 0, 0, GETDATE())
      `);
  });
  if (input.wilayahId || input.alamat) {
    await sisipkanAgenDetail(tx, agenId, input.alamat, input.wilayahId);
  }
  return agenId;
}

/**
 * Buat PMP_Agen (+ PMP_AgenDetail bila ada wilayah/alamat). `tx` opsional:
 * bila diberikan, semua tulisan ikut transaksi pemanggil (tidak di-commit di
 * sini); tanpa `tx`, fungsi membuka & meng-commit transaksinya sendiri.
 */
export async function createMitra(kode: string, sumber: SumberAgen, input: MitraInput, tx?: sql.Transaction): Promise<string> {
  if (tx) return createMitraDalamTx(tx, input);
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  return denganTransaksi(pool, (t) => createMitraDalamTx(t, input));
}

const teksSama = (a: string | null | undefined, b: string | null | undefined) => (a?.trim() || null) === (b?.trim() || null);

async function updateMitraDalamTx(tx: sql.Transaction, agenId: string, input: MitraInput, agenDetailId: string | null | undefined): Promise<void> {
  // PMP_Agen — hanya ditulis bila ada yang berubah (perbandingan di JS supaya
  // peka huruf besar-kecil; kolasi DB tidak), agar simpan tanpa perubahan
  // tidak menggeser ModifiedDate ERP.
  const agenRes = await new sql.Request(tx)
    .input("id", sql.VarChar(16), agenId)
    .query(`SELECT Nama, Telepon, BalokKecil, BalokBesar, MaksimumHutang FROM PMP_Agen WITH (UPDLOCK) WHERE AgenID = @id`);
  const agen = agenRes.recordset[0] as
    | { Nama: string | null; Telepon: string | null; BalokKecil: number; BalokBesar: number; MaksimumHutang: number }
    | undefined;
  if (!agen) throw new AppError("Mitra tidak ditemukan.");
  const agenBerubah =
    (agen.Nama ?? "") !== input.nama ||
    !teksSama(agen.Telepon, input.telepon) ||
    Number(agen.BalokKecil) !== input.hargaBalokKecil ||
    Number(agen.BalokBesar) !== input.hargaBalokBesar ||
    Number(agen.MaksimumHutang) !== input.maksimumHutang;
  if (agenBerubah) {
    await new sql.Request(tx)
      .input("id", sql.VarChar(16), agenId)
      .input("nama", sql.VarChar(128), input.nama)
      .input("telepon", sql.VarChar(16), input.telepon)
      .input("kecil", sql.Decimal(18, 2), input.hargaBalokKecil)
      .input("besar", sql.Decimal(18, 2), input.hargaBalokBesar)
      .input("maksHutang", sql.Decimal(18, 2), input.maksimumHutang).query(`
        UPDATE PMP_Agen SET
          Nama = @nama, Telepon = @telepon, BalokKecil = @kecil, BalokBesar = @besar,
          MaksimumHutang = @maksHutang, ModifiedDate = GETDATE()
        WHERE AgenID = @id
      `);
  }

  // PMP_AgenDetail — SELALU satu baris tertentu. Agen bisa punya >1 baris
  // detail aktif (keputusan pengguna: semua kartu dipertahankan), jadi
  // penulisan TIDAK PERNAH "WHERE AgenID = …" (itu menimpa semua baris).
  let detailId = agenDetailId ?? null;
  if (!detailId) {
    // Kartu tanpa AgenDetailID = Agen belum punya baris detail saat dimuat.
    // UPDLOCK+HOLDLOCK mengunci rentang supaya dua simpan bersamaan tidak
    // sama-sama membuat baris baru.
    const ada = await new sql.Request(tx)
      .input("id", sql.VarChar(16), agenId)
      .query(`SELECT AgenDetailID FROM PMP_AgenDetail WITH (UPDLOCK, HOLDLOCK) WHERE AgenID = @id AND ISNULL(IsDeleted,0) = 0`);
    const ids = (ada.recordset as { AgenDetailID: string }[]).map((r) => r.AgenDetailID);
    if (ids.length > 1) {
      throw new AppError("Mitra ini punya lebih dari satu baris alamat ERP. Muat ulang halaman lalu edit kartu yang dimaksud.");
    }
    if (ids.length === 0) {
      if (input.wilayahId || input.alamat) await sisipkanAgenDetail(tx, agenId, input.alamat, input.wilayahId);
      return;
    }
    detailId = ids[0];
  }

  const detRes = await new sql.Request(tx)
    .input("id", sql.VarChar(16), agenId)
    .input("detailId", sql.VarChar(16), detailId)
    .query(`SELECT Address1, RegionID FROM PMP_AgenDetail WITH (UPDLOCK)
            WHERE AgenDetailID = @detailId AND AgenID = @id AND ISNULL(IsDeleted,0) = 0`);
  const det = detRes.recordset[0] as { Address1: string | null; RegionID: string | null } | undefined;
  if (!det) throw new AppError("Alamat ERP mitra ini sudah berubah atau dihapus. Muat ulang halaman lalu coba lagi.");
  // Kedua isian dikosongkan → baris dikosongkan (bukan dihapus, AgenDetailID
  // tetap stabil). Selain itu tulis nilai baru. Tanpa perubahan → tidak ditulis.
  if (teksSama(det.Address1, input.alamat) && teksSama(det.RegionID, input.wilayahId)) return;
  await new sql.Request(tx)
    .input("detailId", sql.VarChar(16), detailId)
    .input("address1", sql.VarChar(256), input.alamat)
    .input("regionId", sql.VarChar(16), input.wilayahId).query(`
      UPDATE PMP_AgenDetail SET Address1 = @address1, RegionID = @regionId, ModifiedDate = GETDATE()
      WHERE AgenDetailID = @detailId
    `);
}

/**
 * Perbarui PMP_Agen + SATU baris PMP_AgenDetail (milik kartu). `agenDetailId`:
 * - diisi → hanya baris itu yang ditulis (baris detail lain Agen yang sama
 *   tidak tersentuh);
 * - null/undefined → Agen dianggap tanpa baris detail: dibuat bila ada
 *   wilayah/alamat; bila ternyata ada tepat satu, baris itu yang dipakai;
 *   bila >1, ditolak (kartu harus menyebut AgenDetailID-nya).
 * `tx` opsional, sama seperti createMitra.
 */
export async function updateMitra(
  kode: string,
  sumber: SumberAgen,
  agenId: string,
  input: MitraInput,
  tx?: sql.Transaction,
  agenDetailId?: string | null
): Promise<void> {
  if (tx) return updateMitraDalamTx(tx, agenId, input, agenDetailId);
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  await withIdRetry(() => denganTransaksi(pool, (t) => updateMitraDalamTx(t, agenId, input, agenDetailId)));
}

export async function setMitraSuspended(kode: string, sumber: SumberAgen, agenId: string, isActive: boolean): Promise<void> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  await pool
    .request()
    .input("id", sql.VarChar(16), agenId)
    .input("isActive", sql.Bit, isActive)
    .query(`UPDATE PMP_Agen SET IsActive = @isActive, ModifiedDate = GETDATE() WHERE AgenID = @id`);
}

export async function deleteMitra(kode: string, sumber: SumberAgen, agenId: string): Promise<void> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  await pool
    .request()
    .input("id", sql.VarChar(16), agenId)
    .query(`UPDATE PMP_Agen SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE AgenID = @id`);
}

async function execUntuk(kode: string, sumber: SumberAgen, exec?: ExecAgen): Promise<ExecAgen> {
  if (exec) return exec;
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  return getCompanyPool(physKode, label);
}

// Kapasitas/Segmentasi are dashboard-owned (no ERP equivalent, confirmed
// live) -- stored in DashboardAgenProfil, same MERGE-upsert pattern as
// setAgenLocation just below. `kecamatan` (Kecamatan lokasi utama, spec
// §6.2): undefined = kolom tidak disentuh. `exec` opsional — transaksi
// pemanggil (form lengkap) atau pool DB fisik (bawaan).
export async function setAgenProfil(
  kode: string,
  sumber: SumberAgen,
  agenId: string,
  input: {
    kapasitasBalokKecil: number | null;
    kapasitasBalokBesar: number | null;
    segmentasi: Segmentasi | null;
    kecamatan?: string | null;
    userId: string;
  },
  exec?: ExecAgen
): Promise<void> {
  const e = await execUntuk(kode, sumber, exec);
  const sentuhKecamatan = input.kecamatan !== undefined;
  await e
    .request()
    .input("id", sql.VarChar(16), agenId)
    .input("kecil", sql.Decimal(18, 2), input.kapasitasBalokKecil)
    .input("besar", sql.Decimal(18, 2), input.kapasitasBalokBesar)
    .input("segmentasi", sql.VarChar(20), input.segmentasi)
    .input("kecamatan", sql.VarChar(128), input.kecamatan ?? null)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE DashboardAgenProfil WITH (HOLDLOCK) AS target
      USING (SELECT @id AS AgenID) AS src
      ON target.AgenID = src.AgenID
      WHEN MATCHED THEN
        UPDATE SET KapasitasBalokKecil = @kecil, KapasitasBalokBesar = @besar, Segmentasi = @segmentasi,
                   ${sentuhKecamatan ? "Kecamatan = @kecamatan," : ""} UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (AgenID, KapasitasBalokKecil, KapasitasBalokBesar, Segmentasi, Kecamatan, CreatedByUserID)
        VALUES (@id, @kecil, @besar, @segmentasi, @kecamatan, @userId);
    `);
}

export async function setAgenLocation(
  kode: string,
  sumber: SumberAgen,
  agenId: string,
  input: { latitude: number; longitude: number; alamat: string | null; userId: string },
  exec?: ExecAgen
): Promise<void> {
  const e = await execUntuk(kode, sumber, exec);
  await e
    .request()
    .input("id", sql.VarChar(16), agenId)
    .input("lat", sql.Decimal(10, 7), input.latitude)
    .input("lng", sql.Decimal(10, 7), input.longitude)
    .input("alamat", sql.VarChar(512), input.alamat)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE DashboardAgenLocation WITH (HOLDLOCK) AS target
      USING (SELECT @id AS AgenID) AS src
      ON target.AgenID = src.AgenID
      WHEN MATCHED THEN
        UPDATE SET Latitude = @lat, Longitude = @lng, Alamat = @alamat, UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (AgenID, Latitude, Longitude, Alamat, CreatedByUserID)
        VALUES (@id, @lat, @lng, @alamat, @userId);
    `);
}
