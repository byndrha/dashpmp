"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Fuel, Siren, Phone, MapPin } from "lucide-react";
import { formatKemasanQty } from "@/lib/format";
import { SwipeToConfirm } from "@/components/driver-app/swipe-to-confirm";
import { PengirimanMap } from "./pengiriman-map";
import { BbmDialog } from "./bbm-dialog";
import { KendalaDialog } from "./kendala-dialog";
import { CallChoiceDialog } from "./call-choice-dialog";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";
import type { BbmContext } from "@/components/driver-app/stop-flow";
import { getMultiPointRoute, type MultiPointRoute } from "@/lib/osrm";
import { recordStopArrivalAction } from "@/app/mkesindo/driver-app/actions";

// Expanded sheet height as a fraction of the viewport — recomputed on
// resize; DEFAULT_EXPANDED_HEIGHT is just the value used for the one frame
// before the resize effect's first run measures the real viewport.
const EXPANDED_HEIGHT_RATIO = 0.75;
const DEFAULT_EXPANDED_HEIGHT = 500;

export function PengirimanStep({
  jadwalId,
  armadaNama,
  vehicleNo,
  bbmContext,
  activeStop,
  remainingStops,
  pabrik,
  driverName,
  onArrived,
}: {
  jadwalId: number;
  armadaNama: string;
  vehicleNo: string | null;
  bbmContext: BbmContext;
  activeStop: DriverStopRow;
  // Every currently-incomplete stop for this Jadwal, in delivery order —
  // activeStop is remainingStops[0]. Drives both the map's numbered
  // markers and the destination list, so there's one source of truth for
  // "how many locations are left" instead of a separately passed count
  // that can drift from the actual list.
  remainingStops: DriverStopRow[];
  pabrik: { lat: number; lng: number };
  driverName: string;
  onArrived: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [bbmOpen, setBbmOpen] = useState(false);
  const [kendalaOpen, setKendalaOpen] = useState(false);
  const [kendalaReported, setKendalaReported] = useState(false);
  const [callOpen, setCallOpen] = useState(false);

  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [route, setRoute] = useState<MultiPointRoute | null>(null);

  // --- Bottom sheet: real drag-to-expand/collapse, replacing the old tap
  // button. collapsedContentRef measures the TRUE collapsed height (handle
  // + info text + swipe row + any error line) via ResizeObserver, since
  // those pieces resize dynamically (error appearing, etc.) — the
  // destination list below gets whatever height remains via flex-1.
  const collapsedContentRef = useRef<HTMLDivElement>(null);
  const [collapsedHeight, setCollapsedHeight] = useState(0);
  const [expandedHeight, setExpandedHeight] = useState(DEFAULT_EXPANDED_HEIGHT);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(0);

  useEffect(() => {
    function updateExpandedHeight() {
      setExpandedHeight(window.innerHeight * EXPANDED_HEIGHT_RATIO);
    }
    updateExpandedHeight();
    window.addEventListener("resize", updateExpandedHeight);
    return () => window.removeEventListener("resize", updateExpandedHeight);
  }, []);

  useEffect(() => {
    const el = collapsedContentRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height) setCollapsedHeight(height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Drag handlers attach only to the handle+info block below (not the
  // swipe-to-arrive slider or call button, which need their own untouched
  // gestures) — dragging anywhere on that block resizes the sheet live;
  // releasing snaps to whichever of collapsed/expanded is closer.
  function handleSheetPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragStartYRef.current = e.clientY;
    dragStartHeightRef.current = expanded ? expandedHeight : collapsedHeight;
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  }
  function handleSheetPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const delta = dragStartYRef.current - e.clientY;
    const next = Math.min(Math.max(dragStartHeightRef.current + delta, collapsedHeight), expandedHeight);
    setDragHeight(next);
  }
  function handleSheetPointerUp() {
    if (!dragging) return;
    setDragging(false);
    const current = dragHeight ?? (expanded ? expandedHeight : collapsedHeight);
    const midpoint = (collapsedHeight + expandedHeight) / 2;
    setExpanded(current >= midpoint);
    setDragHeight(null);
  }

  const sheetHeight = dragging && dragHeight != null ? dragHeight : expanded ? expandedHeight : collapsedHeight;

  // Continuous live tracking (not a poll interval) so the map's truck icon
  // and the distances below follow GPS movement as closely as the
  // browser/OS reports it.
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 15_000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const validStops = useMemo(
    () => remainingStops.filter((s): s is DriverStopRow & { Latitude: number; Longitude: number } => s.Latitude != null && s.Longitude != null),
    [remainingStops]
  );
  const validStopIdsKey = validStops.map((s) => s.JadwalDetailID).join(",");

  // One shared route: ETA to the active stop, cumulative distance for every
  // remaining stop below, AND the map's polyline all come from this single
  // OSRM call (position/pabrik -> stop1 -> stop2 -> ...) instead of each
  // fetching their own copy.
  useEffect(() => {
    if (validStops.length === 0) return;
    let cancelled = false;
    const originPoint = position ?? pabrik;
    getMultiPointRoute([originPoint, ...validStops.map((s) => ({ lat: s.Latitude, lng: s.Longitude }))])
      .then((r) => {
        if (!cancelled) setRoute(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.lat, position?.lng, pabrik.lat, pabrik.lng, validStopIdsKey]);

  // Derived, not effect-driven: a stale `route` from a previous set of
  // stops is harmless to leave in state (the fetch above will overwrite it
  // once there are valid stops again) — it just must not be treated as
  // current when there's nothing left to route to.
  const effectiveRoute = validStops.length === 0 ? null : route;
  const etaMinutes = effectiveRoute?.legs[0]?.durationMinutes ?? null;

  // Cumulative km from the current position up to each stop (route.legs[i]
  // is the distance from waypoint i to i+1, so summing legs[0..i] gives the
  // total remaining distance to reach the (i+1)-th waypoint).
  const distanceByDetailId = useMemo(() => {
    const map = new Map<number, number>();
    if (!effectiveRoute) return map;
    let cumulative = 0;
    validStops.forEach((s, i) => {
      cumulative += effectiveRoute.legs[i]?.distanceKm ?? 0;
      map.set(s.JadwalDetailID, cumulative);
    });
    return map;
  }, [effectiveRoute, validStops]);

  function handleArrived() {
    setError(null);
    startTransition(async () => {
      const result = await recordStopArrivalAction(activeStop.JadwalDetailID);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onArrived();
    });
  }

  const stopMarkers = validStops.map((s, i) => ({ lat: s.Latitude, lng: s.Longitude, label: i + 1 }));

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <PengirimanMap
        origin={pabrik}
        stops={stopMarkers}
        route={effectiveRoute}
        position={position}
        onPositionChange={setPosition}
        bottomOffset={sheetHeight}
        className="absolute inset-0"
      />

      {/* z-10, not z-1000: PengirimanMap's own z-1000 internals are
          contained in their own stacking context (see pengiriman-map.tsx),
          so this only needs to clear the map's z-0 root — staying well
          under any real <Dialog> (z-50), which must always win over this
          screen's own custom floating chrome. */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-start gap-3 p-3">
        <button
          type="button"
          onClick={() => router.push("/mkesindo/driver-app")}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card shadow-md"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1 pt-2 text-center">
          <p className="truncate text-sm font-medium">
            {armadaNama} {vehicleNo ? `• ${vehicleNo}` : ""}
          </p>
          <p className="truncate text-[11px] uppercase text-muted-foreground">{driverName}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <button
            type="button"
            onClick={() => setBbmOpen(true)}
            className="flex size-10 items-center justify-center rounded-full bg-card shadow-md"
            title="Isi BBM"
          >
            <Fuel className="size-4.5" />
          </button>
          <button
            type="button"
            onClick={() => setKendalaOpen(true)}
            className="flex size-10 items-center justify-center rounded-full bg-destructive text-white shadow-md"
            title="SOS"
          >
            <Siren className="size-4.5" />
          </button>
        </div>
      </div>

      <div
        className="absolute inset-x-0 bottom-0 z-10 flex flex-col overflow-hidden rounded-t-2xl bg-card shadow-[0_-4px_16px_rgba(0,0,0,0.15)]"
        style={collapsedHeight > 0 ? { height: sheetHeight, transition: dragging ? "none" : "height 200ms ease-out" } : undefined}
      >
        <div ref={collapsedContentRef} className="flex shrink-0 flex-col">
          <div
            className="flex touch-none flex-col"
            onPointerDown={handleSheetPointerDown}
            onPointerMove={handleSheetPointerMove}
            onPointerUp={handleSheetPointerUp}
            onPointerCancel={handleSheetPointerUp}
          >
            <div className="flex justify-center pt-2">
              <div className="h-1 w-10 rounded-full bg-muted" />
            </div>
            <div className="flex flex-col gap-2 px-4 pt-2 pb-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate">{activeStop.DeliveryOrderID ?? activeStop.SalesOrderID}</span>
                <span className={kendalaReported ? "font-medium text-destructive" : ""}>
                  {kendalaReported ? "Kendala dilaporkan" : etaMinutes != null ? `~${etaMinutes} menit` : "Menghitung..."}
                </span>
              </div>
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-sm font-semibold">{activeStop.CustomerName}</p>
                <p className="shrink-0 text-xs text-muted-foreground">
                  {formatKemasanQty(activeStop.Qty10KG, activeStop.Qty5KG)}
                  {activeStop.BonusQty > 0 && <span className="ml-1 text-primary">(+{activeStop.BonusQty} bonus)</span>}
                </p>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3 shrink-0" />
                <span className="truncate">
                  {activeStop.Wilayah} {activeStop.Kecamatan ? `| ${activeStop.Kecamatan}` : ""}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">{activeStop.Alamat ?? "-"}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 px-4">
            <SwipeToConfirm label="Geser untuk Tiba" pending={pending} onConfirm={handleArrived} className="flex-1" />
            {activeStop.MobileNo && (
              <button
                type="button"
                onClick={() => setCallOpen(true)}
                className="flex size-12 shrink-0 items-center justify-center rounded-full bg-green-600 text-white shadow-md"
                title="Hubungi Pelanggan"
              >
                <Phone className="size-5" />
              </button>
            )}
          </div>
          <p className="px-4 pt-1 pb-3 text-center text-xs text-muted-foreground">{remainingStops.length} lokasi tersisa</p>

          {error && <p className="px-4 pb-2 text-sm text-destructive">{error}</p>}
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto border-t border-border px-4 py-2">
          {remainingStops.map((s, i) => {
            const distanceKm = distanceByDetailId.get(s.JadwalDetailID);
            return (
              <div key={s.JadwalDetailID} className="flex items-start gap-2 border-b border-border/50 py-2 text-sm last:border-0">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-foreground text-[10px] font-medium">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.CustomerName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatKemasanQty(s.Qty10KG, s.Qty5KG)} &mdash; {s.Wilayah} {s.Kecamatan ? `| ${s.Kecamatan}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{distanceKm != null ? `${distanceKm.toFixed(1)} km` : "-"}</span>
              </div>
            );
          })}
        </div>
      </div>

      {activeStop.MobileNo && <CallChoiceDialog open={callOpen} onOpenChange={setCallOpen} mobileNo={activeStop.MobileNo} />}
      <BbmDialog open={bbmOpen} onOpenChange={setBbmOpen} jadwalId={jadwalId} bbmContext={bbmContext} />
      <KendalaDialog
        open={kendalaOpen}
        onOpenChange={setKendalaOpen}
        jadwalId={jadwalId}
        jadwalDetailId={activeStop.JadwalDetailID}
        onReported={() => setKendalaReported(true)}
      />
    </div>
  );
}
