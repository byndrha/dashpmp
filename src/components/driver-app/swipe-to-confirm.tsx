"use client";

import { useRef, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const CONFIRM_THRESHOLD = 0.75;
const HANDLE_SIZE = 40;

// Real drag-to-confirm slider — the reference design's "Geser untuk Tiba"
// button is a slider, not a tap target, so a plain <Button onClick> (the
// original implementation) doesn't match despite the same label. Dragging
// past CONFIRM_THRESHOLD of the track fires onConfirm; releasing short of
// it snaps back to the start.
export function SwipeToConfirm({
  label,
  pendingLabel = "Memproses...",
  pending = false,
  disabled = false,
  onConfirm,
  className,
}: {
  label: string;
  pendingLabel?: string;
  pending?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const maxXRef = useRef(0);

  // Snaps the handle back once a pending confirm resolves with an error —
  // on success the screen navigates away before this matters. Adjusted
  // during render (React's sanctioned pattern for "reset state when a prop
  // changes") rather than in an effect, which would cause an extra
  // cascading render for the same result.
  const [prevPending, setPrevPending] = useState(pending);
  if (pending !== prevPending) {
    setPrevPending(pending);
    if (!pending) setDragX(0);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled || pending) return;
    const track = trackRef.current;
    if (!track) return;
    maxXRef.current = track.clientWidth - HANDLE_SIZE - 8;
    startXRef.current = e.clientX - dragX;
    setDragging(true);
    // Best-effort: some environments (older WebViews, synthetic/automated
    // pointer events) can throw here for a pointerId the browser doesn't
    // recognize as an active pointer — dragging still works via the
    // pointermove/pointerup listeners either way, capture just avoids
    // losing the drag if the finger/cursor leaves the handle's bounds.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const next = Math.min(Math.max(0, e.clientX - startXRef.current), maxXRef.current);
    setDragX(next);
  }

  function handlePointerUp() {
    if (!dragging) return;
    setDragging(false);
    if (maxXRef.current > 0 && dragX / maxXRef.current >= CONFIRM_THRESHOLD) {
      setDragX(maxXRef.current);
      onConfirm();
    } else {
      setDragX(0);
    }
  }

  return (
    <div
      ref={trackRef}
      className={cn(
        "relative h-12 w-full shrink-0 overflow-hidden rounded-full bg-foreground p-1 select-none",
        disabled && "opacity-50",
        className
      )}
    >
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-background">
        {pending ? pendingLabel : label}
      </span>
      <div
        className="relative z-10 flex size-10 touch-none items-center justify-center rounded-full bg-background text-foreground shadow-md"
        style={{ transform: `translateX(${dragX}px)`, transition: dragging ? "none" : "transform 200ms ease-out" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
      </div>
    </div>
  );
}
