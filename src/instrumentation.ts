// Next.js calls register() exactly once when the server process starts —
// the supported place to kick off a background process, as opposed to
// starting it lazily on first request (which would race multiple
// concurrent first-requests into starting it more than once).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startNotificationScanner } = await import("@/lib/notifications/scanner");
    startNotificationScanner();
  }
}
