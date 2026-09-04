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
  // false for any month navigated to via the panel's prev/next buttons that
  // isn't the real current business month — the panel switches to a
  // full-month-realisasi-vs-target display for those (no day progress, no
  // "Target Besok" projection, which naturally becomes null anyway once
  // RemainingDays is 0 — see getRevenueTargetForMonth below).
  IsCurrentMonth: boolean;

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
    IsCurrentMonth: true,

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

// Powers the panel's prev/next month navigation. The current business month
// delegates straight to getRevenueTarget() (zero behavior change to the
// already-shipped day-progress view). Any other month has no "day progress"
// or "besok" concept — it shows full-month realisasi vs the full-month
// target instead, by treating the whole month as its own "to date" window
// (RemainingDays = 0, which the shared besok formula already resolves to
// null, so no extra branching is needed for that field).
export async function getRevenueTargetForMonth(year: number, month: number): Promise<RevenueTarget> {
  const businessToday = getBusinessDate();
  const isCurrentMonth = year === businessToday.getUTCFullYear() && month === businessToday.getUTCMonth() + 1;
  if (isCurrentMonth) {
    return getRevenueTarget();
  }

  const pool = await getPool();
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const [targetResult, realisasiResult] = await Promise.all([
    pool
      .request()
      .input("year", sql.Int, year)
      .input("month", sql.Int, month)
      .query(`SELECT TargetNominal, TargetQty FROM DashboardMonthlyTarget WHERE TargetYear = @year AND TargetMonth = @month`),
    pool
      .request()
      .input("monthStart", sql.Date, monthStart)
      .input("monthEnd", sql.Date, monthEnd)
      .query(`
        SELECT
            ISNULL(SUM(si.Netto), 0) AS RealisasiNominal,
            ISNULL((SELECT SUM(sid.Qty) FROM SalesInvoiceDetail sid
                    JOIN SalesInvoice si2 ON si2.SalesInvoiceID = sid.SalesInvoiceID
                    WHERE si2.IsDeleted = 0 AND ISNULL(si2.IsPerforma,0) = 0
                      AND si2.TransDate >= @monthStart AND si2.TransDate < @monthEnd), 0) AS RealisasiQty
        FROM SalesInvoice si
        WHERE si.IsDeleted = 0 AND ISNULL(si.IsPerforma,0) = 0
          AND si.TransDate >= @monthStart AND si.TransDate < @monthEnd
      `),
  ]);

  const targetRow = targetResult.recordset[0] as { TargetNominal: number; TargetQty: number } | undefined;
  const realisasiRow = realisasiResult.recordset[0] as { RealisasiNominal: number; RealisasiQty: number };

  function compute(targetMonthly: number | null, realisasiFullMonth: number) {
    if (targetMonthly == null) {
      return { targetDaily: null, targetToDate: null, growth: null, growthPercent: null, targetBesok: null };
    }
    const targetDaily = targetMonthly / daysInMonth;
    const targetToDate = targetMonthly; // the full month IS "to date" once it's over
    const growth = realisasiFullMonth - targetToDate;
    const growthPercent = targetToDate ? (growth / targetToDate) * 100 : null;
    return { targetDaily, targetToDate, growth, growthPercent, targetBesok: null };
  }

  const nominal = compute(targetRow?.TargetNominal ?? null, realisasiRow.RealisasiNominal);
  const qty = compute(targetRow?.TargetQty ?? null, realisasiRow.RealisasiQty);

  return {
    Year: year,
    Month: month,
    DaysInMonth: daysInMonth,
    CurrentDay: daysInMonth,
    Today: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
    RemainingDays: 0,
    IsCurrentMonth: false,

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
