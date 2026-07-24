"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import dynamic from "next/dynamic";
import { GripVertical, MapPin, Route as RouteIcon, Fuel, Clock, Plus, PackageCheck } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/format";
import type { JadwalCard as JadwalCardData, JadwalDetailRow, AvailableSalesOrder } from "@/lib/queries/pengiriman-jadwal";
import type { DriverOption } from "@/lib/queries/delivery";
import type { MultiPointRoute } from "@/lib/osrm";
import {
  getJadwalDetailAction,
  updateJadwalUrutanAction,
  updateJadwalDriverTimeAction,
  addSalesOrdersToJadwalAction,
  getAvailableSalesOrdersAction,
  deleteJadwalDraftAction,
  startMuatAction,
  startBerangkatAction,
} from "@/app/(dashboard)/delivery/actions";

const RouteMap = dynamic(() => import("@/components/dashboard/route-map").then((m) => m.RouteMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-lg" />,
});

function combineDateAndTime(businessDate: string, timeHHMM: string): Date {
  return new Date(`${businessDate}T${timeHHMM}:00`);
}

function SortableStopRow({ detail, index }: { detail: JadwalDetailRow; index: number }) {
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
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{detail.CustomerName}</p>
        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <MapPin className="size-3 shrink-0" />
          {detail.Wilayah}
          {detail.Kecamatan ? ` | ${detail.Kecamatan}` : ""}
        </p>
      </div>
      <span className="shrink-0 tabular-nums text-muted-foreground">{detail.Qty} kantong</span>
      {detail.Latitude == null && (
        <Badge variant="outline" className="shrink-0 border-destructive/30 text-[10px] text-destructive">
          Tanpa lokasi
        </Badge>
      )}
    </div>
  );
}

export function RouteValidationDialog({
  jadwal,
  businessDate,
  drivers,
  konsumsiBBM,
  kapasitasMaks,
  onOpenChange,
  onDeleted,
}: {
  jadwal: JadwalCardData | null;
  businessDate: string;
  drivers: DriverOption[];
  // Fuel estimate input — the Armada the open Jadwal belongs to, resolved
  // by the caller (JadwalCard itself doesn't carry KonsumsiBBM, ArmadaRow
  // does).
  konsumsiBBM: number | null;
  // Capacity hard-block input, same resolution path as konsumsiBBM. Null
  // means no limit has been configured, so nothing is blocked.
  kapasitasMaks: number | null;
  onOpenChange: (open: boolean) => void;
  // Fired after a successful "Batalkan Draft" so the caller can close this
  // dialog (it has no Jadwal left to show once deleted).
  onDeleted?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<JadwalDetailRow[]>([]);
  const [time, setTime] = useState("00:00");
  const [driverId, setDriverId] = useState("");
  const [pabrik, setPabrik] = useState<{ latitude: number; longitude: number } | null>(null);
  const [route, setRoute] = useState<MultiPointRoute | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [availableToAdd, setAvailableToAdd] = useState<AvailableSalesOrder[]>([]);
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);

  const jadwalId = jadwal?.JadwalID ?? null;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const totalQty = useMemo(() => order.reduce((sum, o) => sum + o.Qty, 0), [order]);
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

    if (jadwalId == null) {
      setOrder([]);
      return;
    }
    setLoading(true);
    setError(null);
    getJadwalDetailAction(jadwalId)
      .then((rows) => {
        setOrder(rows);
      })
      .finally(() => setLoading(false));
  }, [jadwalId]);

  useEffect(() => {
    if (jadwal == null) return;
    const d = new Date(jadwal.JamJadwal);
    // Syncs the editable time/driver fields from the open card — not
    // derivable from render since these are user-editable inputs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    setDriverId(jadwal.SalesmanID ?? "");
  }, [jadwal]);

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
  // existing DOs) doesn't go through handleBerangkat.
  function handleSaveDriverTime() {
    if (jadwalId == null) return;
    setError(null);
    startTransition(async () => {
      try {
        await updateJadwalDriverTimeAction(jadwalId, {
          jamJadwal: combineDateAndTime(businessDate, time),
          salesmanId: driverId || null,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan driver/waktu.");
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

  // "Berangkat" always persists the currently-selected driver/time first —
  // otherwise a driver picked but not yet "Simpan"-ed would still read as
  // NULL server-side (startBerangkat checks the persisted SalesmanID column,
  // not client state), failing confusingly even though the button looked
  // ready. This is also the moment real DO documents get created — there is
  // no separate "Terbitkan" step anymore.
  function handleBerangkat() {
    if (jadwalId == null) return;
    setError(null);
    startTransition(async () => {
      try {
        await updateJadwalDriverTimeAction(jadwalId, {
          jamJadwal: combineDateAndTime(businessDate, time),
          salesmanId: driverId || null,
        });
        await startBerangkatAction(jadwalId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal memproses keberangkatan.");
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

  const isDraft = jadwal?.Status === "Draft";
  const overCapacity = kapasitasMaks != null && totalQty > kapasitasMaks;
  const canBerangkat = isDraft && driverId !== "" && route != null && !routeLoading && !overCapacity;
  const totalFuelLiters = useMemo(() => {
    if (route == null || konsumsiBBM == null) return null;
    return Math.round(route.distanceKm * konsumsiBBM * 10) / 10;
  }, [route, konsumsiBBM]);

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
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="flex items-center gap-2">
            Validasi Rute
            {jadwal && (
              <Badge variant="outline" className={cn("text-[10px]", isDraft ? "border-dashed" : "border-primary/30 text-primary")}>
                {jadwal.Status}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>Atur waktu, driver, urutan pengiriman, dan validasi rute sebelum berangkat.</DialogDescription>
        </DialogHeader>

        {/* Mobile (default): map first, full-bleed, then the config panel
            below it as a rounded-top "sheet" pulled up slightly to overlap
            the map's bottom edge — same idea as Google Maps' bottom sheet,
            built with layout order + a negative margin rather than a real
            drag-to-resize sheet (out of scope here).
            md and up: reverts to config-left / map-right side by side,
            matching how a desktop map + form split is usually laid out. */}
        <div className="flex flex-col md:grid md:grid-cols-2 md:gap-4 md:p-4 md:pt-2 lg:grid-cols-[1fr_1.3fr]">
          <div className="order-1 h-[34vh] min-h-[220px] w-full overflow-hidden md:order-2 md:h-auto md:min-h-[440px] md:rounded-lg">
            {pabrik && order.length > 0 ? (
              <RouteMap
                pabrik={pabrik}
                stops={order.filter((o) => o.Latitude != null && o.Longitude != null) as (JadwalDetailRow & { Latitude: number; Longitude: number })[]}
                geometry={route?.geometry ?? null}
              />
            ) : (
              <Skeleton className="h-full w-full md:rounded-lg" />
            )}
          </div>

          <div className="order-2 -mt-4 flex flex-col gap-3 rounded-t-2xl bg-popover p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] md:order-1 md:mt-0 md:rounded-none md:p-0 md:shadow-none">
            <div className="flex flex-wrap items-center gap-2">
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

            {isDraft ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={pending} onClick={handleDeleteDraft}>
                  Batalkan Draft
                </Button>
                {jadwal?.JamMulaiMuat == null && (
                  <Button size="sm" variant="outline" className="flex-1" disabled={pending} onClick={handleMuat}>
                    Mulai Muat
                  </Button>
                )}
                <Button size="sm" className="flex-1" disabled={!canBerangkat || pending} onClick={handleBerangkat}>
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
              <p className="text-xs font-medium text-muted-foreground">Daftar Tujuan ({order.length})</p>
              {isDraft && !adding && (
                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" disabled={pending} onClick={handleOpenAdd}>
                  <Plus className="size-3.5" />
                  Tambahkan
                </Button>
              )}
            </div>

            {isDraft && adding && (
              <div className="flex flex-col gap-2 rounded-lg border p-2">
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
                        <span className="shrink-0 tabular-nums text-muted-foreground">{so.Qty} kantong</span>
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

            <div className="flex max-h-72 flex-col overflow-y-auto rounded-lg border">
              {loading && <p className="py-6 text-center text-sm text-muted-foreground">Memuat...</p>}
              {!loading && order.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada SO.</p>
              )}
              {!loading && order.length > 0 && (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={order.map((o) => o.JadwalDetailID)} strategy={verticalListSortingStrategy}>
                    {order.map((d, i) => (
                      <SortableStopRow key={d.JadwalDetailID} detail={d} index={i} />
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>

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
                  </span>
                )}
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
