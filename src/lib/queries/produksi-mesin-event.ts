import { getPool, sql } from "@/lib/db";
import { getNaiveWibNow } from "@/lib/business-date";
import { getShiftWindow, type ShiftNumber } from "@/lib/report-shift";

export type JenisMesinEvent = "On" | "Off";

export interface MesinEventRow {
  eventId: number;
  mesinId: number;
  jenisEvent: JenisMesinEvent;
  waktuEvent: Date; // naive-WIB
  dicatatOlehAkunId: number;
}

export async function catatMesinEvent(mesinId: number, jenisEvent: JenisMesinEvent, akunId: number): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("mesinId", sql.Int, mesinId)
    .input("jenisEvent", sql.VarChar(10), jenisEvent)
    .input("waktuEvent", sql.DateTime, getNaiveWibNow())
    .input("akunId", sql.Int, akunId)
    .query(`
      INSERT INTO DashboardProduksiMesinEvent (MesinID, JenisEvent, WaktuEvent, DicatatOlehAkunID)
      OUTPUT INSERTED.EventID
      VALUES (@mesinId, @jenisEvent, @waktuEvent, @akunId)
    `);
  return (result.recordset[0] as { EventID: number }).EventID;
}

// Events shown on a specific shift's screen — filtered by real-time
// window, not a stored AktivitasID link (a toggle can happen before the
// shift's own DashboardAktivitasProduksiShift row is ever created).
// getShiftWindow returns naive-WIB bounds, matching WaktuEvent's own
// naive-WIB storage (getNaiveWibNow) — no cross-convention conversion
// needed here, unlike the Qty5KG/JamSelesaiMuat query in Task 6.
// Carried-over On/Off state at the exact instant a shift's window starts,
// for every mesin that has ANY event before that instant -- a mesin absent
// from the returned object has no recorded history at all and should be
// treated as "Off" by the caller (nothing to carry over). Deliberately not
// filtered to a mesinId list (this app has a handful of machines; a plain
// per-MesinID correlated MAX avoids an IN-list/table-valued-param dance for
// no real benefit at this scale).
export async function getMesinStateAwalShift(start: Date): Promise<Record<number, JenisMesinEvent>> {
  const pool = await getPool();
  const result = await pool.request().input("start", sql.DateTime, start).query(`
    SELECT e.MesinID, e.JenisEvent
    FROM DashboardProduksiMesinEvent e
    WHERE e.WaktuEvent < @start
      AND e.WaktuEvent = (
        SELECT MAX(e2.WaktuEvent) FROM DashboardProduksiMesinEvent e2 WHERE e2.MesinID = e.MesinID AND e2.WaktuEvent < @start
      )
  `);
  const state: Record<number, JenisMesinEvent> = {};
  for (const r of result.recordset as { MesinID: number; JenisEvent: JenisMesinEvent }[]) {
    state[r.MesinID] = r.JenisEvent;
  }
  return state;
}

export async function getMesinEventsForShift(businessDate: Date, shift: ShiftNumber): Promise<MesinEventRow[]> {
  const pool = await getPool();
  const { start, end } = getShiftWindow(businessDate, shift, "work");
  const result = await pool
    .request()
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end)
    .query(`
      SELECT EventID, MesinID, JenisEvent, WaktuEvent, DicatatOlehAkunID
      FROM DashboardProduksiMesinEvent
      WHERE WaktuEvent BETWEEN @start AND @end
      ORDER BY WaktuEvent ASC
    `);
  return (result.recordset as { EventID: number; MesinID: number; JenisEvent: JenisMesinEvent; WaktuEvent: Date; DicatatOlehAkunID: number }[]).map(
    (r) => ({
      eventId: r.EventID,
      mesinId: r.MesinID,
      jenisEvent: r.JenisEvent,
      waktuEvent: r.WaktuEvent,
      dicatatOlehAkunId: r.DicatatOlehAkunID,
    })
  );
}
