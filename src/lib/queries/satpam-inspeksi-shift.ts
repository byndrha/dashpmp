import { getPool, sql } from "@/lib/db";
import { getSatpamShiftWindow, type SatpamShiftType } from "@/lib/satpam-shift";
import { naiveWibToUtcInstant } from "@/lib/business-date";
import { haversineKm, type LatLng } from "@/lib/route-estimate";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";
import { getVehicleChecksForJadwal, type VehicleCheckRow } from "@/lib/queries/vehicle-check";

export interface InspeksiKartuRow {
  jadwalId: number;
  armadaNama: string;
  vehicleNo: string | null;
  driverName: string | null;
  jamAktualBerangkat: string | null; // ISO, true-UTC
  lokasiTerjauh: { wilayah: string; kecamatan: string | null } | null;
  checks: VehicleCheckRow[]; // BERANGKAT/DATANG for this Jadwal, each with its own photos
}

// Farthest-from-pabrik destination per Jadwal, for the card title format
// "[JamAktualBerangkat] - Wilayah, Kecamatan" -- same fresh, lighter mirror
// of estimateTravelMinutesForJadwal's farthest-location half already used by
// laporan-shift-pengiriman.ts's getLokasiTerjauhPerJadwal (that function is
// private there and scoped to a different caller, so this deliberately
// duplicates the small query rather than importing it). "Wilayah"/
// "Kecamatan" are NOT dedicated columns -- they read BusinessPartner's
// NPWPName/NPWPAddress (repurposed fields), same convention.
async function getLokasiTerjauhPerJadwal(
  pool: sql.ConnectionPool,
  jadwalIds: number[]
): Promise<Map<number, { wilayah: string; kecamatan: string | null }>> {
  const result = new Map<number, { wilayah: string; kecamatan: string | null }>();
  if (jadwalIds.length === 0) return result;

  const pabrik = await getPabrikLocation();
  const pabrikLatLng: LatLng = { lat: pabrik.latitude, lng: pabrik.longitude };

  const request = pool.request();
  const placeholders = jadwalIds.map((id, i) => {
    request.input(`jid${i}`, sql.Int, id);
    return `@jid${i}`;
  });
  const stopsResult = await request.query(`
    SELECT jd.JadwalID, ml.Latitude, ml.Longitude,
           ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
           bp.NPWPAddress AS Kecamatan
    FROM DashboardPengirimanJadwalDetail jd
    JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
    JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    LEFT JOIN DashboardMitraLocation ml ON ml.BusinessPartnerID = so.BusinessPartnerID
    WHERE jd.JadwalID IN (${placeholders.join(",")}) AND jd.IsDeleted = 0
  `);
  type StopRow = { JadwalID: number; Latitude: number | null; Longitude: number | null; Wilayah: string; Kecamatan: string | null };
  const byJadwal = new Map<number, (StopRow & { Latitude: number; Longitude: number })[]>();
  for (const row of stopsResult.recordset as StopRow[]) {
    if (row.Latitude == null || row.Longitude == null) continue;
    const list = byJadwal.get(row.JadwalID) ?? [];
    list.push(row as StopRow & { Latitude: number; Longitude: number });
    byJadwal.set(row.JadwalID, list);
  }

  for (const [jadwalId, stops] of byJadwal) {
    let farthest: { wilayah: string; kecamatan: string | null } | null = null;
    let farthestKm = -1;
    for (const stop of stops) {
      const km = haversineKm(pabrikLatLng, { lat: stop.Latitude, lng: stop.Longitude });
      if (km > farthestKm) {
        farthestKm = km;
        farthest = { wilayah: stop.Wilayah, kecamatan: stop.Kecamatan };
      }
    }
    if (farthest) result.set(jadwalId, farthest);
  }
  return result;
}

// Setiap Jadwal yang punya minimal satu DashboardVehicleCheck (BERANGKAT
// dan/atau DATANG) dalam jendela satu shift keamanan -- CheckedAt adalah
// kolom true-UTC (dikonfirmasi lewat vehicle-check-dialog dan komponen lain
// yang memakai formatDate/formatTime biasa, bukan varian *Wib), sedangkan
// getSatpamShiftWindow mengembalikan batas naive-WIB -- harus dikonversi
// dengan naiveWibToUtcInstant dulu sebelum dibandingkan.
export async function getInspeksiUntukShift(tanggalUsaha: Date, shiftType: SatpamShiftType): Promise<InspeksiKartuRow[]> {
  const window = getSatpamShiftWindow(tanggalUsaha, shiftType);
  const start = naiveWibToUtcInstant(window.start);
  const end = naiveWibToUtcInstant(window.end);

  const pool = await getPool();
  const jadwalResult = await pool
    .request()
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end).query(`
      SELECT DISTINCT j.JadwalID, a.Nama AS ArmadaNama, ISNULL(ed.VehicleNo, a.Nama) AS VehicleNo,
             sm.Name AS DriverName, j.JamAktualBerangkat
      FROM DashboardVehicleCheck vc
      JOIN DashboardPengirimanJadwal j ON j.JadwalID = vc.JadwalID AND j.IsDeleted = 0
      JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID AND a.IsDeleted = 0
      LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
      LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
      WHERE vc.CheckedAt >= @start AND vc.CheckedAt < @end
      ORDER BY j.JamAktualBerangkat
    `);
  const jadwalRows = jadwalResult.recordset as {
    JadwalID: number;
    ArmadaNama: string;
    VehicleNo: string | null;
    DriverName: string | null;
    JamAktualBerangkat: Date | null;
  }[];
  if (jadwalRows.length === 0) return [];

  const jadwalIds = jadwalRows.map((r) => r.JadwalID);
  const [lokasiTerjauhMap, checksPerJadwal] = await Promise.all([
    getLokasiTerjauhPerJadwal(pool, jadwalIds),
    Promise.all(jadwalIds.map((id) => getVehicleChecksForJadwal(id))),
  ]);
  const checksByJadwal = new Map<number, VehicleCheckRow[]>(jadwalIds.map((id, i) => [id, checksPerJadwal[i]]));

  return jadwalRows.map((j) => ({
    jadwalId: j.JadwalID,
    armadaNama: j.ArmadaNama,
    vehicleNo: j.VehicleNo,
    driverName: j.DriverName,
    jamAktualBerangkat: j.JamAktualBerangkat ? j.JamAktualBerangkat.toISOString() : null,
    lokasiTerjauh: lokasiTerjauhMap.get(j.JadwalID) ?? null,
    checks: checksByJadwal.get(j.JadwalID) ?? [],
  }));
}
