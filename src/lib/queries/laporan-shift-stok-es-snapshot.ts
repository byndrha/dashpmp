import { getPool, sql } from "@/lib/db";
import { getNaiveWibNow } from "@/lib/business-date";
import type { ShiftNumber } from "@/lib/report-shift";

// Total live sisa stok es (SUM SisaQty10KG across all active pallet
// batches) — same query as getTotalStokEs10KG in aktivitas-produksi.ts and
// the live Peta Warehouse total, duplicated here rather than imported
// (this file must not depend on aktivitas-produksi.ts, and the query is a
// single COALESCE-guarded SUM, not worth a shared-module indirection).
async function hitungTotalSisaStokEsLive(): Promise<number> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ISNULL(SUM(SisaQty10KG), 0) AS Total FROM DashboardProduksiBatch WHERE IsDeleted = 0 AND SisaQty10KG > 0
  `);
  return (result.recordset[0] as { Total: number }).Total;
}

// Idempotent: does nothing if a snapshot for (tanggalUsaha, shift) already
// exists. Called both by the periodic scanner (Task 2, for "the shift that
// just ended") and its own startup catch-up sweep — safe to call for the
// same shift many times in a row.
//
// WARNING for future maintainers: the read/write logic in this file always
// filters "AND IsDeleted = 0", following this codebase's usual soft-delete
// convention. But the underlying UNIQUE constraint —
// DashboardLaporanShiftStokEsSnapshot.UQ_LaporanShiftStokEsSnapshot on
// (TanggalUsaha, Shift) — is NOT IsDeleted-filtered. So if a snapshot for a
// given shift is ever wrong and needs correcting, do NOT soft-delete the
// existing row and let this function reinsert on its next tick: the
// soft-deleted row still occupies the (TanggalUsaha, Shift) slot in the
// unique index, so every future insert attempt for that same shift will
// permanently hit a UNIQUE VIOLATION. Fix a bad snapshot with a direct SQL
// UPDATE of TotalSisaQty10KG on the existing row instead.
export async function catatSnapshotJikaBelumAda(tanggalUsaha: string, shift: ShiftNumber): Promise<void> {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`SELECT 1 FROM DashboardLaporanShiftStokEsSnapshot WHERE TanggalUsaha = @t AND Shift = @s AND IsDeleted = 0`);
  if (existing.recordset.length > 0) return;

  const total = await hitungTotalSisaStokEsLive();
  await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .input("total", sql.Decimal(18, 2), total)
    .input("createdDate", sql.DateTime, getNaiveWibNow())
    .query(`
      INSERT INTO DashboardLaporanShiftStokEsSnapshot (TanggalUsaha, Shift, TotalSisaQty10KG, CreatedDate)
      VALUES (@t, @s, @total, @createdDate)
    `);
}

// null when no snapshot exists yet for this shift (shift still running, or
// this feature wasn't active yet when that shift happened).
export async function getSnapshotStokEs(tanggalUsaha: string, shift: ShiftNumber): Promise<number | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`SELECT TotalSisaQty10KG FROM DashboardLaporanShiftStokEsSnapshot WHERE TanggalUsaha = @t AND Shift = @s AND IsDeleted = 0`);
  const row = result.recordset[0] as { TotalSisaQty10KG: number } | undefined;
  return row?.TotalSisaQty10KG ?? null;
}

// Live total, exported for Task 7's "shift currently running" display path
// (labeled "(live, belum final)" in the UI, per spec Bagian 4).
export { hitungTotalSisaStokEsLive };
