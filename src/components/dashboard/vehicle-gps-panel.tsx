"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import {
  AlertTriangle,
  PauseCircle,
  PackageOpen,
  Clock,
  Truck,
  Undo2,
  CheckCircle2,
  Wrench,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";
import { TILE_SOURCES, type MapStyle } from "@/lib/map-styles";
import { MapStyleSwitcher, MapZoomControl, MapAttribution } from "@/components/dashboard/map-controls";
import {
  getVehiclePositionsAction,
  getVehicleTrailAction,
  syncVehicleGpsPositionsAction,
  getArmadaOperationalStatusesAction,
} from "@/app/mkesindo/(dashboard)/delivery/actions";
import type { VehiclePositionRow, VehicleTrailPoint } from "@/lib/queries/armada-gps";
import type { ArmadaOperationalStatus } from "@/lib/queries/pengiriman-jadwal";

// Client-only polling: 45s, within the plan's 30-60s spec range and matching
// print-queue-poller.tsx's own interval pattern. No server cron exists yet
// (see the TODO on syncVehicleGpsPositionsAction) so this tab must stay
// mounted (TabsContent doesn't keepMounted) for updates to keep flowing.
const POLL_INTERVAL_MS = 45000;

const HOURS_OPTIONS: { label: string; hours: number }[] = [
  { label: "1 jam", hours: 1 },
  { label: "6 jam", hours: 6 },
  { label: "24 jam", hours: 24 },
];

const PROVIDER_LABELS: Record<VehiclePositionRow["provider"], string> = {
  hino: "Hino Connect",
  solofleet: "SoloFleet",
};

// One entry per ArmadaOperationalStatus["kind"] — label, badge color, and
// icon shown on both the map popup and the side-list card. Colors follow
// this app's existing semantic palette (muted=idle, amber=in-progress-prep,
// primary=core delivery activity, destructive=needs attention).
const STATUS_META: Record<
  ArmadaOperationalStatus["kind"],
  { label: string; badgeClassName: string; Icon: typeof PauseCircle }
> = {
  diam: { label: "Diam", badgeClassName: "bg-muted text-muted-foreground", Icon: PauseCircle },
  proses_muat: { label: "Proses Muat", badgeClassName: "bg-amber-500/15 text-amber-600 dark:text-amber-400", Icon: PackageOpen },
  menunggu_keberangkatan: {
    label: "Menunggu Keberangkatan",
    badgeClassName: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    Icon: Clock,
  },
  dalam_pengiriman: { label: "Dalam Pengiriman", badgeClassName: "bg-primary/15 text-primary", Icon: Truck },
  perjalanan_kembali: {
    label: "Perjalanan Kembali",
    badgeClassName: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    Icon: Undo2,
  },
  tiba: { label: "Tiba", badgeClassName: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", Icon: CheckCircle2 },
  maintenance: { label: "Maintenance", badgeClassName: "bg-destructive/15 text-destructive", Icon: Wrench },
};

// "Dalam Pengiriman ke: <mitra>" / "Status Maintenance Lainnya: <detail>" —
// the two kinds whose display text needs the status's own payload, not just
// its kind.
function statusDetailText(status: ArmadaOperationalStatus): string | null {
  if (status.kind === "dalam_pengiriman") return status.mitraTujuan ? `ke: ${status.mitraTujuan}` : null;
  if (status.kind === "maintenance") return status.label;
  return null;
}

// Same identity key the query layer itself dedupes on (provider,
// external_vehicle_id) — always device identity, never armadaId. A vehicle
// tracked by two providers at once shares one armadaId across two rows on
// purpose (see armada-gps.ts), so armadaId alone can never be used as a key.
function vehicleKey(v: VehiclePositionRow): string {
  return `${v.provider}:${v.externalVehicleId}`;
}

// Top-down truck icon, adapted from route-map.tsx's truckIcon — same shape,
// but rotated by the vehicle's OWN `heading` field (reported by the GPS
// provider) rather than a bearing derived from route geometry, since these
// vehicles have no planned route to compare against.
function truckIcon(headingDeg: number, connected: boolean) {
  const bodyColor = connected ? "#2563eb" : "#9ca3af";
  const cabColor = connected ? "#1d4ed8" : "#6b7280";
  return L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;transform:rotate(${headingDeg}deg);transform-origin:50% 50%;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))">
      <svg viewBox="0 0 24 24" width="28" height="28">
        <rect x="7" y="10" width="10" height="12" rx="1.5" fill="${bodyColor}" stroke="white" stroke-width="1.2" />
        <rect x="8.5" y="2" width="7" height="9" rx="1.5" fill="${cabColor}" stroke="white" stroke-width="1.2" />
      </svg>
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Redesigned map popup: plate + provider as the header, a colored status
// badge (with icon) as the primary content, then a quiet meta row for
// speed/last-update — replaces the earlier plain stacked-paragraph version.
function VehiclePopupContent({
  v,
  status,
  otherProvider,
}: {
  v: VehiclePositionRow;
  status: ArmadaOperationalStatus | undefined;
  otherProvider: string | null;
}) {
  const meta = status ? STATUS_META[status.kind] : null;
  const detail = status ? statusDetailText(status) : null;
  return (
    <div className="w-56 overflow-hidden rounded-lg">
      <div className="flex items-center justify-between gap-2 bg-foreground/[0.03] px-3 py-2 dark:bg-white/5">
        <span className="text-sm font-semibold">{v.plateRaw}</span>
        <Badge variant="secondary" className="text-[10px]">
          {PROVIDER_LABELS[v.provider]}
        </Badge>
      </div>
      <div className="flex flex-col gap-2 px-3 py-2.5">
        {meta ? (
          <div className={cn("flex items-start gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium", meta.badgeClassName)}>
            <meta.Icon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {meta.label}
              {detail && <span className="font-normal"> {detail}</span>}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
            <PauseCircle className="size-3.5" />
            Belum terhubung ke Armada
          </div>
        )}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{v.speedKmh != null ? `${Math.round(v.speedKmh)} km/h` : "Kecepatan tidak diketahui"}</span>
          <span>{formatRelativeTime(v.recordedAt)}</span>
        </div>
        {otherProvider && (
          <p className="text-[11px] text-muted-foreground">Juga dilacak: {otherProvider}</p>
        )}
      </div>
    </div>
  );
}

export function VehicleGpsPanel({
  initialPositions,
  initialArmadaStatuses,
}: {
  initialPositions: VehiclePositionRow[];
  initialArmadaStatuses: { armadaId: number; status: ArmadaOperationalStatus }[];
}) {
  const [positions, setPositions] = useState<VehiclePositionRow[]>(initialPositions);
  const [armadaStatuses, setArmadaStatuses] = useState<Map<number, ArmadaOperationalStatus>>(
    () => new Map(initialArmadaStatuses.map((s) => [s.armadaId, s.status]))
  );
  const [mapStyle, setMapStyle] = useState<MapStyle>("light");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hoursBack, setHoursBack] = useState(1);
  const [trail, setTrail] = useState<VehicleTrailPoint[]>([]);
  const [failedProviders, setFailedProviders] = useState<string[]>([]);
  const mapRef = useRef<L.Map | null>(null);
  const markerRefs = useRef<Map<string, L.Marker>>(new Map());

  const tile = TILE_SOURCES[mapStyle];
  const selected = useMemo(() => positions.find((p) => vehicleKey(p) === selectedKey) ?? null, [positions, selectedKey]);

  // Which armada currently have more than one provider reporting a position
  // (a truck with both a Hino Connect and a SoloFleet device installed) —
  // surfaced as a small note on each of that armada's rows/markers so it's
  // clear the other row isn't a duplicate, it's the other device.
  const providersByArmada = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const p of positions) {
      if (p.armadaId == null) continue;
      if (!map.has(p.armadaId)) map.set(p.armadaId, new Set());
      map.get(p.armadaId)!.add(p.provider);
    }
    return map;
  }, [positions]);

  function otherProviderLabel(v: VehiclePositionRow): string | null {
    if (v.armadaId == null) return null;
    const providers = providersByArmada.get(v.armadaId);
    if (!providers || providers.size < 2) return null;
    const other = [...providers].find((p) => p !== v.provider);
    return other ? PROVIDER_LABELS[other as VehiclePositionRow["provider"]] : null;
  }

  function handleSelect(v: VehiclePositionRow) {
    setSelectedKey(vehicleKey(v));
    mapRef.current?.flyTo([v.latitude, v.longitude], 14);
    markerRefs.current.get(vehicleKey(v))?.openPopup();
  }

  // Trail fetch: re-runs whenever the selected vehicle or the time-range
  // control changes. Only meaningful for a vehicle matched to an Armada
  // (getVehicleTrailAction needs an armadaId) — an unmatched device has
  // nothing to key its history on, so the trail is simply left empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (selected?.armadaId == null) {
        if (!cancelled) setTrail([]);
        return;
      }
      const result = await getVehicleTrailAction(selected.armadaId, hoursBack);
      if (!cancelled && result.success) setTrail(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.armadaId, hoursBack]);

  // Polling: sync every provider, then re-read the latest positions — 45s,
  // cleared on unmount. Relies on this project's Tabs not keeping inactive
  // TabsContent panels mounted, so switching away from the "GPS Kendaraan"
  // tab naturally stops this interval via the cleanup function below.
  useEffect(() => {
    let cancelled = false;
    async function pollOnce() {
      const syncResult = await syncVehicleGpsPositionsAction();
      if (cancelled) return;
      if (syncResult.success) {
        setFailedProviders(syncResult.data.filter((s) => !s.ok).map((s) => s.provider));
      }
      const posResult = await getVehiclePositionsAction();
      if (cancelled || !posResult.success) return;
      setPositions(posResult.data);

      const armadaIds = [...new Set(posResult.data.map((p) => p.armadaId).filter((id): id is number => id != null))];
      if (armadaIds.length === 0) return;
      const statusResult = await getArmadaOperationalStatusesAction(armadaIds);
      if (!cancelled && statusResult.success) {
        setArmadaStatuses(new Map(statusResult.data.map((s) => [s.armadaId, s.status])));
      }
    }
    // Fire an immediate sync on mount so the tab shows fresh data right away,
    // rather than waiting up to POLL_INTERVAL_MS for the first refresh.
    void pollOnce();
    const interval = setInterval(pollOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>GPS Kendaraan</CardTitle>
        {failedProviders.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {failedProviders.map((provider) => (
              <span key={provider} className="flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle className="size-3.5" />
                gagal sync: {PROVIDER_LABELS[provider as VehiclePositionRow["provider"]] ?? provider}
              </span>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 lg:flex-row">
        <div className="relative z-0 min-h-80 flex-1">
          <MapContainer
            ref={mapRef}
            center={positions.length > 0 ? [positions[0].latitude, positions[0].longitude] : [-7.867, 111.463]}
            zoom={11}
            scrollWheelZoom
            zoomControl={false}
            attributionControl={false}
            style={{ height: "100%", minHeight: 320, width: "100%", borderRadius: "var(--radius-lg)" }}
          >
            <TileLayer key={mapStyle} attribution={tile.attribution} url={tile.url} subdomains={tile.subdomains ?? "abc"} />
            <MapZoomControl className="top-2 left-2" />
            {positions.map((v) => (
              <Marker
                key={vehicleKey(v)}
                position={[v.latitude, v.longitude]}
                icon={truckIcon(v.heading ?? 0, v.armadaId != null)}
                eventHandlers={{ click: () => handleSelect(v) }}
                ref={(instance) => {
                  if (instance) markerRefs.current.set(vehicleKey(v), instance);
                  else markerRefs.current.delete(vehicleKey(v));
                }}
              >
                <Popup minWidth={220} className="[&_.leaflet-popup-content-wrapper]:p-0 [&_.leaflet-popup-content]:m-0">
                  <VehiclePopupContent
                    v={v}
                    status={v.armadaId != null ? armadaStatuses.get(v.armadaId) : undefined}
                    otherProvider={otherProviderLabel(v)}
                  />
                </Popup>
              </Marker>
            ))}
            {trail.length >= 2 && (
              <Polyline
                positions={trail.map((p): [number, number] => [p.latitude, p.longitude])}
                pathOptions={{ color: "#2563eb", weight: 4 }}
              />
            )}
          </MapContainer>

          <MapStyleSwitcher mapStyle={mapStyle} onChange={setMapStyle} className="top-2 right-2" />
          <MapAttribution className="bottom-2 right-2" />
        </div>

        <div className="flex w-full flex-col gap-3 lg:w-80 lg:shrink-0">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Riwayat:</span>
            {HOURS_OPTIONS.map((opt) => (
              <Button
                key={opt.hours}
                type="button"
                size="sm"
                variant={hoursBack === opt.hours ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                disabled={selected?.armadaId == null}
                onClick={() => setHoursBack(opt.hours)}
              >
                {opt.label}
              </Button>
            ))}
          </div>

          <div className="flex flex-col gap-2 overflow-y-auto lg:max-h-96">
            {positions.length === 0 && (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                Belum ada data posisi kendaraan.
              </p>
            )}
            {positions.map((v) => {
              const key = vehicleKey(v);
              const isSelected = key === selectedKey;
              const isUnmatched = v.armadaId == null;
              const status = v.armadaId != null ? armadaStatuses.get(v.armadaId) : undefined;
              const meta = status ? STATUS_META[status.kind] : null;
              const detail = status ? statusDetailText(status) : null;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleSelect(v)}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-md border p-2.5 text-left text-sm transition-colors hover:bg-accent",
                    isSelected && "border-primary bg-accent"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{v.plateRaw}</span>
                    <Badge variant="secondary">{PROVIDER_LABELS[v.provider]}</Badge>
                  </div>
                  {isUnmatched ? (
                    <Badge variant="outline" className="w-fit text-muted-foreground">
                      Belum terhubung ke Armada
                    </Badge>
                  ) : (
                    meta && (
                      <div className={cn("flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium w-fit", meta.badgeClassName)}>
                        <meta.Icon className="size-3.5 shrink-0" />
                        <span>
                          {meta.label}
                          {detail && <span className="font-normal"> {detail}</span>}
                        </span>
                      </div>
                    )
                  )}
                  {otherProviderLabel(v) && (
                    <p className="text-xs text-muted-foreground">Juga dilacak: {otherProviderLabel(v)}</p>
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{v.speedKmh != null ? `${Math.round(v.speedKmh)} km/h` : "Kecepatan tidak diketahui"}</span>
                    <span>terakhir update {formatRelativeTime(v.recordedAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
