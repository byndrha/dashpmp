"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TRUCK_SIDE_ORDER, type TruckSide } from "@/lib/vehicle-check-types";

// A face placed at `rotateY(A) translateZ(r)` faces the viewer once the
// cube's own rotation brings its angle to 0, i.e. when the cube's rotateY
// equals -A. KANAN/KIRI's signs below are the standard CSS-cube convention
// (right face at +90deg, left face at -90deg) — validated interactively in
// this feature's brainstorming session before implementation started.
const SIDE_DEGREES: Record<TruckSide, number> = {
  DEPAN: 0,
  KANAN: 90,
  BELAKANG: 180,
  KIRI: -90,
};

function nearestSide(deg: number): TruckSide {
  const norm = ((deg % 360) + 360) % 360;
  if (norm < 45 || norm >= 315) return "DEPAN";
  if (norm >= 45 && norm < 135) return "KANAN";
  if (norm >= 135 && norm < 225) return "BELAKANG";
  return "KIRI";
}

export function TruckCubeCarousel({
  sides,
  activeSide,
  onActiveSideChange,
}: {
  sides: Record<TruckSide, React.ReactNode>;
  activeSide: TruckSide;
  onActiveSideChange: (side: TruckSide) => void;
}) {
  const [rotY, setRotY] = useState(-SIDE_DEGREES[activeSide]);
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartRot = useRef(0);

  // Recompute rotY (via the shortest path from its current value) whenever
  // the parent changes `activeSide` some other way than a drag on this
  // component itself (e.g. the arrow buttons below).
  useEffect(() => {
    if (dragging) return;
    // Syncing internal rotation from an externally-driven `activeSide`
    // change (e.g. the arrow buttons below), not a value derivable during
    // render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRotY((current) => {
      const base = Math.round(current / 360) * 360;
      return base - SIDE_DEGREES[activeSide];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSide]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    setDragging(true);
    dragStartX.current = e.clientX;
    dragStartRot.current = rotY;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setRotY(dragStartRot.current + (e.clientX - dragStartX.current) * 0.5);
  }

  function handlePointerUp() {
    if (!dragging) return;
    setDragging(false);
    const landed = nearestSide(-rotY);
    const base = Math.round(rotY / 360) * 360;
    setRotY(base - SIDE_DEGREES[landed]);
    onActiveSideChange(landed);
  }

  function step(dir: 1 | -1) {
    const idx = TRUCK_SIDE_ORDER.indexOf(activeSide);
    const next = TRUCK_SIDE_ORDER[(idx + dir + TRUCK_SIDE_ORDER.length) % TRUCK_SIDE_ORDER.length];
    onActiveSideChange(next);
  }

  return (
    <div className="flex w-full items-center justify-center gap-2">
      {/* `relative z-10`: the settled front face is visually pushed toward
          the viewer (translateZ(140px) under perspective(900px), a ~1.18x
          scale-up), which extends its hit-tested box past the 280px face
          width into these buttons' area. Without an explicit higher
          stacking order here, that scaled-up face intercepts clicks meant
          for these buttons — confirmed live via elementFromPoint at the
          button's own screen coordinates resolving to the cube face, not
          the button. */}
      <Button type="button" variant="outline" size="icon" className="relative z-10 shrink-0" onClick={() => step(-1)}>
        <ChevronLeft className="size-4" />
      </Button>
      <div
        className="relative h-[380px] w-full max-w-[280px] select-none"
        style={{ perspective: "900px", touchAction: "pan-y" }}
      >
        <div
          className="relative h-full w-full cursor-grab active:cursor-grabbing"
          style={{
            transformStyle: "preserve-3d",
            transform: `rotateY(${rotY}deg)`,
            transition: dragging ? "none" : "transform 0.2s ease-out",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {TRUCK_SIDE_ORDER.map((side) => (
            <div
              key={side}
              className="absolute inset-0 overflow-y-auto rounded-lg border bg-card"
              style={{
                transform: `rotateY(${SIDE_DEGREES[side]}deg) translateZ(140px)`,
                backfaceVisibility: "hidden",
              }}
            >
              {sides[side]}
            </div>
          ))}
        </div>
      </div>
      <Button type="button" variant="outline" size="icon" className="relative z-10 shrink-0" onClick={() => step(1)}>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
