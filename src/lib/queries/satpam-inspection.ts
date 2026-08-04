import { getPool, sql } from "@/lib/db";

export interface SatpamInspectionCard {
  jadwalId: number;
  armadaNama: string;
  vehicleNo: string | null;
  driverName: string | null;
  jamJadwal: string;
  doVoucherNo: string | null;
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
        j.Status,
        (
          SELECT TOP 1 do_.VoucherNo
          FROM DashboardPengirimanJadwalDetail jd
          JOIN DeliveryOrder do_ ON do_.DeliveryOrderID = jd.DeliveryOrderID AND do_.IsDeleted = 0
          WHERE jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
          ORDER BY jd.Urutan
        ) AS DoVoucherNo,
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
    Status: "Draft" | "Terbit";
    DoVoucherNo: string | null;
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
      doVoucherNo: r.DoVoucherNo,
      status: r.Status,
      tipe: "BERANGKAT",
      hasCheck: r.BerangkatCheckID != null,
    });
    if (r.Status === "Terbit" && r.BerangkatCheckID != null) {
      cards.push({
        jadwalId: r.JadwalID,
        armadaNama: r.ArmadaNama,
        vehicleNo: r.VehicleNo,
        driverName: r.DriverName,
        jamJadwal: r.JamJadwal.toISOString(),
        doVoucherNo: r.DoVoucherNo,
        status: r.Status,
        tipe: "DATANG",
        hasCheck: r.DatangCheckID != null,
      });
    }
  }

  return cards.filter((c) => !c.hasCheck);
}
