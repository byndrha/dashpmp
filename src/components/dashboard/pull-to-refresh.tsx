"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const PULL_THRESHOLD = 70;
const MAX_PULL = 110;

// Wraps the whole dashboard content area so pulling down at the very top of
// any module's page re-fetches its data via router.refresh() — a soft
// re-run of the current route's Server Component data fetching, not a hard
// page reload. Only engages when the page is already scrolled to the top;
// any other drag (mid-scroll, inside a horizontally-scrollable strip, etc.)
// is left alone.
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pullDistance, setPullDistance] = useState(0);
  const [pulling, setPulling] = useState(false);
  const dragRef = useRef<{ startY: number; committed: boolean } | null>(null);

  // While a refresh is in flight, hold the indicator open at the threshold
  // height instead of tracking the (now-released) drag — once isPending
  // flips back to false this just falls through to the real pullDistance,
  // which is already 0, so it collapses with no extra state/effect needed.
  const indicatorHeight = isPending ? PULL_THRESHOLD : pullDistance;

  function handlePointerDown(e: React.PointerEvent) {
    // Touch/pen only — this is a mobile gesture; a mouse-drag trigger would
    // just make desktop text selection near the top of a page feel broken.
    if (e.pointerType === "mouse" || isPending || window.scrollY > 0) return;
    dragRef.current = { startY: e.clientY, committed: false };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || isPending) return;
    const delta = e.clientY - drag.startY;
    if (delta <= 0 || window.scrollY > 0) {
      dragRef.current = null;
      setPulling(false);
      setPullDistance(0);
      return;
    }
    // Once committed, suppress the browser's own drag behavior (text
    // selection on desktop, page scroll/overscroll-reload on touch) so only
    // our indicator responds to the gesture.
    e.preventDefault();
    drag.committed = true;
    setPulling(true);
    // Dampened (not 1:1) so the gesture feels resistive, same convention as
    // native pull-to-refresh implementations.
    setPullDistance(Math.min(MAX_PULL, delta * 0.5));
  }

  function handlePointerEnd() {
    const drag = dragRef.current;
    dragRef.current = null;
    setPulling(false);
    if (drag?.committed && pullDistance >= PULL_THRESHOLD) {
      startTransition(() => router.refresh());
    }
    setPullDistance(0);
  }

  return (
    <div
      className={cn("[overscroll-behavior-y:contain]", pulling && "select-none")}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <div
        className={cn(
          "flex items-center justify-center overflow-hidden",
          !pulling && "transition-[height] duration-200 ease-out"
        )}
        style={{ height: indicatorHeight }}
        aria-hidden={indicatorHeight === 0}
      >
        <RefreshCw
          className={cn("size-5 text-primary", isPending && "animate-spin")}
          style={{
            opacity: Math.min(1, indicatorHeight / PULL_THRESHOLD),
            transform: isPending ? undefined : `rotate(${Math.min(180, (indicatorHeight / PULL_THRESHOLD) * 180)}deg)`,
          }}
        />
      </div>
      {children}
    </div>
  );
}
