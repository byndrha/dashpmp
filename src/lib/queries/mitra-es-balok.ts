// src/lib/queries/mitra-es-balok.ts
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";

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

export interface MitraCard {
  agenId: string;
  sumber: SumberAgen;
  nama: string;
  telepon: string | null;
  isActive: boolean;
  wilayah: string | null;
  wilayahId: string | null;
  alamat: string | null;
  hargaBalokKecil: number;
  hargaBalokBesar: number;
  maksimumHutang: number;
  kapasitasBalokKecil: number | null;
  kapasitasBalokBesar: number | null;
  segmentasi: Segmentasi | null;
  latitude: number | null;
  longitude: number | null;
}

interface AgenRow {
  AgenID: string;
  Nama: string;
  Telepon: string | null;
  IsActive: boolean;
  BalokKecil: number;
  BalokBesar: number;
  MaksimumHutang: number;
  Wilayah: string | null;
  WilayahId: string | null;
  Alamat: string | null;
  KapasitasBalokKecil: number | null;
  KapasitasBalokBesar: number | null;
  Segmentasi: Segmentasi | null;
  Latitude: number | null;
  Longitude: number | null;
}

// Shared SELECT shape for one (kode,sumber) database -- LEFT JOINs
// PMP_AgenDetail (an Agen may have zero detail rows) -> PMP_Wilayah,
// DashboardAgenLocation (an Agen may have zero saved pins), and
// DashboardAgenProfil (an Agen may have zero saved Kapasitas/Segmentasi --
// dashboard-owned, no ERP equivalent exists). IsDeleted=0 only -- deleted
// Agen never appear in the list, matching Es Kristal's getMitraList
// (deleteMitra there is also a soft IsDeleted=1).
async function getAgenRows(kode: string, sumber: SumberAgen): Promise<AgenRow[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const result = await pool.request().query(`
    SELECT a.AgenID, a.Nama, a.Telepon, a.IsActive, a.BalokKecil, a.BalokBesar, a.MaksimumHutang,
           w.Nama AS Wilayah, ad.RegionID AS WilayahId, ad.Address1 AS Alamat,
           prof.KapasitasBalokKecil, prof.KapasitasBalokBesar, prof.Segmentasi,
           loc.Latitude, loc.Longitude
    FROM PMP_Agen a
    LEFT JOIN PMP_AgenDetail ad ON ad.AgenID = a.AgenID AND ISNULL(ad.IsDeleted,0) = 0
    LEFT JOIN PMP_Wilayah w ON w.WilayahID = ad.RegionID
    LEFT JOIN DashboardAgenProfil prof ON prof.AgenID = a.AgenID
    LEFT JOIN DashboardAgenLocation loc ON loc.AgenID = a.AgenID
    WHERE ISNULL(a.IsDeleted,0) = 0
    ORDER BY a.Nama
  `);
  return result.recordset as AgenRow[];
}

function toCard(row: AgenRow, sumber: SumberAgen): MitraCard {
  return {
    agenId: row.AgenID,
    sumber,
    nama: row.Nama,
    telepon: row.Telepon || null,
    isActive: row.IsActive,
    wilayah: row.Wilayah,
    wilayahId: row.WilayahId,
    alamat: row.Alamat,
    hargaBalokKecil: row.BalokKecil,
    hargaBalokBesar: row.BalokBesar,
    maksimumHutang: row.MaksimumHutang,
    kapasitasBalokKecil: row.KapasitasBalokKecil,
    kapasitasBalokBesar: row.KapasitasBalokBesar,
    segmentasi: row.Segmentasi,
    latitude: row.Latitude,
    longitude: row.Longitude,
  };
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
    const rows = await getAgenRows("pmputra", "utama");
    return rows.map((r) => toCard(r, "utama"));
  }
  const sources = sourcesForKode(kode);
  const perSource = await Promise.all(sources.map((s) => getAgenRows(kode, s)));
  return perSource.flatMap((rows, i) => rows.map((r) => toCard(r, sources[i])));
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
      const isPkViolation = typeof err === "object" && err !== null && "number" in err && (err as { number: number }).number === SQL_PK_VIOLATION;
      if (!isPkViolation) throw err;
    }
  }
  throw new Error(`Gagal membuat ID unik setelah ${MAX_ID_RETRY_ATTEMPTS} percobaan: ${String(lastErr)}`);
}

export async function createMitra(kode: string, sumber: SumberAgen, input: MitraInput): Promise<string> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);

  return withIdRetry(async () => {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const agenId = await nextSequentialId(transaction, "PMP_Agen", "AgenID");
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), agenId)
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

      if (input.wilayahId || input.alamat) {
        const agenDetailId = await nextSequentialId(transaction, "PMP_AgenDetail", "AgenDetailID");
        await new sql.Request(transaction)
          .input("detailId", sql.VarChar(16), agenDetailId)
          .input("id", sql.VarChar(16), agenId)
          .input("address1", sql.VarChar(256), input.alamat)
          .input("regionId", sql.VarChar(16), input.wilayahId).query(`
            INSERT INTO PMP_AgenDetail (AgenDetailID, AgenID, Address1, RegionID, IsDeleted, ModifiedDate)
            VALUES (@detailId, @id, @address1, @regionId, 0, GETDATE())
          `);
      }

      await transaction.commit();
      return agenId;
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  });
}

export async function updateMitra(kode: string, sumber: SumberAgen, agenId: string, input: MitraInput): Promise<void> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);

  await pool
    .request()
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

  // Only touches PMP_AgenDetail when the caller actually supplied
  // wilayah/alamat -- if both are empty/null, this Agen simply has no
  // detail row and updateMitra leaves it that way (matches createMitra's
  // same "only create AgenDetail if there's something to put in it" rule).
  //
  // Uses a single atomic MERGE ... WITH (HOLDLOCK) instead of a separate
  // SELECT-then-branch (check-then-act), because two near-simultaneous
  // updateMitra calls on the same Agen that both see "no existing row" via
  // a plain SELECT would both take the INSERT branch and create two active
  // AgenDetail rows -- confirmed live via a concurrency test. HOLDLOCK
  // serializes concurrent MERGE statements against matching rows, which is
  // the standard Microsoft-documented pattern for preventing this race.
  if (input.wilayahId || input.alamat) {
    await withIdRetry(async () => {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        // Computed unconditionally, inside the transaction, even though
        // it's only USED by the MERGE's INSERT branch -- if the WHEN
        // MATCHED branch fires instead, this ID is simply wasted (a small,
        // harmless gap in the sequence), which is far preferable to a
        // second round-trip after learning whether MATCHED fired.
        const agenDetailId = await nextSequentialId(transaction, "PMP_AgenDetail", "AgenDetailID");
        await new sql.Request(transaction)
          .input("id", sql.VarChar(16), agenId)
          .input("detailId", sql.VarChar(16), agenDetailId)
          .input("address1", sql.VarChar(256), input.alamat)
          .input("regionId", sql.VarChar(16), input.wilayahId).query(`
            MERGE PMP_AgenDetail WITH (HOLDLOCK) AS target
            USING (SELECT @id AS AgenID) AS src
            ON target.AgenID = src.AgenID AND ISNULL(target.IsDeleted,0) = 0
            WHEN MATCHED THEN
              UPDATE SET Address1 = @address1, RegionID = @regionId, ModifiedDate = GETDATE()
            WHEN NOT MATCHED THEN
              INSERT (AgenDetailID, AgenID, Address1, RegionID, IsDeleted, ModifiedDate)
              VALUES (@detailId, @id, @address1, @regionId, 0, GETDATE());
          `);
        await transaction.commit();
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    });
  } else {
    // Both Wilayah and Alamat were cleared by the caller. The MERGE branch
    // above never runs in this case, so any existing PMP_AgenDetail row
    // would otherwise keep its stale Address1/RegionID forever despite the
    // form showing them empty. Explicitly blank the row instead (kept, not
    // soft-deleted, so AgenDetailID stays stable for auditability) -- no
    // ID generation or insert here, so this doesn't need withIdRetry.
    await pool
      .request()
      .input("id", sql.VarChar(16), agenId)
      .query(`
        UPDATE PMP_AgenDetail SET Address1 = NULL, RegionID = NULL, ModifiedDate = GETDATE()
        WHERE AgenID = @id AND ISNULL(IsDeleted,0) = 0
      `);
  }
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

// Kapasitas/Segmentasi are dashboard-owned (no ERP equivalent, confirmed
// live) -- stored in DashboardAgenProfil, same MERGE-upsert pattern as
// setAgenLocation just below. Called separately from createMitra/updateMitra
// (not inside their own transaction) since this data has nothing to do with
// PMP_Agen/PMP_AgenDetail's own ID-generation/concurrency concerns -- a
// failure here should never roll back the core Agen record itself.
export async function setAgenProfil(
  kode: string,
  sumber: SumberAgen,
  agenId: string,
  input: { kapasitasBalokKecil: number | null; kapasitasBalokBesar: number | null; segmentasi: Segmentasi | null; userId: string }
): Promise<void> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  await pool
    .request()
    .input("id", sql.VarChar(16), agenId)
    .input("kecil", sql.Decimal(18, 2), input.kapasitasBalokKecil)
    .input("besar", sql.Decimal(18, 2), input.kapasitasBalokBesar)
    .input("segmentasi", sql.VarChar(20), input.segmentasi)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE DashboardAgenProfil AS target
      USING (SELECT @id AS AgenID) AS src
      ON target.AgenID = src.AgenID
      WHEN MATCHED THEN
        UPDATE SET KapasitasBalokKecil = @kecil, KapasitasBalokBesar = @besar, Segmentasi = @segmentasi, UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (AgenID, KapasitasBalokKecil, KapasitasBalokBesar, Segmentasi, CreatedByUserID)
        VALUES (@id, @kecil, @besar, @segmentasi, @userId);
    `);
}

export async function setAgenLocation(
  kode: string,
  sumber: SumberAgen,
  agenId: string,
  input: { latitude: number; longitude: number; alamat: string | null; userId: string }
): Promise<void> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  await pool
    .request()
    .input("id", sql.VarChar(16), agenId)
    .input("lat", sql.Decimal(10, 7), input.latitude)
    .input("lng", sql.Decimal(10, 7), input.longitude)
    .input("alamat", sql.VarChar(512), input.alamat)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE DashboardAgenLocation AS target
      USING (SELECT @id AS AgenID) AS src
      ON target.AgenID = src.AgenID
      WHEN MATCHED THEN
        UPDATE SET Latitude = @lat, Longitude = @lng, Alamat = @alamat, UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (AgenID, Latitude, Longitude, Alamat, CreatedByUserID)
        VALUES (@id, @lat, @lng, @alamat, @userId);
    `);
}
