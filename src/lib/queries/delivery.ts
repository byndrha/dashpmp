import { getPool, sql } from "@/lib/db";

export interface OpenDelivery {
  DeliveryOrderID: string;
  VoucherNo: string;
  TransDate: string;
  DueDate: string;
  BranchName: string;
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

export async function getOpenDeliveries(branchId?: string): Promise<OpenDelivery[]> {
  const pool = await getPool();
  const request = pool.request();
  if (branchId) request.input("branchId", sql.VarChar(16), branchId);

  // NOTE: DeliveryOrderDetail.Outstanding is NOT reliable (verified against
  // live data — inconsistent with Qty-Delivered, even on closed orders).
  // Remaining quantity is always computed manually as Qty - Delivered.
  const result = await request.query(`
    SELECT
        do.DeliveryOrderID,
        do.VoucherNo,
        do.TransDate,
        do.DueDate,
        b.Name  AS BranchName,
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
    LEFT JOIN Branch b ON b.BranchID = do.BranchID
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = do.BusinessPartnerID
    WHERE do.IsDeleted = 0
      AND do.IsClosed = 0
      ${branchId ? "AND do.BranchID = @branchId" : ""}
    ORDER BY do.TransDate DESC
  `);

  return result.recordset;
}
