"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import dynamic from "next/dynamic";
import { GripVertical, MapPin, Phone, Route as RouteIcon, Fuel, Clock } from "lucide-react";
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
import type { JadwalCard as JadwalCardData, JadwalDetailRow } from "@/lib/queries/pengiriman-jadwal";
import type { DriverOption } from "@/lib/queries/delivery";
import type { MultiPointRoute } from "@/lib/osrm";
import {
  getJadwalDetailAction,
  updateJadwalUrutanAction,
  updateJadwalDriverTimeAction,
  publishJadwalAction,
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
  onOpenChange: (open: boolean) => void;
  // Fired after a successful "Batalkan Draft" so the caller can close this
  // dialog (it has no Jadwal left to show once deleted).
  onDeleted?: () => void;
}) {
  const [detail, setDetail] = useState<JadwalDetailRow[] | null>(null);
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

  const jadwalId = jadwal?.JadwalID ?? null;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (jadwalId == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOrder([]);
      return;
    }
    setLoading(true);
    setError(null);
    getJadwalDetailAction(jadwalId)
      .then((rows) => {
        setDetail(rows);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  // (which in turn keeps "Terbitkan" disabled, matching the mandatory-route
  // rule) instead of silently skipping stops.
  useEffect(() => {
    if (pabrik == null || order.length === 0) return;
    const missing = order.some((o) => o.Latitude == null || o.Longitude == null);
    if (missing) {
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
        if ("error" in data) {
          setRoute(null);
          setRouteError(data.error);
        } else {
          setRoute(data);
        }
      })
      .catch(() => {
        setRoute(null);
        setRouteError("Gagal menghitung rute.");
      })
      .finally(() => setRouteLoading(false));
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
      startTransition(() => updateJadwalUrutanAction(jadwalId, next.map((d) => d.JadwalDetailID)));
    }
  }

  function handleSaveDriverTime() {
    if (jadwalId == null) return;
    startTransition(() =>
      updateJadwalDriverTimeAction(jadwalId, {
        jamJadwal: combineDateAndTime(businessDate, time),
        salesmanId: driverId || null,
      })
    );
  }

  function handlePublish() {
    if (jadwalId == null) return;
    setError(null);
    startTransition(async () => {
      try {
        await publishJadwalAction(jadwalId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menerbitkan DO.");
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
    startTransition(() => startMuatAction(jadwalId));
  }

  function handleBerangkat() {
    if (jadwalId == null) return;
    startTransition(() => startBerangkatAction(jadwalId));
  }

  const isDraft = jadwal?.Status === "Draft";
  const canPublish = isDraft && driverId !== "" && route != null && !routeLoading;
  const totalFuelLiters = useMemo(() => {
    if (route == null || konsumsiBBM == null) return null;
    return Math.round(route.distanceKm * konsumsiBBM * 10) / 10;
  }, [route, konsumsiBBM]);

  return (
    <Dialog open={jadwalId != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Validasi Rute
            {jadwal && (
              <Badge variant="outline" className={cn("text-[10px]", isDraft ? "border-dashed" : "border-primary/30 text-primary")}>
                {jadwal.Status}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>Atur waktu, driver, urutan pengiriman, dan validasi rute sebelum menerbitkan DO.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
              <Select value={driverId} onValueChange={(v) => setDriverId(v ?? "")}>
                <SelectTrigger className="flex-1">
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
              <Button size="sm" variant="outline" disabled={pending} onClick={handleSaveDriverTime}>
                Simpan
              </Button>
            </div>

            {!isDraft && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" disabled={pending} onClick={handleMuat}>
                  Mulai Muat
                </Button>
                <Button size="sm" className="flex-1" disabled={pending} onClick={handleBerangkat}>
                  Berangkat
                </Button>
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

            {isDraft && (
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" disabled={pending} onClick={handleDeleteDraft}>
                  Batalkan Draft
                </Button>
                <Button className="flex-1" disabled={!canPublish || pending} onClick={handlePublish}>
                  {pending ? "Menerbitkan..." : "Terbitkan"}
                </Button>
              </div>
            )}
          </div>

          <div className="min-h-[320px] md:min-h-full">
            {pabrik && order.length > 0 ? (
              <RouteMap
                pabrik={pabrik}
                stops={order.filter((o) => o.Latitude != null && o.Longitude != null) as (JadwalDetailRow & { Latitude: number; Longitude: number })[]}
                geometry={route?.geometry ?? null}
              />
            ) : (
              <Skeleton className="h-full min-h-[320px] w-full rounded-lg" />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
