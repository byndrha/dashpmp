import { getPool, sql } from "@/lib/db";
import { getReportShift, getShiftWindow, getShiftLabel, type ShiftNumber } from "@/lib/report-shift";
import { JENIS_BARANG_LIST, type JenisBarang } from "@/lib/stok-bahan-baku-shared";

// Re-exported so every existing import of these names from this module
// (server-side code — actions.ts, page.tsx, etc.) keeps working
// unchanged. The actual definitions live in stok-bahan-baku-shared.ts so
// "use client" components can import them without pulling this module's
// `@/lib/db` (mssql/pg) dependency into the browser bundle — see that
// file's header comment.
export type { JenisBarang } from "@/lib/stok-bahan-baku-shared";
export { JENIS_BARANG_LIST, JENIS_BARANG_LABEL, JENIS_BARANG_UNIT_BUNDLE, toBundle } from "@/lib/stok-bahan-baku-shared";

export interface StokBahanBakuRow {
  stokBahanBakuId: number | null; // null when synthesized for a shift with no row yet
  tanggalUsaha: string; // "YYYY-MM-DD"
  shift: ShiftNumber;
  shiftMulai: Date;
  jenisBarang: JenisBarang;
  stokMasukGudang: number;
  stokMasukInventoriOperasional: number;
  stokDipakaiProduksi: number;
  stokRusakProduksi: number;
  operasionalAkunId: number | null;
  operasionalDiisiPada: Date | null;
  produksiAkunId: number | null;
  produksiDiisiPada: Date | null;
  sisaGudangAkhir: number;
  sisaInventoriAkhir: number;
}

export interface CurrentShiftInfo {
  tanggalUsaha: string;
  shift: ShiftNumber;
  shiftLabel: string;
}

export interface SaldoAwalRow {
  jenisBarang: JenisBarang;
  saldoAwalGudang: number;
  saldoAwalInventoriOperasional: number;
}

interface RawRow {
  StokBahanBakuID: number;
  TanggalUsaha: Date;
  Shift: number;
  ShiftMulai: Date;
  JenisBarang: JenisBarang;
  StokMasukGudang: number;
  StokMasukInventoriOperasional: number;
  StokDipakaiProduksi: number;
  StokRusakProduksi: number;
  OperasionalAkunID: number | null;
  OperasionalDiisiPada: Date | null;
  ProduksiAkunID: number | null;
  ProduksiDiisiPada: Date | null;
  SisaGudangAkhir: number;
  SisaInventoriAkhir: number;
}

function mapRow(r: RawRow): StokBahanBakuRow {
  return {
    stokBahanBakuId: Number(r.StokBahanBakuID),
    tanggalUsaha: r.TanggalUsaha.toISOString().slice(0, 10),
    shift: r.Shift as ShiftNumber,
    shiftMulai: r.ShiftMulai,
    jenisBarang: r.JenisBarang,
    stokMasukGudang: r.StokMasukGudang,
    stokMasukInventoriOperasional: r.StokMasukInventoriOperasional,
    stokDipakaiProduksi: r.StokDipakaiProduksi,
    stokRusakProduksi: r.StokRusakProduksi,
    operasionalAkunId: r.OperasionalAkunID,
    operasionalDiisiPada: r.OperasionalDiisiPada,
    produksiAkunId: r.ProduksiAkunID,
    produksiDiisiPada: r.ProduksiDiisiPada,
    sisaGudangAkhir: r.SisaGudangAkhir,
    sisaInventoriAkhir: r.SisaInventoriAkhir,
  };
}

export async function getSaldoAwal(): Promise<SaldoAwalRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT JenisBarang, SaldoAwalGudang, SaldoAwalInventoriOperasional FROM DashboardStokBahanBakuSaldoAwal
  `);
  return (result.recordset as { JenisBarang: JenisBarang; SaldoAwalGudang: number; SaldoAwalInventoriOperasional: number }[]).map((r) => ({
    jenisBarang: r.JenisBarang,
    saldoAwalGudang: r.SaldoAwalGudang,
    saldoAwalInventoriOperasional: r.SaldoAwalInventoriOperasional,
  }));
}

export async function setSaldoAwal(
  jenisBarang: JenisBarang,
  saldoAwalGudang: number,
  saldoAwalInventoriOperasional: number,
  akunId: number
): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("jenisBarang", sql.VarChar(20), jenisBarang)
    .input("saldoAwalGudang", sql.Int, saldoAwalGudang)
    .input("saldoAwalInventoriOperasional", sql.Int, saldoAwalInventoriOperasional)
    .input("akunId", sql.Int, akunId).query(`
      UPDATE DashboardStokBahanBakuSaldoAwal
      SET SaldoAwalGudang = @saldoAwalGudang,
          SaldoAwalInventoriOperasional = @saldoAwalInventoriOperasional,
          DiisiOlehAkunID = @akunId,
          ModifiedDate = GETDATE()
      WHERE JenisBarang = @jenisBarang
    `);
}

// Full shift history (newest first) with running balances computed via a
// window function partitioned per JenisBarang — see this plan's Global
// Constraints on why balances are never stored. `limit` caps how many
// SHIFT ROWS come back per call (not per JenisBarang), matching how the
// desktop table/riwayat views page through it.
export async function getStokBahanBakuHistory(limit = 90): Promise<StokBahanBakuRow[]> {
  const pool = await getPool();
  const result = await pool.request().input("limit", sql.Int, limit).query(`
    SELECT TOP (@limit) *
    FROM (
      SELECT
        s.StokBahanBakuID, s.TanggalUsaha, s.Shift, s.ShiftMulai, s.JenisBarang,
        s.StokMasukGudang, s.StokMasukInventoriOperasional, s.StokDipakaiProduksi, s.StokRusakProduksi,
        s.OperasionalAkunID, s.OperasionalDiisiPada, s.ProduksiAkunID, s.ProduksiDiisiPada,
        sa.SaldoAwalGudang + SUM(s.StokMasukGudang - s.StokMasukInventoriOperasional)
          OVER (PARTITION BY s.JenisBarang ORDER BY s.ShiftMulai ROWS UNBOUNDED PRECEDING) AS SisaGudangAkhir,
        sa.SaldoAwalInventoriOperasional + SUM(s.StokMasukInventoriOperasional - s.StokDipakaiProduksi - s.StokRusakProduksi)
          OVER (PARTITION BY s.JenisBarang ORDER BY s.ShiftMulai ROWS UNBOUNDED PRECEDING) AS SisaInventoriAkhir
      FROM DashboardStokBahanBakuShift s
      JOIN DashboardStokBahanBakuSaldoAwal sa ON sa.JenisBarang = s.JenisBarang
    ) x
    ORDER BY x.ShiftMulai DESC
  `);
  return (result.recordset as RawRow[]).map(mapRow);
}

// Each JenisBarang's single latest running balance over the FULL
// unfiltered history (no TOP N truncation) — unlike getStokBahanBakuHistory,
// whose `limit` caps the combined row count across all 3 JenisBarang, so a
// less-frequently-filled item's true latest row can otherwise fall outside
// a shared display-limited window. Used by getCurrentShiftRows's fallback
// so it never mistakes "pushed out of the display window" for "no history
// at all yet."
export async function getLatestBalancePerJenisBarang(): Promise<
  Map<JenisBarang, { sisaGudangAkhir: number; sisaInventoriAkhir: number }>
> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT JenisBarang, SisaGudangAkhir, SisaInventoriAkhir
    FROM (
      SELECT
        s.JenisBarang,
        sa.SaldoAwalGudang + SUM(s.StokMasukGudang - s.StokMasukInventoriOperasional)
          OVER (PARTITION BY s.JenisBarang ORDER BY s.ShiftMulai ROWS UNBOUNDED PRECEDING) AS SisaGudangAkhir,
        sa.SaldoAwalInventoriOperasional + SUM(s.StokMasukInventoriOperasional - s.StokDipakaiProduksi - s.StokRusakProduksi)
          OVER (PARTITION BY s.JenisBarang ORDER BY s.ShiftMulai ROWS UNBOUNDED PRECEDING) AS SisaInventoriAkhir,
        ROW_NUMBER() OVER (PARTITION BY s.JenisBarang ORDER BY s.ShiftMulai DESC) AS rn
      FROM DashboardStokBahanBakuShift s
      JOIN DashboardStokBahanBakuSaldoAwal sa ON sa.JenisBarang = s.JenisBarang
    ) x
    WHERE rn = 1
  `);
  return new Map(
    (result.recordset as { JenisBarang: JenisBarang; SisaGudangAkhir: number; SisaInventoriAkhir: number }[]).map((r) => [
      r.JenisBarang,
      { sisaGudangAkhir: r.SisaGudangAkhir, sisaInventoriAkhir: r.SisaInventoriAkhir },
    ])
  );
}

// Current work-shift row per JenisBarang — synthesizes a zero-valued row
// (stokBahanBakuId: null) for any JenisBarang with no row yet this shift,
// carrying forward the latest known running balance (or SaldoAwal if this
// JenisBarang has no history at all yet) so the UI always has a sensible
// starting point to display before anyone has typed anything.
export async function getCurrentShiftRows(): Promise<{ current: CurrentShiftInfo; rows: StokBahanBakuRow[] }> {
  const { shift, businessDate } = getReportShift("work");
  const tanggalUsaha = businessDate.toISOString().slice(0, 10);
  const [history, latestBalance, saldoAwal] = await Promise.all([
    getStokBahanBakuHistory(),
    getLatestBalancePerJenisBarang(),
    getSaldoAwal(),
  ]);
  const saldoAwalMap = new Map(saldoAwal.map((s) => [s.jenisBarang, s]));

  const rows: StokBahanBakuRow[] = JENIS_BARANG_LIST.map((jenisBarang) => {
    const existing = history.find((r) => r.tanggalUsaha === tanggalUsaha && r.shift === shift && r.jenisBarang === jenisBarang);
    if (existing) return existing;
    // latestBalance is computed over the FULL unfiltered history (no
    // display-limit truncation), so it never mistakes "pushed out of the
    // limited history window" for "no history at all yet."
    const previous = latestBalance.get(jenisBarang);
    const saldo = saldoAwalMap.get(jenisBarang);
    return {
      stokBahanBakuId: null,
      tanggalUsaha,
      shift,
      shiftMulai: getShiftWindow(businessDate, shift, "work").start,
      jenisBarang,
      stokMasukGudang: 0,
      stokMasukInventoriOperasional: 0,
      stokDipakaiProduksi: 0,
      stokRusakProduksi: 0,
      operasionalAkunId: null,
      operasionalDiisiPada: null,
      produksiAkunId: null,
      produksiDiisiPada: null,
      sisaGudangAkhir: previous?.sisaGudangAkhir ?? saldo?.saldoAwalGudang ?? 0,
      sisaInventoriAkhir: previous?.sisaInventoriAkhir ?? saldo?.saldoAwalInventoriOperasional ?? 0,
    };
  });

  return { current: { tanggalUsaha, shift, shiftLabel: getShiftLabel(shift, "work") }, rows };
}

export interface UpsertOperasionalStokInput {
  tanggalUsaha: string;
  shift: ShiftNumber;
  jenisBarang: JenisBarang;
  stokMasukGudang: number;
  stokMasukInventoriOperasional: number;
  akunId: number;
}

export async function upsertOperasionalStok(input: UpsertOperasionalStokInput): Promise<void> {
  const pool = await getPool();
  const businessDate = new Date(`${input.tanggalUsaha}T00:00:00Z`);
  const shiftMulai = getShiftWindow(businessDate, input.shift, "work").start;
  await pool
    .request()
    .input("tanggalUsaha", sql.Date, input.tanggalUsaha)
    .input("shift", sql.TinyInt, input.shift)
    .input("shiftMulai", sql.DateTime, shiftMulai)
    .input("jenisBarang", sql.VarChar(20), input.jenisBarang)
    .input("stokMasukGudang", sql.Int, input.stokMasukGudang)
    .input("stokMasukInventoriOperasional", sql.Int, input.stokMasukInventoriOperasional)
    .input("akunId", sql.Int, input.akunId).query(`
      MERGE DashboardStokBahanBakuShift AS target
      USING (SELECT @tanggalUsaha AS TanggalUsaha, @shift AS Shift, @jenisBarang AS JenisBarang) AS src
      ON target.TanggalUsaha = src.TanggalUsaha AND target.Shift = src.Shift AND target.JenisBarang = src.JenisBarang
      WHEN MATCHED THEN UPDATE SET
        StokMasukGudang = @stokMasukGudang,
        StokMasukInventoriOperasional = @stokMasukInventoriOperasional,
        OperasionalAkunID = @akunId,
        OperasionalDiisiPada = GETDATE(),
        ModifiedDate = GETDATE()
      WHEN NOT MATCHED THEN INSERT
        (TanggalUsaha, Shift, ShiftMulai, JenisBarang, StokMasukGudang, StokMasukInventoriOperasional, OperasionalAkunID, OperasionalDiisiPada)
        VALUES (@tanggalUsaha, @shift, @shiftMulai, @jenisBarang, @stokMasukGudang, @stokMasukInventoriOperasional, @akunId, GETDATE());
    `);
}

export interface UpsertProduksiStokInput {
  tanggalUsaha: string;
  shift: ShiftNumber;
  jenisBarang: JenisBarang;
  stokDipakaiProduksi: number;
  stokRusakProduksi: number;
  akunId: number;
}

export async function upsertProduksiStok(input: UpsertProduksiStokInput): Promise<void> {
  const pool = await getPool();
  const businessDate = new Date(`${input.tanggalUsaha}T00:00:00Z`);
  const shiftMulai = getShiftWindow(businessDate, input.shift, "work").start;
  await pool
    .request()
    .input("tanggalUsaha", sql.Date, input.tanggalUsaha)
    .input("shift", sql.TinyInt, input.shift)
    .input("shiftMulai", sql.DateTime, shiftMulai)
    .input("jenisBarang", sql.VarChar(20), input.jenisBarang)
    .input("stokDipakaiProduksi", sql.Int, input.stokDipakaiProduksi)
    .input("stokRusakProduksi", sql.Int, input.stokRusakProduksi)
    .input("akunId", sql.Int, input.akunId).query(`
      MERGE DashboardStokBahanBakuShift AS target
      USING (SELECT @tanggalUsaha AS TanggalUsaha, @shift AS Shift, @jenisBarang AS JenisBarang) AS src
      ON target.TanggalUsaha = src.TanggalUsaha AND target.Shift = src.Shift AND target.JenisBarang = src.JenisBarang
      WHEN MATCHED THEN UPDATE SET
        StokDipakaiProduksi = @stokDipakaiProduksi,
        StokRusakProduksi = @stokRusakProduksi,
        ProduksiAkunID = @akunId,
        ProduksiDiisiPada = GETDATE(),
        ModifiedDate = GETDATE()
      WHEN NOT MATCHED THEN INSERT
        (TanggalUsaha, Shift, ShiftMulai, JenisBarang, StokDipakaiProduksi, StokRusakProduksi, ProduksiAkunID, ProduksiDiisiPada)
        VALUES (@tanggalUsaha, @shift, @shiftMulai, @jenisBarang, @stokDipakaiProduksi, @stokRusakProduksi, @akunId, GETDATE());
    `);
}
