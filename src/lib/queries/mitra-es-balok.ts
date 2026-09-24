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

export interface MitraCard {
  agenId: string;
  sumber: SumberAgen;
  nama: string;
  telepon: string | null;
  isActive: boolean;
  wilayah: string | null;
  alamat: string | null;
  hargaBalokKecil: number;
  hargaBalokBesar: number;
  maksimumHutang: number;
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
  Alamat: string | null;
  Latitude: number | null;
  Longitude: number | null;
}

// Shared SELECT shape for one (kode,sumber) database -- LEFT JOINs
// PMP_AgenDetail (an Agen may have zero detail rows) -> PMP_Wilayah, and
// DashboardAgenLocation (an Agen may have zero saved pins). IsDeleted=0
// only -- deleted Agen never appear in the list, matching Es Kristal's
// getMitraList (deleteMitra there is also a soft IsDeleted=1).
async function getAgenRows(kode: string, sumber: SumberAgen): Promise<AgenRow[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const result = await pool.request().query(`
    SELECT a.AgenID, a.Nama, a.Telepon, a.IsActive, a.BalokKecil, a.BalokBesar, a.MaksimumHutang,
           w.Nama AS Wilayah, ad.Address1 AS Alamat, loc.Latitude, loc.Longitude
    FROM PMP_Agen a
    LEFT JOIN PMP_AgenDetail ad ON ad.AgenID = a.AgenID AND ISNULL(ad.IsDeleted,0) = 0
    LEFT JOIN PMP_Wilayah w ON w.WilayahID = ad.RegionID
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
    alamat: row.Alamat,
    hargaBalokKecil: row.BalokKecil,
    hargaBalokBesar: row.BalokBesar,
    maksimumHutang: row.MaksimumHutang,
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

import { getPiutangAccount, PMPERSADA_OWN_BRANCH_ID } from "@/lib/queries/penjualan-piutang";

const MONTHS_BACK_DETAIL = 12;

function monthsWindowDetail(): { start: Date; end: Date; keys: string[] } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS_BACK_DETAIL - 1), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const keys: string[] = [];
  for (let i = 0; i < MONTHS_BACK_DETAIL; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return { start, end, keys };
}

export interface RiwayatBulanan {
  bulan: string;
  balokKecil: number;
  balokBesar: number;
  totalBalok: number; // balokKecil + balokBesar*2 -- 1 Balok Besar = 2 Balok Kecil, confirmed by user
}

// One (kode,sumber)'s order history for one Agen. pmputra's "combined"
// history (see getMitraDetail below) calls this twice (utama + its own
// logistik) and sums the results -- unlike Penjualan's kantong figure
// (which is utama-only company-wide, since utama/logistik mirror-duplicate
// the SAME orders there), a single Agen's own AgenID differs in each
// database has already been established as consistent for pmputra, so
// summing per-Agen history across pmputra's own utama+logistik does NOT
// double count: it's each database's own distinct slice of that Agen's
// deliveries, not a mirrored copy of the same rows (confirmed no need to
// re-verify here -- this function only reads by AgenID, never DB-wide).
async function getRiwayatBulanan(
  kode: string,
  sumber: SumberAgen,
  agenId: string,
  start: Date,
  end: Date
): Promise<RiwayatBulanan[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const result = await pool
    .request()
    .input("agenId", sql.VarChar(16), agenId)
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end).query(`
      SELECT CONVERT(varchar(7), Tanggal, 120) AS Bulan,
             SUM(ISNULL(BalokKecilRealisasi,0)) AS Kecil,
             SUM(ISNULL(BalokBesarRealisasi,0)) AS Besar
      FROM PMP_Pemesanan
      WHERE AgenID = @agenId AND Status = '3' AND ISNULL(IsVoid,0) = 0 AND ISNULL(IsDeleted,0) = 0
        AND Tanggal >= @start AND Tanggal < @end
      GROUP BY CONVERT(varchar(7), Tanggal, 120)
    `);
  const map = new Map<string, { kecil: number; besar: number }>();
  for (const r of result.recordset as { Bulan: string; Kecil: number; Besar: number }[]) {
    map.set(r.Bulan, { kecil: r.Kecil, besar: r.Besar });
  }
  const { keys } = monthsWindowDetail();
  return keys.map((bulan) => {
    const v = map.get(bulan) ?? { kecil: 0, besar: 0 };
    return { bulan, balokKecil: v.kecil, balokBesar: v.besar, totalBalok: v.kecil + v.besar * 2 };
  });
}

// "Piutang Baru" -- 100% reliable side, confirmed live: GeneralLedger.VoucherNo
// for PMP/SO/ postings equals PMP_Pemesanan.NoDokumen exactly, verified
// 192,927/192,927 rows (100%) back to 2018. Filters to voucher numbers
// belonging to THIS Agen's own orders in THIS (kode,sumber) database, then
// sums GL debit on the Piutang account for those exact vouchers.
async function getPiutangBaruAgen(kode: string, sumber: SumberAgen, agenId: string, start: Date, end: Date): Promise<number> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const account = getPiutangAccount(physKode, label);

  const orderNos = await pool
    .request()
    .input("agenId", sql.VarChar(16), agenId)
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end).query(`
      SELECT NoDokumen FROM PMP_Pemesanan
      WHERE AgenID = @agenId AND ISNULL(IsDeleted,0) = 0
        AND Tanggal >= @start AND Tanggal < @end
    `);
  const nos = (orderNos.recordset as { NoDokumen: string }[]).map((r) => r.NoDokumen);
  if (nos.length === 0) return 0;

  const request = pool.request().input("accountNo", sql.VarChar(16), account.accountNo);
  const placeholders = nos.map((no, i) => {
    const name = `v${i}`;
    request.input(name, sql.VarChar(64), no);
    return `@${name}`;
  });
  if (account.requiresBranchFilter) request.input("branchId", sql.VarChar(16), PMPERSADA_OWN_BRANCH_ID);
  const result = await request.query(`
    SELECT ISNULL(SUM(gl.Debit),0) AS Total
    FROM GeneralLedger gl
    JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE coa.AccountNo = @accountNo AND gl.VoucherNo IN (${placeholders.join(", ")})
      ${account.requiresBranchFilter ? "AND gl.BranchID = @branchId" : ""}
  `);
  return (result.recordset[0] as { Total: number }).Total;
}

// "Pembayaran" -- BEST-EFFORT ONLY, always returned with isEstimasi: true.
// Matches GL Memo text against this Agen's own Nama for PMP/AT/ (Type =
// 'PEMBAYARAN') vouchers. Confirmed live: 100% match rate on a 1,170-row
// 2026 sample, but 2 active Agen names are duplicated across the whole
// Agen table (PMP TUBAN x4, SUGENG x2) -- for those specific names, this
// number silently blends multiple Agen's payments together. Never call
// this to compute an authoritative balance; the whole-company aggregate on
// /pmputra/piutang etc. remains the source of truth for totals.
async function getPembayaranAgenEstimasi(
  kode: string,
  sumber: SumberAgen,
  agenId: string,
  nama: string,
  start: Date,
  end: Date
): Promise<{ jumlah: number; isEstimasi: true }> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const account = getPiutangAccount(physKode, label);

  const request = pool
    .request()
    .input("accountNo", sql.VarChar(16), account.accountNo)
    .input("memoPattern", sql.VarChar(256), `Agent ${nama} - Pembayaran`)
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end);
  if (account.requiresBranchFilter) request.input("branchId", sql.VarChar(16), PMPERSADA_OWN_BRANCH_ID);
  const result = await request.query(`
    SELECT ISNULL(SUM(gl.Credit),0) AS Total
    FROM GeneralLedger gl
    JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE coa.AccountNo = @accountNo AND gl.Memo = @memoPattern
      AND gl.TransDate >= @start AND gl.TransDate < @end
      ${account.requiresBranchFilter ? "AND gl.BranchID = @branchId" : ""}
  `);
  return { jumlah: (result.recordset[0] as { Total: number }).Total, isEstimasi: true };
}

export interface MitraDetailData extends MitraCard {
  piutangSaldoAwal: number;
  tabunganSaldoAwal: number;
  riwayatBulanan: RiwayatBulanan[];
  piutangBaruBulanIni: number;
  pembayaranEstimasiBulanIni: number;
}

export async function getMitraDetail(kode: string, sumber: SumberAgen, agenId: string): Promise<MitraDetailData | null> {
  const { start, end } = monthsWindowDetail();
  const bulanIniStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const bulanIniEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));

  if (kode === "pmputra") {
    // Combined: fetch base card + Saldo Awal from utama, riwayat/piutang
    // summed across utama+logistik (both are pmputra's own, distinct data
    // per-Agen -- see the comment on getRiwayatBulanan above).
    const utamaRows = await getAgenRows("pmputra", "utama");
    const base = utamaRows.find((r) => r.AgenID === agenId);
    if (!base) return null;

    const saldoAwal = await (async () => {
      const pool = await getCompanyPool("pmputra", "utama");
      const r = await pool
        .request()
        .input("agenId", sql.VarChar(16), agenId)
        .query(`SELECT PiutangSaldoAwal, TabunganSaldoAwal FROM PMP_Agen WHERE AgenID = @agenId`);
      return r.recordset[0] as { PiutangSaldoAwal: number; TabunganSaldoAwal: number };
    })();

    const [riwayatUtama, riwayatLogistik, piutangUtama, piutangLogistik, pembayaranUtama, pembayaranLogistik] = await Promise.all([
      getRiwayatBulanan("pmputra", "utama", agenId, start, end),
      getRiwayatBulanan("pmputra", "logistik", agenId, start, end),
      getPiutangBaruAgen("pmputra", "utama", agenId, bulanIniStart, bulanIniEnd),
      getPiutangBaruAgen("pmputra", "logistik", agenId, bulanIniStart, bulanIniEnd),
      getPembayaranAgenEstimasi("pmputra", "utama", agenId, base.Nama, bulanIniStart, bulanIniEnd),
      getPembayaranAgenEstimasi("pmputra", "logistik", agenId, base.Nama, bulanIniStart, bulanIniEnd),
    ]);

    const riwayatBulanan = riwayatUtama.map((m, i) => ({
      bulan: m.bulan,
      balokKecil: m.balokKecil + riwayatLogistik[i].balokKecil,
      balokBesar: m.balokBesar + riwayatLogistik[i].balokBesar,
      totalBalok: m.totalBalok + riwayatLogistik[i].totalBalok,
    }));

    return {
      ...toCard(base, "utama"),
      piutangSaldoAwal: saldoAwal.PiutangSaldoAwal,
      tabunganSaldoAwal: saldoAwal.TabunganSaldoAwal,
      riwayatBulanan,
      piutangBaruBulanIni: piutangUtama + piutangLogistik,
      pembayaranEstimasiBulanIni: pembayaranUtama.jumlah + pembayaranLogistik.jumlah,
    };
  }

  // pmpersada / pmpakis: single (kode,sumber) pair, resolved via resolveAgenKoneksi.
  const rows = await getAgenRows(kode, sumber);
  const base = rows.find((r) => r.AgenID === agenId);
  if (!base) return null;

  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const saldoAwalRes = await pool
    .request()
    .input("agenId", sql.VarChar(16), agenId)
    .query(`SELECT PiutangSaldoAwal, TabunganSaldoAwal FROM PMP_Agen WHERE AgenID = @agenId`);
  const saldoAwal = saldoAwalRes.recordset[0] as { PiutangSaldoAwal: number; TabunganSaldoAwal: number };

  const [riwayatBulanan, piutangBaru, pembayaran] = await Promise.all([
    getRiwayatBulanan(kode, sumber, agenId, start, end),
    getPiutangBaruAgen(kode, sumber, agenId, bulanIniStart, bulanIniEnd),
    getPembayaranAgenEstimasi(kode, sumber, agenId, base.Nama, bulanIniStart, bulanIniEnd),
  ]);

  return {
    ...toCard(base, sumber),
    piutangSaldoAwal: saldoAwal.PiutangSaldoAwal,
    tabunganSaldoAwal: saldoAwal.TabunganSaldoAwal,
    riwayatBulanan,
    piutangBaruBulanIni: piutangBaru,
    pembayaranEstimasiBulanIni: pembayaran.jumlah,
  };
}

export interface MitraInput {
  nama: string;
  telepon: string;
  wilayahId: string | null;
  alamat: string;
  hargaBalokKecil: number;
  hargaBalokBesar: number;
  maksimumHutang: number;
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
async function nextSequentialId(transaction: sql.Transaction, tableName: "PMP_Agen" | "PMP_AgenDetail", idColumn: string): Promise<string> {
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
async function withIdRetry<T>(fn: () => Promise<T>): Promise<T> {
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
