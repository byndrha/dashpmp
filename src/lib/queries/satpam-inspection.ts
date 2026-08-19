import { getPool, sql } from "@/lib/db";
import type { VehicleCheckTipe } from "@/lib/vehicle-check-types";
import { JADWAL_KANTONG_10KG_EXPR, JADWAL_KANTONG_5KG_EXPR } from "@/lib/queries/pengiriman-jadwal";

export interface SatpamInspectionCard {
  jadwalId: number;
  armadaNama: string;
  vehicleNo: string | null;
  driverName: string | null;
  jamJadwal: string;
  // Only set for tipe === "DATANG" — JamAktualBerangkat + the OSRM-estimated
  // one-way DurasiMenit, the exact same "Dalam Perjalanan" end-time math the
  // Papan Pengiriman board already uses for its own "Kembali ke Pabrik"
  // marker (see pengiriman-board.tsx). null if either input is missing
  // (shouldn't happen in practice — a DATANG card only exists once Status
  // is already Terbit with a recorded Cek Berangkat, both of which imply
  // JamAktualBerangkat is set; DurasiMenit could still be null for a Jadwal
  // created before that column existed).
  jamEstimasiKedatangan: string | null;
  qty10KG: number;
  qty5KG: number;
  status: "Draft" | "Terbit";
  tipe: "BERANGKAT" | "DATANG";
  // Always false in the array this function returns (see the filter at the
  // bottom) — kept on the type because a future consumer showing an
  // "already inspected today" view would need it; this function's own job
  // is strictly "what still needs a decision".
  hasCheck: boolean;
}

// One row per Jadwal-and-Tipe combination still needing a Satpam decision
// today (businessDate, 14:00 WIB rollover — see ROLLOVER_HOUR in
// business-date.ts). BERANGKAT rows always appear (Draft ones just aren't
// actionable yet); DATANG rows only appear once BERANGKAT is Terbit AND has
// its own recorded check — mirrors the sequential Cek Berangkat -> Cek
// Datang gate already enforced server-side in vehicle-check.ts's
// createVehicleCheck.
export async function getSatpamInspectionList(businessDate: string): Promise<SatpamInspectionCard[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessDate", sql.Date, businessDate).query(`
      SELECT
        j.JadwalID,
        a.Nama AS ArmadaNama,
        ISNULL(ed.VehicleNo, a.Nama) AS VehicleNo,
        sm.Name AS DriverName,
        j.JamJadwal,
        j.JamAktualBerangkat,
        j.DurasiMenit,
        j.Status,
        (
          SELECT ISNULL(${JADWAL_KANTONG_10KG_EXPR}, 0)
          FROM DashboardPengirimanJadwalDetail jd
          JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
          WHERE jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
        ) AS Qty10KG,
        (
          SELECT ISNULL(${JADWAL_KANTONG_5KG_EXPR}, 0)
          FROM DashboardPengirimanJadwalDetail jd
          JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
          WHERE jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
        ) AS Qty5KG,
        vcb.VehicleCheckID AS BerangkatCheckID,
        vcd.VehicleCheckID AS DatangCheckID
      FROM DashboardPengirimanJadwal j
      JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID AND a.IsDeleted = 0
      LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
      LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
      LEFT JOIN DashboardVehicleCheck vcb ON vcb.JadwalID = j.JadwalID AND vcb.Tipe = 'BERANGKAT'
      LEFT JOIN DashboardVehicleCheck vcd ON vcd.JadwalID = j.JadwalID AND vcd.Tipe = 'DATANG'
      WHERE j.IsDeleted = 0
        -- businessDate is a 14:00 WIB rollover label — see ROLLOVER_HOUR in
        -- business-date.ts and the identical window used in
        -- pengiriman-jadwal.ts's getPengirimanBoard.
        AND j.JamJadwal >= DATEADD(HOUR, 7, DATEADD(DAY, -1, CAST(@businessDate AS DATETIME)))
        AND j.JamJadwal < DATEADD(HOUR, 7, CAST(@businessDate AS DATETIME))
      ORDER BY j.JamJadwal
    `);

  const rows = result.recordset as {
    JadwalID: number;
    ArmadaNama: string;
    VehicleNo: string | null;
    DriverName: string | null;
    JamJadwal: Date;
    JamAktualBerangkat: Date | null;
    DurasiMenit: number | null;
    Status: "Draft" | "Terbit";
    Qty10KG: number;
    Qty5KG: number;
    BerangkatCheckID: number | null;
    DatangCheckID: number | null;
  }[];

  const cards: SatpamInspectionCard[] = [];
  for (const r of rows) {
    cards.push({
      jadwalId: r.JadwalID,
      armadaNama: r.ArmadaNama,
      vehicleNo: r.VehicleNo,
      driverName: r.DriverName,
      jamJadwal: r.JamJadwal.toISOString(),
      jamEstimasiKedatangan: null,
      qty10KG: r.Qty10KG,
      qty5KG: r.Qty5KG,
      status: r.Status,
      tipe: "BERANGKAT",
      hasCheck: r.BerangkatCheckID != null,
    });
    if (r.Status === "Terbit" && r.BerangkatCheckID != null) {
      const jamEstimasiKedatangan =
        r.JamAktualBerangkat && r.DurasiMenit != null
          ? new Date(r.JamAktualBerangkat.getTime() + r.DurasiMenit * 60_000).toISOString()
          : null;
      cards.push({
        jadwalId: r.JadwalID,
        armadaNama: r.ArmadaNama,
        vehicleNo: r.VehicleNo,
        driverName: r.DriverName,
        jamJadwal: r.JamJadwal.toISOString(),
        jamEstimasiKedatangan,
        qty10KG: r.Qty10KG,
        qty5KG: r.Qty5KG,
        status: r.Status,
        tipe: "DATANG",
        hasCheck: r.DatangCheckID != null,
      });
    }
  }

  return cards.filter((c) => !c.hasCheck);
}

export interface SatpamTimelineEntry {
  vehicleCheckId: number;
  jadwalId: number;
  tipe: VehicleCheckTipe;
  armadaNama: string;
  vehicleNo: string | null;
  driverName: string | null;
  checkedAt: string;
  odometerKM: number;
}

// Timeline for satpam-app's Beranda, appended below the existing pending
// list (getSatpamInspectionList above, unmodified) — completed check
// events (both BERANGKAT and DATANG, each its own entry since they can be
// hours apart) whose CheckedAt falls in the current business-date window.
// Same 14:00-WIB-rollover window expression as getSatpamInspectionList's
// own JamJadwal filter above, applied to CheckedAt instead.
export async function getSatpamTimeline(businessDateISO: string): Promise<SatpamTimelineEntry[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessDate", sql.Date, businessDateISO).query(`
      SELECT
        vc.VehicleCheckID,
        vc.JadwalID,
        vc.Tipe,
        a.Nama AS ArmadaNama,
        ISNULL(ed.VehicleNo, a.Nama) AS VehicleNo,
        sm.Name AS DriverName,
        vc.CheckedAt,
        vc.OdometerKM
      FROM DashboardVehicleCheck vc
      JOIN DashboardPengirimanJadwal j ON j.JadwalID = vc.JadwalID AND j.IsDeleted = 0
      JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID AND a.IsDeleted = 0
      LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
      LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
      WHERE vc.CheckedAt >= DATEADD(HOUR, 7, DATEADD(DAY, -1, CAST(@businessDate AS DATETIME)))
        AND vc.CheckedAt < DATEADD(HOUR, 7, CAST(@businessDate AS DATETIME))
      ORDER BY vc.CheckedAt DESC
    `);

  const rows = result.recordset as {
    VehicleCheckID: number;
    JadwalID: number;
    Tipe: VehicleCheckTipe;
    ArmadaNama: string;
    VehicleNo: string | null;
    DriverName: string | null;
    CheckedAt: Date;
    OdometerKM: number;
  }[];

  return rows.map((r) => ({
    vehicleCheckId: r.VehicleCheckID,
    jadwalId: r.JadwalID,
    tipe: r.Tipe,
    armadaNama: r.ArmadaNama,
    vehicleNo: r.VehicleNo,
    driverName: r.DriverName,
    checkedAt: r.CheckedAt.toISOString(),
    odometerKM: r.OdometerKM,
  }));
}
