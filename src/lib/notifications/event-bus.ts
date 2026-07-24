import { EventEmitter } from "events";

// globalThis-guarded singleton — Next.js dev mode (Turbopack HMR) can
// re-evaluate this module multiple times within the same running process;
// without the guard each re-evaluation would create a fresh EventEmitter
// that the SSE route and the scanner would disagree about.
declare global {
  // eslint-disable-next-line no-var
  var __notificationEventBus: EventEmitter | undefined;
}

export const notificationEventBus: EventEmitter = globalThis.__notificationEventBus ?? new EventEmitter();
globalThis.__notificationEventBus = notificationEventBus;

// EventEmitter's default max-listener warning (10) is tuned for typical
// single-purpose emitters — this one gets one listener per open SSE
// connection, i.e. one per logged-in browser tab, which can reasonably
// exceed 10 on a shared dashboard.
notificationEventBus.setMaxListeners(200);

export const NOTIFICATION_EVENT = "notification";
