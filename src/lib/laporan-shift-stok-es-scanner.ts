import { getReportShift, getPreviousShift } from "@/lib/report-shift";
import { catatSnapshotJikaBelumAda } from "@/lib/queries/laporan-shift-stok-es-snapshot";

// Checked every minute — cheap (getReportShift is pure JS, catatSnapshot...
// short-circuits to a single indexed SELECT when a snapshot already
// exists). Every tick asks "what's the CURRENT shift right now, and has
// the one immediately before it already been snapshotted?" — if not, it
// snapshots it now, using the CURRENT live total as that shift's "final"
// figure. This is deliberately simpler than firing exactly at 07:00/15:00/
// 23:00: checking every minute means a shift's snapshot is captured within
// ~1 minute of it ending (accurate enough — the report's own spec accepts
// "(live, belum final)" while a shift is still running, so this is not a
// business-critical instant), AND it doubles as the startup/downtime
// catch-up mechanism for free — the same tick that would have run at the
// exact boundary still runs on the very next minute after the process
// (re)starts, no separate catch-up code path needed (matches this file's
// sibling scanner.ts, which achieves catch-up purely through its own
// periodic re-check + watermark, not a special first-run branch).
const CHECK_INTERVAL_MS = 60_000;

async function tick(): Promise<void> {
  try {
    const { shift, businessDate } = getReportShift("work");
    const tanggalUsaha = businessDate.toISOString().slice(0, 10);
    const previous = getPreviousShift(tanggalUsaha, shift);
    await catatSnapshotJikaBelumAda(previous.tanggalUsaha, previous.shift);
  } catch (err) {
    // One failed tick (e.g. a transient DB blip) must not crash the
    // interval or stop future ticks — the next tick retries the same
    // check from scratch, same resilience posture as notifications/scanner.ts.
    console.error("Stok Es snapshot scan failed:", err);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __laporanShiftStokEsScannerStarted: boolean | undefined;
}

export function startStokEsSnapshotScanner(): void {
  if (globalThis.__laporanShiftStokEsScannerStarted) return;
  globalThis.__laporanShiftStokEsScannerStarted = true;
  setInterval(tick, CHECK_INTERVAL_MS);
  // Fire once immediately on startup too, rather than waiting a full
  // minute for the first tick — catches a shift that ended while the
  // server was down as soon as it comes back up, not up to 60s later.
  void tick();
}
