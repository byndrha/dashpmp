"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { NotificationEvent, NotificationRow } from "@/lib/queries/notifications";
import { getNotificationsAction, markNotificationReadAction } from "@/app/(dashboard)/notification-actions";

export function NotificationBell() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // The SSE connection is deliberately opened only AFTER the initial
    // fetch resolves and its rows are in state — opening both in parallel
    // (two independent effects) would race: an event arriving while the
    // fetch is still in flight could get overwritten the moment the fetch
    // finally resolves and unconditionally replaces the whole list.
    // Sequencing them removes the race instead of trying to merge around it.
    let cancelled = false;
    let source: EventSource | null = null;

    getNotificationsAction().then((rows) => {
      if (cancelled) return;
      setNotifications(rows);
      source = new EventSource("/api/notifications/stream");
      source.onmessage = (e) => {
        // The ": connected\n\n" keepalive comment never fires onmessage (it
        // has no "data:" line), so every message here is a genuine
        // NotificationEvent — no need to distinguish message types.
        const event = JSON.parse(e.data) as NotificationEvent;
        setNotifications((prev) => {
          if (prev.some((n) => n.NotificationID === event.NotificationID)) return prev;
          return [{ ...event, IsRead: false }, ...prev];
        });
      };
    });

    return () => {
      cancelled = true;
      source?.close();
    };
  }, []);

  const unreadCount = notifications.filter((n) => !n.IsRead).length;

  function handleClick(notification: NotificationRow) {
    setNotifications((prev) =>
      prev.map((n) => (n.NotificationID === notification.NotificationID ? { ...n, IsRead: true } : n))
    );
    markNotificationReadAction(notification.NotificationID);
    setOpen(false);
    router.push(notification.LinkUrl);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon-sm" className="relative" />}>
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <Badge className="absolute -top-1 -right-1 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 gap-0 p-0" align="end">
        <div className="flex max-h-96 flex-col divide-y overflow-y-auto">
          {notifications.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">Tidak ada notifikasi.</p>
          )}
          {notifications.map((n) => (
            <button
              key={n.NotificationID}
              type="button"
              onClick={() => handleClick(n)}
              className={cn(
                "flex flex-col gap-0.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted",
                !n.IsRead && "bg-primary/5"
              )}
            >
              <span className="flex items-center gap-1.5 font-medium">
                {!n.IsRead && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                {n.Title}
              </span>
              <span className="text-xs text-muted-foreground">{n.Message}</span>
              <span className="text-[10px] text-muted-foreground">{formatRelativeTime(n.CreatedAt)}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
