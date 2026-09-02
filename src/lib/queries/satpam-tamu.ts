import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";

export interface TamuKunjunganRow {
  kunjunganId: number;
  namaTamu: string;
  asalInstansi: string | null;
  tujuanKunjungan: string;
  dikunjungi: string;
  nomorKendaraan: string | null;
  fotoMasukPath: string;
  fotoMasukLatitude: number | null;
  fotoMasukLongitude: number | null;
  waktuMasuk: Date;
  fotoKeluarPath: string | null;
  fotoKeluarLatitude: number | null;
  fotoKeluarLongitude: number | null;
  waktuKeluar: Date | null;
}

interface TamuDbRow {
  KunjunganID: number;
  NamaTamu: string;
  AsalInstansi: string | null;
  TujuanKunjungan: string;
  Dikunjungi: string;
  NomorKendaraan: string | null;
  FotoMasukPath: string;
  FotoMasukLatitude: number | null;
  FotoMasukLongitude: number | null;
  WaktuMasuk: Date;
  FotoKeluarPath: string | null;
  FotoKeluarLatitude: number | null;
  FotoKeluarLongitude: number | null;
  WaktuKeluar: Date | null;
}

const SELECT_COLUMNS = `
  KunjunganID, NamaTamu, AsalInstansi, TujuanKunjungan, Dikunjungi, NomorKendaraan,
  FotoMasukPath, FotoMasukLatitude, FotoMasukLongitude, WaktuMasuk,
  FotoKeluarPath, FotoKeluarLatitude, FotoKeluarLongitude, WaktuKeluar
`;

function mapTamuRow(r: TamuDbRow): TamuKunjunganRow {
  return {
    kunjunganId: r.KunjunganID,
    namaTamu: r.NamaTamu,
    asalInstansi: r.AsalInstansi,
    tujuanKunjungan: r.TujuanKunjungan,
    dikunjungi: r.Dikunjungi,
    nomorKendaraan: r.NomorKendaraan,
    fotoMasukPath: r.FotoMasukPath,
    fotoMasukLatitude: r.FotoMasukLatitude,
    fotoMasukLongitude: r.FotoMasukLongitude,
    waktuMasuk: r.WaktuMasuk,
    fotoKeluarPath: r.FotoKeluarPath,
    fotoKeluarLatitude: r.FotoKeluarLatitude,
    fotoKeluarLongitude: r.FotoKeluarLongitude,
    waktuKeluar: r.WaktuKeluar,
  };
}

// Shared/tidak dibatasi per-akun satpam -- siapa pun yang login melihat
// baris yang sama, sesuai keputusan desain (serah-terima antar-shift).
export async function getTamuDiDalam(): Promise<TamuKunjunganRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ${SELECT_COLUMNS}
    FROM DashboardSatpamTamu
    WHERE WaktuKeluar IS NULL AND IsDeleted = 0
    ORDER BY WaktuMasuk DESC
  `);
  return (result.recordset as TamuDbRow[]).map(mapTamuRow);
}

export async function getTamuRiwayat(): Promise<TamuKunjunganRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 50 ${SELECT_COLUMNS}
    FROM DashboardSatpamTamu
    WHERE WaktuKeluar IS NOT NULL AND IsDeleted = 0
    ORDER BY WaktuKeluar DESC
  `);
  return (result.recordset as TamuDbRow[]).map(mapTamuRow);
}

export async function getTamuById(kunjunganId: number): Promise<TamuKunjunganRow | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("kunjunganId", sql.Int, kunjunganId)
    .query(`
      SELECT ${SELECT_COLUMNS}
      FROM DashboardSatpamTamu
      WHERE KunjunganID = @kunjunganId AND IsDeleted = 0
    `);
  const row = (result.recordset as TamuDbRow[])[0];
  return row ? mapTamuRow(row) : null;
}

export async function createTamuMasuk(input: {
  namaTamu: string;
  asalInstansi: string | null;
  tujuanKunjungan: string;
  dikunjungi: string;
  nomorKendaraan: string | null;
  fotoMasukPath: string;
  latitude: number | null;
  longitude: number | null;
}): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("namaTamu", sql.VarChar(128), input.namaTamu)
    .input("asalInstansi", sql.VarChar(128), input.asalInstansi)
    .input("tujuanKunjungan", sql.VarChar(256), input.tujuanKunjungan)
    .input("dikunjungi", sql.VarChar(128), input.dikunjungi)
    .input("nomorKendaraan", sql.VarChar(32), input.nomorKendaraan)
    .input("fotoMasukPath", sql.VarChar(256), input.fotoMasukPath)
    .input("latitude", sql.Decimal(10, 7), input.latitude)
    .input("longitude", sql.Decimal(10, 7), input.longitude)
    .query(`
      INSERT INTO DashboardSatpamTamu
        (NamaTamu, AsalInstansi, TujuanKunjungan, Dikunjungi, NomorKendaraan, FotoMasukPath, FotoMasukLatitude, FotoMasukLongitude)
      OUTPUT INSERTED.KunjunganID
      VALUES (@namaTamu, @asalInstansi, @tujuanKunjungan, @dikunjungi, @nomorKendaraan, @fotoMasukPath, @latitude, @longitude)
    `);
  return (result.recordset[0] as { KunjunganID: number }).KunjunganID;
}

// Guard `WaktuKeluar IS NULL` mencegah double-checkout: kalau dua satpam
// menekan "Konfirmasi Keluar" pada tamu yang sama nyaris bersamaan, hanya
// UPDATE pertama yang mengenai baris (rowsAffected[0] === 1); yang kedua
// mendapat 0 baris dan action-nya melempar error jelas -- pola sama seperti
// updateFuelLog di src/lib/queries/driver-fuel.ts.
export async function recordTamuKeluar(
  kunjunganId: number,
  fotoKeluarPath: string,
  latitude: number | null,
  longitude: number | null
): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("kunjunganId", sql.Int, kunjunganId)
    .input("fotoKeluarPath", sql.VarChar(256), fotoKeluarPath)
    .input("latitude", sql.Decimal(10, 7), latitude)
    .input("longitude", sql.Decimal(10, 7), longitude)
    .query(`
      UPDATE DashboardSatpamTamu
      SET FotoKeluarPath = @fotoKeluarPath, FotoKeluarLatitude = @latitude, FotoKeluarLongitude = @longitude,
          WaktuKeluar = GETDATE(), ModifiedDate = GETDATE()
      WHERE KunjunganID = @kunjunganId AND WaktuKeluar IS NULL
    `);
  if (result.rowsAffected[0] === 0) {
    throw new AppError("Tamu ini sudah dicatat keluar sebelumnya.");
  }
}
