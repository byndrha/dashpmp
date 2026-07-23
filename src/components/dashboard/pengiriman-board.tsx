"use client";

import { DndContext, useDraggable, useSensor, useSensors, PointerSensor, type DragEndEvent } from "@dnd-kit/core";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Plus, Phone, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArmadaManager } from "@/components/dashboard/armada-dialog";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ArmadaRow } from "@/lib/queries/armada";
import type { JadwalCard as JadwalCardData, JadwalDetailRow, UnassignedDO } from "@/lib/queries/pengiriman-jadwal";
import type { DriverOption } from "@/lib/queries/delivery";
import {
  createJadwalAction,
  updateJadwalTimeAction,
  startMuatAction,
  startBerangkatAction,
  getJadwalDetailAction,
  getUnassignedDeliveryOrdersAction,
} from "@/app/(dashboard)/delivery/actions";

// 24-hour axis: 80px/hour = 1920px for a full day. Every position/sizing
// value below (ruler, cards, gridlines) is derived from this one constant.
const HOUR_WIDTH = 80;
const DAY_WIDTH = HOUR_WIDTH * 24;
const CARD_WIDTH = 72;

// Times are constructed/read entirely client-side with plain Date methods —
// matching how formatTime()/formatDate() already display every WIB
// timestamp elsewhere in this app (trusting the viewing device's own local
// timezone, since staff are physically in Indonesia). A Date built in the
// browser keeps its correct instant across the Server Action boundary, so
// no manual UTC-offset math (like parseWibDateTimeLocal) is needed here.
function hourFraction(value: string | Date): number {
  const d = new Date(value);
  return d.getHours() + d.getMinutes() / 60;
}

function combineDateAndTime(businessDate: string, timeHHMM: string): Date {
  return new Date(`${businessDate}T${timeHHMM}:00`);
}

function JadwalDetailDialog({
  jadwalId,
  jamJadwal,
  businessDate,
  onOpenChange,
}: {
  jadwalId: number | null;
  // Current scheduled time for the open card, so the time field starts
  // pre-filled — null while no card is open (dialog is closed).
  jamJadwal: string | Date | null;
  businessDate: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = useState<JadwalDetailRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState("00:00");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (jadwalId == null) {
      setDetail(null);
      return;
    }
    setLoading(true);
    getJadwalDetailAction(jadwalId)
      .then(setDetail)
      .finally(() => setLoading(false));
  }, [jadwalId]);

  useEffect(() => {
    if (jamJadwal == null) return;
    const d = new Date(jamJadwal);
    setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
  }, [jamJadwal]);

  function handleMuat() {
    if (jadwalId == null) return;
    startTransition(() => startMuatAction(jadwalId));
  }

  function handleBerangkat() {
    if (jadwalId == null) return;
    startTransition(() => startBerangkatAction(jadwalId));
  }

  function handleSaveTime() {
    if (jadwalId == null) return;
    startTransition(() => updateJadwalTimeAction(jadwalId, combineDateAndTime(businessDate, time)));
  }

  return (
    <Dialog open={jadwalId != null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Detail Keberangkatan</DialogTitle>
          <DialogDescription>Daftar DO yang ikut pada keberangkatan ini.</DialogDescription>
        </DialogHeader>
        {/* Second way to reschedule (alongside dragging the card on the
            board) — both call the same updateJadwalTimeAction. */}
        <div className="flex items-center gap-2">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
          <Button size="sm" variant="outline" disabled={pending} onClick={handleSaveTime}>
            Simpan Jam
          </Button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" disabled={pending} onClick={handleMuat}>
            Mulai Muat
          </Button>
          <Button size="sm" className="flex-1" disabled={pending} onClick={handleBerangkat}>
            Berangkat
          </Button>
        </div>
        <div className="flex max-h-80 flex-col divide-y overflow-y-auto rounded-lg border">
          {loading && <p className="py-6 text-center text-sm text-muted-foreground">Memuat...</p>}
          {!loading &&
            detail?.map((d) => (
              <div key={d.DeliveryOrderID} className="flex flex-col gap-1 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{d.CustomerName}</span>
                  <span className="tabular-nums text-muted-foreground">{d.Qty} kantong</span>
                </div>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="size-3" />
                  {d.Wilayah}
                  {d.Kecamatan ? ` | ${d.Kecamatan}` : ""}
                  {d.Alamat ? ` — ${d.Alamat}` : ""}
                </span>
                {d.MobileNo && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Phone className="size-3" />
                    {d.MobileNo}
                  </span>
                )}
              </div>
            ))}
          {!loading && detail?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada DO.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateJadwalDialog({
  open,
  onOpenChange,
  armadaId,
  businessDate,
  drivers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  armadaId: number | null;
  businessDate: string;
  drivers: DriverOption[];
}) {
  const [unassigned, setUnassigned] = useState<UnassignedDO[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [time, setTime] = useState("08:00");
  const [salesmanId, setSalesmanId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setTime("08:00");
    setSalesmanId("");
    setError(null);
    getUnassignedDeliveryOrdersAction(businessDate).then(setUnassigned);
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
        await createJadwalAction({
          armadaId,
          salesmanId: salesmanId || null,
          jamJadwal: combineDateAndTime(businessDate, time),
          deliveryOrderIds: [...selected],
        });
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal membuat keberangkatan.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keberangkatan Baru</DialogTitle>
          <DialogDescription>Pilih DO yang ikut pada keberangkatan ini.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
            <Select value={salesmanId} onValueChange={(v) => setSalesmanId(v ?? "")}>
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
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex max-h-64 flex-col divide-y overflow-y-auto rounded-lg border">
            {unassigned.map((u) => (
              <button
                key={u.DeliveryOrderID}
                type="button"
                onClick={() => toggle(u.DeliveryOrderID)}
                className={cn(
                  "flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors",
                  selected.has(u.DeliveryOrderID) ? "bg-primary/10" : "hover:bg-muted"
                )}
              >
                <span className="min-w-0 truncate">
                  {u.CustomerName} <span className="text-xs text-muted-foreground">· {u.Wilayah}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{u.Qty} kantong</span>
              </button>
            ))}
            {unassigned.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada DO yang belum ditugaskan.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button disabled={pending || selected.size === 0 || armadaId == null} onClick={handleSubmit} className="ml-auto">
            {pending ? "Menyimpan..." : `Buat Keberangkatan (${selected.size} DO)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DraggableJadwalCard({ jadwal: j, onCardClick }: { jadwal: JadwalCardData; onCardClick: (jadwalId: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `jadwal-${j.JadwalID}`,
    data: { jadwalId: j.JadwalID },
  });

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      onClick={() => !isDragging && onCardClick(j.JadwalID)}
      className={cn(
        "absolute top-2 flex flex-col gap-0.5 rounded-md border border-primary/30 bg-primary/10 p-1.5 text-left text-[10px] shadow-sm",
        isDragging && "z-20 opacity-70 shadow-lg"
      )}
      style={{
        left: hourFraction(j.JamJadwal) * HOUR_WIDTH,
        width: CARD_WIDTH,
        transform: transform ? `translateX(${transform.x}px)` : undefined,
      }}
    >
      <span className="font-semibold tabular-nums">{formatTime(j.JamJadwal)}</span>
      <span className="tabular-nums text-muted-foreground">{j.TotalKantong} kantong</span>
      <span className="tabular-nums text-muted-foreground">{j.TotalDO} DO</span>
      {j.JamAktualBerangkat && <span className="text-primary">Berangkat</span>}
    </button>
  );
}

function ArmadaRowBoard({
  armada,
  jadwal,
  onCardClick,
  onCreateClick,
}: {
  armada: ArmadaRow;
  jadwal: JadwalCardData[];
  onCardClick: (jadwalId: number) => void;
  onCreateClick: (armadaId: number) => void;
}) {
  return (
    <div className="flex items-stretch">
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
      <div className="relative border-l" style={{ width: DAY_WIDTH, height: 72 }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="absolute top-0 h-full border-r" style={{ left: h * HOUR_WIDTH, width: HOUR_WIDTH }} />
        ))}
        {jadwal.map((j) => (
          <DraggableJadwalCard key={j.JadwalID} jadwal={j} onCardClick={onCardClick} />
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

  const jadwalByArmada = useMemo(() => {
    const map = new Map<number, JadwalCardData[]>();
    for (const j of jadwal) {
      const list = map.get(j.ArmadaID) ?? [];
      list.push(j);
      map.set(j.ArmadaID, list);
    }
    return map;
  }, [jadwal]);

  // Vehicles with an upcoming (not yet departed) trip today float to the
  // top, ordered by how soon that trip leaves; vehicles with nothing
  // pending today sort after, alphabetically.
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
    const deltaHours = event.delta.x / HOUR_WIDTH;
    // Round to the nearest 15 minutes (0.25h), clamp to a valid day.
    const newHour = Math.min(23.75, Math.max(0, Math.round((currentHour + deltaHours) * 4) / 4));
    const hour = Math.floor(newHour);
    const minute = Math.round((newHour - hour) * 60);
    const newTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

    startTransition(() => {
      updateJadwalTimeAction(jadwalId, combineDateAndTime(businessDate, newTime));
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
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada armada. Tambah lewat "Kelola Armada".</p>
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="overflow-x-auto">
              <div className="flex flex-col divide-y">
                {sortedArmada.map((a) => (
                  <ArmadaRowBoard
                    key={a.ArmadaID}
                    armada={a}
                    jadwal={jadwalByArmada.get(a.ArmadaID) ?? []}
                    onCardClick={setDetailJadwalId}
                    onCreateClick={setCreateArmadaId}
                  />
                ))}
              </div>
            </div>
          </DndContext>
        )}
      </CardContent>

      <JadwalDetailDialog
        jadwalId={detailJadwalId}
        jamJadwal={jadwal.find((j) => j.JadwalID === detailJadwalId)?.JamJadwal ?? null}
        businessDate={businessDate}
        onOpenChange={(open) => !open && setDetailJadwalId(null)}
      />
      <CreateJadwalDialog
        open={createArmadaId != null}
        onOpenChange={(open) => !open && setCreateArmadaId(null)}
        armadaId={createArmadaId}
        businessDate={businessDate}
        drivers={drivers}
      />
    </Card>
  );
}
