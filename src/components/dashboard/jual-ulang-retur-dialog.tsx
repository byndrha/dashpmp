"use client";

import { useEffect, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MitraSelect } from "@/components/dashboard/mitra-select";
import {
  jualUlangDalamRuteAction,
  jualUlangLuarRuteAction,
  jualUlangRetailAction,
  getJadwalDetailAction,
} from "@/app/mkesindo/(dashboard)/delivery/actions";
import { getMitraOptionsAction } from "@/app/mkesindo/(dashboard)/mitra/actions";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";
import type { MitraOption } from "@/lib/queries/marketing-wilayah";

// Same dynamic-import-without-ssr pattern every other caller of
// MitraLocationMap already uses (mitra-location-field.tsx,
// mitra-detail-dialog.tsx, pengajuan-sub-tab.tsx, pengajuan-list.tsx) —
// Leaflet touches `window` at module scope and breaks under SSR otherwise.
const MitraLocationMap = dynamic(
  () => import("@/components/dashboard/mitra-location-map").then((m) => m.MitraLocationMap),
  { ssr: false, loading: () => <Skeleton className="h-[260px] w-full rounded-lg" /> }
);

type Jalur = "DALAM_RUTE" | "LUAR_RUTE" | "RETAIL";
// Sentinel for "not chosen yet" — Select items can't use an empty string as
// a value, same convention as UNSET in pemesanan-form-dialog.tsx /
// route-validation-dialog.tsx.
const UNSET = "__unset__";
// Fallback map center when no coordinate has been picked yet for the
// RETAIL jalur — same Jombang-area default MitraLocationField itself falls
// back to when it has no saved/geolocated point.
const DEFAULT_LAT = -7.8;
const DEFAULT_LNG = 111.9;

// Jual Ulang Es Retur di Rute (Task 8) — opened from
// StopDeliveryProofDialog's "Jual ke Mitra Lain" button on a "Retur Baik"
// item. Lets the dispatcher route that returned stock through one of three
// jalur: DALAM_RUTE (another stop still pending on the same Jadwal),
// LUAR_RUTE (any other mitra, searched), or RETAIL (a walk-up sale with no
// fixed mitra record, pinned on the map). Actual document creation is
// entirely server-side (Task 6's three actions below) — this dialog only
// collects the jalur-specific inputs and surfaces validation errors.
export function JualUlangReturDialog({
  jadwalId,
  // JadwalDetailID of the stop this retur ITSELF came from — excluded from
  // the DALAM_RUTE candidate list below (the mitra that rejected this item
  // isn't a sensible target to sell its own retur back to). Sourced by the
  // caller from the same `detail` (DriverStopRow) it already fetched the
  // proof for, not a separately-fetched value.
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
  // DALAM_RUTE jalur's targets, from getJadwalDetailAction (already used by
  // RouteValidationDialog for the same Jadwal), filtered to JamSelesai ==
  // null (not yet delivered) and excluding originJadwalDetailId.
  // Deliberately NOT getSisaReturTersediaAction, which lists retur
  // available to SELL, not stops that can RECEIVE a sale.
  const [belumSelesaiStops, setBelumSelesaiStops] = useState<DriverStopRow[] | null>(null);
  const [targetJadwalDetailId, setTargetJadwalDetailId] = useState<string>(UNSET);
  // LUAR_RUTE's mitra picker options — fetched on demand (this dialog sits
  // several layers below Papan Pengiriman's page, which doesn't otherwise
  // fetch a mitra list), via a lightweight action colocated with the rest
  // of the Mitra module's picker actions.
  const [mitraOptions, setMitraOptions] = useState<MitraOption[] | null>(null);
  const [businessPartnerId, setBusinessPartnerId] = useState("");
  const [qty, setQty] = useState("");
  const [lokasiLat, setLokasiLat] = useState<number | null>(null);
  const [lokasiLng, setLokasiLng] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Resets every jalur-specific input and refetches both pickers whenever a
  // *different* retur item is opened — without this, qty/jalur/mitra chosen
  // for one item would leak into the form the next time this dialog opens
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
    getJadwalDetailAction(jadwalId).then((rows) => {
      setBelumSelesaiStops(rows.filter((r) => r.JamSelesai == null && r.JadwalDetailID !== originJadwalDetailId));
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
        result = await jualUlangDalamRuteAction(target!.stopDeliveryItemId, Number(targetJadwalDetailId), qtyNum);
      } else if (jalur === "LUAR_RUTE") {
        if (!businessPartnerId) {
          setError("Pilih mitra tujuan.");
          return;
        }
        result = await jualUlangLuarRuteAction(target!.stopDeliveryItemId, businessPartnerId, qtyNum, targetJadwalId);
      } else {
        if (lokasiLat == null || lokasiLng == null) {
          setError("Titik lokasi wajib dipilih dari peta.");
          return;
        }
        result = await jualUlangRetailAction(target!.stopDeliveryItemId, qtyNum, lokasiLat, lokasiLng, targetJadwalId);
      }
      if (!result.success) {
        setError(result.error);
        return;
      }
      // Every jualUlang*Action already revalidatePath("/mkesindo/delivery")
      // server-side — this pulls that fresh RSC payload into the
      // already-mounted board so the origin stop's red retur badge (Task 7)
      // and sisa retur figures reflect the sale immediately.
      router.refresh();
      onDone();
    });
  }

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Jual Ulang Retur — {target.itemName}</DialogTitle>
          <DialogDescription className="sr-only">
            Jual ulang stok es retur yang masih baik ke mitra lain dalam rute, mitra luar rute, atau retail.
          </DialogDescription>
        </DialogHeader>
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
        <DialogFooter>
          <Button disabled={pending} onClick={handleSubmit}>
            {pending ? "Menyimpan..." : "Konfirmasi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
