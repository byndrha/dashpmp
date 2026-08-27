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
