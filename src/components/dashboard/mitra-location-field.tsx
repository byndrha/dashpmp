"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Geolocation } from "@capacitor/geolocation";
import { Locate, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const MitraLocationMap = dynamic(
  () => import("@/components/dashboard/mitra-location-map").then((m) => m.MitraLocationMap),
  { ssr: false, loading: () => <Skeleton className="h-[260px] w-full rounded-lg" /> }
);

export interface MitraLocationValue {
  latitude: number;
  longitude: number;
  alamat: string | null;
}

// Suggestion bubbled up whenever the pin moves — separate from
// MitraLocationValue because Wilayah/Kecamatan aren't columns on
// DashboardMitraLocation, they belong to the mitra form's own
// Wilayah/Kecamatan/Alamat inputs (which the caller may or may not want to
// auto-fill from this).
export interface MitraGeocodeSuggestion {
  alamat: string | null;
  wilayah: string | null;
  kecamatan: string | null;
}

// Last-resort fallback while /api/pabrik-location hasn't resolved yet (or
// if it errors) — same coordinate DashboardPabrikLocation is seeded with.
// A sensible starting pin for a mitra with no saved location either way,
// since mitra are all within driving distance of the pabrik.
const PABRIK_FALLBACK: MitraLocationValue = {
  latitude: -7.8462825,
  longitude: 111.4759937,
  alamat: null,
};

export function MitraLocationField({
  value,
  onChange,
  onGeocode,
  wilayah,
  kecamatan,
}: {
  value: MitraLocationValue | null;
  onChange: (value: MitraLocationValue) => void;
  onGeocode?: (suggestion: MitraGeocodeSuggestion) => void;
  // Used once, on mount, to center the default pin on the mitra's already-
  // known Wilayah/Kecamatan instead of the generic Pabrik-default position —
  // only when there's no saved GPS location yet (`value == null`).
  wilayah?: string | null;
  kecamatan?: string | null;
}) {
  const [pabrik, setPabrik] = useState<MitraLocationValue>(PABRIK_FALLBACK);
  const current = value ?? pabrik;
  const [recenterKey, setRecenterKey] = useState(0);
  const [locating, setLocating] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pabrik-location")
      .then((res) => res.json())
      .then((data: { latitude: number; longitude: number; alamat: string | null }) => {
        if (!cancelled) setPabrik(data);
      })
      .catch(() => {
        // Keep PABRIK_FALLBACK — this only affects the map's decorative
        // Pabrik marker and a mitra-with-no-location's starting pin,
        // neither is worth surfacing an error for.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // One-shot on mount: a mitra with Wilayah/Kecamatan already on file (e.g.
  // ERP-imported) but no saved GPS pin yet gets its default pin centered on
  // that address instead of the generic Pabrik position. Doesn't re-run if
  // the user edits Wilayah/Kecamatan afterwards, or once a real location
  // exists — this is only about where editing starts.
  useEffect(() => {
    if (value != null) return;
    const query = [kecamatan, wilayah].filter(Boolean).join(", ");
    if (!query) return;
    (async () => {
      try {
        const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(`${query}, Indonesia`)}`);
        const data = await res.json();
        if (res.ok && !data.error) {
          onChange({ latitude: data.latitude, longitude: data.longitude, alamat: data.alamat ?? null });
          setRecenterKey((k) => k + 1);
        }
      } catch {
        // Keep the Pabrik-default pin if the lookup fails — still a
        // reasonable starting point, just not address-specific.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reverseGeocode(lat: number, lng: number) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Debounced so a drag (many intermediate positions) or a quick click
    // doesn't hammer Nominatim's public instance, which rate-limits to
    // ~1 request/second per their usage policy.
    debounceRef.current = setTimeout(async () => {
      setGeocoding(true);
      try {
        const res = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`);
        const data = await res.json();
        onChange({ latitude: lat, longitude: lng, alamat: data.alamat ?? null });
        onGeocode?.({ alamat: data.alamat ?? null, wilayah: data.wilayah ?? null, kecamatan: data.kecamatan ?? null });
      } catch {
        // Keep the coordinates even if the address lookup fails — lat/lng is
        // the data that actually matters for routing, alamat is a label.
      } finally {
        setGeocoding(false);
      }
    }, 600);
  }

  function handleMove(lat: number, lng: number) {
    onChange({ latitude: lat, longitude: lng, alamat: current.alamat });
    reverseGeocode(lat, lng);
  }

  // On native Android/iOS, Capacitor's Geolocation plugin rejects with a real
  // Error whose .message contains "denied" for a permission refusal. In a
  // plain browser (no native shell), the plugin's web implementation just
  // forwards the browser's raw GeolocationPositionError unchanged — that's
  // NOT an Error instance, but it exposes `.code === err.PERMISSION_DENIED`
  // instead. Check both shapes so denial is detected correctly either way.
  function isLocationPermissionDenied(err: unknown): boolean {
    if (err instanceof Error) return err.message.toLowerCase().includes("denied");
    if (typeof err === "object" && err !== null && "code" in err && "PERMISSION_DENIED" in err) {
      const geoErr = err as GeolocationPositionError;
      return geoErr.code === geoErr.PERMISSION_DENIED;
    }
    return false;
  }

  // Plain click/Enter handler, not a <form onSubmit> — this field is always
  // nested inside the mitra form's own <form>, and HTML doesn't allow a
  // <form> inside a <form> (confirmed live: React logged a hydration error
  // for exactly that when this was first written as a nested form).
  async function handleSearch() {
    const query = searchQuery.trim();
    if (!query) return;
    setSearchError(null);
    setSearching(true);
    try {
      const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setSearchError(data.error ?? "Lokasi tidak ditemukan.");
        return;
      }
      onChange({ latitude: data.latitude, longitude: data.longitude, alamat: data.alamat ?? null });
      setRecenterKey((k) => k + 1);
    } catch {
      setSearchError("Gagal mencari lokasi.");
    } finally {
      setSearching(false);
    }
  }

  async function handleUseMyLocation() {
    setGeoError(null);
    setLocating(true);
    try {
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      const { latitude, longitude } = pos.coords;
      onChange({ latitude, longitude, alamat: current.alamat });
      reverseGeocode(latitude, longitude);
      setRecenterKey((k) => k + 1);
    } catch (err) {
      setGeoError(isLocationPermissionDenied(err) ? "Izin akses lokasi ditolak." : "Gagal mengambil lokasi GPS.");
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <MitraLocationMap
          latitude={current.latitude}
          longitude={current.longitude}
          onChange={handleMove}
          recenterKey={recenterKey}
          pabrikPosition={[pabrik.latitude, pabrik.longitude]}
        />
        {/* Bottom-left, not top-left — Leaflet's own zoom in/out control sits
            top-left by default, so this avoids overlapping it. Solid
            (non-transparent) theme colors, matching every other input/button
            on this form rather than a floating glass-panel look. */}
        <div className="absolute bottom-2 left-2 z-1000 flex w-[calc(100%-56px)] max-w-64 gap-1">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSearch();
              }
            }}
            placeholder="Cari lokasi..."
            className="h-8 bg-card text-xs shadow-md dark:bg-card"
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-8 shrink-0 bg-card shadow-md dark:bg-card"
            disabled={searching}
            onClick={handleSearch}
          >
            <Search className="size-3.5" />
          </Button>
        </div>
        {/* Bottom-right, icon-only — mirrors the search box's bottom-left
            placement instead of taking a whole row above the map. */}
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="absolute bottom-2 right-2 z-1000 size-8 bg-card shadow-md dark:bg-card"
          onClick={handleUseMyLocation}
          disabled={locating}
          title="Pakai Lokasi Saya"
        >
          <Locate className={cn("size-3.5", locating && "animate-spin")} />
        </Button>
      </div>

      {searchError && <p className="text-xs text-destructive">{searchError}</p>}
      {geoError && <p className="text-xs text-destructive">{geoError}</p>}

      <div className="flex items-start gap-1.5 rounded-md border border-border bg-card/50 px-2.5 py-2 text-xs">
        <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-muted-foreground">
            {current.latitude.toFixed(6)}, {current.longitude.toFixed(6)}
          </p>
          <p className="mt-0.5">{geocoding ? "Mencari alamat..." : (current.alamat ?? "Alamat belum ditemukan.")}</p>
        </div>
      </div>
    </div>
  );
}
