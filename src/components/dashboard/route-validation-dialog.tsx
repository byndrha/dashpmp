"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { GripVertical, MapPin, Route as RouteIcon, Fuel, Clock, Plus, Printer, X, Share2, Truck, Package, Image as ImageIcon, List, ChevronDown, History, Gauge, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeInput } from "@/components/ui/time-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VerticalTimeline, VerticalTimelineItem } from "@/components/ui/vertical-timeline";
import { CheckSummary } from "@/components/vehicle-check-summary";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDate, formatRupiah, formatTime, formatKemasanQty } from "@/lib/format";
import { estimateDeliveryMinutes, CONFIRMATION_MINUTES_PER_STOP } from "@/lib/delivery-duration";
import type { JadwalCard as JadwalCardData, JadwalDetailRow, DriverStopRow, AvailableSalesOrder, ArmadaConflictInfo } from "@/lib/queries/pengiriman-jadwal";
import type { DriverOption } from "@/lib/queries/delivery";
import type { MultiPointRoute } from "@/lib/osrm";
import type { FuelType } from "@/lib/armada-fuel";
import { VehicleCheckDialog } from "@/components/dashboard/vehicle-check-dialog";
import { ArmadaConflictDialog } from "@/components/dashboard/armada-conflict-dialog";
import { StopDeliveryProofDialog } from "@/components/dashboard/stop-delivery-proof-dialog";
import { triggerPrintQueuePollNow } from "@/components/dashboard/print-queue-poller";
import type {
  VehicleCheckRow,
  VehicleCheckTipe,
  FuelBar,
  VehicleCheckPhoto,
  JenisFotoKendaraan,
} from "@/lib/vehicle-check-types";
import {
  getJadwalDetailAction,
  updateJadwalUrutanAction,
  updateJadwalDriverTimeAction,
  addSalesOrdersToJadwalAction,
  removeSalesOrderFromJadwalAction,
  getAvailableSalesOrdersAction,
  deleteJadwalDraftAction,
  startMuatAction,
  selesaiMuatAction,
  konfirmasiBerangkatAction,
  getVehicleChecksForJadwalAction,
  createVehicleCheckAction,
  checkArmadaConflictAction,
  getPriceLevelOptionsAction,
  getDriverPositionAction,
  getIstirahatForJadwalAction,
  enqueueManualReprintAction,
} from "@/app/mkesindo/(dashboard)/delivery/actions";
import type { PriceLevelOption } from "@/lib/queries/mitra";
import type { IstirahatSession } from "@/lib/queries/driver-istirahat";

const RouteMap = dynamic(() => import("@/components/dashboard/route-map").then((m) => m.RouteMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-lg" />,
});

// Resolves the "end" instant for an in-progress elapsed-time calculation —
// pulled out to a plain module-level function (rather than calling
// Date.now() straight inside a component's useMemo) so the
// react-hooks/purity lint rule doesn't flag it: it only recognizes impure
// calls written directly in a component/hook body, not ones behind a
// named helper.
function resolveEndMs(actualEnd: string | Date | null): number {
  return actualEnd ? new Date(actualEnd).getTime() : Date.now();
}

// "5 Menit" under an hour, "4 Jam 5 Menit" (or "4 Jam" flat) at or above.
function formatDurationMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, totalMinutes);
  if (minutes < 60) return `${minutes} Menit`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} Jam ${rest} Menit` : `${hours} Jam`;
}

function SortableStopRow({
  detail,
  index,
  onEdit,
  disabled,
  onReprint,
  reprinting,
  onRemove,
  hasDeparted,
  onOpenProof,
}: {
  detail: DriverStopRow;
  index: number;
  onEdit: (detail: DriverStopRow) => void;
  disabled: boolean;
  onReprint: (jadwalDetailId: number) => void;
  // True while THIS row's own reprint request is in flight — disables the
  // icon so a fast repeat-click can't fire enqueueManualReprintAction
  // multiple times for the same stop (each call is an unconditional INSERT
  // with no dedup, so duplicates would each get physically reprinted by the
  // print-queue poller).
  reprinting: boolean;
  // Only usable while the Jadwal is still Draft (matches
  // removeSalesOrderFromJadwal's own guard) — omitted/hidden once Terbit.
  onRemove?: (detail: DriverStopRow) => void;
  // Once the armada is Berangkat, the manual-reprint icon no longer makes
  // sense here (per-stop invoices are already settled by then) — it's
  // replaced per-row by a checkmark the moment that stop's own delivery
  // completes (detail.JamSelesai), opening the proof-of-delivery popup.
  hasDeparted: boolean;
  onOpenProof: (detail: DriverStopRow) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: detail.JadwalDetailID,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 border-b bg-card px-3 py-2.5 text-sm last:border-b-0",
        isDragging && "z-10 opacity-70 shadow-lg"
      )}
    >
      <button type="button" {...attributes} {...listeners} className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing">
        <GripVertical className="size-4" />
      </button>
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {index + 1}
      </span>
      <button
        type="button"
        onClick={() => !disabled && onEdit(detail)}
        disabled={disabled}
        className="min-w-0 flex-1 text-left hover:underline disabled:cursor-default disabled:hover:no-underline"
      >
        <p className="truncate text-base font-semibold">{detail.CustomerName}</p>
        <p className="flex items-center gap-1 truncate text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" />
          {detail.Wilayah}
          {detail.Kecamatan ? ` | ${detail.Kecamatan}` : ""}
        </p>
        {detail.JamTiba != null && (
          <p className="text-xs text-muted-foreground">Tiba {formatTime(detail.JamTiba)}</p>
        )}
      </button>
      {/* Widened per explicit user request (confirmed OK with the tighter
          name/location column that results) so "155 kantong (10 KG)" fits
          on one line instead of wrapping — was w-24, which avoided the
          name/location column being squeezed to zero width but wrapped
          this qty text awkwardly. */}
      <span className="w-40 shrink-0 text-right tabular-nums">
        <span className="font-medium">
          {formatKemasanQty(detail.Qty10KG, detail.Qty5KG)}
          {detail.BonusQty > 0 && <span className="text-primary"> (+{detail.BonusQty} bonus)</span>}
        </span>
        <span className="block text-xs text-muted-foreground">~{estimateDeliveryMinutes(detail.Qty)} menit</span>
      </span>
      {detail.Latitude == null && (
        <Badge variant="outline" className="shrink-0 border-destructive/30 text-[10px] text-destructive">
          Tanpa lokasi
        </Badge>
      )}
      {detail.IsTerkendala && (
        <Badge
          variant="outline"
          className="shrink-0 border-destructive/30 text-[10px] text-destructive"
          title={detail.TerkendalaAlasan ?? undefined}
        >
          Terkendala
        </Badge>
      )}
      {!hasDeparted ? (
        // Always shown pre-departure, even before Selesai Muat has created
        // this stop's SalesInvoice — enqueueManualReprintAction (Task 3)
        // already rejects with a clear AppError ("SI ... belum terbit") in
        // that case, surfaced below as a toast, so there's no need to hide
        // the button and make an operator wonder where it went.
        <button
          type="button"
          title="Cetak ulang SI"
          onClick={() => onReprint(detail.JadwalDetailID)}
          disabled={reprinting}
          className="shrink-0 rounded border border-transparent p-1 text-muted-foreground transition-colors hover:border-border disabled:cursor-default disabled:opacity-50"
        >
          <Printer className="size-3.5" />
        </button>
      ) : detail.JamSelesai != null ? (
        <button
          type="button"
          title="Lihat bukti pengiriman"
          onClick={() => onOpenProof(detail)}
          className="shrink-0 rounded border border-transparent p-1 text-green-600 transition-colors hover:border-border hover:bg-green-600/10"
        >
          <CheckCircle2 className="size-4" />
        </button>
      ) : (
        <span className="size-6 shrink-0" />
      )}
      {onRemove && (
        <button
          type="button"
          title="Keluarkan dari draft"
          onClick={() => onRemove(detail)}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function RouteValidationDialog({
  jadwal,
  businessDate,
  todayISO,
  drivers,
  armadaId,
  armadaNama,
  armadaPlat,
  konsumsiBBM,
  kapasitasMaks,
  jenisBBM,
  biayaBBMPerLiter,
  isSatpam,
  onOpenChange,
  onDeleted,
  onEditSalesOrder,
  salesOrderEditSignal,
}: {
  jadwal: JadwalCardData | null;
  businessDate: string;
  todayISO: string;
  drivers: DriverOption[];
  // The open Jadwal's own ArmadaID — same already-resolved ArmadaRow the
  // caller uses for armadaNama/konsumsiBBM/kapasitasMaks/jenisBBM below.
  // Needed as a form field for the Satpam photo-upload endpoint. Null for
  // the same reason armadaNama can be null (jadwal == null / no matching
  // Armada resolved yet).
  armadaId: number | null;
  // Display-only, for the Share summary text — same ArmadaRow the caller
  // already resolved for konsumsiBBM/kapasitasMaks below.
  armadaNama: string | null;
  // Display-only, shown in the header next to armadaNama — same ArmadaRow
  // the caller already resolved (ArmadaRow.PlatNomor).
  armadaPlat: string | null;
  // Fuel estimate input — the Armada the open Jadwal belongs to, resolved
  // by the caller (JadwalCard itself doesn't carry KonsumsiBBM, ArmadaRow
  // does).
  konsumsiBBM: number | null;
  // Capacity hard-block input, same resolution path as konsumsiBBM. Null
  // means no limit has been configured, so nothing is blocked.
  kapasitasMaks: number | null;
  // Same resolution path as konsumsiBBM/kapasitasMaks — both null when
  // the Armada hasn't had these fields filled in yet.
  jenisBBM: FuelType | null;
  biayaBBMPerLiter: number | null;
  // Current session's Satpam flag, resolved server-side by the caller —
  // gates whether VehicleCheckPanel shows an editable form or a read-only
  // summary/placeholder.
  isSatpam: boolean;
  onOpenChange: (open: boolean) => void;
  // Fired after a successful "Batalkan Draft" so the caller can close this
  // dialog (it has no Jadwal left to show once deleted).
  onDeleted?: () => void;
  // Fired when a stop is clicked — the caller opens UbahPemesananDialog as a
  // sibling Dialog on top of this one, deliberately WITHOUT closing this
  // dialog first, so it stays visible (and its scroll/route-calc state
  // intact) underneath once the edit dialog closes again.
  onEditSalesOrder: (detail: JadwalDetailRow) => void;
  // Bumped by the caller every time UbahPemesananDialog closes (see
  // onEditSalesOrder above) — a Qty edit reached through that dialog can
  // change this Jadwal's per-stop Qty/totals/capacity, so this dialog
  // needs an explicit nudge to refetch `order` rather than staying stale
  // until the whole dialog is closed and reopened.
  salesOrderEditSignal: number;
}) {
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<DriverStopRow[]>([]);
  const [vehicleChecks, setVehicleChecks] = useState<VehicleCheckRow[]>([]);
  // Every istirahat session logged against this Jadwal — feeds the Riwayat
  // Status popover's time summary (Task 11), fetched alongside
  // vehicleChecks in the same jadwalId-keyed effect below.
  const [istirahatSessions, setIstirahatSessions] = useState<IstirahatSession[]>([]);
  // Freely editable delivery date — the primary override for this Jadwal's
  // departure day. Kept as its own field (not derived from businessDate's
  // rollover label) precisely so staff can set ANY calendar date here,
  // including one outside the board's current businessDate/businessDate-1
  // window — see buildJamJadwal below and skipOrderTimeCheck at the
  // updateJadwalDriverTimeAction call sites.
  const [date, setDate] = useState("");
  const [time, setTime] = useState("00:00");
  const [driverId, setDriverId] = useState("");
  const [pabrik, setPabrik] = useState<{ latitude: number; longitude: number } | null>(null);
  // For Efektifitas Armada's weighted-average selling price — refetched
  // per dialog open alongside pabrik below, same convention this file
  // already uses rather than a separate mount-once fetch.
  const [priceLevels, setPriceLevels] = useState<PriceLevelOption[]>([]);
  // Live driver GPS for RouteMap's rotating truck marker — polled every 10s
  // once Mulai Muat is done, see the effect below. Null hides the marker.
  const [driverPosition, setDriverPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  // The stop whose "Lihat bukti pengiriman" checkmark was clicked — null
  // closes StopDeliveryProofDialog, same open-via-prop convention this
  // dialog itself uses (open={jadwalId != null}).
  const [proofDetail, setProofDetail] = useState<DriverStopRow | null>(null);
  const [route, setRoute] = useState<MultiPointRoute | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Set when checkArmadaConflictAction finds an overlapping Draft for this
  // armada — pauses the save (see handleSaveDriverTime/handleSelesaiMuat)
  // until the user confirms merging via ArmadaConflictDialog. Stores the
  // exact jamJadwal that was checked (not a bare ArmadaConflictInfo) so
  // onConfirm below reuses that validated value instead of recomputing
  // buildJamJadwal() again against possibly-changed date/time state, and
  // `then` discriminates which of the two handlers to resume since both
  // share this one piece of state.
  const [conflict, setConflict] = useState<{ info: ArmadaConflictInfo; jamJadwal: Date; then: "save" | "selesaiMuat" } | null>(null);
  // Lets staff drop the map panel entirely (no Leaflet init, no OSRM wait) —
  // useful on a slow connection when all they need is the stop list/totals
  // to check or share, matching what's already in buildShareText.
  const [showMap, setShowMap] = useState(true);
  // True only while captureDialogImage() is mid-capture — drops the
  // destinations list's max-height/scroll so every stop renders in the
  // screenshot instead of only whatever was scrolled into view.
  const [capturing, setCapturing] = useState(false);
  // Bumped right before a "Seluruhnya" capture to force RouteMap to
  // re-fit its bounds to the whole route (un-animated) before the
  // screenshot, overriding any manual pan/zoom — see FitBounds in
  // route-map.tsx.
  const [refitTrigger, setRefitTrigger] = useState(0);

  const [adding, setAdding] = useState(false);
  const [availableToAdd, setAvailableToAdd] = useState<AvailableSalesOrder[]>([]);
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);

  // Tracks the single JadwalDetailID (if any) whose reprint request is
  // currently in flight — disables just that row's icon (see
  // SortableStopRow's reprinting prop) so a fast repeat-click can't enqueue
  // duplicate print-queue rows before the first request's toast lands.
  // Deliberately its own state rather than reusing the shared `pending`
  // boolean from useTransition above: `pending` also gates unrelated
  // buttons elsewhere in this dialog (e.g. "Tambah"), so tying it to a
  // reprint click would needlessly disable those too.
  const [reprintingId, setReprintingId] = useState<number | null>(null);

  function handleReprint(jadwalDetailId: number) {
    setReprintingId(jadwalDetailId);
    startTransition(async () => {
      const result = await enqueueManualReprintAction(jadwalDetailId);
      setReprintingId(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("SI ditambahkan ke antrian cetak.");
      // Nudge PrintQueuePoller to drain right away instead of leaving this
      // job to wait for its next scheduled tick (up to POLL_INTERVAL_MS).
      triggerPrintQueuePollNow();
    });
  }

  const jadwalId = jadwal?.JadwalID ?? null;
  // RouteValidationDialog is a single persistent instance whose `jadwal`
  // prop is swapped by pengiriman-board.tsx's detailJadwalId state, not
  // remounted per card — so this ref tracks which Jadwal it is CURRENTLY
  // showing, resynced on every render straight from jadwalId rather than
  // from an open/close event, since an externally-driven open never fires
  // this component's own onOpenChange. Every async handler below captures
  // its own `targetId` at call time and re-checks this ref after each
  // await before touching setError/setAddError or any dialog-closing
  // state (onDeleted/onOpenChange) — a request in flight for one Jadwal
  // whose dialog got dismissed (or replaced by a different Jadwal card)
  // before the response arrives must not paint its stale error, or
  // silently close whichever Jadwal is now open, discarding its
  // in-progress state. Side effects that are true regardless of what's
  // currently displayed (toast notifications, opening a printed invoice
  // for a stop that really was just invoiced) are deliberately left
  // unguarded — the underlying action genuinely happened and skipping
  // them would change business behavior, not just avoid a stale paint.
  const jadwalIdRef = useRef<number | null>(jadwalId);
  jadwalIdRef.current = jadwalId;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const totalQty = useMemo(() => order.reduce((sum, o) => sum + o.Qty, 0), [order]);
  const totalBonusQty = useMemo(() => order.reduce((sum, o) => sum + o.BonusQty, 0), [order]);
  const totalQty10KG = useMemo(() => order.reduce((sum, o) => sum + o.Qty10KG, 0), [order]);
  const totalQty5KG = useMemo(() => order.reduce((sum, o) => sum + o.Qty5KG, 0), [order]);
  const selectedToAddQty = useMemo(
    () => availableToAdd.filter((so) => selectedToAdd.has(so.SalesOrderID)).reduce((sum, so) => sum + so.Qty, 0),
    [availableToAdd, selectedToAdd]
  );

  useEffect(() => {
    // Resets the "Tambahkan" sub-panel when a different Jadwal card is
    // opened — not derivable from render since these are user-editable
    // picker fields, not synced from any jadwal prop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAdding(false);
    setSelectedToAdd(new Set());
    setAddError(null);
    setShowMap(true);
    // A conflict popup left open from a previously-shown Jadwal must never
    // resurface against whichever Jadwal is opened next.
    setConflict(null);
    // Same reasoning — a proof-of-delivery popup for a stop on the
    // previous Jadwal must not stay open against the newly-opened one.
    setProofDetail(null);

    if (jadwalId == null) {
      setOrder([]);
      setVehicleChecks([]);
      setIstirahatSessions([]);
      return;
    }
    setLoading(true);
    setError(null);
    getJadwalDetailAction(jadwalId)
      .then((rows) => {
        setOrder(rows);
      })
      .finally(() => setLoading(false));
    getVehicleChecksForJadwalAction(jadwalId).then(setVehicleChecks);
    getIstirahatForJadwalAction(jadwalId).then(setIstirahatSessions);
  }, [jadwalId]);

  // Refetches just `order` after UbahPemesananDialog closes (saved or
  // cancelled — refetching unconditionally is simplest and safe: idempotent
  // if nothing changed, correctly fresh if the Qty edit went through).
  // Deliberately a separate effect from the one above rather than adding
  // salesOrderEditSignal to its dependency array — that effect also resets
  // the "Tambahkan" sub-panel, print selections, and map visibility, none
  // of which should be disturbed by an in-place Qty edit on one stop.
  useEffect(() => {
    if (jadwalId == null) return;
    getJadwalDetailAction(jadwalId).then(setOrder);
    // Deliberately keyed on salesOrderEditSignal only, not jadwalId — the
    // effect above already covers the initial fetch / jadwalId change, and
    // including jadwalId here too would just re-run this fetch redundantly
    // right after that one on every open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesOrderEditSignal]);

  useEffect(() => {
    if (jadwal == null) return;
    const d = new Date(jadwal.JamJadwal);
    // Syncs the editable date/time/driver fields from the open card — not
    // derivable from render since these are user-editable inputs. Unlike
    // the old time-only sync, this keeps the real calendar date too (see
    // the `date` state's own comment).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
    setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    setDriverId(jadwal.SalesmanID ?? "");
  }, [jadwal]);

  // Builds the departure Date directly from the freely-editable `date` +
  // `time` fields — deliberately NOT resolveBusinessDateTime(businessDate,
  // time), which can only ever land on businessDate or businessDate minus
  // one day (see its own comment) and silently discards any date the user
  // picks outside that 2-day window. `date` is the authoritative source of
  // truth for the calendar day here.
  function buildJamJadwal(): Date {
    return new Date(`${date}T${time}:00`);
  }

  useEffect(() => {
    if (jadwalId == null) return;
    fetch("/api/mkesindo/pabrik-location")
      .then((res) => res.json())
      .then((data: { latitude: number; longitude: number }) => setPabrik(data))
      .catch(() => setPabrik(null));
    getPriceLevelOptionsAction().then(setPriceLevels);
  }, [jadwalId]);

  // Live driver position for RouteMap's rotating truck marker — starts
  // once "Mulai Muat" has actually happened (confirmed 2026-08-20: shows
  // the driver's real position "mengikuti rute pengiriman" from that
  // point on) and keeps polling every 10 seconds (explicit request — 20s
  // was judged too slow) for as long as this dialog stays open on this
  // Jadwal. Requires a linked driver account (SalesmanID) — no account,
  // no ping to look up.
  const jamMulaiMuat = jadwal?.JamMulaiMuat ?? null;
  const salesmanIdForTracking = jadwal?.SalesmanID ?? null;
  useEffect(() => {
    if (jadwalId == null || jamMulaiMuat == null || !salesmanIdForTracking) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDriverPosition(null);
      return;
    }
    let cancelled = false;
    function poll() {
      getDriverPositionAction(salesmanIdForTracking!).then((pos) => {
        if (cancelled) return;
        setDriverPosition(pos ? { latitude: pos.latitude, longitude: pos.longitude } : null);
      });
    }
    poll();
    const interval = setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jadwalId, jamMulaiMuat, salesmanIdForTracking]);

  // Recomputes the route whenever the stop order or the pabrik location
  // changes. Every stop must have a saved coordinate — otherwise a full
  // route genuinely can't be computed, so this surfaces as routeError
  // (which in turn keeps "Berangkat" disabled, matching the mandatory-route
  // rule) instead of silently skipping stops.
  useEffect(() => {
    let cancelled = false;
    if (pabrik == null || order.length === 0) return;
    const missing = order.some((o) => o.Latitude == null || o.Longitude == null);
    if (missing) {
      // Stops changed to a set that genuinely can't be routed (missing
      // coordinates) — reset any stale route from the previous stop order
      // so "Berangkat" doesn't stay enabled against it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRoute(null);
      setRouteError("Beberapa tujuan belum punya lokasi tersimpan — tidak bisa hitung rute.");
      return;
    }
    setRouteLoading(true);
    setRouteError(null);
    const points = [
      { lat: pabrik.latitude, lng: pabrik.longitude },
      ...order.map((o) => ({ lat: o.Latitude as number, lng: o.Longitude as number })),
      { lat: pabrik.latitude, lng: pabrik.longitude },
    ];
    fetch("/api/mkesindo/routing/multi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points }),
    })
      .then((res) => res.json())
      .then((data: MultiPointRoute | { error: string }) => {
        if (cancelled) return;
        if ("error" in data) {
          setRoute(null);
          setRouteError(data.error);
        } else {
          setRoute(data);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setRoute(null);
        setRouteError("Gagal menghitung rute.");
      })
      .finally(() => {
        if (cancelled) return;
        setRouteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [order, pabrik]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.findIndex((o) => o.JadwalDetailID === active.id);
    const newIndex = order.findIndex((o) => o.JadwalDetailID === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    if (jadwalId != null) {
      const targetId = jadwalId;
      setError(null);
      startTransition(async () => {
        const result = await updateJadwalUrutanAction(targetId, next.map((d) => d.JadwalDetailID));
        if (jadwalIdRef.current !== targetId) return;
        if (!result.success) {
          setError(result.error);
        }
      });
    }
  }

  // Actual driver/time persist, split out of handleSaveDriverTime so it can
  // run either immediately (no conflict) or after the user confirms merging
  // via ArmadaConflictDialog (see the conflict-check pre-flight below).
  function doSaveDriverTime(targetId: number, jamJadwal: Date) {
    startTransition(async () => {
      const result = await updateJadwalDriverTimeAction(
        targetId,
        { jamJadwal, salesmanId: driverId || null },
        { skipOrderTimeCheck: true }
      );
      if (!result.success) {
        if (jadwalIdRef.current === targetId) setError(result.error);
        return;
      }
      // The new time landed inside another Draft's estimated busy window
      // for the same armada — this Jadwal got folded into that one
      // instead (see updateJadwalDriverTime), so there's nothing left
      // under jadwalId to keep showing here.
      if (result.data !== targetId) {
        toast.success(`Digabung dengan keberangkatan lain di jam yang sama untuk armada ini.`);
        if (jadwalIdRef.current === targetId) {
          onDeleted?.();
          onOpenChange(false);
        }
      }
    });
  }

  // Standalone "Simpan" path — still needed on its own since editing
  // driver/time while already Terbit (re-assigning driver/vehicle onto
  // existing DOs) doesn't go through handleSelesaiMuat/handleKonfirmasiBerangkat.
  // Pre-checks for an armada conflict (an overlapping Draft on the same
  // armada) before persisting — if found, pauses on ArmadaConflictDialog
  // instead of saving straight away (see conflict state above).
  function handleSaveDriverTime() {
    if (jadwalId == null || armadaId == null) return;
    const targetId = jadwalId;
    const jamJadwal = buildJamJadwal();
    setError(null);
    startTransition(async () => {
      const check = await checkArmadaConflictAction(armadaId, jamJadwal, totalQty, targetId);
      if (jadwalIdRef.current !== targetId) return;
      if (check) {
        setConflict({ info: check, jamJadwal, then: "save" });
        return;
      }
      doSaveDriverTime(targetId, jamJadwal);
    });
  }

  // Removing the last remaining stop also deletes the now-empty Jadwal
  // itself (removeSalesOrderFromJadwal's own cleanup) — nothing left to
  // show, so this closes the dialog the same way "Batalkan Draft" does.
  function handleRemoveStop(detail: DriverStopRow) {
    if (jadwalId == null) return;
    if (!confirm(`Keluarkan "${detail.CustomerName}" dari draft ini?`)) return;
    const targetId = jadwalId;
    setError(null);
    startTransition(async () => {
      const result = await removeSalesOrderFromJadwalAction(targetId, detail.SalesOrderID);
      if (!result.success) {
        if (jadwalIdRef.current === targetId) setError(result.error);
        return;
      }
      if (order.length <= 1) {
        if (jadwalIdRef.current === targetId) {
          onDeleted?.();
          onOpenChange(false);
        }
        return;
      }
      const rows = await getJadwalDetailAction(targetId);
      if (jadwalIdRef.current === targetId) setOrder(rows);
    });
  }

  function handleDeleteDraft() {
    if (jadwalId == null) return;
    const targetId = jadwalId;
    setError(null);
    startTransition(async () => {
      const result = await deleteJadwalDraftAction(targetId);
      if (!result.success) {
        if (jadwalIdRef.current === targetId) setError(result.error);
        return;
      }
      if (jadwalIdRef.current === targetId) {
        onDeleted?.();
        onOpenChange(false);
      }
    });
  }

  // Manual fallback for "Mulai Muat" — the primary path is Aplikasi
  // Produksi's Isi Muatan flow (produksiMulaiMuatAction), which also
  // records pallet/stock consumption. This button calls startMuatAction
  // directly, exactly like before Produksi existed, for cases where a
  // Kartu Pengiriman needs to be pushed through without going via
  // produksi-app (e.g. a backlog Draft, or Produksi is unavailable) —
  // it does NOT deduct any pallet stock, so using it means the
  // warehouse/FIFO records won't reflect what was actually shipped.
  function handleMuat() {
    if (jadwalId == null) return;
    const targetId = jadwalId;
    setError(null);
    startTransition(async () => {
      const result = await startMuatAction(targetId);
      if (!result.success) {
        if (jadwalIdRef.current === targetId) setError(result.error);
      }
    });
  }

  // Selesai Muat creates the real DO+SI documents (see selesaiMuat); actual
  // printing of those documents is entirely the print queue's job now (see
  // Task 4/11 — selesaiMuat itself enqueues a print job per stop), so this
  // handler has no printing-related code of its own.
  //
  // Persists the currently-selected driver/time FIRST, same safety net the
  // old (now-removed) handleBerangkat had before it called startBerangkat:
  // selesaiMuat reads SalesmanID off the DB row, not off this component's
  // client state, so a driver picked in the dropdown but not yet "Simpan"-ed
  // would otherwise get silently attributed to whichever driver was last
  // persisted — on a real DeliveryOrder/SalesInvoice, once Status flips to
  // Terbit, that misattribution can no longer be corrected through the UI
  // (updateJadwalDriverTime refuses any edit once not Draft).
  // Actual driver/time persist + follow-on selesaiMuat, split out of
  // handleSelesaiMuat so it can run either immediately (no conflict) or
  // after the user confirms merging via ArmadaConflictDialog. Unlike
  // doSaveDriverTime, a successful save here continues on to
  // selesaiMuatAction and the invoice-printing loop — that's why this
  // isn't just a call to doSaveDriverTime.
  function doSaveDriverTimeThenSelesaiMuat(targetId: number, jamJadwal: Date) {
    startTransition(async () => {
      const driverTimeResult = await updateJadwalDriverTimeAction(
        targetId,
        { jamJadwal, salesmanId: driverId || null },
        { skipOrderTimeCheck: true }
      );
      if (!driverTimeResult.success) {
        if (jadwalIdRef.current === targetId) setError(driverTimeResult.error);
        return;
      }
      // The new time landed inside another Draft's estimated busy window
      // for the same armada — this Jadwal got folded into that one
      // instead (see updateJadwalDriverTime), so there's nothing left
      // under jadwalId to run selesaiMuat against anymore.
      if (driverTimeResult.data !== targetId) {
        toast.success(
          "Waktu ini tumpang tindih dengan keberangkatan lain untuk armada ini — sudah digabung. Buka kembali untuk melanjutkan keberangkatan."
        );
        if (jadwalIdRef.current === targetId) {
          onDeleted?.();
          onOpenChange(false);
        }
        return;
      }
      const selesaiMuatResult = await selesaiMuatAction(targetId);
      if (!selesaiMuatResult.success) {
        if (jadwalIdRef.current === targetId) setError(selesaiMuatResult.error);
        return;
      }
      const rows = await getJadwalDetailAction(targetId);
      if (jadwalIdRef.current === targetId) setOrder(rows);
    });
  }

  // Pre-checks for an armada conflict (an overlapping Draft on the same
  // armada) before persisting — if found, pauses on ArmadaConflictDialog
  // instead of proceeding straight to save + selesaiMuat (see conflict
  // state above and doSaveDriverTimeThenSelesaiMuat).
  function handleSelesaiMuat() {
    if (jadwalId == null || armadaId == null) return;
    const targetId = jadwalId;
    const jamJadwal = buildJamJadwal();
    setError(null);
    startTransition(async () => {
      const check = await checkArmadaConflictAction(armadaId, jamJadwal, totalQty, targetId);
      if (jadwalIdRef.current !== targetId) return;
      if (check) {
        setConflict({ info: check, jamJadwal, then: "selesaiMuat" });
        return;
      }
      doSaveDriverTimeThenSelesaiMuat(targetId, jamJadwal);
    });
  }

  function handleKonfirmasiBerangkat() {
    if (jadwalId == null) return;
    const targetId = jadwalId;
    setError(null);
    startTransition(async () => {
      const result = await konfirmasiBerangkatAction(targetId);
      if (!result.success) {
        if (jadwalIdRef.current === targetId) setError(result.error);
      }
    });
  }

  function handleOpenAdd() {
    if (jadwalId == null) return;
    setAdding(true);
    setSelectedToAdd(new Set());
    setAddError(null);
    getAvailableSalesOrdersAction(businessDate).then(setAvailableToAdd);
  }

  function handleToggleAdd(id: string, qty: number) {
    setSelectedToAdd((prev) => {
      const isSelected = prev.has(id);
      if (!isSelected && kapasitasMaks != null && totalQty + selectedToAddQty + qty > kapasitasMaks) {
        return prev;
      }
      const next = new Set(prev);
      if (isSelected) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleConfirmAdd() {
    if (jadwalId == null || selectedToAdd.size === 0) return;
    const targetId = jadwalId;
    setAddError(null);
    startTransition(async () => {
      const result = await addSalesOrdersToJadwalAction(targetId, [...selectedToAdd]);
      if (!result.success) {
        if (jadwalIdRef.current === targetId) setAddError(result.error);
        return;
      }
      const rows = await getJadwalDetailAction(targetId);
      if (jadwalIdRef.current === targetId) {
        setOrder(rows);
        setAdding(false);
      }
    });
  }

  async function handleUploadVehiclePhoto(file: File, jenisFoto: JenisFotoKendaraan): Promise<string> {
    if (armadaId == null) throw new Error("Armada tidak diketahui.");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("armadaId", String(armadaId));
    formData.append("jenisFoto", jenisFoto);
    const res = await fetch("/api/mkesindo/upload/satpam-check", { method: "POST", body: formData });
    const data = (await res.json()) as { path?: string; error?: string };
    if (!res.ok || !data.path) throw new Error(data.error ?? "Gagal mengunggah foto.");
    return data.path;
  }

  async function handleSubmitVehicleCheck(input: {
    tipe: VehicleCheckTipe;
    odometerKM: number;
    fuelBar: FuelBar;
    muatanQty: number;
    remark: string | null;
    photos: VehicleCheckPhoto[];
  }): Promise<void> {
    if (jadwalId == null) return;
    const result = await createVehicleCheckAction({ jadwalId, ...input });
    if (!result.success) {
      throw new Error(result.error);
    }
    const rows = await getVehicleChecksForJadwalAction(jadwalId);
    setVehicleChecks(rows);
  }

  const isDraft = jadwal?.Status === "Draft";
  const isWaitingDeparture = jadwal?.Status === "Terbit" && jadwal?.JamAktualBerangkat == null;
  const hasDeparted = jadwal?.JamAktualBerangkat != null;
  const hasBerangkatCheck = vehicleChecks.some((c) => c.tipe === "BERANGKAT");
  const jamKembaliAktual = vehicleChecks.find((c) => c.tipe === "DATANG")?.checkedAt ?? null;

  // "Draf dibuat" is an administrative marker, not part of the timed
  // loading/departure pipeline — it never gets a duration (the gap before
  // Mulai Muat can be arbitrarily long and isn't meaningful to show). The
  // pipeline itself starts counting from Mulai Muat: each later step's
  // duration is the elapsed time since the immediately preceding step that
  // has actually happened.
  const statusHistory = useMemo(() => {
    if (!jadwal) return [];
    const rawPipeline: { label: string; timestamp: string | Date | null }[] = [
      { label: "Mulai Muat", timestamp: jadwal.JamMulaiMuat },
      { label: "Selesai Muat", timestamp: jadwal.JamSelesaiMuat },
      { label: "Berangkat", timestamp: jadwal.JamAktualBerangkat },
      { label: "Datang", timestamp: jamKembaliAktual },
    ];

    let prevMs: number | null = null;
    const withDuration: { label: string; timestamp: string | Date; durationLabel: string | null }[] = [];
    for (const s of rawPipeline) {
      if (s.timestamp == null) continue;
      const ms = new Date(s.timestamp).getTime();
      const durationLabel = prevMs != null ? formatDurationMinutes(Math.round((ms - prevMs) / 60000)) : null;
      prevMs = ms;
      withDuration.push({ label: s.label, timestamp: s.timestamp, durationLabel });
    }

    return [{ label: "Draf dibuat", timestamp: jadwal.CreatedDate, durationLabel: null }, ...withDuration];
  }, [jadwal, jamKembaliAktual]);

  // Riwayat Status time summary (Task 11): total time on break, total time
  // from actual departure to actual arrival (or now, if still en route),
  // and the difference between the two ("effective" delivery time with
  // breaks excluded).
  const totalIstirahatMenit = useMemo(
    () => istirahatSessions.reduce((sum, s) => sum + s.durasiMenit, 0),
    [istirahatSessions]
  );
  // Null (not 0) before departure — there's nothing to measure "berjalan"
  // time against yet, and showing "0 Menit" would misleadingly imply the
  // trip already started.
  const totalBerjalanMenit = useMemo(() => {
    if (!jadwal?.JamAktualBerangkat) return null;
    const endMs = resolveEndMs(jamKembaliAktual);
    return Math.round((endMs - new Date(jadwal.JamAktualBerangkat).getTime()) / 60000);
  }, [jadwal, jamKembaliAktual]);
  const waktuEfektifMenit = totalBerjalanMenit != null ? totalBerjalanMenit - totalIstirahatMenit : null;

  // Same sentence the status area below used to show on its own — now it
  // doubles as the Riwayat Status trigger's own label (next to the Terbit
  // badge) so there's one line of truth instead of two.
  const currentStatusLabel = !jadwal
    ? "Riwayat Status"
    : isDraft
      ? jadwal.JamMulaiMuat == null
        ? `Draf dibuat pukul ${formatTime(jadwal.CreatedDate)}`
        : `Mulai Muat pukul ${formatTime(jadwal.JamMulaiMuat)}`
      : isWaitingDeparture
        ? `Selesai Muat pukul ${formatTime(jadwal.JamSelesaiMuat as string)} — menunggu Cek Berangkat`
        : jadwal.JamAktualBerangkat
          ? `Sudah berangkat pukul ${formatTime(jadwal.JamAktualBerangkat)}`
          : "Riwayat Status";
  const isFutureDate = businessDate > todayISO;
  const overCapacity = kapasitasMaks != null && totalQty > kapasitasMaks;
  const canSelesaiMuat = isDraft && driverId !== "" && route != null && !routeLoading && !overCapacity && !isFutureDate;
  const totalFuelLiters = useMemo(() => {
    if (route == null || konsumsiBBM == null) return null;
    return Math.round(route.distanceKm * konsumsiBBM * 10) / 10;
  }, [route, konsumsiBBM]);
  const totalFuelCost = useMemo(() => {
    if (totalFuelLiters == null || biayaBBMPerLiter == null) return null;
    return Math.round(totalFuelLiters * biayaBBMPerLiter);
  }, [totalFuelLiters, biayaBBMPerLiter]);
  // "Biaya BBM tambahan": a 15% buffer on top of the base fuel cost above,
  // shown separately (never merged into totalFuelCost) — confirmed formula
  // with the user 2026-08-20, replacing the old floor(distanceKm/5) segment
  // formula. Applies uniformly to every jenisBBM (Solar, Pertalite, etc.),
  // since it's a flat percentage of whatever totalFuelCost already resolved
  // to for that fuel type.
  const extraFuelCost = useMemo(() => {
    if (totalFuelCost == null) return null;
    return Math.round(totalFuelCost * 0.15);
  }, [totalFuelCost]);
  // Base + tambahan, rounded UP (never down) to the nearest Rp1.000 — also
  // confirmed mandatory with the user, e.g. 93.840 + 14.076 = 107.916 ->
  // 108.000.
  const totalFuelCostWithExtra = useMemo(() => {
    if (totalFuelCost == null || extraFuelCost == null) return null;
    return Math.ceil((totalFuelCost + extraFuelCost) / 1000) * 1000;
  }, [totalFuelCost, extraFuelCost]);

  // Efektifitas Armada — confirmed formula with the user 2026-08-20:
  // 1. Jarak Tempuh (km) x rata-rata harga jual per kantong
  // 2. Total konsumsi BBM x harga per liter (== totalFuelCost above, the
  //    BASE fuel cost — deliberately not totalFuelCostWithExtra, the
  //    formula only asked for consumption x price/liter)
  // 3. (Hasil 1 - Hasil 2) / Jarak Tempuh (km) -> Rupiah margin per km
  const priceByLevel = useMemo(() => new Map(priceLevels.map((p) => [p.Level, p.Price])), [priceLevels]);
  // Weighted by each stop's own kantong qty (total revenue / total
  // kantong) rather than a flat average of price LEVELS, so a few
  // high-qty stops at one price level aren't diluted by many low-qty
  // stops at another. Stops with no resolved price level/price are
  // excluded from both the revenue and qty sums.
  const avgHargaJualPerKantong = useMemo(() => {
    let revenue = 0;
    let qty = 0;
    for (const o of order) {
      const price = o.PriceLevel != null ? priceByLevel.get(o.PriceLevel) : undefined;
      if (price == null) continue;
      revenue += price * o.Qty;
      qty += o.Qty;
    }
    return qty > 0 ? revenue / qty : null;
  }, [order, priceByLevel]);
  const efektivitasHasil1 = useMemo(() => {
    if (route == null || avgHargaJualPerKantong == null) return null;
    return route.distanceKm * avgHargaJualPerKantong;
  }, [route, avgHargaJualPerKantong]);
  const efektivitasPerKm = useMemo(() => {
    if (efektivitasHasil1 == null || totalFuelCost == null || route == null || route.distanceKm <= 0) return null;
    return (efektivitasHasil1 - totalFuelCost) / route.distanceKm;
  }, [efektivitasHasil1, totalFuelCost, route]);

  // Aggregate bongkar time across every stop in the current order — the
  // per-stop "~X menit" label (SortableStopRow) shows this same function's
  // result for one stop; this is the sum across all of them, feeding the
  // route summary's time breakdown below.
  const bongkarTotalMenit = useMemo(() => {
    return order.reduce((sum, o) => sum + estimateDeliveryMinutes(o.Qty), 0);
  }, [order]);
  const konfirmasiTotalMenit = order.length * CONFIRMATION_MINUTES_PER_STOP;

  // "Detail Rute" — plain-text destination list only (no route/fuel
  // figures, those are visual-only info covered by the image share
  // options below). No public link/token exists for this dialog, so
  // sharing means handing off a readable recap rather than a URL.
  function buildStopListText(): string {
    if (!jadwal) return "";
    const lines = [
      `Daftar Tujuan — ${armadaNama ?? "Armada"}`,
      `${formatDate(businessDate)} ${time}${driverId ? ` · ${drivers.find((d) => d.SalesmanID === driverId)?.Name ?? ""}` : ""}`,
      "",
      ...order.map(
        (o, i) =>
          `${i + 1}. ${o.CustomerName} — ${o.Wilayah} (${formatKemasanQty(o.Qty10KG, o.Qty5KG)}${o.BonusQty > 0 ? ` +${o.BonusQty} bonus` : ""})`
      ),
      "",
      `Total: ${formatKemasanQty(totalQty10KG, totalQty5KG)}${totalBonusQty > 0 ? ` (+${totalBonusQty} bonus)` : ""}`,
    ];
    return lines.join("\n");
  }

  const captureRef = useRef<HTMLDivElement>(null);

  // Renders captureRef's subtree (dialog title/summary + body) to a PNG
  // Blob — skips any node marked data-capture-hide (action buttons that
  // don't make sense in a shared screenshot, e.g. the Bagikan trigger
  // itself, "Cetak DO Terpilih", and the "Tambahkan" sub-panel). Also:
  // (a) drops the destinations list's max-height/scroll (capturing state)
  // so every stop is actually rendered, not clipped to whatever was
  // scrolled into view, and (b) if the map is showing, forces it to
  // re-fit the whole route first (refitTrigger) — both would otherwise
  // let the captured image silently cut off real route data.
  async function captureDialogImage(): Promise<Blob | null> {
    if (!captureRef.current) return null;
    setCapturing(true);
    if (showMap) setRefitTrigger((n) => n + 1);
    // Two frames: one for the capturing-driven layout change (list
    // max-height removed) to reflow, one more for RouteMap's un-animated
    // fitBounds to finish repainting tiles at the new view.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      const { toBlob } = await import("html-to-image");
      return await toBlob(captureRef.current, {
        pixelRatio: 2,
        filter: (node) => !(node instanceof HTMLElement && node.dataset.captureHide === "true"),
      });
    } finally {
      setCapturing(false);
    }
  }

  async function shareImageBlob(blob: Blob, filename: string, title: string): Promise<void> {
    const file = new File([blob], filename, { type: "image/png" });

    // Copy to clipboard FIRST, before calling share() — both APIs need a
    // live user-activation gesture, and awaiting the OS share sheet can
    // take arbitrarily long (or hand off to another app entirely), which
    // risks the activation expiring before a clipboard write attempted
    // afterward. Doing it up front also means it still happens even when
    // the user cancels the share sheet, or shares to an app that can't
    // receive the image directly.
    let copied = false;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      copied = true;
    } catch {
      // Clipboard image write isn't universally supported (e.g. Firefox) —
      // proceed to share/download regardless.
    }

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
      } catch {
        // User cancelled the share sheet — not an error worth surfacing.
      }
      if (copied) toast.success("Gambar disalin ke clipboard.");
      return;
    }

    if (copied) {
      toast.success("Gambar disalin ke clipboard.");
      return;
    }
    // Final fallback when neither share nor clipboard write is available.
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleShareSeluruhnya() {
    const blob = await captureDialogImage();
    if (blob) await shareImageBlob(blob, "validasi-rute.png", "Validasi Rute");
  }

  async function handleShareDetailRute() {
    const text = buildStopListText();
    if (!text) return;

    // Same ordering rationale as shareImageBlob: copy first, before
    // calling share(), so it isn't lost to a user-activation timeout while
    // the OS share sheet is open, and still happens if the user cancels it.
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      // Proceed to share regardless.
    }

    if (navigator.share) {
      try {
        await navigator.share({ title: "Detail Rute", text });
      } catch {
        // User cancelled the share sheet — not an error worth surfacing.
      }
      if (copied) toast.success("Detail rute disalin ke clipboard.");
      return;
    }

    if (copied) {
      toast.success("Detail rute disalin ke clipboard.");
    } else {
      toast.error("Gagal menyalin detail rute.");
    }
  }

  async function handleShareDataRute() {
    // Reuses the same map-hiding layout the dialog already has (see
    // showMap) instead of a separate capture-time DOM filter — guarantees
    // the config panel reflows to full width exactly like the user-facing
    // "no map" layout already does, with no leftover gap where the map was.
    const wasShowingMap = showMap;
    if (wasShowingMap) {
      setShowMap(false);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    try {
      const blob = await captureDialogImage();
      if (blob) await shareImageBlob(blob, "data-rute.png", "Data Rute");
    } finally {
      if (wasShowingMap) setShowMap(true);
    }
  }

  return (
    <Dialog open={jadwalId != null} onOpenChange={onOpenChange}>
      {/* Widened past the base Dialog's sm:max-w-sm — a bare max-w-4xl loses
          to that rule (same specificity, but sm:max-w-sm sits later in
          Tailwind's compiled output), so the override needs its own sm:
          variant too, same fix already established in mitra-list.tsx /
          pengajuan-form-dialog.tsx. Scales further at lg: since this dialog
          holds a map + list side by side and genuinely benefits from a
          landscape screen's extra width, unlike a plain form dialog. */}
      <DialogContent className="max-w-lg p-0 sm:max-w-3xl lg:max-w-6xl">
        <div ref={captureRef}>
        <DialogHeader className="p-4 pb-0">
          <div className="flex items-center justify-between gap-2 pr-8">
            <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
              {jadwal && (
                <Badge variant="outline" className={cn("text-[10px]", isDraft ? "border-dashed" : "border-primary/30 text-primary")}>
                  {jadwal.Status}
                </Badge>
              )}
              Validasi Rute
              {jadwal && (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm rounded-lg border bg-primary/5 px-2 py-1">
                  <span className="flex items-center gap-1.5 font-semibold">
                    {armadaPlat && <span>{armadaPlat}</span>}
                    <Truck className="size-4 text-muted-foreground" />
                    {armadaNama ?? "Armada"}
                  </span>
                  <span className="text-muted-foreground">({order.length}) Tujuan</span>
                  {!isDraft && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <span className="font-medium text-foreground">{time}</span>
                      {drivers.find((d) => d.SalesmanID === driverId)?.Name ?? "Tanpa driver"}
                    </span>
                  )}
                </p>
              )}
            </DialogTitle>
            <div className="flex shrink-0 items-center gap-2">
              {statusHistory.length > 0 && (
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs font-normal" />
                    }
                  >
                    <History className="size-3.5" />
                    {currentStatusLabel}
                    <ChevronDown className="size-3 opacity-60" />
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-80">
                    <VerticalTimeline>
                      {statusHistory.map((s, i) => (
                        <VerticalTimelineItem
                          key={s.label}
                          time={`${formatTime(s.timestamp)} · ${formatDate(s.timestamp)}`}
                          isLast={i === statusHistory.length - 1}
                        >
                          <p className="text-sm font-medium">
                            {s.label}
                            {s.durationLabel && (
                              <span className="ml-1.5 font-normal text-muted-foreground">| {s.durationLabel}</span>
                            )}
                          </p>
                        </VerticalTimelineItem>
                      ))}
                    </VerticalTimeline>
                    {(totalBerjalanMenit != null || istirahatSessions.length > 0) && (
                      <div className="mt-3 flex flex-col gap-1 border-t pt-3 text-xs">
                        {totalBerjalanMenit != null && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Total Berjalan</span>
                            <span className="font-medium">{formatDurationMinutes(totalBerjalanMenit)}</span>
                          </div>
                        )}
                        {istirahatSessions.length > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Total Istirahat ({istirahatSessions.length}x)</span>
                            <span className="font-medium">{formatDurationMinutes(totalIstirahatMenit)}</span>
                          </div>
                        )}
                        {waktuEfektifMenit != null && (
                          <div className="flex justify-between font-semibold">
                            <span>Waktu Efektif Pengiriman</span>
                            <span>{formatDurationMinutes(waktuEfektifMenit)}</span>
                          </div>
                        )}
                        {istirahatSessions.map((s, i) => (
                          <p key={i} className="text-[11px] text-muted-foreground">
                            {s.keterangan} — {formatDurationMinutes(s.durasiMenit)} ({formatTime(s.waktuMulai)}
                            {s.waktuSelesai ? ` – ${formatTime(s.waktuSelesai)}` : " – berlangsung"})
                          </p>
                        ))}
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              )}
              {jadwal && order.length > 0 && (
                <div data-capture-hide="true">
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" />}>
                      <Share2 className="size-3.5" />
                      Bagikan
                      <ChevronDown className="size-3 opacity-60" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={handleShareSeluruhnya}>
                        <ImageIcon className="size-4" />
                        Seluruhnya
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleShareDetailRute}>
                        <List className="size-4" />
                        Detail Rute
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleShareDataRute}>
                        <ImageIcon className="size-4" />
                        Data Rute
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
              {isWaitingDeparture && (
                <Button size="sm" disabled={pending || !hasBerangkatCheck} onClick={handleKonfirmasiBerangkat}>
                  {pending ? "Memproses..." : "Berangkat"}
                </Button>
              )}
            </div>
          </div>
          <DialogDescription className="sr-only">
            Atur waktu, driver, urutan pengiriman, dan validasi rute sebelum berangkat.
          </DialogDescription>
        </DialogHeader>

        {/* Mobile (default): map first, full-bleed, then the config panel
            below it as a rounded-top "sheet" pulled up slightly to overlap
            the map's bottom edge — same idea as Google Maps' bottom sheet,
            built with layout order + a negative margin rather than a real
            drag-to-resize sheet (out of scope here).
            md and up: reverts to config-left / map-right side by side,
            matching how a desktop map + form split is usually laid out. */}
        <div className={cn("flex flex-col", showMap ? "md:grid md:grid-cols-2 md:gap-4 md:p-4 md:pt-2 lg:grid-cols-[1fr_1.3fr]" : "md:p-4 md:pt-2")}>
          {showMap && (
            <div className="order-1 flex flex-col gap-3 md:order-2">
              <div className="h-[34vh] min-h-[220px] w-full overflow-hidden md:h-auto md:min-h-[220px] md:rounded-lg">
                {pabrik && order.length > 0 ? (
                  <RouteMap
                    pabrik={pabrik}
                    stops={order.filter((o) => o.Latitude != null && o.Longitude != null) as (JadwalDetailRow & { Latitude: number; Longitude: number })[]}
                    geometry={route?.geometry ?? null}
                    refitTrigger={refitTrigger}
                    driverPosition={driverPosition}
                  />
                ) : (
                  <Skeleton className="h-full w-full md:rounded-lg" />
                )}
              </div>

              {/* Efektifitas Armada — Rupiah margin per km, confirmed
                  formula with the user 2026-08-20: (1) Jarak Tempuh x
                  rata-rata harga jual/kantong, minus (2) konsumsi BBM x
                  harga/liter (the base fuel cost, not the +15% buffer),
                  divided by (3) Jarak Tempuh again. Every step's own inputs
                  and result are spelled out (not just the final number) so
                  staff can see where the figure comes from. Gated on
                  `route` existing, same precondition the BBM breakdown
                  block below already uses. */}
              {route && (
                <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <Gauge className="size-4 text-primary" />
                    Efektifitas Armada
                  </p>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                      1
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Jarak Tempuh &times; Harga Jual rata-rata/kantong</p>
                      {avgHargaJualPerKantong != null ? (
                        <p className="tabular-nums">
                          {route.distanceKm.toLocaleString("id-ID")} km &times; {formatRupiah(avgHargaJualPerKantong)} ={" "}
                          <span className="font-semibold">{formatRupiah(efektivitasHasil1 ?? 0)}</span>
                        </p>
                      ) : (
                        <p className="text-muted-foreground">Harga jual mitra pada rute ini belum diketahui.</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                      2
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Konsumsi BBM &times; Harga per Liter</p>
                      {totalFuelLiters != null && totalFuelCost != null ? (
                        <p className="tabular-nums">
                          {totalFuelLiters.toLocaleString("id-ID")} L &times; {formatRupiah(biayaBBMPerLiter ?? 0)} ={" "}
                          <span className="font-semibold">{formatRupiah(totalFuelCost)}</span>
                        </p>
                      ) : (
                        <p className="text-muted-foreground">Konsumsi BBM armada belum diketahui.</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-2 border-t pt-2.5">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                      3
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">(Hasil 1 &minus; Hasil 2) &divide; Jarak Tempuh</p>
                      {efektivitasHasil1 != null && totalFuelCost != null && efektivitasPerKm != null ? (
                        <p className="tabular-nums">
                          ({formatRupiah(efektivitasHasil1)} &minus; {formatRupiah(totalFuelCost)}) &divide;{" "}
                          {route.distanceKm.toLocaleString("id-ID")} km ={" "}
                          <span className="font-semibold text-primary">{formatRupiah(efektivitasPerKm)}/km</span>
                        </p>
                      ) : (
                        <p className="text-muted-foreground">Belum bisa dihitung — lengkapi data di atas dulu.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div
            className={cn(
              "flex flex-col gap-3 p-4",
              showMap && "order-2 -mt-4 rounded-t-2xl bg-popover shadow-[0_-4px_12px_rgba(0,0,0,0.08)] md:order-1 md:mt-0 md:rounded-none md:p-0 md:shadow-none"
            )}
          >
            {isDraft ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40 shrink-0" />
                <TimeInput value={time} onChange={setTime} className="shrink-0" />
                <Select value={driverId} onValueChange={(v) => setDriverId(v ?? "")}>
                  <SelectTrigger className="min-w-40 flex-1">
                    <SelectValue placeholder="Driver">
                      {(v: string) => drivers.find((d) => d.SalesmanID === v)?.Name ?? "Pilih Driver"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {drivers.map((d) => (
                      <SelectItem key={d.SalesmanID} value={d.SalesmanID}>
                        {d.Name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {isDraft && isFutureDate && (
              <p className="text-xs text-muted-foreground">
                Keberangkatan ini dijadwalkan untuk {formatDate(businessDate)} — Mulai Muat dan Berangkat baru bisa
                dilakukan pada hari itu.
              </p>
            )}

            {overCapacity && (
              <p className="text-xs text-destructive">
                Total muatan {totalQty} kantong melebihi kapasitas armada ({kapasitasMaks} kantong).
              </p>
            )}

            <div className={cn("flex flex-col rounded-lg border", capturing ? "max-h-none overflow-visible" : "max-h-80 overflow-y-auto")}>
              {loading && <p className="py-6 text-center text-sm text-muted-foreground">Memuat...</p>}
              {!loading && order.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada SO.</p>
              )}
              {!loading && order.length > 0 && (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={order.map((o) => o.JadwalDetailID)} strategy={verticalListSortingStrategy}>
                    {order.map((d, i) => (
                      <SortableStopRow
                        key={d.JadwalDetailID}
                        detail={d}
                        index={i}
                        onEdit={onEditSalesOrder}
                        disabled={!isDraft}
                        onReprint={handleReprint}
                        reprinting={reprintingId === d.JadwalDetailID}
                        onRemove={isDraft ? handleRemoveStop : undefined}
                        hasDeparted={hasDeparted}
                        onOpenProof={setProofDetail}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>

            {order.length > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm">
                <Package className="size-4 text-primary" />
                <span className="font-medium">
                  {formatKemasanQty(totalQty10KG, totalQty5KG)}
                  {totalBonusQty > 0 && <span className="text-primary"> (+{totalBonusQty} bonus)</span>}
                </span>
              </div>
            )}

            {isDraft && (
              <div className="flex flex-wrap items-center gap-2">
                {!adding && (
                  <Button size="sm" variant="ghost" className="gap-1.5" disabled={pending} onClick={handleOpenAdd}>
                    <Plus className="size-3.5" />
                    Tambahkan
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={pending} onClick={handleDeleteDraft}>
                  Batalkan Draft
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={handleSaveDriverTime}>
                  Simpan
                </Button>
                {jadwal?.JamMulaiMuat == null ? (
                  <Button size="sm" variant="outline" className="ml-auto" disabled={pending || isFutureDate} onClick={handleMuat}>
                    Mulai Muat
                  </Button>
                ) : (
                  <Button size="sm" className="ml-auto" disabled={!canSelesaiMuat || pending} onClick={handleSelesaiMuat}>
                    {pending ? "Memproses..." : "Selesai Muat"}
                  </Button>
                )}
              </div>
            )}

            {isDraft && adding && (
              <div className="flex flex-col gap-2 rounded-lg border p-2" data-capture-hide="true">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Pilih SO tambahan</span>
                  {kapasitasMaks != null && (
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        totalQty + selectedToAddQty > kapasitasMaks ? "text-destructive" : "text-muted-foreground"
                      )}
                    >
                      {totalQty + selectedToAddQty} / {kapasitasMaks} kantong
                    </span>
                  )}
                </div>
                {addError && <p className="text-xs text-destructive">{addError}</p>}
                <div className="flex max-h-40 flex-col divide-y overflow-y-auto rounded-md border">
                  {availableToAdd.map((so) => {
                    const isSelected = selectedToAdd.has(so.SalesOrderID);
                    const soOverCapacity = !isSelected && kapasitasMaks != null && totalQty + selectedToAddQty + so.Qty > kapasitasMaks;
                    return (
                      <button
                        key={so.SalesOrderID}
                        type="button"
                        disabled={soOverCapacity}
                        onClick={() => handleToggleAdd(so.SalesOrderID, so.Qty)}
                        className={cn(
                          "flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs transition-colors",
                          isSelected && "bg-primary/10",
                          !isSelected && !soOverCapacity && "hover:bg-muted",
                          soOverCapacity && "cursor-not-allowed opacity-40"
                        )}
                      >
                        <span className="min-w-0 truncate">
                          {so.CustomerName} <span className="text-muted-foreground">· {so.Wilayah}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{formatKemasanQty(so.Qty10KG, so.Qty5KG)}</span>
                      </button>
                    );
                  })}
                  {availableToAdd.length === 0 && (
                    <p className="py-4 text-center text-xs text-muted-foreground">Tidak ada SO yang tersedia.</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" disabled={pending} onClick={() => setAdding(false)}>
                    Batal
                  </Button>
                  <Button size="sm" className="flex-1" disabled={pending || selectedToAdd.size === 0} onClick={handleConfirmAdd}>
                    Tambah ({selectedToAdd.size})
                  </Button>
                </div>
              </div>
            )}

            {routeError && <p className="text-xs text-destructive">{routeError}</p>}
            {route && (
              <div className="flex flex-wrap gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <span className="flex items-center gap-1">
                  <RouteIcon className="size-4 text-muted-foreground" />
                  {route.distanceKm.toLocaleString("id-ID")} km
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="size-4 text-muted-foreground" />
                  Tempuh {route.durationMinutes} + Bongkar {Math.round(bongkarTotalMenit)} + Konfirmasi{" "}
                  {konfirmasiTotalMenit} = {Math.round(route.durationMinutes + bongkarTotalMenit + konfirmasiTotalMenit)}{" "}
                  menit
                </span>
                {totalFuelLiters != null && (
                  <span className="flex items-center gap-1">
                    <Fuel className="size-4 text-muted-foreground" />
                    {totalFuelLiters.toLocaleString("id-ID")} L
                    {jenisBBM && ` (${jenisBBM})`}
                  </span>
                )}
                {totalFuelCost != null && (
                  <span className="flex items-center gap-1 font-medium">{formatRupiah(totalFuelCost)}</span>
                )}
                {extraFuelCost != null && (
                  <span className="flex items-center gap-1 text-muted-foreground">+ {formatRupiah(extraFuelCost)}</span>
                )}
                {totalFuelCostWithExtra != null && (
                  <span className="flex items-center gap-1 font-semibold text-primary">= {formatRupiah(totalFuelCostWithExtra)}</span>
                )}
              </div>
            )}

            {!isDraft && jadwalId != null && armadaId != null && (
              <VehicleCheckDialog
                jadwalId={jadwalId}
                armadaId={armadaId}
                isSatpam={isSatpam}
                onUploadPhoto={handleUploadVehiclePhoto}
                onSubmitCheck={handleSubmitVehicleCheck}
                checks={vehicleChecks}
              />
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>
        </div>

        {!isDraft && vehicleChecks.length > 0 && (
          <div className="flex flex-col gap-2 border-t p-4 md:pt-3">
            <p className="text-xs font-medium text-muted-foreground">Hasil Inspeksi Kendaraan (Satpam)</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {vehicleChecks.map((c) => (
                <CheckSummary key={c.vehicleCheckId} check={c} />
              ))}
            </div>
          </div>
        )}
        <StopDeliveryProofDialog detail={proofDetail} onOpenChange={(open) => !open && setProofDetail(null)} />
        {conflict && (
          <ArmadaConflictDialog
            conflict={conflict.info}
            onCancel={() => setConflict(null)}
            onConfirm={() => {
              if (jadwalId == null) return;
              const targetId = jadwalId;
              const { jamJadwal, then } = conflict;
              setConflict(null);
              if (then === "save") {
                doSaveDriverTime(targetId, jamJadwal);
              } else {
                doSaveDriverTimeThenSelesaiMuat(targetId, jamJadwal);
              }
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
