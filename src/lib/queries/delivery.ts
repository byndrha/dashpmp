import { getPool, sql } from "@/lib/db";
import { getBusinessDate } from "@/lib/business-date";
import type { DateRangeFilter } from "@/types/dashboard";

export interface WilayahDeliverySummary {
  Wilayah: string;
  Qty10KG: number;
  Qty5KG: number;
  TotalKantong: number;
  TotalKantongHariIni: number;
}

const WILAYAH_EXPR = `ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui')`;

// Kantong count here is a plain 10KG+5KG sum (1 bag = 1 kantong regardless of
// size) — the general "Kantong Terkirim" convention used everywhere else in
// this app (sales-overview.ts, Beranda). The 5KG-counts-as-half-a-kantong
// rule in mitra-do.ts is specific to that panel's DO-vs-Capacity-target math,
// not a general delivery-count convention.
//
// TotalKantongHariIni is always "today" (business date), independent of the
// period `filter` — the panel shows both side by side, and today's number
// would silently disappear whenever the filter's range doesn't include today.
export async function getWilayahDeliverySummary(filter: DateRangeFilter): Promise<WilayahDeliverySummary[]> {
  const pool = await getPool();
  const businessToday = getBusinessDate();

  const [periodResult, todayResult] = await Promise.all([
    pool
      .request()
      .input("startDate", sql.Date, filter.startDate)
      .input("endDate", sql.Date, filter.endDate)
      .query(`
        SELECT
            ${WILAYAH_EXPR} AS Wilayah,
            ISNULL(SUM(CASE WHEN dod.Name LIKE '%5 KG%' THEN 0 ELSE dod.Delivered END), 0) AS Qty10KG,
            ISNULL(SUM(CASE WHEN dod.Name LIKE '%5 KG%' THEN dod.Delivered ELSE 0 END), 0) AS Qty5KG
        FROM DeliveryOrder do_
        JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
        LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = do_.BusinessPartnerID
        WHERE do_.IsDeleted = 0
          AND do_.TransDate >= @startDate AND do_.TransDate < @endDate
        GROUP BY ${WILAYAH_EXPR}
      `),
    pool
      .request()
      .input("businessDate", sql.Date, businessToday)
      .query(`
        SELECT
            ${WILAYAH_EXPR} AS Wilayah,
            ISNULL(SUM(dod.Delivered), 0) AS TotalKantongHariIni
        FROM DeliveryOrder do_
        JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
        LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = do_.BusinessPartnerID
        WHERE do_.IsDeleted = 0
          AND do_.TransDate >= @businessDate AND do_.TransDate < DATEADD(DAY, 1, @businessDate)
        GROUP BY ${WILAYAH_EXPR}
      `),
  ]);

  const byWilayah = new Map<string, { Qty10KG: number; Qty5KG: number; TotalKantongHariIni: number }>();
  for (const r of periodResult.recordset as { Wilayah: string; Qty10KG: number; Qty5KG: number }[]) {
    byWilayah.set(r.Wilayah, { Qty10KG: r.Qty10KG, Qty5KG: r.Qty5KG, TotalKantongHariIni: 0 });
  }
  for (const r of todayResult.recordset as { Wilayah: string; TotalKantongHariIni: number }[]) {
    const entry = byWilayah.get(r.Wilayah);
    if (entry) entry.TotalKantongHariIni = r.TotalKantongHariIni;
    else byWilayah.set(r.Wilayah, { Qty10KG: 0, Qty5KG: 0, TotalKantongHariIni: r.TotalKantongHariIni });
  }

  return [...byWilayah.entries()]
    .map(([Wilayah, v]) => ({ Wilayah, ...v, TotalKantong: v.Qty10KG + v.Qty5KG }))
    .sort((a, b) => b.TotalKantong - a.TotalKantong);
}

export interface OpenDelivery {
  DeliveryOrderID: string;
  VoucherNo: string;
  TransDate: string;
  DueDate: string;
  Wilayah: string;
  CustomerName: string;
  VehicleNo: string;
  IsClosed: boolean;
  IsInvoiced: boolean;
  ItemID: string;
  ItemName: string;
  Qty: number;
  Delivered: number;
  SisaBelumDikirim: number;
}

export async function getOpenDeliveries(wilayah?: string): Promise<OpenDelivery[]> {
  const pool = await getPool();
  const request = pool.request();
  if (wilayah) request.input("wilayah", sql.VarChar(128), wilayah);

  // NOTE: DeliveryOrderDetail.Outstanding is NOT reliable (verified against
  // live data — inconsistent with Qty-Delivered, even on closed orders).
  // Remaining quantity is always computed manually as Qty - Delivered.
  const result = await request.query(`
    SELECT
        do.DeliveryOrderID,
        do.VoucherNo,
        do.TransDate,
        do.DueDate,
        ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
        bp.Name AS CustomerName,
        do.VehicleNo,
        do.IsClosed,
        do.IsInvoiced,
        dod.ItemID,
        dod.Name AS ItemName,
        dod.Qty,
        dod.Delivered,
        (dod.Qty - dod.Delivered) AS SisaBelumDikirim
    FROM DeliveryOrder do
    JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do.DeliveryOrderID
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = do.BusinessPartnerID
    WHERE do.IsDeleted = 0
      AND do.IsClosed = 0
      ${wilayah ? "AND bp.NPWPName = @wilayah" : ""}
    ORDER BY do.TransDate DESC
  `);

  return result.recordset;
}

export interface DriverOption {
  SalesmanID: string;
  Name: string;
}

// Excludes '0127' ("Ambil Sendiri"/TakeAway, see PARTNER_TYPE_CASE in
// aging.ts) — not a real driver, so it must never show up as an
// assignable option.
export async function getDriverOptions(): Promise<DriverOption[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT SalesmanID, Name
    FROM Salesman
    WHERE ISNULL(IsDeleted, 0) = 0
      AND SalesmanID <> '0127'
    ORDER BY Name
  `);
  return result.recordset;
}

export interface DeliveryAssignmentRow {
  DeliveryOrderID: string;
  VoucherNo: string;
  // mssql returns DATETIME columns as real Date instances, which survive
  // Server->Client Component serialization as Date (not auto-stringified) —
  // this is only ever a plain string after a JSON round-trip, never
  // straight off this query's recordset. Format with formatTime()/
  // formatDate() (both already accept `string | Date`), never `.slice(...)`.
  TransDate: string | Date;
  Wilayah: string;
  CustomerName: string;
  SalesmanID: string | null;
  DriverName: string | null;
  VehicleNo: string | null;
}

// One row per DeliveryOrder (not per detail line, unlike getOpenDeliveries)
// for the given business date — this is what the assignment panel lists.
export async function getDeliveryAssignments(businessDate: Date): Promise<DeliveryAssignmentRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessDate", sql.Date, businessDate).query(`
      SELECT
          do.DeliveryOrderID,
          do.VoucherNo,
          do.TransDate,
          ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          bp.Name AS CustomerName,
          do.SalesmanID,
          sm.Name AS DriverName,
          NULLIF(do.VehicleNo, '') AS VehicleNo
      FROM DeliveryOrder do
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = do.BusinessPartnerID
      LEFT JOIN Salesman sm ON sm.SalesmanID = do.SalesmanID
      WHERE do.IsDeleted = 0
        AND do.TransDate >= @businessDate AND do.TransDate < DATEADD(DAY, 1, @businessDate)
      ORDER BY do.TransDate DESC
    `);
  return result.recordset;
}

export async function assignDeliveryDriver(deliveryOrderId: string, salesmanId: string | null): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.VarChar(16), deliveryOrderId)
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .query(`UPDATE DeliveryOrder SET SalesmanID = @salesmanId WHERE DeliveryOrderID = @id`);
}

export async function assignDeliveryVehicle(deliveryOrderId: string, vehicleName: string | null): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.VarChar(16), deliveryOrderId)
    .input("vehicleName", sql.VarChar(50), vehicleName)
    .query(`UPDATE DeliveryOrder SET VehicleNo = @vehicleName WHERE DeliveryOrderID = @id`);
}
