"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";

const MapContent = dynamic(() => import("./peta-overview-map-content"), { ssr: false });

const ROUTE_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];

export function PetaOverviewMap({
  pabrik,
  routes,
}: {
  pabrik: { lat: number; lng: number };
  routes: { jadwalId: number; stops: DriverStopRow[] }[];
}) {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 15_000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const coloredRoutes = routes.map((r, i) => ({ ...r, color: ROUTE_COLORS[i % ROUTE_COLORS.length] }));

  return <MapContent pabrik={pabrik} routes={coloredRoutes} position={position} />;
}
