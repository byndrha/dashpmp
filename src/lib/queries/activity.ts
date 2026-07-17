import { getPool } from "@/lib/db";

export interface RecentInvoice {
  SalesInvoiceID: string;
  VoucherNo: string;
  TransDate: string;
  Wilayah: string;
  CustomerName: string;
  Netto: number;
}

export async function getRecentInvoices(limit = 15): Promise<RecentInvoice[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP ${limit}
        si.SalesInvoiceID,
        si.VoucherNo,
        si.TransDate,
        ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
        bp.Name AS CustomerName,
        si.Netto
    FROM SalesInvoice si
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
    WHERE si.IsDeleted = 0
      AND ISNULL(si.IsPerforma, 0) = 0
    ORDER BY si.TransDate DESC
  `);

  return result.recordset;
}

export interface TodayWilayahPulse {
  Wilayah: string;
  NetSales: number;
  InvoiceCount: number;
}

export async function getTodayWilayahPulse(limit = 6): Promise<TodayWilayahPulse[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP ${limit}
        ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
        SUM(si.Netto) AS NetSales,
        COUNT(si.SalesInvoiceID) AS InvoiceCount
    FROM SalesInvoice si
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
    WHERE si.IsDeleted = 0
      AND ISNULL(si.IsPerforma, 0) = 0
      AND si.TransDate >= CAST(GETDATE() AS DATE)
      AND si.TransDate <  DATEADD(DAY, 1, CAST(GETDATE() AS DATE))
    GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui')
    ORDER BY NetSales DESC
  `);

  return result.recordset;
}
