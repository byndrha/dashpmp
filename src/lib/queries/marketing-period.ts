import { getPool, sql } from "@/lib/db";

export interface MarketingPeriodSetting {
  startDate: string; // "YYYY-MM-DD"
  periodDays: number;
}

// Same single-row-settings convention as pabrik-location.ts: TOP 1 with a
// last-resort fallback if the seeded row is ever somehow missing. Default
// period is the calendar month (matches every other "Bulan Berjalan" panel
// in the app) — customizable from here on via setMarketingPeriodSetting().
const DEFAULT_SETTING: MarketingPeriodSetting = { startDate: "2026-07-01", periodDays: 31 };

export async function getMarketingPeriodSetting(): Promise<MarketingPeriodSetting> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 1 StartDate, PeriodDays FROM DashboardMarketingPeriodSetting ORDER BY ID
  `);
  const row = result.recordset[0] as { StartDate: Date; PeriodDays: number } | undefined;
  if (!row) return DEFAULT_SETTING;
  return { startDate: row.StartDate.toISOString().slice(0, 10), periodDays: row.PeriodDays };
}

export async function setMarketingPeriodSetting(input: {
  startDate: string;
  periodDays: number;
  userId: string;
}): Promise<void> {
  const pool = await getPool();
  const existing = await pool.request().query(`SELECT TOP 1 ID FROM DashboardMarketingPeriodSetting ORDER BY ID`);
  const id = (existing.recordset[0] as { ID: number } | undefined)?.ID;

  const request = pool
    .request()
    .input("startDate", sql.Date, input.startDate)
    .input("periodDays", sql.Int, input.periodDays)
    .input("userId", sql.VarChar(16), input.userId);

  if (id != null) {
    await request
      .input("id", sql.Int, id)
      .query(
        `UPDATE DashboardMarketingPeriodSetting SET StartDate = @startDate, PeriodDays = @periodDays, UpdatedByUserID = @userId, UpdatedAt = GETDATE() WHERE ID = @id`
      );
  } else {
    // Defensive only — the seed migration always inserts row ID=1, so this
    // branch shouldn't run in practice.
    await request.query(
      `INSERT INTO DashboardMarketingPeriodSetting (ID, StartDate, PeriodDays, UpdatedByUserID) VALUES (1, @startDate, @periodDays, @userId)`
    );
  }
}
