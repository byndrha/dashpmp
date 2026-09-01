import { getPool, sql } from "@/lib/db";
import type { SatpamShiftType } from "@/lib/satpam-shift";

export const PATROLI_TITIK_LIST: string[] = [
  "Area Produksi Es Balok-A",
  "Area Produksi Es Balok-B",
  "Area Produksi Es Balok-C",
  "Area Produksi Es Kristal-A",
  "Area Produksi Es Kristal-B",
  "Area Produksi Es Kristal-C",
  "Area Cuci Armada Es Kristal",
  "Gudang",
  "Distribusi",
  "Ruang Trafo Kelistrikan",
  "Tempat Parkir Kendaraan Karyawan",
  "Area Parkir Armada Operasional",
  "Area Luar Kantor",
];

export interface PatroliFotoRow {
  fotoId: number;
  sesiId: number;
  titikPatroli: string | null;
  keterangan: string | null;
  fotoPath: string;
  latitude: number | null;
  longitude: number | null;
  waktuFoto: Date;
}

export interface PatroliSesiRow {
  sesiId: number;
  satpamAkunId: number;
  shiftType: SatpamShiftType | null;
  tanggalUsahaShift: Date | null;
  mulaiWaktu: Date;
  selesaiWaktu: Date | null;
}

export interface PatroliSesiDetail extends PatroliSesiRow {
  fotos: PatroliFotoRow[];
}

export interface PatroliSesiRingkas {
  sesiId: number;
  mulaiWaktu: Date;
  selesaiWaktu: Date;
  jumlahFoto: number;
}

interface SesiDbRow {
  SesiID: number;
  SatpamAkunID: number;
  ShiftType: SatpamShiftType | null;
  TanggalUsahaShift: Date | null;
  MulaiWaktu: Date;
  SelesaiWaktu: Date | null;
}

interface FotoDbRow {
  FotoID: number;
  SesiID: number;
  TitikPatroli: string | null;
  Keterangan: string | null;
  FotoPath: string;
  Latitude: number | null;
  Longitude: number | null;
  WaktuFoto: Date;
}

function mapSesiRow(r: SesiDbRow): PatroliSesiRow {
  return {
    sesiId: r.SesiID,
    satpamAkunId: r.SatpamAkunID,
    shiftType: r.ShiftType,
    tanggalUsahaShift: r.TanggalUsahaShift,
    mulaiWaktu: r.MulaiWaktu,
    selesaiWaktu: r.SelesaiWaktu,
  };
}

function mapFotoRow(r: FotoDbRow): PatroliFotoRow {
  return {
    fotoId: r.FotoID,
    sesiId: r.SesiID,
    titikPatroli: r.TitikPatroli,
    keterangan: r.Keterangan,
    fotoPath: r.FotoPath,
    latitude: r.Latitude,
    longitude: r.Longitude,
    waktuFoto: r.WaktuFoto,
  };
}

export async function getActivePatroliSesi(satpamAkunId: number): Promise<PatroliSesiDetail | null> {
  const pool = await getPool();
  const sesiResult = await pool
    .request()
    .input("satpamAkunId", sql.Int, satpamAkunId)
    .query(`
      SELECT TOP 1 SesiID, SatpamAkunID, ShiftType, TanggalUsahaShift, MulaiWaktu, SelesaiWaktu
      FROM DashboardSatpamPatroliSesi
      WHERE SatpamAkunID = @satpamAkunId AND SelesaiWaktu IS NULL AND IsDeleted = 0
      ORDER BY MulaiWaktu DESC
    `);
  const sesiRow = (sesiResult.recordset as SesiDbRow[])[0];
  if (!sesiRow) return null;

  const fotoResult = await pool
    .request()
    .input("sesiId", sql.Int, sesiRow.SesiID)
    .query(`
      SELECT FotoID, SesiID, TitikPatroli, Keterangan, FotoPath, Latitude, Longitude, WaktuFoto
      FROM DashboardSatpamPatroliFoto
      WHERE SesiID = @sesiId AND IsDeleted = 0
      ORDER BY WaktuFoto ASC
    `);

  return {
    ...mapSesiRow(sesiRow),
    fotos: (fotoResult.recordset as FotoDbRow[]).map(mapFotoRow),
  };
}

export async function getPatroliRiwayat(satpamAkunId: number): Promise<PatroliSesiRingkas[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("satpamAkunId", sql.Int, satpamAkunId)
    .query(`
      SELECT s.SesiID, s.MulaiWaktu, s.SelesaiWaktu, COUNT(f.FotoID) AS JumlahFoto
      FROM DashboardSatpamPatroliSesi s
      LEFT JOIN DashboardSatpamPatroliFoto f ON f.SesiID = s.SesiID AND f.IsDeleted = 0
      WHERE s.SatpamAkunID = @satpamAkunId AND s.SelesaiWaktu IS NOT NULL AND s.IsDeleted = 0
      GROUP BY s.SesiID, s.MulaiWaktu, s.SelesaiWaktu
      ORDER BY s.SelesaiWaktu DESC
    `);
  return (result.recordset as (SesiDbRow & { JumlahFoto: number })[]).map((r) => ({
    sesiId: r.SesiID,
    mulaiWaktu: r.MulaiWaktu,
    selesaiWaktu: r.SelesaiWaktu as Date,
    jumlahFoto: r.JumlahFoto,
  }));
}

export async function createPatroliSesi(input: {
  satpamAkunId: number;
  shiftType: SatpamShiftType | null;
  tanggalUsahaShift: Date | null;
}): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("satpamAkunId", sql.Int, input.satpamAkunId)
    .input("shiftType", sql.VarChar(12), input.shiftType)
    .input("tanggalUsahaShift", sql.Date, input.tanggalUsahaShift)
    .query(`
      INSERT INTO DashboardSatpamPatroliSesi (SatpamAkunID, ShiftType, TanggalUsahaShift)
      OUTPUT INSERTED.SesiID
      VALUES (@satpamAkunId, @shiftType, @tanggalUsahaShift)
    `);
  return (result.recordset[0] as { SesiID: number }).SesiID;
}

export async function addPatroliFoto(input: {
  sesiId: number;
  titikPatroli: string | null;
  keterangan: string | null;
  fotoPath: string;
  latitude: number | null;
  longitude: number | null;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("sesiId", sql.Int, input.sesiId)
    .input("titikPatroli", sql.VarChar(50), input.titikPatroli)
    .input("keterangan", sql.VarChar(256), input.keterangan)
    .input("fotoPath", sql.VarChar(256), input.fotoPath)
    .input("latitude", sql.Decimal(10, 7), input.latitude)
    .input("longitude", sql.Decimal(10, 7), input.longitude)
    .query(`
      INSERT INTO DashboardSatpamPatroliFoto (SesiID, TitikPatroli, Keterangan, FotoPath, Latitude, Longitude)
      VALUES (@sesiId, @titikPatroli, @keterangan, @fotoPath, @latitude, @longitude)
    `);
}

export async function selesaiPatroliSesi(sesiId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("sesiId", sql.Int, sesiId)
    .query(`UPDATE DashboardSatpamPatroliSesi SET SelesaiWaktu = GETDATE(), ModifiedDate = GETDATE() WHERE SesiID = @sesiId`);
}
