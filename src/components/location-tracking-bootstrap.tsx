"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { Capacitor } from "@capacitor/core";
import { BackgroundGeolocation } from "@capgo/background-geolocation";
import { recordLokasiAction } from "@/app/api/lokasi/actions";

const MIN_PING_INTERVAL_MS = 90_000;

export function LocationTrackingBootstrap() {
  const { status } = useSession();
  const lastSentAtRef = useRef(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (status !== "authenticated") return;
    if (startedRef.current) return;
    startedRef.current = true;

    BackgroundGeolocation.start(
      {
        backgroundTitle: "PMP Group",
        backgroundMessage: "Menjadi Pabrik Es Terbesar di Indonesia",
        requestPermissions: true,
        stale: false,
        distanceFilter: 0,
      },
      (position, error) => {
        if (error || !position) return;
        const now = Date.now();
        if (now - lastSentAtRef.current < MIN_PING_INTERVAL_MS) return;
        lastSentAtRef.current = now;
        recordLokasiAction({
          latitude: position.latitude,
          longitude: position.longitude,
          accuracy: position.accuracy,
        }).catch(() => {
          // A single failed ping isn't user-facing — the next one 90s later
          // will succeed once whatever transient issue (e.g. no network)
          // clears. No retry/backoff needed given how frequent pings are.
        });
      }
    );

    return () => {
      BackgroundGeolocation.stop();
      startedRef.current = false;
    };
  }, [status]);

  return null;
}
