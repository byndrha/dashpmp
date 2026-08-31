import { getPool, sql } from "@/lib/db";

// Pass/fail checklist a QC entry records (Kontaminasi/Kemasan were dropped
// entirely -- see the 2026-08-28 revisi spec), a QTY reading that doubles as
// this pemeriksaan's plafon stok (see DashboardProduksiBatch.KualitasID in
// produksi-warehouse.ts), a diameter reading, a free-text note, and one
// evidence photo -- the shared Tanggal/Waktu/Shift/Mesin fields mirror
// Tambah Produksi's own form exactly (same input types, same Shift/Mesin
// conventions), since this is the same "who recorded what, on which
// machine, during which shift" frame as every other produksi-app entry.
export interface KualitasRow {
  KualitasID: number;
  TanggalLabel: string;
  Waktu: string;
  Shift: 1 | 2 | 3;
  MesinID: number;
  MesinNama: string;
  CekKejernihan: boolean;
  CekUkuranBentuk: boolean;
  Qty10KG: number | null;
  DiameterDalamMm: number | null;
  Catatan: string | null;
  FotoPath: string | null;
  FotoBeratKemasanPath: string | null;
  CreatedByUserID: string;
  CreatedDate: string;
  // Qty10KG minus SUM(DashboardProduksiBatch.Qty10KG) already allocated to
  // any pallete under this KualitasID (IsDeleted = 0) -- null when Qty10KG
  // itself is null (no ceiling to compute against, e.g. legacy rows).
  // Never negative (floored at 0) even if over-allocated somehow slipped
  // through before this check existed.
  SisaAlokasi: number | null;
}

// Most recent QC entries across all mesin -- a flat riwayat log, not
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
             k.CekKejernihan, k.CekUkuranBentuk, k.Qty10KG, k.DiameterDalamMm, k.Catatan, k.FotoPath,
             k.FotoBeratKemasanPath, k.CreatedByUserID, k.CreatedDate,
             ISNULL(alok.TotalTeralokasi, 0) AS TotalTeralokasi
      FROM DashboardProduksiKualitas k
      LEFT JOIN DashboardProduksiMesin m ON m.MesinID = k.MesinID
      OUTER APPLY (
        SELECT SUM(b.Qty10KG) AS TotalTeralokasi
        FROM DashboardProduksiBatch b
        WHERE b.KualitasID = k.KualitasID AND b.IsDeleted = 0
      ) alok
      ORDER BY k.CreatedDate DESC
    `);
  return (
    result.recordset as (Omit<KualitasRow, "TanggalLabel" | "CreatedDate" | "SisaAlokasi"> & {
      TanggalLabel: Date;
      CreatedDate: Date;
      TotalTeralokasi: number;
    })[]
  ).map((r) => ({
    ...r,
    TanggalLabel: r.TanggalLabel.toISOString().slice(0, 10),
    CreatedDate: r.CreatedDate.toISOString(),
    SisaAlokasi: r.Qty10KG == null ? null : Math.max(0, r.Qty10KG - r.TotalTeralokasi),
  }));
}

export interface CreateKualitasInput {
  tanggalLabel: string;
  waktu: string;
  shift: 1 | 2 | 3;
  mesinId: number;
  cekKejernihan: boolean;
  cekUkuranBentuk: boolean;
  qty10KG: number;
  diameterDalamMm: number | null;
  catatan: string | null;
  fotoPath: string | null;
  fotoBeratKemasanPath: string | null;
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
    .input("qty10KG", sql.Int, input.qty10KG)
    .input("diameterDalamMm", sql.Decimal(5, 1), input.diameterDalamMm)
    .input("catatan", sql.NVarChar(500), input.catatan)
    .input("fotoPath", sql.VarChar(256), input.fotoPath)
    .input("fotoBeratKemasanPath", sql.VarChar(256), input.fotoBeratKemasanPath)
    .input("userId", sql.VarChar(16), input.dicatatOlehUserId).query(`
      INSERT INTO DashboardProduksiKualitas
        (TanggalLabel, Waktu, Shift, MesinID, CekKejernihan, CekUkuranBentuk, Qty10KG, DiameterDalamMm, Catatan, FotoPath, FotoBeratKemasanPath, CreatedByUserID)
      OUTPUT INSERTED.KualitasID
      VALUES
        (@tanggalLabel, @waktu, @shift, @mesinId, @cekKejernihan, @cekUkuranBentuk, @qty10KG, @diameterDalamMm, @catatan, @fotoPath, @fotoBeratKemasanPath, @userId)
    `);
  return (result.recordset[0] as { KualitasID: number }).KualitasID;
}
