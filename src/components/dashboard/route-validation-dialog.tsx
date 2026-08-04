"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { GripVertical, MapPin, Route as RouteIcon, Fuel, Clock, Plus, PackageCheck, Printer, X, Share2, Truck, Package, Image as ImageIcon, List, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDate, formatRupiah, formatTime, formatKemasanQty } from "@/lib/format";
import { estimateDeliveryMinutes } from "@/lib/delivery-duration";
import type { JadwalCard as JadwalCardData, JadwalDetailRow, AvailableSalesOrder } from "@/lib/queries/pengiriman-jadwal";
import type { DriverOption } from "@/lib/queries/delivery";
import type { MultiPointRoute } from "@/lib/osrm";
import type { FuelType } from "@/lib/armada-fuel";
import { VehicleCheckDialog } from "@/components/dashboard/vehicle-check-dialog";
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
} from "@/app/(dashboard)/delivery/actions";

const RouteMap = dynamic(() => import("@/components/dashboard/route-map").then((m) => m.RouteMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-lg" />,
});

function SortableStopRow({
  detail,
  index,
  onEdit,
  disabled,
  printChecked,
  onTogglePrint,
  onRemove,
}: {
  detail: JadwalDetailRow;
  index: number;
  onEdit: (detail: JadwalDetailRow) => void;
  disabled: boolean;
  printChecked: boolean;
  onTogglePrint: (jadwalDetailId: number) => void;
  // Only usable while the Jadwal is still Draft (matches
  // removeSalesOrderFromJadwal's own guard) — omitted/hidden once Terbit.
  onRemove?: (detail: JadwalDetailRow) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: detail.JadwalDetailID,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 border-b bg-card px-3 py-2 text-sm last:border-b-0",
        isDragging && "z-10 opacity-70 shadow-lg"
      )}
    >
      <button type="button" {...attributes} {...listeners} className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing">
        <GripVertical className="size-4" />
      </button>
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
        {index + 1}
      </span>
      <button
        type="button"
        onClick={() => !disabled && onEdit(detail)}
        disabled={disabled}
        className="min-w-0 flex-1 text-left hover:underline disabled:cursor-default disabled:hover:no-underline"
      >
        <p className="truncate font-medium">{detail.CustomerName}</p>
        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <MapPin className="size-3 shrink-0" />
          {detail.Wilayah}
          {detail.Kecamatan ? ` | ${detail.Kecamatan}` : ""}
        </p>
      </button>
      <span className="shrink-0 text-right tabular-nums text-muted-foreground">
        <span className="block">
          {formatKemasanQty(detail.Qty10KG, detail.Qty5KG)}
          {detail.BonusQty > 0 && <span className="text-primary"> (+{detail.BonusQty} bonus)</span>}
        </span>
        <span className="block text-[10px]">~{estimateDeliveryMinutes(detail.Qty)} menit</span>
      </span>
      {detail.Latitude == null && (
        <Badge variant="outline" className="shrink-0 border-destructive/30 text-[10px] text-destructive">
          Tanpa lokasi
        </Badge>
      )}
      <button
        type="button"
        title={printChecked ? "Batal tandai untuk dicetak" : "Tandai untuk dicetak"}
        onClick={() => onTogglePrint(detail.JadwalDetailID)}
        className={cn(
          "shrink-0 rounded border p-1 transition-colors",
          printChecked ? "border-primary bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:border-border"
        )}
      >
        <Printer className="size-3.5" />
      </button>
      {onRemove && (
        <button
          type="button"
          title="Keluarkan dari draft"
          onClick={() => onRemove(detail)}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="size-3.5" />
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
  konsumsiBBM,
  kapasitasMaks,
  jenisBBM,
  biayaBBMPerLiter,
  isSatpam,
  onOpenChange,
  onDeleted,
  onEditSalesOrder,
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
}) {
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<JadwalDetailRow[]>([]);
  const [vehicleChecks, setVehicleChecks] = useState<VehicleCheckRow[]>([]);
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
  const [route, setRoute] = useState<MultiPointRoute | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
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
  const [printSelected, setPrintSelected] = useState<Set<number>>(new Set());
  const [printError, setPrintError] = useState<string | null>(null);

  function togglePrint(jadwalDetailId: number) {
    setPrintSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jadwalDetailId)) next.delete(jadwalDetailId);
      else next.add(jadwalDetailId);
      return next;
    });
  }

  // Opens the printable invoice for every currently-marked stop that already
  // has an InvoiceToken (a stop marked before Selesai Muat runs has none yet
  // — nothing to open for it here; the auto-print in handleSelesaiMuat is
  // what actually opens it the moment its token becomes available). Stops
  // marked but still missing a token are reported instead of silently
  // skipped, so a Draft-stage click doesn't look like it did nothing.
  function handlePrintSelected() {
    setPrintError(null);
    let missingCount = 0;
    for (const d of order) {
      if (!printSelected.has(d.JadwalDetailID)) continue;
      if (d.InvoiceToken) {
        window.open(`/invoice/${d.InvoiceToken}`, "_blank");
      } else {
        missingCount++;
      }
    }
    if (missingCount > 0) {
      setPrintError(
        `${missingCount} SI belum terbit — SI baru dibuat otomatis saat "Selesai Muat" diklik. Tetap ditandai; akan otomatis tercetak begitu Selesai Muat selesai.`
      );
    }
  }

  const jadwalId = jadwal?.JadwalID ?? null;
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
    setPrintSelected(new Set());
    setShowMap(true);

    if (jadwalId == null) {
      setOrder([]);
      setVehicleChecks([]);
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
  }, [jadwalId]);

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
    fetch("/api/pabrik-location")
      .then((res) => res.json())
      .then((data: { latitude: number; longitude: number }) => setPabrik(data))
      .catch(() => setPabrik(null));
  }, [jadwalId]);

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
    fetch("/api/routing/multi", {
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
      setError(null);
      startTransition(async () => {
        try {
          await updateJadwalUrutanAction(jadwalId, next.map((d) => d.JadwalDetailID));
        } catch (err) {
          setError(err instanceof Error ? err.message : "Gagal menyimpan urutan tujuan.");
        }
      });
    }
  }

  // Standalone "Simpan" path — still needed on its own since editing
  // driver/time while already Terbit (re-assigning driver/vehicle onto
  // existing DOs) doesn't go through handleSelesaiMuat/handleKonfirmasiBerangkat.
  function handleSaveDriverTime() {
    if (jadwalId == null) return;
    setError(null);
    startTransition(async () => {
      try {
        const resultId = await updateJadwalDriverTimeAction(
          jadwalId,
          { jamJadwal: buildJamJadwal(), salesmanId: driverId || null },
          { skipOrderTimeCheck: true }
        );
        // The new time landed inside another Draft's estimated busy window
        // for the same armada — this Jadwal got folded into that one
        // instead (see updateJadwalDriverTime), so there's nothing left
        // under jadwalId to keep showing here.
        if (resultId !== jadwalId) {
          toast.success(`Digabung dengan keberangkatan lain di jam yang sama untuk armada ini.`);
          onDeleted?.();
          onOpenChange(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan driver/waktu.");
      }
    });
  }

  // Removing the last remaining stop also deletes the now-empty Jadwal
  // itself (removeSalesOrderFromJadwal's own cleanup) — nothing left to
  // show, so this closes the dialog the same way "Batalkan Draft" does.
  function handleRemoveStop(detail: JadwalDetailRow) {
    if (jadwalId == null) return;
    if (!confirm(`Keluarkan "${detail.CustomerName}" dari draft ini?`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await removeSalesOrderFromJadwalAction(jadwalId, detail.SalesOrderID);
        if (order.length <= 1) {
          onDeleted?.();
          onOpenChange(false);
          return;
        }
        const rows = await getJadwalDetailAction(jadwalId);
        setOrder(rows);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal mengeluarkan tujuan.");
      }
    });
  }

  function handleDeleteDraft() {
    if (jadwalId == null) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteJadwalDraftAction(jadwalId);
        onDeleted?.();
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal membatalkan draft.");
      }
    });
  }

  function handleMuat() {
    if (jadwalId == null) return;
    setError(null);
    startTransition(async () => {
      try {
        await startMuatAction(jadwalId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal mencatat mulai muat.");
      }
    });
  }

  // Selesai Muat creates the real DO+SI documents (see selesaiMuat) and
  // auto-opens the invoice for every stop marked in printSelected — same
  // window.open mechanism handlePrintSelected already uses, just triggered
  // automatically instead of manually, and without closing this dialog so
  // the operator can keep working here while the print tabs load.
  //
  // Persists the currently-selected driver/time FIRST, same safety net the
  // old (now-removed) handleBerangkat had before it called startBerangkat:
  // selesaiMuat reads SalesmanID off the DB row, not off this component's
  // client state, so a driver picked in the dropdown but not yet "Simpan"-ed
  // would otherwise get silently attributed to whichever driver was last
  // persisted — on a real DeliveryOrder/SalesInvoice, once Status flips to
  // Terbit, that misattribution can no longer be corrected through the UI
  // (updateJadwalDriverTime refuses any edit once not Draft).
  function handleSelesaiMuat() {
    if (jadwalId == null) return;
    setError(null);
    startTransition(async () => {
      try {
        const resultId = await updateJadwalDriverTimeAction(
          jadwalId,
          { jamJadwal: buildJamJadwal(), salesmanId: driverId || null },
          { skipOrderTimeCheck: true }
        );
        // The new time landed inside another Draft's estimated busy window
        // for the same armada — this Jadwal got folded into that one
        // instead (see updateJadwalDriverTime), so there's nothing left
        // under jadwalId to run selesaiMuat against anymore.
        if (resultId !== jadwalId) {
          toast.success(
            "Waktu ini tumpang tindih dengan keberangkatan lain untuk armada ini — sudah digabung. Buka kembali untuk melanjutkan keberangkatan."
          );
          onDeleted?.();
          onOpenChange(false);
          return;
        }
        const tokens = await selesaiMuatAction(jadwalId);
        for (const t of tokens) {
          if (printSelected.has(t.jadwalDetailId)) {
            window.open(`/invoice/${t.invoiceToken}`, "_blank");
          }
        }
        const rows = await getJadwalDetailAction(jadwalId);
        setOrder(rows);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyelesaikan muat.");
      }
    });
  }

  function handleKonfirmasiBerangkat() {
    if (jadwalId == null) return;
    setError(null);
    startTransition(async () => {
      try {
        await konfirmasiBerangkatAction(jadwalId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal mengonfirmasi keberangkatan.");
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
    setAddError(null);
    startTransition(async () => {
      try {
        await addSalesOrdersToJadwalAction(jadwalId, [...selectedToAdd]);
        const rows = await getJadwalDetailAction(jadwalId);
        setOrder(rows);
        setAdding(false);
      } catch (err) {
        setAddError(err instanceof Error ? err.message : "Gagal menambahkan SO.");
      }
    });
  }

  async function handleUploadVehiclePhoto(file: File, jenisFoto: JenisFotoKendaraan): Promise<string> {
    if (armadaId == null) throw new Error("Armada tidak diketahui.");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("armadaId", String(armadaId));
    formData.append("jenisFoto", jenisFoto);
    const res = await fetch("/api/upload/satpam-check", { method: "POST", body: formData });
    const data = (await res.json()) as { path?: string; error?: string };
    if (!res.ok || !data.path) throw new Error(data.error ?? "Gagal mengunggah foto.");
    return data.path;
  }

  async function handleSubmitVehicleCheck(input: {
    tipe: VehicleCheckTipe;
    odometerKM: number;
    fuelBar: FuelBar;
    muatanQty: number;
    photos: VehicleCheckPhoto[];
  }): Promise<void> {
    if (jadwalId == null) return;
    await createVehicleCheckAction({ jadwalId, ...input });
    const rows = await getVehicleChecksForJadwalAction(jadwalId);
    setVehicleChecks(rows);
  }

  const isDraft = jadwal?.Status === "Draft";
  const isWaitingDeparture = jadwal?.Status === "Terbit" && jadwal?.JamAktualBerangkat == null;
  const hasBerangkatCheck = vehicleChecks.some((c) => c.tipe === "BERANGKAT");
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
  // "Biaya BBM tambahan": an extra buffer figure on top of the normal fuel
  // cost above, shown separately (never merged into totalFuelCost) — for
  // every complete 5km of route distance, add the cost of 5km worth of
  // fuel. Confirmed formula with the user: floor(distanceKm / 5) * (5km
  // worth of fuel cost), not a re-scaling of the existing total.
  const extraFuelCost = useMemo(() => {
    if (route == null || konsumsiBBM == null || biayaBBMPerLiter == null) return null;
    const segments = Math.floor(route.distanceKm / 5);
    const costPer5Km = 5 * konsumsiBBM * biayaBBMPerLiter;
    return Math.round(segments * costPer5Km);
  }, [route, konsumsiBBM, biayaBBMPerLiter]);

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
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
      } catch {
        // User cancelled the share sheet — not an error worth surfacing.
      }
      return;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success("Gambar disalin ke clipboard.");
    } catch {
      // Clipboard image write isn't universally supported (e.g. Firefox) —
      // final fallback is a plain download.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  async function handleShareSeluruhnya() {
    const blob = await captureDialogImage();
    if (blob) await shareImageBlob(blob, "validasi-rute.png", "Validasi Rute");
  }

  async function handleShareDetailRute() {
    const text = buildStopListText();
    if (!text) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Detail Rute", text });
      } catch {
        // User cancelled the share sheet — not an error worth surfacing.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Detail rute disalin ke clipboard.");
    } catch {
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
            <DialogTitle className="flex items-center gap-2">
              Validasi Rute
              {jadwal && (
                <Badge variant="outline" className={cn("text-[10px]", isDraft ? "border-dashed" : "border-primary/30 text-primary")}>
                  {jadwal.Status}
                </Badge>
              )}
            </DialogTitle>
            {jadwal && order.length > 0 && (
              <div data-capture-hide="true" className="shrink-0">
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
          </div>
          {jadwal && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Truck className="size-3.5" />
                {armadaNama ?? "Armada"}
              </span>
              {order.length > 0 && (
                <span className="flex items-center gap-1">
                  <Package className="size-3.5" />
                  {formatKemasanQty(totalQty10KG, totalQty5KG)}
                  {totalBonusQty > 0 && <span className="text-primary"> (+{totalBonusQty} bonus)</span>}
                </span>
              )}
            </p>
          )}
          <DialogDescription>Atur waktu, driver, urutan pengiriman, dan validasi rute sebelum berangkat.</DialogDescription>
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
            <div className="order-1 h-[34vh] min-h-[220px] w-full overflow-hidden md:order-2 md:h-auto md:min-h-[440px] md:rounded-lg">
              {pabrik && order.length > 0 ? (
                <RouteMap
                  pabrik={pabrik}
                  stops={order.filter((o) => o.Latitude != null && o.Longitude != null) as (JadwalDetailRow & { Latitude: number; Longitude: number })[]}
                  geometry={route?.geometry ?? null}
                  refitTrigger={refitTrigger}
                />
              ) : (
                <Skeleton className="h-full w-full md:rounded-lg" />
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
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32 shrink-0" />
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
                <Button size="sm" variant="outline" className="shrink-0" disabled={pending} onClick={handleSaveDriverTime}>
                  Simpan
                </Button>
              </div>
            ) : (
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{time}</span>
                <span className="text-muted-foreground">
                  {drivers.find((d) => d.SalesmanID === driverId)?.Name ?? "Tanpa driver"}
                </span>
              </p>
            )}

            {isDraft ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={pending} onClick={handleDeleteDraft}>
                  Batalkan Draft
                </Button>
                {jadwal?.JamMulaiMuat == null ? (
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={pending || isFutureDate}
                    onClick={handleMuat}
                  >
                    Mulai Muat
                  </Button>
                ) : (
                  <Button size="sm" className="flex-1" disabled={!canSelesaiMuat || pending} onClick={handleSelesaiMuat}>
                    {pending ? "Memproses..." : "Selesai Muat"}
                  </Button>
                )}
              </div>
            ) : isWaitingDeparture ? (
              <div className="flex flex-col gap-2">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="size-3.5" />
                  Selesai Muat pukul {formatTime(jadwal!.JamSelesaiMuat as string)} — menunggu Cek Berangkat
                </p>
                <Button size="sm" className="w-fit" disabled={pending || !hasBerangkatCheck} onClick={handleKonfirmasiBerangkat}>
                  {pending ? "Memproses..." : "Berangkat"}
                </Button>
              </div>
            ) : (
              jadwal?.JamAktualBerangkat && (
                <p className="flex items-center gap-1.5 text-xs text-primary">
                  <PackageCheck className="size-3.5" />
                  Sudah berangkat pukul {formatTime(jadwal.JamAktualBerangkat)}
                </p>
              )
            )}

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

            {jadwal?.JamMulaiMuat && (
              <p className="flex items-center gap-1.5 rounded-lg border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
                <Clock className="size-3.5" />
                Mulai Muat pukul {formatTime(jadwal.JamMulaiMuat)}
              </p>
            )}

            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Daftar Tujuan ({order.length})
                {order.length > 0 && (
                  <span className="ml-2 tabular-nums">
                    {formatKemasanQty(totalQty10KG, totalQty5KG)}
                    {totalBonusQty > 0 && <span className="text-primary"> (+{totalBonusQty} bonus)</span>}
                  </span>
                )}
              </p>
              {isDraft && !adding && (
                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" disabled={pending} onClick={handleOpenAdd}>
                  <Plus className="size-3.5" />
                  Tambahkan
                </Button>
              )}
            </div>

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

            <div className={cn("flex flex-col rounded-lg border", capturing ? "max-h-none overflow-visible" : "max-h-72 overflow-y-auto")}>
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
                        printChecked={printSelected.has(d.JadwalDetailID)}
                        onTogglePrint={togglePrint}
                        onRemove={isDraft ? handleRemoveStop : undefined}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>

            {printSelected.size > 0 && (
              <Button size="sm" variant="outline" className="gap-1.5" data-capture-hide="true" onClick={handlePrintSelected}>
                <Printer className="size-3.5" />
                Cetak SI Terpilih ({printSelected.size})
              </Button>
            )}
            {printError && <p className="text-xs text-destructive">{printError}</p>}

            {routeError && <p className="text-xs text-destructive">{routeError}</p>}
            {route && (
              <div className="flex flex-wrap gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                <span className="flex items-center gap-1">
                  <RouteIcon className="size-3.5 text-muted-foreground" />
                  {route.distanceKm.toLocaleString("id-ID")} km
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="size-3.5 text-muted-foreground" />
                  {route.durationMinutes} menit
                </span>
                {totalFuelLiters != null && (
                  <span className="flex items-center gap-1">
                    <Fuel className="size-3.5 text-muted-foreground" />
                    {totalFuelLiters.toLocaleString("id-ID")} L
                    {jenisBBM && ` (${jenisBBM})`}
                  </span>
                )}
                {totalFuelCost != null && (
                  <span className="flex items-center gap-1 font-medium">{formatRupiah(totalFuelCost)}</span>
                )}
                {extraFuelCost != null && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    + {formatRupiah(extraFuelCost)}
                    <span className="text-[10px]">(BBM tambahan)</span>
                  </span>
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
      </DialogContent>
    </Dialog>
  );
}
