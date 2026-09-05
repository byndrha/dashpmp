"use client";

import { useEffect, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MitraSelect } from "@/components/dashboard/mitra-select";
import {
  getDriverJadwalStopsAction,
  jualUlangDalamRuteDriverAction,
  jualUlangLuarRuteDriverAction,
  jualUlangRetailDriverAction,
} from "@/app/mkesindo/driver-app/actions";
import { getMitraOptionsAction } from "@/app/mkesindo/(dashboard)/mitra/actions";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";
import type { MitraOption } from "@/lib/queries/marketing-wilayah";

// Same dynamic-import-without-ssr pattern every other caller of
// MitraLocationMap already uses (mitra-location-field.tsx,
// mitra-detail-dialog.tsx, pengajuan-sub-tab.tsx, pengajuan-list.tsx,
// jual-ulang-retur-dialog.tsx) — Leaflet touches `window` at module scope
// and breaks under SSR otherwise. MitraLocationMap's own width is already
// percentage-based (height fixed at 260px), so it renders reasonably at
// phone viewport widths with no changes needed here.
const MitraLocationMap = dynamic(
  () => import("@/components/dashboard/mitra-location-map").then((m) => m.MitraLocationMap),
  { ssr: false, loading: () => <Skeleton className="h-[260px] w-full rounded-lg" /> }
);

type Jalur = "DALAM_RUTE" | "LUAR_RUTE" | "RETAIL";
// Sentinel for "not chosen yet" — same convention as
// jual-ulang-retur-dialog.tsx (Task 8) / pemesanan-form-dialog.tsx /
// route-validation-dialog.tsx.
const UNSET = "__unset__";
// Fallback map center when no coordinate has been picked yet for the
// RETAIL jalur — same Jombang-area default MitraLocationField itself falls
// back to when it has no saved/geolocated point.
const DEFAULT_LAT = -7.8;
const DEFAULT_LNG = 111.9;

// Mobile (bottom-sheet) counterpart of JualUlangReturDialog (Task 8,
// src/components/dashboard/jual-ulang-retur-dialog.tsx) — same 3-jalur
// jalur-selection/validation/submit logic, but:
//  - calls the *DriverAction variants (Task 6) instead of the desktop
//    delivery/actions.ts ones (jualUlangDalamRuteDriverAction additionally
//    takes a jadwalId param the desktop equivalent does not, for
//    assertOwnsJadwal's ownership check server-side);
//  - sources its DALAM_RUTE candidate list from getDriverJadwalStopsAction,
//    which is ActionResult-wrapped (unlike the desktop getJadwalDetailAction,
//    which returns a bare array) — result.success is checked before reading
//    result.data;
//  - renders as a fixed bottom sheet (KonfirTerimaStep's own pattern) rather
//    than a shadcn Dialog, to match this app's existing driver-app chrome.
// Opened from two places: the one-shot prompt in stop-flow.tsx right after
// confirmStopDeliveryAction succeeds (Task 9 Step 3), and the persistent
// "Retur Tersedia" access in pengiriman-step.tsx (Task 9 Step 4) for retur
// recorded at an earlier stop on the same route. Purely UI + action calls,
// no business logic duplicated here — same as Task 8's dialog.
export function JualUlangReturSheet({
  jadwalId,
  // JadwalDetailID of the stop this retur ITSELF came from — excluded from
  // the DALAM_RUTE candidate list below (the mitra that rejected this item
  // isn't a sensible target to sell its own retur back to).
  originJadwalDetailId,
  target,
  onOpenChange,
  onDone,
}: {
  jadwalId: number | null;
  originJadwalDetailId: number | null;
  target: { stopDeliveryItemId: number; itemName: string } | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [jalur, setJalur] = useState<Jalur>("LUAR_RUTE");
  // Candidate STOPS (not retur rows) still pending on this Jadwal — the
  // DALAM_RUTE jalur's targets, filtered to JamSelesai == null (not yet
  // delivered) and excluding originJadwalDetailId. Deliberately NOT
  // getSisaReturTersediaDriverAction, which lists retur available to SELL,
  // not stops that can RECEIVE a sale.
  const [belumSelesaiStops, setBelumSelesaiStops] = useState<DriverStopRow[] | null>(null);
  const [targetJadwalDetailId, setTargetJadwalDetailId] = useState<string>(UNSET);
  // LUAR_RUTE's mitra picker options — same lightweight desktop action
  // (auth()-gated only, not role-restricted) jual-ulang-retur-dialog.tsx
  // reuses, so a driver session can call it too.
  const [mitraOptions, setMitraOptions] = useState<MitraOption[] | null>(null);
  const [businessPartnerId, setBusinessPartnerId] = useState("");
  const [qty, setQty] = useState("");
  const [lokasiLat, setLokasiLat] = useState<number | null>(null);
  const [lokasiLng, setLokasiLng] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Resets every jalur-specific input and refetches both pickers whenever a
  // *different* retur item is opened — without this, qty/jalur/mitra chosen
  // for one item would leak into the form the next time this sheet opens
  // for a different item.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJalur("LUAR_RUTE");
    setTargetJadwalDetailId(UNSET);
    setBusinessPartnerId("");
    setQty("");
    setLokasiLat(null);
    setLokasiLng(null);
    setError(null);
    setBelumSelesaiStops(null);
    setMitraOptions(null);

    if (!target || jadwalId == null) return;
    getDriverJadwalStopsAction(jadwalId).then((result) => {
      if (result.success) {
        setBelumSelesaiStops(result.data.filter((r) => r.JamSelesai == null && r.JadwalDetailID !== originJadwalDetailId));
      }
    });
    getMitraOptionsAction().then((result) => {
      if (result.success) setMitraOptions(result.data);
    });
  }, [target, jadwalId, originJadwalDetailId]);

  if (!target) return null;

  function handleSubmit() {
    const qtyNum = Number(qty);
    if (!(qtyNum > 0)) {
      setError("Qty harus lebih dari 0.");
      return;
    }
    if (jadwalId == null) {
      setError("Jadwal tidak diketahui.");
      return;
    }
    const targetJadwalId = jadwalId;
    setError(null);
    startTransition(async () => {
      let result;
      if (jalur === "DALAM_RUTE") {
        if (targetJadwalDetailId === UNSET) {
          setError("Pilih mitra tujuan dalam rute.");
          return;
        }
        result = await jualUlangDalamRuteDriverAction(
          target!.stopDeliveryItemId,
          Number(targetJadwalDetailId),
          qtyNum,
          targetJadwalId
        );
      } else if (jalur === "LUAR_RUTE") {
        if (!businessPartnerId) {
          setError("Pilih mitra tujuan.");
          return;
        }
        result = await jualUlangLuarRuteDriverAction(target!.stopDeliveryItemId, businessPartnerId, qtyNum, targetJadwalId);
      } else {
        if (lokasiLat == null || lokasiLng == null) {
          setError("Titik lokasi wajib dipilih dari peta.");
          return;
        }
        result = await jualUlangRetailDriverAction(target!.stopDeliveryItemId, qtyNum, lokasiLat, lokasiLng, targetJadwalId);
      }
      if (!result.success) {
        setError(result.error);
        return;
      }
      // Every jualUlang*DriverAction already revalidatePath("/mkesindo/driver-app")
      // server-side — this pulls that fresh payload into the already-mounted
      // screen so sisa retur figures reflect the sale immediately.
      router.refresh();
      onDone();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => onOpenChange(false)}>
      <div
        className="max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-background p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="min-w-0 truncate text-base font-semibold">Jual Ulang Retur — {target.itemName}</h2>
          <button type="button" onClick={() => onOpenChange(false)} aria-label="Tutup" className="shrink-0">
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <Select value={jalur} onValueChange={(v) => setJalur((v as Jalur) ?? "LUAR_RUTE")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DALAM_RUTE">Mitra dalam rute (stop belum selesai)</SelectItem>
              <SelectItem value="LUAR_RUTE">Mitra lain (cari)</SelectItem>
              <SelectItem value="RETAIL">Retail Return (non-mitra)</SelectItem>
            </SelectContent>
          </Select>

          {jalur === "DALAM_RUTE" && (
            <Select value={targetJadwalDetailId} onValueChange={(v) => setTargetJadwalDetailId(v ?? UNSET)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pilih mitra tujuan" />
              </SelectTrigger>
              <SelectContent>
                {(belumSelesaiStops ?? []).map((r) => (
                  <SelectItem key={r.JadwalDetailID} value={String(r.JadwalDetailID)}>
                    {r.CustomerName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {jalur === "LUAR_RUTE" && (
            <MitraSelect options={mitraOptions ?? []} value={businessPartnerId} onChange={setBusinessPartnerId} />
          )}

          {jalur === "RETAIL" && (
            <MitraLocationMap
              latitude={lokasiLat ?? DEFAULT_LAT}
              longitude={lokasiLng ?? DEFAULT_LNG}
              onChange={(lat, lng) => {
                setLokasiLat(lat);
                setLokasiLng(lng);
              }}
              recenterKey={0}
            />
          )}

          <Input type="number" min="1" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <Button className="mt-3 w-full" disabled={pending} onClick={handleSubmit}>
          {pending ? "Menyimpan..." : "Konfirmasi"}
        </Button>
      </div>
    </div>
  );
}
