import { getPool, sql } from "@/lib/db";
import { getSatpamShiftWindow, type SatpamShiftType } from "@/lib/satpam-shift";
import { naiveWibToUtcInstant } from "@/lib/business-date";
import { getAkunNamaMap } from "@/lib/queries/akun";

// Re-exported for existing server-side consumers (e.g. satpam-app/actions.ts)
// so their import path stays unchanged -- the real definition moved to a
// DB-import-free module so client components can use it directly without
// pulling mssql/tedious/pg into the browser bundle (see that file's comment).
export { PATROLI_TITIK_LIST } from "@/lib/satpam-patroli-titik";

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

export interface PatroliSesiLengkap extends PatroliSesiRow {
  satpamNama: string;
  fotos: PatroliFotoRow[];
}

// Semua sesi patroli (SEMUA satpam, bukan satu akun seperti getPatroliRiwayat
// di atas -- itu untuk riwayat pribadi di aplikasi mobile) yang MulaiWaktu-nya
// jatuh dalam jendela satu shift keamanan. MulaiWaktu adalah kolom true-UTC
// (dikonfirmasi lewat pemakaian formatDate/formatTime biasa, bukan varian
// *Wib, di patroli-panel.tsx) sedangkan getSatpamShiftWindow mengembalikan
// batas naive-WIB -- HARUS dikonversi dengan naiveWibToUtcInstant sebelum
// dibandingkan, kalau tidak akan meleset 7 jam (pola bug yang sama berulang
// kali ditemukan sepanjang sesi ini untuk kolom true-UTC lainnya).
export async function getPatroliUntukShift(tanggalUsaha: Date, shiftType: SatpamShiftType): Promise<PatroliSesiLengkap[]> {
  const window = getSatpamShiftWindow(tanggalUsaha, shiftType);
  const start = naiveWibToUtcInstant(window.start);
  const end = naiveWibToUtcInstant(window.end);

  const pool = await getPool();
  const sesiResult = await pool
    .request()
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end).query(`
      SELECT SesiID, SatpamAkunID, ShiftType, TanggalUsahaShift, MulaiWaktu, SelesaiWaktu
      FROM DashboardSatpamPatroliSesi
      WHERE IsDeleted = 0 AND MulaiWaktu >= @start AND MulaiWaktu < @end
      ORDER BY MulaiWaktu
    `);
  const sesiRows = sesiResult.recordset as SesiDbRow[];
  if (sesiRows.length === 0) return [];

  const sesiIds = sesiRows.map((r) => r.SesiID);
  const fotoRequest = pool.request();
  const fotoPlaceholders = sesiIds.map((id, i) => {
    fotoRequest.input(`sid${i}`, sql.Int, id);
    return `@sid${i}`;
  });
  const fotoResult = await fotoRequest.query(`
    SELECT FotoID, SesiID, TitikPatroli, Keterangan, FotoPath, Latitude, Longitude, WaktuFoto
    FROM DashboardSatpamPatroliFoto
    WHERE SesiID IN (${fotoPlaceholders.join(",")}) AND IsDeleted = 0
    ORDER BY WaktuFoto ASC
  `);
  const fotosBySesi = new Map<number, PatroliFotoRow[]>();
  for (const r of fotoResult.recordset as FotoDbRow[]) {
    const list = fotosBySesi.get(r.SesiID) ?? [];
    list.push(mapFotoRow(r));
    fotosBySesi.set(r.SesiID, list);
  }

  const nameMap = await getAkunNamaMap(sesiRows.map((r) => r.SatpamAkunID));
  return sesiRows.map((r) => ({
    ...mapSesiRow(r),
    satpamNama: nameMap.get(r.SatpamAkunID) ?? "Akun tidak ditemukan",
    fotos: fotosBySesi.get(r.SesiID) ?? [],
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
