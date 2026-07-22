"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Geolocation } from "@capacitor/geolocation";
import { Locate, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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

// Same coordinates as PABRIK_ORIGIN in app/api/routing/route.ts — a sensible
// starting pin for a mitra that doesn't have a saved location yet, since
// mitra are all within driving distance of the pabrik anyway.
const PABRIK_DEFAULT: MitraLocationValue = {
  latitude: -7.8462825,
  longitude: 111.4759937,
  alamat: null,
};

export function MitraLocationField({
  value,
  onChange,
  onGeocode,
}: {
  value: MitraLocationValue | null;
  onChange: (value: MitraLocationValue) => void;
  onGeocode?: (suggestion: MitraGeocodeSuggestion) => void;
}) {
  const current = value ?? PABRIK_DEFAULT;
  const [recenterKey, setRecenterKey] = useState(0);
  const [locating, setLocating] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
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
      const message = err instanceof Error ? err.message.toLowerCase() : "";
      setGeoError(message.includes("denied") ? "Izin akses lokasi ditolak." : "Gagal mengambil lokasi GPS.");
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Geser pin atau klik peta untuk menentukan lokasi mitra.</p>
        <Button type="button" variant="outline" size="sm" onClick={handleUseMyLocation} disabled={locating}>
          <Locate className="size-3.5" />
          {locating ? "Mencari lokasi..." : "Pakai Lokasi Saya"}
        </Button>
      </div>

      <MitraLocationMap
        latitude={current.latitude}
        longitude={current.longitude}
        onChange={handleMove}
        recenterKey={recenterKey}
      />

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
