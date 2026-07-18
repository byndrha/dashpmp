import { getDaysInMonth } from "date-fns";
import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";

export interface RevenueTarget {
  Year: number;
  Month: number;
  DaysInMonth: number;
  CurrentDay: number;
  Today: string;
  RemainingDays: number;

  TargetNominalMonthly: number | null;
  TargetNominalDaily: number | null;
  TargetNominalToDate: number | null;
  RealisasiNominalToDate: number;
  GrowthNominal: number | null;
  GrowthNominalPercent: number | null;
  TargetNominalBesok: number | null;

  TargetQtyMonthly: number | null;
  TargetQtyDaily: number | null;
  TargetQtyToDate: number | null;
  RealisasiQtyToDate: number;
  GrowthQty: number | null;
  GrowthQtyPercent: number | null;
  TargetQtyBesok: number | null;
}

export async function getRevenueTarget(): Promise<RevenueTarget> {
  const pool = await getPool();
  const businessToday = getBusinessDate();
  const year = businessToday.getUTCFullYear();
  const month = businessToday.getUTCMonth() + 1;
  const currentDay = businessToday.getUTCDate();
  const daysInMonth = getDaysInMonth(businessToday);
  const remainingDays = daysInMonth - currentDay;
  const monthStart = monthBoundary(businessToday);

  const [targetResult, realisasiResult] = await Promise.all([
    pool
      .request()
      .input("year", sql.Int, year)
      .input("month", sql.Int, month)
      .query(`SELECT TargetNominal, TargetQty FROM DashboardMonthlyTarget WHERE TargetYear = @year AND TargetMonth = @month`),
    pool
      .request()
      .input("monthStart", sql.Date, monthStart)
      .input("businessDate", sql.Date, businessToday)
      .query(`
        SELECT
            ISNULL(SUM(si.Netto), 0) AS RealisasiNominal,
            ISNULL((SELECT SUM(sid.Qty) FROM SalesInvoiceDetail sid
                    JOIN SalesInvoice si2 ON si2.SalesInvoiceID = sid.SalesInvoiceID
                    WHERE si2.IsDeleted = 0 AND ISNULL(si2.IsPerforma,0) = 0
                      AND si2.TransDate >= @monthStart AND si2.TransDate < DATEADD(DAY, 1, @businessDate)), 0) AS RealisasiQty
        FROM SalesInvoice si
        WHERE si.IsDeleted = 0 AND ISNULL(si.IsPerforma,0) = 0
          AND si.TransDate >= @monthStart AND si.TransDate < DATEADD(DAY, 1, @businessDate)
      `),
  ]);

  const targetRow = targetResult.recordset[0] as { TargetNominal: number; TargetQty: number } | undefined;
  const realisasiRow = realisasiResult.recordset[0] as { RealisasiNominal: number; RealisasiQty: number };

  function compute(targetMonthly: number | null, realisasiToDate: number) {
    if (targetMonthly == null) {
      return {
        targetDaily: null,
        targetToDate: null,
        growth: null,
        growthPercent: null,
        targetBesok: null,
      };
    }
    const targetDaily = targetMonthly / daysInMonth;
    const targetToDate = targetDaily * currentDay;
    const growth = realisasiToDate - targetToDate;
    const growthPercent = targetToDate ? (growth / targetToDate) * 100 : null;
    const targetBesok = remainingDays > 0 ? (targetMonthly - realisasiToDate) / remainingDays : null;
    return { targetDaily, targetToDate, growth, growthPercent, targetBesok };
  }

  const nominal = compute(targetRow?.TargetNominal ?? null, realisasiRow.RealisasiNominal);
  const qty = compute(targetRow?.TargetQty ?? null, realisasiRow.RealisasiQty);

  return {
    Year: year,
    Month: month,
    DaysInMonth: daysInMonth,
    CurrentDay: currentDay,
    Today: businessToday.toISOString().slice(0, 10),
    RemainingDays: remainingDays,

    TargetNominalMonthly: targetRow?.TargetNominal ?? null,
    TargetNominalDaily: nominal.targetDaily,
    TargetNominalToDate: nominal.targetToDate,
    RealisasiNominalToDate: realisasiRow.RealisasiNominal,
    GrowthNominal: nominal.growth,
    GrowthNominalPercent: nominal.growthPercent,
    TargetNominalBesok: nominal.targetBesok,

    TargetQtyMonthly: targetRow?.TargetQty ?? null,
    TargetQtyDaily: qty.targetDaily,
    TargetQtyToDate: qty.targetToDate,
    RealisasiQtyToDate: realisasiRow.RealisasiQty,
    GrowthQty: qty.growth,
    GrowthQtyPercent: qty.growthPercent,
    TargetQtyBesok: qty.targetBesok,
  };
}

export async function setMonthlyTarget(input: {
  year: number;
  month: number;
  targetNominal: number;
  targetQty: number;
  userId: string;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("year", sql.Int, input.year)
    .input("month", sql.Int, input.month)
    .input("targetNominal", sql.Decimal(23, 4), input.targetNominal)
    .input("targetQty", sql.Decimal(23, 4), input.targetQty)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE DashboardMonthlyTarget AS target
      USING (SELECT @year AS TargetYear, @month AS TargetMonth) AS src
      ON target.TargetYear = src.TargetYear AND target.TargetMonth = src.TargetMonth
      WHEN MATCHED THEN
        UPDATE SET TargetNominal = @targetNominal, TargetQty = @targetQty, UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (TargetYear, TargetMonth, TargetNominal, TargetQty, CreatedByUserID)
        VALUES (@year, @month, @targetNominal, @targetQty, @userId);
    `);
}
