import { getPool, sql } from "@/lib/db";

// 4-item pass/fail checklist a QC entry records, plus 2 numeric readings
// (suhu/berat), a free-text note, and one evidence photo — the shared
// Tanggal/Waktu/Shift/Mesin fields mirror Tambah Produksi's own form
// exactly (same input types, same Shift/Mesin conventions), since this is
// the same "who recorded what, on which machine, during which shift" frame
// as every other produksi-app entry.
export interface KualitasRow {
  KualitasID: number;
  TanggalLabel: string;
  Waktu: string;
  Shift: 1 | 2 | 3;
  MesinID: number;
  MesinNama: string;
  CekKejernihan: boolean;
  CekUkuranBentuk: boolean;
  CekKontaminasi: boolean;
  CekKemasan: boolean;
  SuhuEs: number | null;
  BeratSampel: number | null;
  Catatan: string | null;
  FotoPath: string | null;
  CreatedByUserID: string;
  CreatedDate: string;
}

// Most recent QC entries across all mesin — a flat riwayat log, not
// filtered by business-date period like Kartu Pengiriman (a QC log is
// meant to be browsable further back without a Pengiriman/Riwayat-style
// split; capped instead, same reasoning as
// getSelesaiMuatJadwalForProduksi's own cap in produksi-muatan.ts).
export async function getKualitasRiwayat(limit = 50): Promise<KualitasRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("limit", sql.Int, limit).query(`
      SELECT TOP (@limit) k.KualitasID, k.TanggalLabel, k.Waktu, k.Shift, k.MesinID, m.Nama AS MesinNama,
             k.CekKejernihan, k.CekUkuranBentuk, k.CekKontaminasi, k.CekKemasan,
             k.SuhuEs, k.BeratSampel, k.Catatan, k.FotoPath, k.CreatedByUserID, k.CreatedDate
      FROM DashboardProduksiKualitas k
      LEFT JOIN DashboardProduksiMesin m ON m.MesinID = k.MesinID
      ORDER BY k.CreatedDate DESC
    `);
  return (
    result.recordset as (Omit<KualitasRow, "TanggalLabel" | "CreatedDate"> & { TanggalLabel: Date; CreatedDate: Date })[]
  ).map((r) => ({
    ...r,
    TanggalLabel: r.TanggalLabel.toISOString().slice(0, 10),
    CreatedDate: r.CreatedDate.toISOString(),
  }));
}

export interface CreateKualitasInput {
  tanggalLabel: string;
  waktu: string;
  shift: 1 | 2 | 3;
  mesinId: number;
  cekKejernihan: boolean;
  cekUkuranBentuk: boolean;
  cekKontaminasi: boolean;
  cekKemasan: boolean;
  suhuEs: number | null;
  beratSampel: number | null;
  catatan: string | null;
  fotoPath: string | null;
  dicatatOlehUserId: string;
}

export async function createKualitas(input: CreateKualitasInput): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("tanggalLabel", sql.Date, input.tanggalLabel)
    .input("waktu", sql.VarChar(5), input.waktu)
    .input("shift", sql.TinyInt, input.shift)
    .input("mesinId", sql.Int, input.mesinId)
    .input("cekKejernihan", sql.Bit, input.cekKejernihan)
    .input("cekUkuranBentuk", sql.Bit, input.cekUkuranBentuk)
    .input("cekKontaminasi", sql.Bit, input.cekKontaminasi)
    .input("cekKemasan", sql.Bit, input.cekKemasan)
    .input("suhuEs", sql.Decimal(5, 2), input.suhuEs)
    .input("beratSampel", sql.Decimal(10, 2), input.beratSampel)
    .input("catatan", sql.NVarChar(500), input.catatan)
    .input("fotoPath", sql.VarChar(256), input.fotoPath)
    .input("userId", sql.VarChar(16), input.dicatatOlehUserId).query(`
      INSERT INTO DashboardProduksiKualitas
        (TanggalLabel, Waktu, Shift, MesinID, CekKejernihan, CekUkuranBentuk, CekKontaminasi, CekKemasan, SuhuEs, BeratSampel, Catatan, FotoPath, CreatedByUserID)
      OUTPUT INSERTED.KualitasID
      VALUES
        (@tanggalLabel, @waktu, @shift, @mesinId, @cekKejernihan, @cekUkuranBentuk, @cekKontaminasi, @cekKemasan, @suhuEs, @beratSampel, @catatan, @fotoPath, @userId)
    `);
  return (result.recordset[0] as { KualitasID: number }).KualitasID;
}
