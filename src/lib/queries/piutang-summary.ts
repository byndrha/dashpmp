import { getPool, sql } from "@/lib/db";
import type { DateRangeFilter } from "@/types/dashboard";

export interface PiutangPeriodSummary {
  SaldoAwalPeriode: number;
  TotalPembayaranPeriode: number;
  TotalPenjualanPeriode: number;
  RatioPiutangOmzetPct: number;
}

// "Periode" here is the filter's date range (defaults to the current month,
// same as every other module). Saldo Awal Periode = outstanding balance
// computed using only invoice/payment activity that happened *before* the
// period started — vCustomerStatement rows carry the invoice's TransDate for
// the invoice-defining row and the payment's own TransDate for payment rows,
// so filtering the whole view by TransDate < @startDate before aggregating
// gives a correct "balance as of that date" snapshot.
export async function getPiutangPeriodSummary(filter: DateRangeFilter): Promise<PiutangPeriodSummary> {
  const pool = await getPool();

  const saldoAwalResult = await pool
    .request()
    .input("cutoff", sql.Date, filter.startDate)
    .query(`
      WITH BalanceAsOf AS (
        SELECT SalesInvoiceID,
               SUM(Netto) AS Netto, SUM(Deposit) AS Deposit,
               SUM(Paid) AS Paid, SUM(OtherPayment) AS OtherPayment
        FROM vCustomerStatement
        WHERE TransDate < @cutoff
        GROUP BY SalesInvoiceID
      )
      SELECT SUM(v.Outstanding) AS SaldoAwal
      FROM (
        SELECT (Netto - Paid - Deposit - OtherPayment) AS Outstanding
        FROM BalanceAsOf
      ) v
      WHERE v.Outstanding > 0
    `);

  const paymentResult = await pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate)
    .query(`
      SELECT ISNULL(SUM(sp.Amount), 0) AS TotalPembayaran
      FROM SalesPayment sp
      WHERE sp.IsDeleted = 0
        AND sp.TransDate >= @startDate
        AND sp.TransDate <  @endDate
    `);

  const salesResult = await pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate)
    .query(`
      SELECT ISNULL(SUM(si.Netto), 0) AS TotalPenjualan
      FROM SalesInvoice si
      WHERE si.IsDeleted = 0
        AND ISNULL(si.IsPerforma, 0) = 0
        AND si.TransDate >= @startDate
        AND si.TransDate <  @endDate
    `);

  const outstandingResult = await pool.request().query(`
    WITH CustomerBalance AS (
      SELECT SalesInvoiceID,
             SUM(Netto) AS Netto, SUM(Deposit) AS Deposit,
             SUM(Paid) AS Paid, SUM(OtherPayment) AS OtherPayment
      FROM vCustomerStatement
      GROUP BY SalesInvoiceID
    )
    SELECT SUM(v.Outstanding) AS TotalOutstanding
    FROM (SELECT (Netto - Paid - Deposit - OtherPayment) AS Outstanding FROM CustomerBalance) v
    WHERE v.Outstanding > 0
  `);

  const saldoAwal = saldoAwalResult.recordset[0]?.SaldoAwal ?? 0;
  const totalPembayaran = paymentResult.recordset[0]?.TotalPembayaran ?? 0;
  const totalPenjualan = salesResult.recordset[0]?.TotalPenjualan ?? 0;
  const totalOutstanding = outstandingResult.recordset[0]?.TotalOutstanding ?? 0;

  return {
    SaldoAwalPeriode: saldoAwal,
    TotalPembayaranPeriode: totalPembayaran,
    TotalPenjualanPeriode: totalPenjualan,
    RatioPiutangOmzetPct: totalPenjualan !== 0 ? (totalOutstanding / totalPenjualan) * 100 : 0,
  };
}
