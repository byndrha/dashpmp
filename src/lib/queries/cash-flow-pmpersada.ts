// src/lib/queries/cash-flow-pmpersada.ts
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import type { CashFlowSummary, CashFlowTypeRow } from "@/lib/queries/cash-flow";
import type { DateRangeFilter } from "@/types/dashboard";

const KAS_BANK_FILTER = `coa.IsChildest = 1 AND LEFT(coa.AccountNo,2) IN ('11','12') AND ISNULL(coa.IsDeleted,0) = 0`;
const KAS_DI_TANGAN_FILTER = `coa.IsChildest = 1 AND LEFT(coa.AccountNo,4) = '1101' AND ISNULL(coa.IsDeleted,0) = 0`;

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

interface RawCashFlowResult {
  pendapatan: number;
  kasDiTangan: number;
  pengeluaranKasDiTangan: number;
  pemasukan: { type: string; amount: number }[];
  pengeluaran: { type: string; amount: number }[];
}

async function getCashFlowForLabel(label: CompanyKoneksiLabel, filter: DateRangeFilter): Promise<RawCashFlowResult> {
  const pool = await getCompanyPool("pmpersada", label);
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
      HAVING SUM(gl.Debit) <> 0;

      SELECT gl.Type, ISNULL(SUM(gl.Credit), 0) AS Total
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_BANK_FILTER}
        AND gl.TransDate >= @startDate AND gl.TransDate < @endDate
      GROUP BY gl.Type
      HAVING SUM(gl.Credit) <> 0;
    `);

  const [pendapatanRs, kasDiTanganRs, pengeluaranKasDiTanganRs, pemasukanRs, pengeluaranRs] =
    result.recordsets as unknown as [
      { Total: number }[],
      { Saldo: number }[],
      { Total: number }[],
      { Type: string; Total: number }[],
      { Type: string; Total: number }[],
    ];

  return {
    pendapatan: pendapatanRs[0]?.Total ?? 0,
    kasDiTangan: kasDiTanganRs[0]?.Saldo ?? 0,
    pengeluaranKasDiTangan: pengeluaranKasDiTanganRs[0]?.Total ?? 0,
    pemasukan: pemasukanRs.map((r) => ({ type: r.Type, amount: r.Total })),
    pengeluaran: pengeluaranRs.map((r) => ({ type: r.Type, amount: r.Total })),
  };
}

function mergeTypeRows(a: { type: string; amount: number }[], b: { type: string; amount: number }[]): CashFlowTypeRow[] {
  const map = new Map<string, number>();
  for (const r of [...a, ...b]) map.set(r.type, (map.get(r.type) ?? 0) + r.amount);
  return [...map.entries()]
    .map(([type, amount]) => ({ type, label: typeLabel(type), amount }))
    .sort((x, y) => y.amount - x.amount);
}

export async function getCashFlowPmpersada(filter: DateRangeFilter): Promise<CashFlowSummary> {
  const [utama, logistik] = await Promise.all([
    getCashFlowForLabel("utama", filter),
    getCashFlowForLabel("logistik", filter),
  ]);

  const pemasukan = mergeTypeRows(utama.pemasukan, logistik.pemasukan);
  const pengeluaran = mergeTypeRows(utama.pengeluaran, logistik.pengeluaran);

  return {
    pendapatanOperasional: utama.pendapatan + logistik.pendapatan,
    kasDiTangan: utama.kasDiTangan + logistik.kasDiTangan,
    pengeluaranKasDiTangan: utama.pengeluaranKasDiTangan + logistik.pengeluaranKasDiTangan,
    totalPemasukan: pemasukan.reduce((s, r) => s + r.amount, 0),
    totalPengeluaran: pengeluaran.reduce((s, r) => s + r.amount, 0),
    pemasukan,
    pengeluaran,
  };
}
