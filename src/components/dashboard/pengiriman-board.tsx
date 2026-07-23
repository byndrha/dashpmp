"use client";

import { DndContext, useDraggable, useSensor, useSensors, PointerSensor, type DragEndEvent } from "@dnd-kit/core";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArmadaManager } from "@/components/dashboard/armada-dialog";
import { RouteValidationDialog } from "@/components/dashboard/route-validation-dialog";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ArmadaRow } from "@/lib/queries/armada";
import type { JadwalCard as JadwalCardData, AvailableSalesOrder } from "@/lib/queries/pengiriman-jadwal";
import type { DriverOption } from "@/lib/queries/delivery";
import {
  createJadwalDraftAction,
  getAvailableSalesOrdersAction,
  updateJadwalDriverTimeAction,
} from "@/app/(dashboard)/delivery/actions";

// 24-hour axis, but the per-hour width is now derived from the available
// container width at render time (see useContainerWidth below) instead of a
// fixed 80px — a fixed width made the timeline wider than most screens,
// forcing a long horizontal scrollbar. DAY_WIDTH always equals the
// container's own width now, so there's nothing to scroll in the normal
// case.
const MIN_HOUR_WIDTH = 28;
const MIN_CARD_WIDTH = 40;

function hourFraction(value: string | Date): number {
  const d = new Date(value);
  return d.getHours() + d.getMinutes() / 60;
}

function combineDateAndTime(businessDate: string, timeHHMM: string): Date {
  return new Date(`${businessDate}T${timeHHMM}:00`);
}

// Measures the scroll container's own clientWidth on mount and on resize,
// so the 24h axis can be sized to fit it exactly.
function useContainerWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(MIN_HOUR_WIDTH * 24);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

function CreateJadwalDialog({
  open,
  onOpenChange,
  armadaId,
  businessDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  armadaId: number | null;
  businessDate: string;
}) {
  const [available, setAvailable] = useState<AvailableSalesOrder[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [time, setTime] = useState("08:00");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    // Resets the form when the dialog re-opens for a new Armada — not
    // derivable from render since these are user-editable fields.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(new Set());
    setTime("08:00");
    setError(null);
    getAvailableSalesOrdersAction(businessDate).then(setAvailable);
  }, [open, businessDate]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit() {
    if (armadaId == null || selected.size === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        await createJadwalDraftAction({
          armadaId,
          jamJadwal: combineDateAndTime(businessDate, time),
          salesOrderIds: [...selected],
        });
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal membuat draft keberangkatan.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keberangkatan Baru</DialogTitle>
          <DialogDescription>
            Pilih Sales Order yang akan menjadi DO pada keberangkatan ini. Driver &amp; rute divalidasi setelah draft
            dibuat — belum menerbitkan dokumen apa pun.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex max-h-64 flex-col divide-y overflow-y-auto rounded-lg border">
            {available.map((so) => (
              <button
                key={so.SalesOrderID}
                type="button"
                onClick={() => toggle(so.SalesOrderID)}
                className={cn(
                  "flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors",
                  selected.has(so.SalesOrderID) ? "bg-primary/10" : "hover:bg-muted"
                )}
              >
                <span className="min-w-0 truncate">
                  {so.CustomerName} <span className="text-xs text-muted-foreground">· {so.Wilayah}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{so.Qty} kantong</span>
              </button>
            ))}
            {available.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada SO yang tersedia.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button disabled={pending || selected.size === 0 || armadaId == null} onClick={handleSubmit} className="ml-auto">
            {pending ? "Menyimpan..." : `Buat Draft (${selected.size} SO)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DraggableJadwalCard({
  jadwal: j,
  hourWidth,
  cardWidth,
  onCardClick,
}: {
  jadwal: JadwalCardData;
  hourWidth: number;
  cardWidth: number;
  onCardClick: (jadwalId: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `jadwal-${j.JadwalID}`,
    data: { jadwalId: j.JadwalID },
  });
  const isDraft = j.Status === "Draft";

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      onClick={() => !isDragging && onCardClick(j.JadwalID)}
      className={cn(
        "absolute top-2 flex flex-col gap-0.5 rounded-md border p-1 text-left text-[9px] shadow-sm",
        isDraft ? "border-dashed border-muted-foreground/40 bg-muted/40" : "border-primary/30 bg-primary/10",
        isDragging && "z-20 opacity-70 shadow-lg"
      )}
      style={{
        left: hourFraction(j.JamJadwal) * hourWidth,
        width: cardWidth,
        transform: transform ? `translateX(${transform.x}px)` : undefined,
      }}
    >
      <span className="font-semibold tabular-nums">{formatTime(j.JamJadwal)}</span>
      <span className="tabular-nums text-muted-foreground">{j.TotalKantong} kantong</span>
      <span className="tabular-nums text-muted-foreground">
        {j.TotalStop} {isDraft ? "SO" : "DO"}
      </span>
      {isDraft && <span className="text-muted-foreground">Draft</span>}
      {j.JamAktualBerangkat && <span className="text-primary">Berangkat</span>}
    </button>
  );
}

function ArmadaRowBoard({
  armada,
  jadwal,
  hourWidth,
  dayWidth,
  onCardClick,
  onCreateClick,
}: {
  armada: ArmadaRow;
  jadwal: JadwalCardData[];
  hourWidth: number;
  dayWidth: number;
  onCardClick: (jadwalId: number) => void;
  onCreateClick: (armadaId: number) => void;
}) {
  const cardWidth = Math.max(MIN_CARD_WIDTH, hourWidth - 6);
  return (
    <div className="flex items-stretch self-start">
      <div className="sticky left-0 z-10 flex w-56 shrink-0 flex-col gap-1.5 bg-card py-3 pr-3">
        <div className="flex items-center gap-2">
          {armada.FotoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={armada.FotoPath} alt={armada.Nama} className="size-10 shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground">
              Foto
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{armada.Nama}</p>
            <p className="truncate text-xs text-muted-foreground">{armada.PlatNomor ?? "-"}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-1">
          <Badge
            variant="outline"
            className={cn(
              "h-5 px-1.5 text-[10px]",
              armada.Status === "Baik" && "border-primary/30 text-primary",
              armada.Status !== "Baik" && "border-destructive/30 text-destructive"
            )}
          >
            {armada.Status}
          </Badge>
          <Button
            variant="outline"
            size="icon"
            className="size-6"
            disabled={armada.Status !== "Baik"}
            onClick={() => onCreateClick(armada.ArmadaID)}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="relative shrink-0 border-l" style={{ width: dayWidth, height: 72 }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="absolute top-0 h-full border-r" style={{ left: h * hourWidth, width: hourWidth }} />
        ))}
        {jadwal.map((j) => (
          <DraggableJadwalCard key={j.JadwalID} jadwal={j} hourWidth={hourWidth} cardWidth={cardWidth} onCardClick={onCardClick} />
        ))}
      </div>
    </div>
  );
}

export function PengirimanBoard({
  armada,
  jadwal,
  drivers,
  businessDate,
  todayISO,
}: {
  armada: ArmadaRow[];
  jadwal: JadwalCardData[];
  drivers: DriverOption[];
  businessDate: string;
  todayISO: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const isToday = businessDate === todayISO;
  const [detailJadwalId, setDetailJadwalId] = useState<number | null>(null);
  const [createArmadaId, setCreateArmadaId] = useState<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [containerRef, containerWidth] = useContainerWidth<HTMLDivElement>();
  const hourWidth = Math.max(MIN_HOUR_WIDTH, containerWidth / 24);
  const dayWidth = hourWidth * 24;

  const jadwalByArmada = useMemo(() => {
    const map = new Map<number, JadwalCardData[]>();
    for (const j of jadwal) {
      const list = map.get(j.ArmadaID) ?? [];
      list.push(j);
      map.set(j.ArmadaID, list);
    }
    return map;
  }, [jadwal]);

  const sortedArmada = useMemo(() => {
    function nextPendingHour(armadaId: number): number {
      const list = jadwalByArmada.get(armadaId) ?? [];
      const pending = list.filter((j) => !j.JamAktualBerangkat);
      if (pending.length === 0) return Infinity;
      return Math.min(...pending.map((j) => hourFraction(j.JamJadwal)));
    }
    return [...armada].sort((a, b) => {
      const diff = nextPendingHour(a.ArmadaID) - nextPendingHour(b.ArmadaID);
      return diff !== 0 ? diff : a.Nama.localeCompare(b.Nama);
    });
  }, [armada, jadwalByArmada]);

  const openJadwal = jadwal.find((j) => j.JadwalID === detailJadwalId) ?? null;
  const openArmada = openJadwal ? armada.find((a) => a.ArmadaID === openJadwal.ArmadaID) : null;

  function goToDate(newDate: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("pengirimanDate", newDate);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function shiftDate(deltaDays: number) {
    const d = new Date(businessDate);
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + deltaDays));
    goToDate(next.toISOString().slice(0, 10));
  }

  function handleDragEnd(event: DragEndEvent) {
    const jadwalId = event.active.data.current?.jadwalId as number | undefined;
    if (jadwalId == null || event.delta.x === 0) return;

    const current = jadwal.find((j) => j.JadwalID === jadwalId);
    if (!current) return;

    const currentHour = hourFraction(current.JamJadwal);
    const deltaHours = event.delta.x / hourWidth;
    const newHour = Math.min(23.75, Math.max(0, Math.round((currentHour + deltaHours) * 4) / 4));
    const hour = Math.floor(newHour);
    const minute = Math.round((newHour - hour) * 60);
    const newTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

    // Reschedule-by-drag calls the same driver/time update path the
    // validation dialog uses, keeping only the time — driver stays as-is.
    startTransition(() => {
      updateJadwalDriverTimeAction(jadwalId, {
        jamJadwal: combineDateAndTime(businessDate, newTime),
        salesmanId: current.SalesmanID,
      });
    });
  }

  return (
    <Card className="relative">
      {isPending && (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-primary/15">
          <div className="h-full w-1/3 animate-indeterminate rounded-full bg-primary" />
        </div>
      )}
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="font-display">
            Papan Pengiriman {isToday ? "Hari Ini" : formatDate(businessDate)}
          </CardTitle>
          <CardDescription>{jadwal.length} keberangkatan terjadwal</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ArmadaManager armada={armada} />
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="size-8" disabled={isPending} onClick={() => shiftDate(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Input
              type="date"
              value={businessDate}
              max={todayISO}
              disabled={isPending}
              onChange={(e) => e.target.value && goToDate(e.target.value)}
              className="h-8 w-40 text-xs"
            />
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={isToday || isPending}
              onClick={() => shiftDate(1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {sortedArmada.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada armada. Tambah lewat &quot;Kelola Armada&quot;.</p>
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div ref={containerRef} className="overflow-x-auto">
              <div className="flex flex-col divide-y">
                {sortedArmada.map((a) => (
                  <ArmadaRowBoard
                    key={a.ArmadaID}
                    armada={a}
                    jadwal={jadwalByArmada.get(a.ArmadaID) ?? []}
                    hourWidth={hourWidth}
                    dayWidth={dayWidth}
                    onCardClick={setDetailJadwalId}
                    onCreateClick={setCreateArmadaId}
                  />
                ))}
              </div>
            </div>
          </DndContext>
        )}
      </CardContent>

      <RouteValidationDialog
        jadwal={openJadwal}
        businessDate={businessDate}
        drivers={drivers}
        konsumsiBBM={openArmada?.KonsumsiBBM ?? null}
        onOpenChange={(open) => !open && setDetailJadwalId(null)}
        onDeleted={() => setDetailJadwalId(null)}
      />
      <CreateJadwalDialog
        open={createArmadaId != null}
        onOpenChange={(open) => !open && setCreateArmadaId(null)}
        armadaId={createArmadaId}
        businessDate={businessDate}
      />
    </Card>
  );
}
