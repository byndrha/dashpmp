import { getPool } from "@/lib/db";
import { PARTNER_TYPE_CASE } from "@/lib/queries/aging";
import type { PartnerType } from "@/types/dashboard";
import type { PiutangStatus } from "@/lib/queries/aging";

export interface TodayReceivablePayment {
  SalesPaymentID: string;
  TransDate: string;
  Amount: number;
  BusinessPartnerID: string;
  CustomerName: string;
  Wilayah: string;
  Kecamatan: string | null;
  PartnerType: PartnerType;
  AvgQtyPerOrderDay: number | null;
  SisaPiutang: number;
  Status: PiutangStatus;
}

export async function getTodayReceivablePayments(): Promise<TodayReceivablePayment[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    WITH InvoiceBalance AS (
        SELECT si.SalesInvoiceID, si.BusinessPartnerID, si.DueDate,
               (cb.Netto - cb.Paid - cb.Deposit - cb.OtherPayment) AS Outstanding
        FROM (
            SELECT SalesInvoiceID, SUM(Netto) AS Netto, SUM(Deposit) AS Deposit,
                   SUM(Paid) AS Paid, SUM(OtherPayment) AS OtherPayment
            FROM vCustomerStatement
            GROUP BY SalesInvoiceID
        ) cb
        JOIN SalesInvoice si ON si.SalesInvoiceID = cb.SalesInvoiceID
        WHERE si.IsDeleted = 0
    ),
    MitraBalance AS (
        SELECT BusinessPartnerID,
               SUM(CASE WHEN Outstanding > 0 THEN Outstanding ELSE 0 END) AS SisaPiutang,
               MAX(CASE WHEN Outstanding > 0 THEN DATEDIFF(DAY, DueDate, GETDATE()) END) AS MaxDaysOverdue
        FROM InvoiceBalance
        GROUP BY BusinessPartnerID
    ),
    OrderStats AS (
        SELECT so.BusinessPartnerID,
               SUM(sod.Qty) / NULLIF(COUNT(DISTINCT CAST(so.TransDate AS DATE)), 0) AS AvgQtyPerOrderDay
        FROM SalesOrder so
        JOIN SalesOrderDetail sod ON sod.SalesOrderID = so.SalesOrderID
        WHERE so.IsDeleted = 0
        GROUP BY so.BusinessPartnerID
    )
    SELECT
        sp.SalesPaymentID,
        sp.TransDate,
        sp.Amount,
        bp.BusinessPartnerID,
        bp.Name AS CustomerName,
        ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
        bp.NPWPAddress AS Kecamatan,
        ${PARTNER_TYPE_CASE} AS PartnerType,
        os.AvgQtyPerOrderDay,
        ISNULL(mb.SisaPiutang, 0) AS SisaPiutang,
        CASE
            WHEN mb.MaxDaysOverdue IS NULL OR mb.MaxDaysOverdue <= 30 THEN 'Sehat'
            WHEN mb.MaxDaysOverdue <= 60 THEN 'Perhatian'
            ELSE 'Kritis'
        END AS Status
    FROM SalesPayment sp
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = sp.BusinessPartnerID
    LEFT JOIN MitraBalance mb ON mb.BusinessPartnerID = sp.BusinessPartnerID
    LEFT JOIN OrderStats os ON os.BusinessPartnerID = sp.BusinessPartnerID
    WHERE sp.IsDeleted = 0
      AND sp.TransDate >= CAST(GETDATE() AS DATE)
      AND sp.TransDate <  DATEADD(DAY, 1, CAST(GETDATE() AS DATE))
    ORDER BY sp.TransDate DESC
  `);

  return result.recordset;
}
