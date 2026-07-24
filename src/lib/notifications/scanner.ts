import { notificationEventBus, NOTIFICATION_EVENT } from "@/lib/notifications/event-bus";
import {
  getScanState,
  advanceScanState,
  scanPengajuanMitraBaru,
  scanSOBaru,
  scanSITerbayar,
  insertNotification,
  type NotificationType,
  type NewNotificationInput,
} from "@/lib/queries/notifications";

const SCAN_INTERVAL_MS = 20_000;

const SOURCES: { sourceType: NotificationType; scan: (since: Date, until: Date) => Promise<NewNotificationInput[]> }[] = [
  { sourceType: "PengajuanMitraBaru", scan: scanPengajuanMitraBaru },
  { sourceType: "SOBaru", scan: scanSOBaru },
  { sourceType: "SITerbayar", scan: scanSITerbayar },
];

// Guards against overlapping ticks: if a tick takes longer than
// SCAN_INTERVAL_MS to finish (plausible as the scanned tables grow), the
// next setInterval firing is skipped rather than allowed to run
// concurrently. Two ticks running at once would both read the same stale
// watermark (roughly doubling/tripling concurrent DB load) and could race
// on advanceScanState, where last-writer-wins could even move a watermark
// backward if an older/slower tick finishes after a newer one. Skipping
// (rather than queueing) is safe because the next successful tick will
// naturally catch up via its own `since` watermark.
let scanInFlight = false;

async function runScan(): Promise<void> {
  if (scanInFlight) return;
  scanInFlight = true;
  try {
    const until = new Date();
    for (const source of SOURCES) {
      try {
        const since = await getScanState(source.sourceType);
        const candidates = await source.scan(since, until);
        for (const candidate of candidates) {
          const event = await insertNotification(candidate);
          if (event) {
            notificationEventBus.emit(NOTIFICATION_EVENT, event);
          }
        }
        // Advances to `until` (the moment this tick started) regardless of
        // whether any candidates were found — a quiet tick still needs to
        // move the watermark forward, and using `until` rather than "the max
        // timestamp found" means a tick that finds nothing never leaves the
        // watermark stuck in the past.
        await advanceScanState(source.sourceType, until);
      } catch (err) {
        // One source failing (e.g. a transient DB blip) must not stop the
        // others from advancing and must not crash the interval — it just
        // retries from the same watermark on the next tick.
        console.error(`Notification scan failed for ${source.sourceType}:`, err);
      }
    }
  } finally {
    scanInFlight = false;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __notificationScannerStarted: boolean | undefined;
}

// Idempotent — safe to call more than once (instrumentation.ts calls it
// exactly once per server start, but the guard protects against dev-mode
// re-registration too).
export function startNotificationScanner(): void {
  if (globalThis.__notificationScannerStarted) return;
  globalThis.__notificationScannerStarted = true;
  setInterval(runScan, SCAN_INTERVAL_MS);
}
