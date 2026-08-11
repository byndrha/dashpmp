import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import type { CashFlowHarian, CashFlowHarianHistoryRow } from "@/lib/queries/cash-flow-harian";

const KAS_BANK_FILTER = `coa.IsChildest = 1 AND LEFT(coa.AccountNo,2) IN ('11','12') AND ISNULL(coa.IsDeleted,0) = 0`;

function nextDayISO(dateISO: string): string {
  const d = new Date(dateISO);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString().slice(0, 10);
}

// Live GL query, no manual-entry dependency — mirrors cash-flow-pmputra.ts's
// getCashFlowForLabel's identical "Kas+Bank SALESPAYMENT" figure, which
// correctly sums both databases. Unlike PMP_CashFlowDaily/PMP_CashFlowExpense
// below (which only exist in `utama`), this is a real GeneralLedger query
// against both `utama` and `logistik`.
async function getPendapatanOperasionalForLabel(label: CompanyKoneksiLabel, businessDate: string): Promise<number> {
  const pool = await getCompanyPool("pmputra", label);
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
    `);
  const rs = result.recordset as { Total: number }[];
  return rs[0]?.Total ?? 0;
}

export async function getCashFlowHarianHistoryPmputra(limit = 60): Promise<CashFlowHarianHistoryRow[]> {
  const pool = await getCompanyPool("pmputra", "utama");
  const result = await pool.request().input("limit", sql.Int, limit).query(`
    SELECT TOP (@limit)
        d.BusinessDate,
        cf.KasDiTangan,
        cf.PengeluaranKasDiTangan,
        ISNULL(e.TotalPengeluaran, 0) AS TotalPengeluaranKas,
        ISNULL(e.ItemCount, 0) AS ItemCount
    FROM (
        SELECT BusinessDate FROM PMP_CashFlowDaily
        UNION
        SELECT BusinessDate FROM PMP_CashFlowExpense
    ) d
    LEFT JOIN PMP_CashFlowDaily cf ON cf.BusinessDate = d.BusinessDate
    LEFT JOIN (
        SELECT BusinessDate, SUM(Nominal) AS TotalPengeluaran, COUNT(*) AS ItemCount
        FROM PMP_CashFlowExpense
        GROUP BY BusinessDate
    ) e ON e.BusinessDate = d.BusinessDate
    ORDER BY d.BusinessDate DESC
  `);

  return (
    result.recordset as {
      BusinessDate: string;
      KasDiTangan: number | null;
      PengeluaranKasDiTangan: number | null;
      TotalPengeluaranKas: number;
      ItemCount: number;
    }[]
  ).map((r) => ({
    businessDate: new Date(r.BusinessDate).toISOString().slice(0, 10),
    kasDiTangan: r.KasDiTangan,
    pengeluaranKasDiTangan: r.PengeluaranKasDiTangan,
    totalPengeluaranKas: r.TotalPengeluaranKas,
    itemCount: r.ItemCount,
  }));
}

export async function getCashFlowHarianPmputra(businessDate: string): Promise<CashFlowHarian> {
  const pool = await getCompanyPool("pmputra", "utama");
  const [pendapatanUtama, pendapatanLogistik, result] = await Promise.all([
    getPendapatanOperasionalForLabel("utama", businessDate),
    getPendapatanOperasionalForLabel("logistik", businessDate),
    pool
      .request()
      .input("date", sql.Date, businessDate)
      .query(`
      SELECT KasDiTangan, PengeluaranKasDiTangan, UpdatedAt
      FROM PMP_CashFlowDaily
      WHERE BusinessDate = @date;

      SELECT ID, Deskripsi, Nominal
      FROM PMP_CashFlowExpense
      WHERE BusinessDate = @date
      ORDER BY CreatedAt ASC;
    `),
  ]);

  const [dailyRs, expenseRs] = result.recordsets as unknown as [
    { KasDiTangan: number; PengeluaranKasDiTangan: number; UpdatedAt: string }[],
    { ID: number; Deskripsi: string; Nominal: number }[],
  ];

  const daily = dailyRs[0];
  const daftarPengeluaranKas = expenseRs.map((r) => ({ id: r.ID, deskripsi: r.Deskripsi, nominal: r.Nominal }));

  return {
    businessDate,
    pendapatanOperasional: pendapatanUtama + pendapatanLogistik,
    kasDiTangan: daily?.KasDiTangan ?? null,
    pengeluaranKasDiTangan: daily?.PengeluaranKasDiTangan ?? null,
    updatedAt: daily?.UpdatedAt ?? null,
    daftarPengeluaranKas,
    totalPengeluaranKas: daftarPengeluaranKas.reduce((s, r) => s + r.nominal, 0),
  };
}

export async function saveCashFlowDailyFiguresPmputra(input: {
  businessDate: string;
  kasDiTangan: number;
  pengeluaranKasDiTangan: number;
  userId: string;
}): Promise<void> {
  const pool = await getCompanyPool("pmputra", "utama");
  await pool
    .request()
    .input("date", sql.Date, input.businessDate)
    .input("kas", sql.Decimal(23, 2), input.kasDiTangan)
    .input("peng", sql.Decimal(23, 2), input.pengeluaranKasDiTangan)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE PMP_CashFlowDaily AS target
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

export async function addCashFlowExpensePmputra(input: {
  businessDate: string;
  deskripsi: string;
  nominal: number;
  userId: string;
}): Promise<void> {
  const pool = await getCompanyPool("pmputra", "utama");
  await pool
    .request()
    .input("date", sql.Date, input.businessDate)
    .input("deskripsi", sql.VarChar(256), input.deskripsi)
    .input("nominal", sql.Decimal(23, 2), input.nominal)
    .input("userId", sql.VarChar(16), input.userId).query(`
      INSERT INTO PMP_CashFlowExpense (BusinessDate, Deskripsi, Nominal, CreatedByUserID)
      VALUES (@date, @deskripsi, @nominal, @userId)
    `);
}

export async function deleteCashFlowExpensePmputra(id: number): Promise<void> {
  const pool = await getCompanyPool("pmputra", "utama");
  await pool.request().input("id", sql.Int, id).query(`DELETE FROM PMP_CashFlowExpense WHERE ID = @id`);
}
