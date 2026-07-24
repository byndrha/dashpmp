import { auth } from "@/lib/auth";
import { canView } from "@/lib/permissions";
import { notificationEventBus, NOTIFICATION_EVENT } from "@/lib/notifications/event-bus";
import type { NotificationEvent } from "@/lib/queries/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const permissions = session.user.permissions ?? {};

  const encoder = new TextEncoder();
  let listener: ((event: NotificationEvent) => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      listener = (event: NotificationEvent) => {
        if (!canView(permissions, event.TargetModuleKey)) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      notificationEventBus.on(NOTIFICATION_EVENT, listener);
      // A comment-only SSE line (ignored by EventSource's message parser)
      // sent immediately on connect — keeps idle proxies that time out a
      // response with no bytes from closing the connection prematurely,
      // and gives the client an immediate signal the stream is live.
      controller.enqueue(encoder.encode(": connected\n\n"));
      // Recurring comment-only heartbeat — the scanner only emits a real
      // event when a notification exists, so quiet periods can stretch on
      // arbitrarily long. Without a periodic keepalive, a reverse proxy or
      // load balancer's idle-connection timeout (commonly ~60s) would
      // silently kill the connection between events. 15s is shorter than
      // the scanner's own 20s tick and comfortably under typical proxy
      // idle-timeout windows.
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15_000);
    },
    cancel() {
      // Fires when the client disconnects (tab closed, navigated away,
      // EventSource.close()) — without this every past connection's
      // listener would stay registered on the shared emitter forever,
      // and its heartbeat interval would keep firing forever too.
      if (listener) notificationEventBus.off(NOTIFICATION_EVENT, listener);
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
