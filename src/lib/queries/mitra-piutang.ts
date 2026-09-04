import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";

export interface MitraPiutangSummary {
  BusinessPartnerID: string;
  Outstanding: number;
  // Total SalesInvoice.Netto over the trailing 3 calendar months (this month
  // to date + the 2 full months before it) — the denominator for
  // RasioPiutangOmzet below. Distinct from collection-priority.ts's
  // all-time "Omzet" (a sum of SalesPayment.Amount ever received) — this is
  // a recent-revenue figure so the ratio reflects current standing, not a
  // lifetime total.
  Omzet3Bulan: number;
  // Outstanding ÷ Omzet3Bulan — null when Omzet3Bulan is 0 (nothing to
  // divide by, e.g. a brand-new mitra with no invoices yet).
  RasioPiutangOmzet: number | null;
  TerakhirBayarTanggal: string | null;
  TerakhirBayarNominal: number | null;
}

// Lightweight, single-mitra version of the aggregation collection-priority.ts
// runs for EVERY mitra (a ~35-40s report query) — this fetches only the one
// BusinessPartnerID the "Buat Pemesanan" dialog has selected, so it stays
// fast enough to call on-demand as the operator picks a mitra.
export async function getMitraPiutangSummary(businessPartnerId: string): Promise<MitraPiutangSummary> {
  const pool = await getPool();
  const businessToday = getBusinessDate();
  const threeMonthStart = monthBoundary(businessToday, -2);

  const [outstandingResult, omzetResult, lastPaymentResult] = await Promise.all([
    pool
      .request()
      .input("bpId", sql.VarChar(16), businessPartnerId)
      .query(`
        WITH CustomerBalance AS (
            SELECT SalesInvoiceID, SUM(Netto) AS Netto, SUM(Deposit) AS Deposit, SUM(Paid) AS Paid, SUM(OtherPayment) AS OtherPayment
            FROM vCustomerStatement
            GROUP BY SalesInvoiceID
        )
        SELECT ISNULL(SUM(CASE WHEN (cb.Netto - cb.Paid - cb.Deposit - cb.OtherPayment) > 0
                                THEN (cb.Netto - cb.Paid - cb.Deposit - cb.OtherPayment) ELSE 0 END), 0) AS Outstanding
        FROM CustomerBalance cb
        JOIN SalesInvoice si ON si.SalesInvoiceID = cb.SalesInvoiceID
        WHERE si.IsDeleted = 0 AND si.BusinessPartnerID = @bpId
      `),
    pool
      .request()
      .input("bpId", sql.VarChar(16), businessPartnerId)
      .input("threeMonthStart", sql.Date, threeMonthStart)
      .query(`
        SELECT ISNULL(SUM(Netto), 0) AS Omzet3Bulan
        FROM SalesInvoice
        WHERE IsDeleted = 0 AND ISNULL(IsPerforma, 0) = 0
          AND BusinessPartnerID = @bpId AND TransDate >= @threeMonthStart
      `),
    pool
      .request()
      .input("bpId", sql.VarChar(16), businessPartnerId)
      .query(`
        SELECT TOP 1 TransDate, Amount
        FROM SalesPayment
        WHERE IsDeleted = 0 AND BusinessPartnerID = @bpId
        ORDER BY TransDate DESC
      `),
  ]);

  const outstanding = (outstandingResult.recordset[0] as { Outstanding: number }).Outstanding;
  const omzet3Bulan = (omzetResult.recordset[0] as { Omzet3Bulan: number }).Omzet3Bulan;
  const lastPayment = lastPaymentResult.recordset[0] as { TransDate: string | Date; Amount: number } | undefined;

  return {
    BusinessPartnerID: businessPartnerId,
    Outstanding: outstanding,
    Omzet3Bulan: omzet3Bulan,
    RasioPiutangOmzet: omzet3Bulan > 0 ? outstanding / omzet3Bulan : null,
    TerakhirBayarTanggal: lastPayment
      ? typeof lastPayment.TransDate === "string"
        ? lastPayment.TransDate
        : lastPayment.TransDate.toISOString()
      : null,
    TerakhirBayarNominal: lastPayment?.Amount ?? null,
  };
}
