"use client";

import { useMap } from "react-leaflet";
import { Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { STYLE_OPTIONS, type MapStyle } from "@/lib/map-styles";

// Shared floating-pill controls for every Leaflet map in the dashboard, so
// the dark/satellite toggle, zoom buttons, and copyright overlay look and
// behave identically wherever they appear instead of being redrawn slightly
// differently per map. Each accepts a `className` for position (top/left/
// right/bottom) since every map's layout claims different corners.

export function MapStyleSwitcher({
  mapStyle,
  onChange,
  className,
  style,
}: {
  mapStyle: MapStyle;
  onChange: (style: MapStyle) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={cn("absolute z-1000 flex gap-1 rounded-md bg-card/90 p-1 shadow-md ring-1 ring-foreground/10 backdrop-blur-sm", className)}
    >
      {STYLE_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          title={opt.label}
          onClick={() => onChange(opt.key)}
          className={cn(
            "flex size-7 items-center justify-center rounded transition-colors",
            mapStyle === opt.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
          )}
        >
          <opt.icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

// Replaces Leaflet's own default zoom control (pass zoomControl={false} to
// MapContainer) so it matches this pill style instead of Leaflet's plain
// white boxes. Must be rendered INSIDE <MapContainer> — it needs useMap().
export function MapZoomControl({ className }: { className?: string }) {
  const map = useMap();
  return (
    <div className={cn("absolute z-1000 flex flex-col gap-1 rounded-md bg-card/90 p-1 shadow-md ring-1 ring-foreground/10 backdrop-blur-sm", className)}>
      <button
        type="button"
        title="Perbesar"
        onClick={() => map.zoomIn()}
        className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent"
      >
        <Plus className="size-3.5" />
      </button>
      <button
        type="button"
        title="Perkecil"
        onClick={() => map.zoomOut()}
        className="flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent"
      >
        <Minus className="size-3.5" />
      </button>
    </div>
  );
}

// Custom credit line standing in for Leaflet's disabled default
// AttributionControl (every map here sets attributionControl={false}).
export function MapAttribution({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-1000 rounded bg-card/70 px-1.5 py-0.5 text-[9px] text-muted-foreground backdrop-blur-sm",
        className
      )}
    >
      &copy; OSRM &middot; byndrha
    </div>
  );
}
