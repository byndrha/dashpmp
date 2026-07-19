import { getPool, sql } from "@/lib/db";
import type { DateRangeFilter } from "@/types/dashboard";

// "Kas + Bank" = the 9 childest accounts under prefix 11 (Kas Besar/Kecil)
// and 12 (Bank/Deposito) — verified live against ChartOfAccount. IsBank is
// set inconsistently across these accounts (true on only 2 of the 7 bank
// accounts), so it isn't a reliable filter; AccountNo prefix is.
export const KAS_BANK_FILTER = `coa.IsChildest = 1 AND LEFT(coa.AccountNo,2) IN ('11','12') AND ISNULL(coa.IsDeleted,0) = 0`;
// "Kas di Tangan" (physical cash on hand) = 1101 Kas Besar + 1102 Kas Kecil
// only, excluding Bank — verified live these are the only two accounts
// under the 1100 "Kas" parent.
const KAS_DI_TANGAN_FILTER = `coa.IsChildest = 1 AND coa.AccountNo IN ('1101','1102') AND ISNULL(coa.IsDeleted,0) = 0`;

export interface CashFlowTypeRow {
  type: string;
  label: string;
  amount: number;
}

export interface CashFlowSummary {
  pendapatanOperasional: number;
  kasDiTangan: number;
  pengeluaranKasDiTangan: number;
  totalPemasukan: number;
  totalPengeluaran: number;
  pemasukan: CashFlowTypeRow[];
  pengeluaran: CashFlowTypeRow[];
}

// Indonesian labels for GeneralLedger.Type — the set actually observed
// touching Kas/Bank accounts. Unmapped types fall back to the raw Type
// string so nothing silently disappears if the ERP records a new one.
const TYPE_LABEL: Record<string, string> = {
  SALESPAYMENT: "Pembayaran dari Pelanggan",
  SALESDEPOSIT: "Uang Muka Penjualan",
  SALESCREDIT: "Kredit Penjualan",
  SALESRETURN: "Retur Penjualan",
  EXPENSE: "Beban Operasional",
  PURCHASEPAYMENT: "Pembayaran ke Supplier",
  VOUCHER: "Voucher / Transfer Lainnya",
};

function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

// A direct-method cash flow snapshot built from literal Kas/Bank account
// movement (AccountNo prefix 11/12) rather than inferred from P&L — this is
// deliberately "money that actually moved through Kas/Bank", not accrual
// revenue/expense recognition.
//
// Verified live (2026-06 sample): SALESPAYMENT is debit-only on these
// accounts (genuine cash received from customers — used as "Pendapatan
// Operasional"), EXPENSE/PURCHASEPAYMENT are credit-only (genuine cash paid
// out). VOUCHER carries both sides and includes internal transfers between
// Kas/Bank accounts (e.g. a Kas Kecil -> Kas Besar movement showed up as a
// matching Debit/Credit pair across the two accounts under the same
// voucher volume) as well as other misc cash vouchers (payroll, owner
// draws, tax, etc. not covered by EXPENSE/PURCHASEPAYMENT) — it's kept as
// its own labeled row in pemasukan/pengeluaran rather than merged into
// "Pengeluaran Kas", so an internal transfer isn't misrepresented as real
// expenditure. Same reasoning as the Balance Sheet's honest footnote: show
// what the ledger actually contains rather than a plug figure.
export async function getCashFlowDetail(filter: DateRangeFilter): Promise<CashFlowSummary> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate)
    .query(`
      SELECT ISNULL(SUM(gl.Debit), 0) AS Total
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_BANK_FILTER}
        AND gl.Type = 'SALESPAYMENT'
        AND gl.TransDate >= @startDate AND gl.TransDate < @endDate;

      SELECT ISNULL(SUM(gl.Debit), 0) - ISNULL(SUM(gl.Credit), 0) AS Saldo
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_DI_TANGAN_FILTER}
        AND gl.TransDate < @endDate;

      SELECT ISNULL(SUM(gl.Credit), 0) AS Total
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_DI_TANGAN_FILTER}
        AND gl.TransDate >= @startDate AND gl.TransDate < @endDate;

      SELECT gl.Type, ISNULL(SUM(gl.Debit), 0) AS Total
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_BANK_FILTER}
        AND gl.TransDate >= @startDate AND gl.TransDate < @endDate
      GROUP BY gl.Type
      HAVING SUM(gl.Debit) <> 0
      ORDER BY SUM(gl.Debit) DESC;

      SELECT gl.Type, ISNULL(SUM(gl.Credit), 0) AS Total
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_BANK_FILTER}
        AND gl.TransDate >= @startDate AND gl.TransDate < @endDate
      GROUP BY gl.Type
      HAVING SUM(gl.Credit) <> 0
      ORDER BY SUM(gl.Credit) DESC;
    `);

  const [pendapatanRs, kasDiTanganRs, pengeluaranKasDiTanganRs, pemasukanRs, pengeluaranRs] =
    result.recordsets as unknown as [
      { Total: number }[],
      { Saldo: number }[],
      { Total: number }[],
      { Type: string; Total: number }[],
      { Type: string; Total: number }[],
    ];

  const pemasukan = pemasukanRs.map((r) => ({ type: r.Type, label: typeLabel(r.Type), amount: r.Total }));
  const pengeluaran = pengeluaranRs.map((r) => ({ type: r.Type, label: typeLabel(r.Type), amount: r.Total }));

  return {
    pendapatanOperasional: pendapatanRs[0]?.Total ?? 0,
    kasDiTangan: kasDiTanganRs[0]?.Saldo ?? 0,
    pengeluaranKasDiTangan: pengeluaranKasDiTanganRs[0]?.Total ?? 0,
    totalPemasukan: pemasukan.reduce((s, r) => s + r.amount, 0),
    totalPengeluaran: pengeluaran.reduce((s, r) => s + r.amount, 0),
    pemasukan,
    pengeluaran,
  };
}
