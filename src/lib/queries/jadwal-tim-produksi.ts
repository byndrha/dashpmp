import { getPool, sql } from "@/lib/db";
import type { ShiftNumber } from "@/lib/report-shift";

export interface JadwalTimRow {
  tanggalUsaha: string;
  shift: ShiftNumber;
  timId: number;
  timNama: string;
}

// Semua baris jadwal dalam satu bulan kalender (bulan: 1-12) -- dipakai
// kalender bulanan admin di /mkesindo/produksi.
export async function getJadwalBulan(tahun: number, bulan: number): Promise<JadwalTimRow[]> {
  const pool = await getPool();
  const awal = new Date(Date.UTC(tahun, bulan - 1, 1));
  const akhir = new Date(Date.UTC(tahun, bulan, 1));
  const result = await pool
    .request()
    .input("awal", sql.Date, awal)
    .input("akhir", sql.Date, akhir)
    .query(`
      SELECT j.TanggalUsaha, j.Shift, j.TimID, t.Nama AS TimNama
      FROM DashboardJadwalTimProduksi j
      JOIN DashboardTimProduksi t ON t.TimID = j.TimID
      WHERE j.TanggalUsaha >= @awal AND j.TanggalUsaha < @akhir
    `);
  return (result.recordset as { TanggalUsaha: Date; Shift: number; TimID: number; TimNama: string }[]).map((r) => ({
    tanggalUsaha: r.TanggalUsaha.toISOString().slice(0, 10),
    shift: r.Shift as ShiftNumber,
    timId: r.TimID,
    timNama: r.TimNama,
  }));
}

// Dipakai ensureAktivitasRow (aktivitas-produksi.ts) sebagai nilai default
// TimID saat baris shift baru pertama dibuat -- lihat spec Bagian 3.1.
export async function getJadwalUntukShift(tanggalUsaha: string, shift: ShiftNumber): Promise<number | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`SELECT TimID FROM DashboardJadwalTimProduksi WHERE TanggalUsaha = @t AND Shift = @s`);
  const row = result.recordset[0] as { TimID: number } | undefined;
  return row?.TimID ?? null;
}

// UPSERT satu sel kalender -- Supervisor mengubah sel yang sama berkali-kali
// seiring waktu, bukan insert baru tiap kali (lihat spec Bagian 1.3).
export async function setJadwalTim(tanggalUsaha: string, shift: ShiftNumber, timId: number, akunId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .input("timId", sql.Int, timId)
    .input("akunId", sql.Int, akunId)
    .query(`
      MERGE DashboardJadwalTimProduksi AS target
      USING (SELECT @t AS TanggalUsaha, @s AS Shift) AS src
      ON target.TanggalUsaha = src.TanggalUsaha AND target.Shift = src.Shift
      WHEN MATCHED THEN UPDATE SET TimID = @timId, ModifiedDate = GETDATE()
      WHEN NOT MATCHED THEN INSERT (TanggalUsaha, Shift, TimID, CreatedByAkunID) VALUES (@t, @s, @timId, @akunId);
    `);
}
