"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Fuel, Siren, Phone, ChevronUp, ChevronDown, MapPin } from "lucide-react";
import { formatKemasanQty } from "@/lib/format";
import { SwipeToConfirm } from "@/components/driver-app/swipe-to-confirm";
import { PengirimanMap } from "./pengiriman-map";
import { BbmDialog } from "./bbm-dialog";
import { KendalaDialog } from "./kendala-dialog";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";
import { getMultiPointRoute } from "@/lib/osrm";
import { recordStopArrivalAction } from "@/app/driver-app/actions";

export function PengirimanStep({
  jadwalId,
  armadaNama,
  vehicleNo,
  activeStop,
  remainingStops,
  pabrik,
  driverName,
  onArrived,
}: {
  jadwalId: number;
  armadaNama: string;
  vehicleNo: string | null;
  activeStop: DriverStopRow;
  // Every currently-incomplete stop for this Jadwal, in delivery order —
  // activeStop is remainingStops[0]. Drives both the map's numbered
  // markers and the "Lihat Daftar Tujuan" list, so there's one source of
  // truth for "how many locations are left" instead of a separately
  // passed count that can drift from the actual list.
  remainingStops: DriverStopRow[];
  pabrik: { lat: number; lng: number };
  driverName: string;
  onArrived: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [bbmOpen, setBbmOpen] = useState(false);
  const [kendalaOpen, setKendalaOpen] = useState(false);
  const [kendalaReported, setKendalaReported] = useState(false);
  const [showDestinations, setShowDestinations] = useState(false);

  // ETA to the CURRENT stop only, shown in the bottom sheet — independent
  // of PengirimanMap's own route, which threads through every remaining
  // stop rather than just this one.
  useEffect(() => {
    if (activeStop.Latitude == null || activeStop.Longitude == null) return;
    let cancelled = false;
    getMultiPointRoute([pabrik, { lat: activeStop.Latitude, lng: activeStop.Longitude }])
      .then((r) => {
        if (!cancelled) setEtaMinutes(r.durationMinutes);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // pabrik is a stable prop (same object reference for the whole
    // screen's lifetime) — depending on its lat/lng scalars instead avoids
    // re-running this on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStop.JadwalDetailID, activeStop.Latitude, activeStop.Longitude, pabrik.lat, pabrik.lng]);

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

  const stopMarkers = remainingStops
    .filter((s): s is DriverStopRow & { Latitude: number; Longitude: number } => s.Latitude != null && s.Longitude != null)
    .map((s, i) => ({ lat: s.Latitude, lng: s.Longitude, label: i + 1 }));

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <PengirimanMap origin={pabrik} stops={stopMarkers} className="absolute inset-0" />

      {/* z-10, not z-1000: PengirimanMap's own z-1000 internals are now
          contained in their own stacking context (see pengiriman-map.tsx),
          so this only needs to clear the map's z-0 root — staying well
          under any real <Dialog> (z-50), which must always win over this
          screen's own custom floating chrome. */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-start gap-3 p-3">
        <button
          type="button"
          onClick={() => router.push("/driver-app")}
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

      <div className="absolute inset-x-0 bottom-0 z-10 flex max-h-[70dvh] flex-col rounded-t-2xl bg-card shadow-[0_-4px_16px_rgba(0,0,0,0.15)]">
        <div className="flex shrink-0 justify-center pt-2">
          <div className="h-1 w-10 rounded-full bg-muted" />
        </div>
        <div className="flex shrink-0 flex-col gap-2 px-4 pt-2 pb-4">
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

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <SwipeToConfirm label="Geser untuk Tiba" pending={pending} onConfirm={handleArrived} className="flex-1" />
            {activeStop.MobileNo && (
              <a
                href={`tel:${activeStop.MobileNo}`}
                className="flex size-12 shrink-0 items-center justify-center rounded-full bg-green-600 text-white shadow-md"
                title="Telepon Pelanggan"
              >
                <Phone className="size-5" />
              </a>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowDestinations((v) => !v)}
          className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-3"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
            <MapPin className="size-4" />
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="text-sm font-medium">Lihat Daftar Tujuan</p>
            <p className="text-[11px] uppercase text-muted-foreground">{remainingStops.length} lokasi tersisa</p>
          </div>
          {showDestinations ? <ChevronDown className="size-4 shrink-0" /> : <ChevronUp className="size-4 shrink-0" />}
        </button>
        {showDestinations && (
          <div className="min-h-0 overflow-y-auto border-t border-border px-4 py-2">
            {remainingStops.map((s, i) => (
              <div key={s.JadwalDetailID} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-foreground text-[10px] font-medium">
                  {i + 1}
                </span>
                <span className="truncate">{s.CustomerName}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <BbmDialog open={bbmOpen} onOpenChange={setBbmOpen} jadwalId={jadwalId} />
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
