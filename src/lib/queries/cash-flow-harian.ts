import { getPool, sql } from "@/lib/db";
import { KAS_BANK_FILTER } from "@/lib/queries/cash-flow";

export interface CashFlowExpenseItem {
  id: number;
  deskripsi: string;
  nominal: number;
}

export interface CashFlowHarian {
  businessDate: string;
  pendapatanOperasional: number;
  kasDiTangan: number | null;
  pengeluaranKasDiTangan: number | null;
  updatedAt: string | null;
  daftarPengeluaranKas: CashFlowExpenseItem[];
  totalPengeluaranKas: number;
}

function nextDayISO(dateISO: string): string {
  const d = new Date(dateISO);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1))
    .toISOString()
    .slice(0, 10);
}

// Same "Pendapatan Operasional" definition as the period Cash Flow panel
// (getCashFlowDetail in cash-flow.ts) — cash actually received from
// customers (GeneralLedger.Type = 'SALESPAYMENT' on Kas/Bank accounts) —
// just scoped to a single business day instead of the filter's period.
// Kas di Tangan / Pengeluaran Kas di Tangan / Daftar Pengeluaran Kas are
// deliberately NOT derived from the ledger here: this panel exists so staff
// can record the *physical* cash count and expenditures for the day by
// hand, which is the actual point of a manual daily cash reconciliation —
// deriving them from GeneralLedger would just duplicate the automatic
// period panel above it.
export async function getCashFlowHarian(businessDate: string): Promise<CashFlowHarian> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("date", sql.Date, businessDate)
    .input("nextDate", sql.Date, nextDayISO(businessDate))
    .query(`
      SELECT ISNULL(SUM(gl.Debit), 0) AS Total
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_BANK_FILTER}
        AND gl.Type = 'SALESPAYMENT'
        AND gl.TransDate >= @date AND gl.TransDate < @nextDate;

      SELECT KasDiTangan, PengeluaranKasDiTangan, UpdatedAt
      FROM DashboardCashFlowDaily
      WHERE BusinessDate = @date;

      SELECT ID, Deskripsi, Nominal
      FROM DashboardCashFlowExpense
      WHERE BusinessDate = @date
      ORDER BY CreatedAt ASC;
    `);

  const [pendapatanRs, dailyRs, expenseRs] = result.recordsets as unknown as [
    { Total: number }[],
    { KasDiTangan: number; PengeluaranKasDiTangan: number; UpdatedAt: string }[],
    { ID: number; Deskripsi: string; Nominal: number }[],
  ];

  const daily = dailyRs[0];
  const daftarPengeluaranKas = expenseRs.map((r) => ({ id: r.ID, deskripsi: r.Deskripsi, nominal: r.Nominal }));

  return {
    businessDate,
    pendapatanOperasional: pendapatanRs[0]?.Total ?? 0,
    kasDiTangan: daily?.KasDiTangan ?? null,
    pengeluaranKasDiTangan: daily?.PengeluaranKasDiTangan ?? null,
    updatedAt: daily?.UpdatedAt ?? null,
    daftarPengeluaranKas,
    totalPengeluaranKas: daftarPengeluaranKas.reduce((s, r) => s + r.nominal, 0),
  };
}

export async function saveCashFlowDailyFigures(input: {
  businessDate: string;
  kasDiTangan: number;
  pengeluaranKasDiTangan: number;
  userId: string;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("date", sql.Date, input.businessDate)
    .input("kas", sql.Decimal(23, 2), input.kasDiTangan)
    .input("peng", sql.Decimal(23, 2), input.pengeluaranKasDiTangan)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE DashboardCashFlowDaily AS target
      USING (SELECT @date AS BusinessDate) AS src
      ON target.BusinessDate = src.BusinessDate
      WHEN MATCHED THEN
        UPDATE SET KasDiTangan = @kas, PengeluaranKasDiTangan = @peng,
                   UpdatedByUserID = @userId, UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (BusinessDate, KasDiTangan, PengeluaranKasDiTangan, UpdatedByUserID)
        VALUES (@date, @kas, @peng, @userId);
    `);
}

export async function addCashFlowExpense(input: {
  businessDate: string;
  deskripsi: string;
  nominal: number;
  userId: string;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("date", sql.Date, input.businessDate)
    .input("deskripsi", sql.VarChar(256), input.deskripsi)
    .input("nominal", sql.Decimal(23, 2), input.nominal)
    .input("userId", sql.VarChar(16), input.userId).query(`
      INSERT INTO DashboardCashFlowExpense (BusinessDate, Deskripsi, Nominal, CreatedByUserID)
      VALUES (@date, @deskripsi, @nominal, @userId)
    `);
}

export async function deleteCashFlowExpense(id: number): Promise<void> {
  const pool = await getPool();
  await pool.request().input("id", sql.Int, id).query(`DELETE FROM DashboardCashFlowExpense WHERE ID = @id`);
}
