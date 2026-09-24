"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const AgenLocationMap = dynamic(
  () => import("@/components/dashboard/agen-location-map").then((m) => m.AgenLocationMap),
  { ssr: false, loading: () => <Skeleton className="h-[260px] w-full rounded-lg" /> }
);

export interface AgenLocationValue {
  latitude: number;
  longitude: number;
  alamat: string | null;
}

// Default pin position when an Agen has no saved location yet -- centered
// on the pmputra pabrik area (same fallback coordinate Es Kristal's
// PABRIK_FALLBACK uses), since a reasonable starting point beats (0,0).
const DEFAULT_POSITION: AgenLocationValue = { latitude: -7.8462825, longitude: 111.4759937, alamat: null };

export function AgenLocationField({
  value,
  onChange,
}: {
  value: AgenLocationValue | null;
  onChange: (value: AgenLocationValue) => void;
}) {
  const current = value ?? DEFAULT_POSITION;
  const [recenterKey] = useState(0);

  function handleMove(lat: number, lng: number) {
    onChange({ latitude: lat, longitude: lng, alamat: current.alamat });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Lokasi (opsional)</Label>
      <AgenLocationMap latitude={current.latitude} longitude={current.longitude} onChange={handleMove} recenterKey={recenterKey} />
      <div className="flex items-start gap-1.5 rounded-md border border-border bg-card/50 px-2.5 py-2 text-xs">
        <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <p className="text-muted-foreground">
          {current.latitude.toFixed(6)}, {current.longitude.toFixed(6)}
        </p>
      </div>
      <Input
        value={current.alamat ?? ""}
        onChange={(e) => onChange({ ...current, alamat: e.target.value || null })}
        placeholder="Catatan alamat lokasi pin (opsional)"
      />
    </div>
  );
}
