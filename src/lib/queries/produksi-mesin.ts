import { getPool, sql } from "@/lib/db";
import type { StatusMesin } from "@/lib/produksi-mesin-status";
import { type ShiftNumber } from "@/lib/report-shift";

export type { StatusMesin } from "@/lib/produksi-mesin-status";

export interface MesinRow {
  MesinID: number;
  Nama: string;
  Status: StatusMesin;
  KapasitasProduksiPerHari: number;
  KonsumsiListrikKWh: number;
  LamaProduksiMenit: number;
  LamaPengemasanMenit: number;
}

export async function getMesinList(): Promise<MesinRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT MesinID, Nama, Status, KapasitasProduksiPerHari, KonsumsiListrikKWh, LamaProduksiMenit, LamaPengemasanMenit
    FROM DashboardProduksiMesin
    WHERE IsDeleted = 0
    ORDER BY MesinID
  `);
  return result.recordset;
}

export interface UpdateMesinInput {
  mesinId: number;
  nama: string;
  status: StatusMesin;
  kapasitasProduksiPerHari: number;
  konsumsiListrikKWh: number;
  lamaProduksiMenit: number;
  lamaPengemasanMenit: number;
}

export interface MesinCounterReading {
  jamPanen: string; // "HH:mm" clock-time label, NOT an ISO datetime -- see note below
  qty10KG: number;
}
export interface MesinCounterRow {
  mesinId: number;
  mesinNama: string;
  readings: MesinCounterReading[];
}

// Individual DashboardProduksiBatch rows (one row per "panen"/harvest
// event), NOT aggregated like getQtyRecapForShift's perMesin totals in
// aktivitas-produksi.ts -- this is the timestamped counter list format
// (jam | qty per event) the Laporan Shift design references, TanggalLabel/
// Shift are stored directly on Batch (copied at insert time from Kualitas),
// same lookup basis getQtyRecapForShift already uses.
//
// JamPanen is DashboardProduksiBatch.JamPanen, VARCHAR(5) "HH:mm" (see the
// 2026-08-11 warehouse-ice-stock-redesign plan's "Jam field convention" --
// same pattern as DriverProfile.JamMulaiKerja/JamSelesaiKerja), NOT a SQL
// datetime column -- the mssql driver returns it as a plain string, so it
// is passed straight through with no Date/.toISOString() conversion.
// Nullable at the DB level for batches recorded before this field existed
// (confirmed live: 2 of 34 non-deleted rows), so it's coalesced to "" here
// rather than crashing a downstream formatter expecting a string.
export async function getMesinCounterUntukShift(tanggalUsaha: string, shift: ShiftNumber): Promise<MesinCounterRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("tanggalLabel", sql.Date, tanggalUsaha)
    .input("shift", sql.TinyInt, shift).query(`
      SELECT b.MesinID, m.Nama AS MesinNama, b.JamPanen, b.Qty10KG
      FROM DashboardProduksiBatch b
      JOIN DashboardProduksiMesin m ON m.MesinID = b.MesinID
      WHERE b.IsDeleted = 0 AND b.TanggalLabel = @tanggalLabel AND b.Shift = @shift
      ORDER BY b.MesinID, b.JamPanen
    `);
  const byMesin = new Map<number, MesinCounterRow>();
  for (const r of result.recordset as { MesinID: number; MesinNama: string; JamPanen: string | null; Qty10KG: number }[]) {
    const entry = byMesin.get(r.MesinID) ?? { mesinId: r.MesinID, mesinNama: r.MesinNama, readings: [] };
    entry.readings.push({ jamPanen: r.JamPanen ?? "", qty10KG: r.Qty10KG });
    byMesin.set(r.MesinID, entry);
  }
  return [...byMesin.values()];
}

export async function updateMesin(input: UpdateMesinInput): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("mesinId", sql.Int, input.mesinId)
    .input("nama", sql.VarChar(100), input.nama)
    .input("status", sql.VarChar(20), input.status)
    .input("kapasitas", sql.Int, input.kapasitasProduksiPerHari)
    .input("listrik", sql.Decimal(10, 2), input.konsumsiListrikKWh)
    .input("lamaProduksi", sql.Int, input.lamaProduksiMenit)
    .input("lamaKemas", sql.Int, input.lamaPengemasanMenit)
    .query(`
      UPDATE DashboardProduksiMesin
      SET Nama = @nama, Status = @status, KapasitasProduksiPerHari = @kapasitas, KonsumsiListrikKWh = @listrik,
          LamaProduksiMenit = @lamaProduksi, LamaPengemasanMenit = @lamaKemas, ModifiedDate = GETDATE()
      WHERE MesinID = @mesinId AND IsDeleted = 0
    `);
}
