"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import { AlertTriangle } from "lucide-react";
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
} from "@/app/mkesindo/(dashboard)/delivery/actions";
import type { VehiclePositionRow, VehicleTrailPoint } from "@/lib/queries/armada-gps";

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

// Same identity key the query layer itself dedupes on (COALESCE(armada_id,
// provider||external_vehicle_id)) — armadaId alone can't be a React key
// since several unmatched devices all carry armadaId: null.
function vehicleKey(v: VehiclePositionRow): string {
  return v.armadaId != null ? `armada:${v.armadaId}` : `${v.provider}:${v.plateRaw}`;
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

export function VehicleGpsPanel({ initialPositions }: { initialPositions: VehiclePositionRow[] }) {
  const [positions, setPositions] = useState<VehiclePositionRow[]>(initialPositions);
  const [mapStyle, setMapStyle] = useState<MapStyle>("light");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hoursBack, setHoursBack] = useState(1);
  const [trail, setTrail] = useState<VehicleTrailPoint[]>([]);
  const [failedProviders, setFailedProviders] = useState<string[]>([]);
  const mapRef = useRef<L.Map | null>(null);
  const markerRefs = useRef<Map<string, L.Marker>>(new Map());

  const tile = TILE_SOURCES[mapStyle];
  const selected = useMemo(() => positions.find((p) => vehicleKey(p) === selectedKey) ?? null, [positions, selectedKey]);

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
      if (!cancelled && posResult.success) setPositions(posResult.data);
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
                <Popup>
                  <div className="text-sm">
                    <p className="font-medium">{v.plateRaw}</p>
                    <p className="text-muted-foreground">{PROVIDER_LABELS[v.provider]}</p>
                    <p className="text-muted-foreground">Update {formatRelativeTime(v.recordedAt)}</p>
                  </div>
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
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleSelect(v)}
                  className={cn(
                    "flex flex-col gap-1 rounded-md border p-2.5 text-left text-sm transition-colors hover:bg-accent",
                    isSelected && "border-primary bg-accent"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{v.plateRaw}</span>
                    <Badge variant="secondary">{PROVIDER_LABELS[v.provider]}</Badge>
                  </div>
                  {isUnmatched && (
                    <Badge variant="outline" className="w-fit text-muted-foreground">
                      Belum terhubung ke Armada
                    </Badge>
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
