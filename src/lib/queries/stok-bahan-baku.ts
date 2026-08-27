import { getPool, sql } from "@/lib/db";
import { getReportShift, getShiftWindow, getShiftLabel, type ShiftNumber } from "@/lib/report-shift";

export type JenisBarang = "Plastik10KG" | "Plastik5KG" | "IkatKabel";

export const JENIS_BARANG_LIST: JenisBarang[] = ["Plastik10KG", "Plastik5KG", "IkatKabel"];

export const JENIS_BARANG_LABEL: Record<JenisBarang, string> = {
  Plastik10KG: "Kantong Plastik 10 KG",
  Plastik5KG: "Kantong Plastik 5 KG",
  IkatKabel: "Ikat Kabel",
};

// 1 unit = 100 lembar/pcs for every JenisBarang — "Bundle" for plastik,
// "Pack" for ikat kabel (same ceil(qty/100) math either way, see toBundle).
export const JENIS_BARANG_UNIT_BUNDLE: Record<JenisBarang, string> = {
  Plastik10KG: "Bundle",
  Plastik5KG: "Bundle",
  IkatKabel: "Pack",
};

// ceil(lembar/100), display-only — never stored. 0 lembar = 0 bundle, 100
// lembar tepat = 1 bundle, 101 = 2.
export function toBundle(lembar: number): number {
  return lembar <= 0 ? 0 : Math.ceil(lembar / 100);
}

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
    stokBahanBakuId: r.StokBahanBakuID,
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

// Current work-shift row per JenisBarang — synthesizes a zero-valued row
// (stokBahanBakuId: null) for any JenisBarang with no row yet this shift,
// carrying forward the latest known running balance (or SaldoAwal if this
// JenisBarang has no history at all yet) so the UI always has a sensible
// starting point to display before anyone has typed anything.
export async function getCurrentShiftRows(): Promise<{ current: CurrentShiftInfo; rows: StokBahanBakuRow[] }> {
  const { shift, businessDate } = getReportShift("work");
  const tanggalUsaha = businessDate.toISOString().slice(0, 10);
  const [history, saldoAwal] = await Promise.all([getStokBahanBakuHistory(), getSaldoAwal()]);
  const saldoAwalMap = new Map(saldoAwal.map((s) => [s.jenisBarang, s]));

  const rows: StokBahanBakuRow[] = JENIS_BARANG_LIST.map((jenisBarang) => {
    const existing = history.find((r) => r.tanggalUsaha === tanggalUsaha && r.shift === shift && r.jenisBarang === jenisBarang);
    if (existing) return existing;
    // history is ORDER BY ShiftMulai DESC — the first match for this
    // jenisBarang is the latest existing shift strictly before this one.
    const previous = history.find((r) => r.jenisBarang === jenisBarang);
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
