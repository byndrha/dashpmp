"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// 10 minutes, not 1 — a 1-minute refresh across every open dashboard tab
// added enough concurrent load on the (largely unindexed, per past
// findings) ERP tables to risk SQL request timeouts, especially stacked on
// top of the notification scanner's own 20s polling.
const REFRESH_INTERVAL_MS = 600_000;

// Keeps every dashboard page's Server Component data reasonably fresh
// without requiring a manual Pull to Refresh — same soft router.refresh()
// re-fetch PullToRefresh already uses, just on a timer instead of a
// gesture. Paused while the tab isn't visible so a backgrounded tab
// doesn't keep re-fetching (and re-rendering) data nobody's looking at.
export function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [router]);

  return null;
}
