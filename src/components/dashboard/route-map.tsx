"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Search, X } from "lucide-react";
import { TILE_SOURCES, type MapStyle } from "@/lib/map-styles";
import { MapStyleSwitcher, MapZoomControl, MapAttribution } from "@/components/dashboard/map-controls";
import { formatRelativeTime, formatTime } from "@/lib/format";
import type { JadwalDetailRow } from "@/lib/queries/pengiriman-jadwal";
import type { JejakAktual } from "@/lib/queries/jejak-armada";

// Status lapisan "rute aktual" (riwayat GPS provider) — dimuat terpisah oleh
// pemanggil setelah peta tampil, jadi peta tidak pernah menunggunya.
export type JejakPeta =
  | { keadaan: "memuat" }
  | { keadaan: "gagal"; pesan: string }
  | { keadaan: "siap"; data: JejakAktual };

const LABEL_SUMBER_JEJAK = { solofleet: "SoloFleet", hino: "Hino Connect" } as const;
const WARNA_AKTUAL = "#ea580c";
const WARNA_RENCANA = "#2563eb";

// Animasi alur: dash SVG yang bergeser maju searah urutan titik garis
// (stroke-dashoffset negatif = bergerak ke ujung garis). Jarak geser per
// putaran harus sama dengan panjang pola dashArray masing-masing kelas.
const CSS_ALUR = `
.alur-rute { animation: alur-rute 1.1s linear infinite; }
.alur-rute-putus { animation: alur-rute-putus 0.9s linear infinite; }
@keyframes alur-rute { to { stroke-dashoffset: -20; } }
@keyframes alur-rute-putus { to { stroke-dashoffset: -14; } }
@media (prefers-reduced-motion: reduce) { .alur-rute, .alur-rute-putus { animation: none; } }
`;

const ikonPanahCache = new Map<string, L.DivIcon>();
function ikonPanah(sudut: number, warna: string): L.DivIcon {
  const bulat = Math.round(sudut / 5) * 5;
  const kunci = `${bulat}|${warna}`;
  let ikon = ikonPanahCache.get(kunci);
  if (!ikon) {
    ikon = L.divIcon({
      className: "",
      html: `<svg viewBox="0 0 12 12" width="14" height="14" style="transform:rotate(${bulat}deg);filter:drop-shadow(0 0 1px rgba(255,255,255,.95))"><path d="M3 2 L9 6 L3 10" fill="none" stroke="${warna}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    ikonPanahCache.set(kunci, ikon);
  }
  return ikon;
}

// Panah arah (chevron) di sepanjang garis, berjarak tetap dalam PIKSEL layar
// — dihitung ulang tiap zoom supaya tidak menumpuk saat diperkecil dan tidak
// terlalu jarang saat diperbesar.
function PanahArah({ titik, warna, jarakPx }: { titik: [number, number][]; warna: string; jarakPx: number }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const panah = useMemo(() => {
    const hasil: { pos: L.LatLng; sudut: number }[] = [];
    if (titik.length < 2) return hasil;
    const px = titik.map(([lat, lng]) => map.project(L.latLng(lat, lng), zoom));
    let menuju = jarakPx / 2;
    for (let i = 1; i < px.length && hasil.length < 200; i++) {
      const a = px[i - 1];
      const b = px[i];
      const panjang = a.distanceTo(b);
      if (panjang === 0) continue;
      const sudut = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      while (menuju <= panjang && hasil.length < 200) {
        const f = menuju / panjang;
        hasil.push({ pos: map.unproject(L.point(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f), zoom), sudut });
        menuju += jarakPx;
      }
      menuju -= panjang;
    }
    return hasil;
  }, [map, titik, zoom, jarakPx]);
  return (
    <>
      {panah.map((p, i) => (
        <Marker key={i} position={p.pos} icon={ikonPanah(p.sudut, warna)} interactive={false} keyboard={false} />
      ))}
    </>
  );
}

// Garis rute + panah arah + lapisan titik putih yang mengalir searah rute.
// `putus` = gaya rencana saat rute aktual ikut tampil (garis putus-putus
// tipis yang alirannya dianimasikan langsung, tanpa lapisan titik).
function GarisRute({ titik, warna, putus = false }: { titik: [number, number][]; warna: string; putus?: boolean }) {
  return (
    <>
      {putus ? (
        <Polyline
          positions={titik}
          pathOptions={{ color: warna, weight: 3, opacity: 0.7, dashArray: "6 8", className: "alur-rute-putus" }}
        />
      ) : (
        <>
          <Polyline positions={titik} pathOptions={{ color: warna, weight: 4, opacity: 0.9 }} />
          <Polyline
            positions={titik}
            interactive={false}
            pathOptions={{ color: "#ffffff", weight: 2.5, opacity: 0.85, dashArray: "2 18", lineCap: "round", className: "alur-rute" }}
          />
        </>
      )}
      <PanahArah titik={titik} warna={warna} jarakPx={putus ? 110 : 90} />
    </>
  );
}

// Truck marker input. `source` says where the ping came from (driver app or
// the armada's GPS tracker) and `recordedAt` (ISO) when — both optional so
// older callers that only pass coordinates keep working.
export interface TruckPosition {
  latitude: number;
  longitude: number;
  heading?: number | null;
  recordedAt?: string;
  source?: "driver" | "hino" | "solofleet";
}

const SOURCE_LABELS: Record<NonNullable<TruckPosition["source"]>, string> = {
  driver: "Aplikasi Driver",
  hino: "GPS Hino Connect",
  solofleet: "GPS SoloFleet",
};

// A ping older than this is drawn grey and flagged "(lama)" — an armada
// tracker only updates while the GPS Kendaraan sync runs, so a stale
// position must not look like a live one.
const STALE_MS = 15 * 60 * 1000;

const pabrikIcon = L.divIcon({
  className: "",
  html: '<div style="background:#ea580c;width:16px;height:16px;border-radius:9999px;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function stopIcon(order: number) {
  return L.divIcon({
    className: "",
    html: `<div style="background:#16a34a;color:white;width:22px;height:22px;border-radius:9999px;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;font-family:sans-serif">${order}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

// Top-down truck (cargo box + cab), not a pin — the front (cab) points
// geographic north at bearingDeg=0 and rotates from there, so passing the
// route's own heading at the driver's nearest point makes the icon's front
// track the direction of travel rather than just marking a location.
function truckIcon(bearingDeg: number, stale = false) {
  return L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;transform:rotate(${bearingDeg}deg);transform-origin:50% 50%;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))">
      <svg viewBox="0 0 24 24" width="28" height="28">
        <rect x="7" y="10" width="10" height="12" rx="1.5" fill="${stale ? "#9ca3af" : "#2563eb"}" stroke="white" stroke-width="1.2" />
        <rect x="8.5" y="2" width="7" height="9" rx="1.5" fill="${stale ? "#6b7280" : "#1d4ed8"}" stroke="white" stroke-width="1.2" />
      </svg>
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Nearest-segment heading: finds the route polyline segment whose midpoint
// is closest to the driver's current position, then returns that segment's
// compass bearing. A single GPS ping has no bearing of its own (no prior
// point to compare against) — the route geometry itself stands in for
// "which way is the truck facing" between 10-second polls, matching what
// the driver-app design settled on (bearing from route, not from position
// history).
function bearingToNearestSegment(position: [number, number], route: [number, number][]): number {
  if (route.length < 2) return 0;
  let bestDistSq = Infinity;
  let bestBearing = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const [lat1, lng1] = route[i];
    const [lat2, lng2] = route[i + 1];
    const midLat = (lat1 + lat2) / 2;
    const midLng = (lng1 + lng2) / 2;
    const distSq = (position[0] - midLat) ** 2 + (position[1] - midLng) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLng = toRad(lng2 - lng1);
      const y = Math.sin(dLng) * Math.cos(toRad(lat2));
      const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
      bestBearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    }
  }
  return bestBearing;
}

type Stop = JadwalDetailRow & { Latitude: number; Longitude: number };

// Keeps the map framed on the whole route (pabrik + every stop + the
// actual road geometry, not just the straight lines between markers) —
// without this, MapContainer's own fixed center/zoom={12} only happens to
// show the whole route by coincidence, and a route with far-flung stops
// (e.g. a Pacitan-area run, ~50-60km from the Ponorogo pabrik) gets several
// markers cut off past the initial viewport. Re-fits whenever the route's
// own data changes, plus whenever refitTrigger is bumped — the latter lets
// a caller (route-validation-dialog.tsx's "Bagikan") force an immediate,
// un-animated re-fit right before a screenshot, overriding any manual
// pan/zoom so a shared image always shows the entire route.
function FitBounds({
  pabrik,
  stops,
  routePoints,
  refitTrigger,
}: {
  pabrik: { latitude: number; longitude: number };
  stops: Stop[];
  routePoints: [number, number][] | undefined;
  refitTrigger: number;
}) {
  const map = useMap();
  useEffect(() => {
    const points: [number, number][] = [
      [pabrik.latitude, pabrik.longitude],
      ...stops.map((s): [number, number] => [s.Latitude, s.Longitude]),
      ...(routePoints ?? []),
    ];
    if (points.length === 0) return;
    map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 15, animate: false });
    // stops/routePoints are new array references most renders — keyed on
    // stop identity + point count instead so this only re-fits when the
    // route's actual data changes (or refitTrigger is bumped on purpose),
    // not on every unrelated re-render (which would fight a manual pan/zoom).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pabrik.latitude, pabrik.longitude, stops.map((s) => s.JadwalDetailID).join(","), routePoints?.length, refitTrigger]);
  return null;
}

// Searches among this route's own stops (by CustomerName) rather than a
// general address search — same "find the one I'm looking for and jump to
// it" role as mitra-locations-map.tsx's MitraSearchBox, just scoped to one
// route's stop list instead of every mitra on the map.
function StopSearchBox({ stops, onSelect }: { stops: Stop[]; onSelect: (stop: Stop) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const matches = query.trim()
    ? stops.filter((s) => s.CustomerName.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : [];

  return (
    <div className="absolute bottom-2 left-2 z-1000 flex w-56 max-w-[calc(100%-1rem)] flex-col-reverse gap-1">
      <div className="flex items-center gap-1.5 rounded-md bg-card/90 px-2 py-1.5 shadow-md ring-1 ring-foreground/10 backdrop-blur-sm">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Cari mitra di rute..."
          className="w-full min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
          >
            <X className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        )}
      </div>
      {open && matches.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-md bg-card/95 shadow-md ring-1 ring-foreground/10 backdrop-blur-sm">
          {matches.map((s) => (
            <button
              key={s.JadwalDetailID}
              type="button"
              onClick={() => {
                onSelect(s);
                setQuery(s.CustomerName);
                setOpen(false);
              }}
              className="flex w-full flex-col items-start px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="truncate font-medium">
                #{s.Urutan} {s.CustomerName}
              </span>
              <span className="text-[11px] text-muted-foreground">{s.Wilayah}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function RouteMap({
  pabrik,
  stops,
  geometry,
  refitTrigger = 0,
  driverPosition = null,
  jejak = null,
}: {
  pabrik: { latitude: number; longitude: number };
  stops: (JadwalDetailRow & { Latitude: number; Longitude: number })[];
  // Raw GeoJSON [lng, lat] pairs from MultiPointRoute — flipped to Leaflet's
  // [lat, lng] here, the only place in this feature that cares about the
  // difference.
  geometry: [number, number][] | null;
  // Bump to force an immediate, un-animated bounds re-fit — see FitBounds.
  refitTrigger?: number;
  // Live driver GPS, polled by the caller every 10s once "Mulai Muat" is
  // done — null hides the marker entirely (not yet loading, no ping ever
  // received, or the caller hasn't started polling yet). Deliberately left
  // out of FitBounds below: re-framing the whole map on every 10s ping
  // would fight any manual pan/zoom and jump the view around as the truck
  // moves, when the point is to watch it move within a fixed frame.
  driverPosition?: TruckPosition | null;
  // Rute yang benar-benar ditempuh (null = tidak ditampilkan sama sekali,
  // mis. armada belum berangkat).
  jejak?: JejakPeta | null;
}) {
  const jejakAda = jejak?.keadaan === "siap" && jejak.data.status === "ada" ? jejak.data : null;
  // Sakelar legenda — keduanya tampil secara bawaan.
  const [tampilRencana, setTampilRencana] = useState(true);
  const [tampilAktual, setTampilAktual] = useState(true);
  const jejakSiap = jejakAda && tampilAktual ? jejakAda : null;
  const polylinePositions: [number, number][] | undefined = geometry?.map(([lng, lat]) => [lat, lng]);
  const mapRef = useRef<L.Map | null>(null);
  const markerRefs = useRef<Map<number, L.Marker>>(new Map());
  const [mapStyle, setMapStyle] = useState<MapStyle>("light");
  const tile = TILE_SOURCES[mapStyle];
  const driverBearing = driverPosition?.heading != null ? driverPosition.heading : driverPosition && polylinePositions ? bearingToNearestSegment([driverPosition.latitude, driverPosition.longitude], polylinePositions) : 0;

  // Re-evaluated every 30s so a ping ages into "(lama)" and its relative
  // time keeps counting even between position updates.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const ageMs = driverPosition?.recordedAt ? now - new Date(driverPosition.recordedAt).getTime() : null;
  const isStale = ageMs != null && ageMs > STALE_MS;
  const positionLabel = driverPosition?.source
    ? `${SOURCE_LABELS[driverPosition.source]}${driverPosition.recordedAt ? ` · ${formatRelativeTime(driverPosition.recordedAt, new Date(now))}` : ""}${isStale ? " (lama)" : ""}`
    : null;

  function handleSelectStop(stop: Stop) {
    mapRef.current?.flyTo([stop.Latitude, stop.Longitude], 15);
    markerRefs.current.get(stop.JadwalDetailID)?.openPopup();
  }

  return (
    <div className="relative z-0">
      <style>{CSS_ALUR}</style>
      <MapContainer
        ref={mapRef}
        center={[pabrik.latitude, pabrik.longitude]}
        zoom={12}
        scrollWheelZoom
        zoomControl={false}
        attributionControl={false}
        style={{ height: "100%", minHeight: 320, width: "100%", borderRadius: "var(--radius-lg)" }}
      >
        {/* key={mapStyle} forces a fresh TileLayer instance per style so
            Leaflet doesn't try to diff/reuse tiles across completely
            different tile servers. */}
        <TileLayer key={mapStyle} attribution={tile.attribution} url={tile.url} subdomains={tile.subdomains ?? "abc"} />
        <FitBounds
          pabrik={pabrik}
          stops={stops}
          routePoints={jejakSiap ? [...(polylinePositions ?? []), ...jejakSiap.titik] : polylinePositions}
          refitTrigger={refitTrigger}
        />
        <MapZoomControl className="top-2 left-2" />
        <Marker position={[pabrik.latitude, pabrik.longitude]} icon={pabrikIcon} />
        {stops.map((s, i) => (
          <Marker
            key={s.JadwalDetailID}
            position={[s.Latitude, s.Longitude]}
            icon={stopIcon(i + 1)}
            ref={(instance) => {
              if (instance) markerRefs.current.set(s.JadwalDetailID, instance);
              else markerRefs.current.delete(s.JadwalDetailID);
            }}
          >
            <Popup>
              <strong>
                #{s.Urutan} {s.CustomerName}
              </strong>
              <br />
              {s.Wilayah}
            </Popup>
          </Marker>
        ))}
        {/* Saat jejak aktual ada, rencana menjadi garis putus-putus tipis
            di bawahnya supaya penyimpangan rute terlihat jelas. */}
        {/* key berganti bersama gaya: className path Leaflet hanya dipasang
            saat dibuat, jadi ganti gaya = pasang ulang garisnya. */}
        {polylinePositions && tampilRencana && (
          <GarisRute key={jejakSiap ? "rencana-putus" : "rencana"} titik={polylinePositions} warna={WARNA_RENCANA} putus={!!jejakSiap} />
        )}
        {jejakSiap && <GarisRute titik={jejakSiap.titik} warna={WARNA_AKTUAL} />}
        {jejakSiap?.berhenti.map((b) => (
          <CircleMarker
            key={b.mulai}
            center={[b.lat, b.lng]}
            radius={Math.min(10, 5 + b.menit / 10)}
            pathOptions={{ color: "white", weight: 2, fillColor: WARNA_AKTUAL, fillOpacity: 0.9 }}
          >
            <Popup>
              Berhenti {b.menit} menit
              <br />
              {formatTime(b.mulai)} – {formatTime(b.selesai)}
            </Popup>
          </CircleMarker>
        ))}
        {driverPosition && (
          <Marker position={[driverPosition.latitude, driverPosition.longitude]} icon={truckIcon(driverBearing, isStale)} zIndexOffset={1000}>
            {positionLabel && <Popup>{positionLabel}</Popup>}
          </Marker>
        )}
      </MapContainer>

      {positionLabel && (
        <div
          className={`absolute top-12 left-2 z-1000 max-w-[calc(100%-1rem)] rounded-md px-2 py-1 text-[11px] font-medium shadow-md ring-1 ring-foreground/10 backdrop-blur-sm ${
            isStale ? "bg-amber-500/90 text-white" : "bg-card/90"
          }`}
        >
          Posisi armada: {positionLabel}
        </div>
      )}
      {jejak && (
        <KeteranganJejak
          jejak={jejak}
          tampilRencana={tampilRencana}
          onTampilRencana={setTampilRencana}
          tampilAktual={tampilAktual}
          onTampilAktual={setTampilAktual}
        />
      )}
      <StopSearchBox stops={stops} onSelect={handleSelectStop} />
      <MapStyleSwitcher mapStyle={mapStyle} onChange={setMapStyle} className="top-2 right-2" />
      <MapAttribution className="bottom-2 right-2" />
    </div>
  );
}

// Sakelar kecil di legenda (role="switch").
function Sakelar({
  nyala,
  onUbah,
  label,
  children,
}: {
  nyala: boolean;
  onUbah: (v: boolean) => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={nyala}
      aria-label={label}
      onClick={() => onUbah(!nyala)}
      className="flex w-full items-center gap-1.5 rounded px-0.5 py-0.5 text-left hover:bg-muted/60"
    >
      <span
        className={`relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors ${nyala ? "bg-primary" : "bg-muted-foreground/30"}`}
      >
        <span
          className={`absolute size-2.5 rounded-full bg-white shadow-sm transition-transform ${nyala ? "translate-x-3" : "translate-x-0.5"}`}
        />
      </span>
      <span className={`flex min-w-0 items-center gap-1.5 ${nyala ? "" : "opacity-50"}`}>{children}</span>
    </button>
  );
}

// Keterangan garis di pojok kanan atas (di bawah pemilih gaya peta), dengan
// sakelar untuk menyembunyikan rute rencana / aktual.
function KeteranganJejak({
  jejak,
  tampilRencana,
  onTampilRencana,
  tampilAktual,
  onTampilAktual,
}: {
  jejak: JejakPeta;
  tampilRencana: boolean;
  onTampilRencana: (v: boolean) => void;
  tampilAktual: boolean;
  onTampilAktual: (v: boolean) => void;
}) {
  const rencana = (
    <Sakelar nyala={tampilRencana} onUbah={onTampilRencana} label="Tampilkan rute rencana">
      <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: WARNA_RENCANA }} />
      Rencana
    </Sakelar>
  );
  let isi: ReactNode;
  if (jejak.keadaan === "memuat") {
    isi = <span className="pl-7.5 text-muted-foreground">Memuat rute aktual…</span>;
  } else if (jejak.keadaan === "gagal") {
    isi = <span className="pl-7.5 text-amber-600">Rute aktual gagal dimuat</span>;
  } else if (jejak.data.status === "tanpa_alat") {
    isi = <span className="pl-7.5 text-muted-foreground">Armada ini tanpa alat GPS</span>;
  } else if (jejak.data.status === "kosong") {
    isi = <span className="pl-7.5 text-muted-foreground">Belum ada titik GPS perjalanan ini</span>;
  } else {
    const d = jejak.data;
    isi = (
      <>
        <Sakelar nyala={tampilAktual} onUbah={onTampilAktual} label="Tampilkan rute aktual">
          <span className="inline-block w-4 border-t-[3px]" style={{ borderColor: WARNA_AKTUAL }} />
          Aktual{d.jarakKm != null ? ` · ${d.jarakKm.toLocaleString("id-ID")} km` : ""}
        </Sakelar>
        {tampilAktual && d.berhenti.length > 0 && (
          <span className="flex items-center gap-1.5 pl-7.5">
            <span className="inline-block size-2.5 rounded-full ring-2 ring-white" style={{ background: WARNA_AKTUAL }} />
            {d.berhenti.length} kali berhenti ≥5 mnt
          </span>
        )}
        <span className="pl-7.5 text-[10px] text-muted-foreground">
          GPS {d.sumber ? LABEL_SUMBER_JEJAK[d.sumber] : ""}
          {d.final ? "" : " · berlangsung"}
        </span>
      </>
    );
  }
  return (
    <div
      title={jejak.keadaan === "gagal" ? jejak.pesan : undefined}
      className="absolute top-12 right-2 z-1000 flex max-w-[calc(100%-1rem)] flex-col gap-0.5 rounded-md bg-card/90 px-1.5 py-1.5 text-[11px] font-medium shadow-md ring-1 ring-foreground/10 backdrop-blur-sm"
    >
      {rencana}
      {isi}
    </div>
  );
}
