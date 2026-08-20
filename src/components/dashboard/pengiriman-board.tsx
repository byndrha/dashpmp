"use client";

import { DndContext, useDraggable, useDroppable, useSensor, useSensors, PointerSensor, type DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Plus, Wrench, User, Combine } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeInput } from "@/components/ui/time-input";
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
import { ArmadaManager, ArmadaFormDialog, STATUS_BADGE, rowToForm } from "@/components/dashboard/armada-dialog";
import { ArmadaConflictDialog } from "@/components/dashboard/armada-conflict-dialog";
import { DriverManager } from "@/components/dashboard/driver-manager";
import { RouteValidationDialog } from "@/components/dashboard/route-validation-dialog";
import { UbahPemesananDialog, type UbahPemesananTarget } from "@/components/dashboard/ubah-pemesanan-dialog";
import { formatDate, formatTime, formatKemasanQty } from "@/lib/format";
import { ROLLOVER_HOUR, shiftDateISO, resolveBusinessDateTime } from "@/lib/business-date";
import { cn } from "@/lib/utils";
import type { ArmadaRow, ArmadaInput } from "@/lib/queries/armada";
import type { ExpeditionVehicleOption } from "@/lib/queries/expedition";
import type {
  JadwalCard as JadwalCardData,
  AvailableSalesOrder,
  ExternalDelivery,
  ArmadaConflictInfo,
} from "@/lib/queries/pengiriman-jadwal";
import type { DriverOption } from "@/lib/queries/delivery";
import type { ArmadaActivity, ArmadaActivityType } from "@/lib/armada-activity-types";
import { ARMADA_ACTIVITY_TYPES, ARMADA_ACTIVITY_LABEL } from "@/lib/armada-activity-types";
import type { DriverProfileRow } from "@/lib/queries/driver-profile";
import {
  createJadwalDraftAction,
  getAvailableSalesOrdersAction,
  updateJadwalDriverTimeAction,
  updateJadwalArmadaAction,
  updateArmadaAction,
  createArmadaActivityAction,
  updateArmadaActivityAction,
  deleteArmadaActivityAction,
  mergeExternalDeliveriesAction,
  getMaxSalesOrderTransDateForDeliveriesAction,
  checkArmadaConflictAction,
} from "@/app/mkesindo/(dashboard)/delivery/actions";

// 24-hour axis, but the per-hour width is now derived from the available
// container width at render time (see useContainerWidth below) instead of a
// fixed 80px — a fixed width made the timeline wider than most screens,
// forcing a long horizontal scrollbar. DAY_WIDTH now equals the container's
// own width MINUS the sticky info column (INFO_COL_WIDTH, matching w-56),
// since that column shares the same scroll container and permanently eats
// into its width — omitting it here previously left a residual ~224px of
// overflow no matter how wide the screen was.
const MIN_HOUR_WIDTH = 28;
// Wide enough that Draft/Terbit cards keep their 4 lines of text legible
// even when several land in the same hour and get pushed into separate
// lanes (assignLanes) instead of overlapping.
const MIN_CARD_WIDTH = 92;
const INFO_COL_WIDTH = 224;
const DATE_SEGMENT_HEIGHT = 20;
const HOUR_RULER_HEIGHT = 20;
const CARD_HEIGHT = 56;
const CARD_GAP = 4;
const ROW_TOP_PADDING = 8;

// Timeline-relative hour (0-24), not the actual wall-clock hour — the axis
// starts at ROLLOVER_HOUR (14:00 WIB) and wraps to ROLLOVER_HOUR the next
// day, matching the business-date label the board is keyed on (see
// ROLLOVER_HOUR in business-date.ts). An actual 15:00 departure lands at
// timeline position 1, actual 02:00 lands at position 12, etc.
function hourFraction(value: string | Date): number {
  const d = new Date(value);
  const hour = d.getHours() + d.getMinutes() / 60;
  return (hour - ROLLOVER_HOUR + 24) % 24;
}

interface TimelineBlock {
  key: string;
  left: number;
  width: number;
}

// Multiple cards can legitimately share the same Armada + time slot (e.g.
// two Pemesanan submitted for the same departure, or a Pengiriman that
// overlaps a manually-logged Perawatan) — without lane assignment they'd
// all render at the exact same absolute {left, top}, perfectly overlapping
// so only the topmost one is visible/clickable even though every one of
// them still exists. Greedy interval-graph-coloring: sort by horizontal
// position, place each block in the first lane whose previous occupant
// doesn't overlap it, else open a new lane. Generic over pixel-space
// blocks so the same function lanes Jadwal cards, ArmadaActivity cards,
// and the auto-derived Memuat/Perjalanan/Kembali segments together.
function assignLanes(blocks: TimelineBlock[]): { laneOf: Map<string, number>; laneCount: number } {
  const sorted = [...blocks].sort((a, b) => a.left - b.left);
  const laneEnds: number[] = [];
  const laneOf = new Map<string, number>();
  for (const b of sorted) {
    const right = b.left + b.width;
    let lane = laneEnds.findIndex((end) => end <= b.left);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(right);
    } else {
      laneEnds[lane] = right;
    }
    laneOf.set(b.key, lane);
  }
  return { laneOf, laneCount: laneEnds.length };
}

// Real-time duration in hours between two datetimes — timezone-agnostic
// (epoch difference), unlike hourFraction which is only meaningful for a
// single point on the ROLLOVER_HOUR-based axis.
function durationHours(start: string | Date, end: string | Date): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000;
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

// Keeps followerRef's sticky `top` pinned exactly to anchorRef's current
// bottom edge (both read live via getBoundingClientRect, viewport-relative)
// — stacks the timeline header directly below the sticky CardHeader with no
// gap. Deliberately NOT "measure CardHeader's height once, then compute
// top-14 + height": that approach drifted out of sync with the header's
// real rendered height (e.g. when its button/date-picker row wraps to a
// second line on a narrower viewport), leaving a visible blank gap between
// the two sticky bars. Reading the anchor's actual live bottom edge on every
// scroll/resize is self-correcting instead — whatever height CardHeader
// ends up at, the follower always lands exactly at its bottom edge. Writes
// directly to the DOM (no React state) to stay cheap on scroll.
function useStickyBelow(anchorRef: React.RefObject<HTMLElement | null>, followerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    function sync() {
      const anchor = anchorRef.current;
      const follower = followerRef.current;
      if (!anchor || !follower) return;
      follower.style.top = `${anchor.getBoundingClientRect().bottom}px`;
    }
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    const resizeObserver = new ResizeObserver(sync);
    if (anchorRef.current) resizeObserver.observe(anchorRef.current);
    return () => {
      window.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      resizeObserver.disconnect();
    };
  }, [anchorRef, followerRef]);
}

function CreateJadwalDialog({
  open,
  onOpenChange,
  armadaId,
  businessDate,
  kapasitasMaks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  armadaId: number | null;
  businessDate: string;
  // Hard-caps total selected Qty against the target Armada's KapasitasMaks —
  // null means no limit has been configured, so nothing is disabled.
  kapasitasMaks: number | null;
}) {
  const [available, setAvailable] = useState<AvailableSalesOrder[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [time, setTime] = useState("08:00");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ info: ArmadaConflictInfo; jamJadwal: Date } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    // Resets the form when the dialog re-opens for a new Armada — not
    // derivable from render since these are user-editable fields.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(new Set());
    setTime("08:00");
    setError(null);
    setConflict(null);
    getAvailableSalesOrdersAction(businessDate).then(setAvailable);
  }, [open, businessDate]);

  const selectedQty = useMemo(
    () => available.filter((so) => selected.has(so.SalesOrderID)).reduce((sum, so) => sum + so.Qty, 0),
    [available, selected]
  );

  function toggle(id: string, qty: number) {
    setSelected((prev) => {
      const isSelected = prev.has(id);
      if (!isSelected && kapasitasMaks != null && selectedQty + qty > kapasitasMaks) {
        return prev;
      }
      const next = new Set(prev);
      if (isSelected) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function doCreate(jamJadwal: Date) {
    if (armadaId == null) return;
    startTransition(async () => {
      const result = await createJadwalDraftAction({
        armadaId,
        jamJadwal,
        salesOrderIds: [...selected],
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
    });
  }

  function handleSubmit() {
    if (armadaId == null || selected.size === 0) return;
    setError(null);
    const jamJadwal = resolveBusinessDateTime(businessDate, time);
    startTransition(async () => {
      const check = await checkArmadaConflictAction(armadaId, jamJadwal, selectedQty, null);
      if (check) {
        setConflict({ info: check, jamJadwal });
        return;
      }
      doCreate(jamJadwal);
    });
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keberangkatan Baru</DialogTitle>
          <DialogDescription>
            Pilih Sales Order yang akan menjadi DO pada keberangkatan ini. Driver &amp; rute divalidasi setelah draft
            dibuat — dokumen DO baru terbit saat klik Berangkat.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <TimeInput value={time} onChange={setTime} />
            {kapasitasMaks != null && (
              <span
                className={cn(
                  "ml-auto text-xs tabular-nums",
                  selectedQty > kapasitasMaks ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {selectedQty} / {kapasitasMaks} kantong
              </span>
            )}
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex max-h-64 flex-col divide-y overflow-y-auto rounded-lg border">
            {available.map((so) => {
              const isSelected = selected.has(so.SalesOrderID);
              const overCapacity = !isSelected && kapasitasMaks != null && selectedQty + so.Qty > kapasitasMaks;
              return (
                <button
                  key={so.SalesOrderID}
                  type="button"
                  disabled={overCapacity}
                  onClick={() => toggle(so.SalesOrderID, so.Qty)}
                  className={cn(
                    "flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors",
                    isSelected && "bg-primary/10",
                    !isSelected && !overCapacity && "hover:bg-muted",
                    overCapacity && "cursor-not-allowed opacity-40"
                  )}
                >
                  <span className="min-w-0 truncate">
                    {so.CustomerName} <span className="text-xs text-muted-foreground">· {so.Wilayah}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatKemasanQty(so.Qty10KG, so.Qty5KG)}
                    {overCapacity && " · kapasitas penuh"}
                  </span>
                </button>
              );
            })}
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
    {conflict && (
      <ArmadaConflictDialog
        conflict={conflict.info}
        onCancel={() => setConflict(null)}
        onConfirm={() => {
          const jamJadwal = conflict.jamJadwal;
          setConflict(null);
          doCreate(jamJadwal);
        }}
      />
    )}
    </>
  );
}

// Turns a manually-picked set of external (desktop-ERP) DeliveryOrder cards
// into one real Draft Jadwal — see mergeExternalDeliveriesIntoJadwal's own
// comment for why Draft (not Terbit): it's what unlocks full editing
// (time, driver, stop order) via the existing Validasi Rute UI afterwards.
function MergeExternalDialog({
  open,
  onOpenChange,
  armadaId,
  deliveries,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  armadaId: number | null;
  deliveries: ExternalDelivery[];
  onDone: () => void;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("08:00");
  // Full ceiled SalesOrder.TransDate (date + time), kept alongside `date`/
  // `time`'s own display strings — submitting the auto-filled default must
  // reuse this Date directly rather than re-derive it from `date`+`time`.
  // Once the user touches either field, `date`+`time` are combined directly
  // (same free, un-derived combination route-validation-dialog.tsx's own
  // date/time editor already uses) instead of going through
  // resolveBusinessDateTime(businessDate, time), which can only ever produce
  // a datetime on `businessDate` or `businessDate` minus one day (see its own
  // comment) — too narrow a window for picking an arbitrary merge date. A
  // SalesOrder touched outside that 2-day window (confirmed live: a
  // same-day-edited SO can carry a TransDate whose calendar date sits a full
  // day ahead of the delivery's own business day) falls outside what any
  // resolveBusinessDateTime-derived value could ever satisfy, permanently
  // tripping assertJamJadwalNotBeforeOrders no matter the input — the free
  // date field lets the user pick that SalesOrder's own date directly instead.
  const [defaultJamJadwal, setDefaultJamJadwal] = useState<Date | null>(null);
  const [timeEdited, setTimeEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ info: ArmadaConflictInfo; jamJadwal: Date } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || deliveries.length === 0) return;
    // Resets stale state from a previous open — not derivable from render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setTimeEdited(false);
    setConflict(null);
    const ids = deliveries.map((d) => d.DeliveryOrderID);
    // Defaults to the latest underlying SalesOrder's own TransDate (not a
    // DeliveryOrder's own TransDate — confirmed live those don't reliably
    // move together), ceil-rounded to the next minute so the default never
    // trips assertJamJadwalNotBeforeOrders's strict "departure can't be
    // earlier than the order it's delivering" check. The HH:MM shown in the
    // time input is built by hand (never via formatTime(), whose id-ID
    // locale output uses "." as the separator and silently produces an
    // Invalid Date once fed into resolveBusinessDateTime/the time input) —
    // same pattern already used correctly in route-validation-dialog.tsx.
    getMaxSalesOrderTransDateForDeliveriesAction(ids).then((iso) => {
      if (iso == null) {
        setDefaultJamJadwal(null);
        return;
      }
      const ceiled = new Date(Math.ceil(new Date(iso).getTime() / 60000) * 60000);
      setDefaultJamJadwal(ceiled);
      setDate(
        `${ceiled.getFullYear()}-${String(ceiled.getMonth() + 1).padStart(2, "0")}-${String(ceiled.getDate()).padStart(2, "0")}`
      );
      setTime(`${String(ceiled.getHours()).padStart(2, "0")}:${String(ceiled.getMinutes()).padStart(2, "0")}`);
    });
  }, [open, deliveries]);

  const totalKantong = deliveries.reduce((sum, d) => sum + d.TotalKantong, 0);

  function doMerge(jamJadwal: Date) {
    if (armadaId == null) return;
    startTransition(async () => {
      const result = await mergeExternalDeliveriesAction(armadaId, deliveries.map((d) => d.DeliveryOrderID), jamJadwal);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      onDone();
    });
  }

  function handleSubmit() {
    if (armadaId == null || deliveries.length === 0) return;
    setError(null);
    // Untouched default -> reuse the exact ceiled SalesOrder.TransDate Date
    // directly, date and all. Once the user touches either field, `date` and
    // `time` combine directly (free, un-derived) — same shape as
    // route-validation-dialog.tsx's own buildJamJadwal().
    const jamJadwal = !timeEdited && defaultJamJadwal ? defaultJamJadwal : new Date(`${date}T${time}:00`);
    startTransition(async () => {
      const check = await checkArmadaConflictAction(armadaId, jamJadwal, totalKantong, null);
      if (check) {
        setConflict({ info: check, jamJadwal });
        return;
      }
      doMerge(jamJadwal);
    });
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gabungkan jadi Jadwal</DialogTitle>
          <DialogDescription>
            {deliveries.length} DO dari ERP akan digabung jadi satu keberangkatan Draft — bisa diatur ulang jam,
            driver, dan urutan stop-nya lewat Validasi Rute setelah ini.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setTimeEdited(true);
              }}
              className="w-40"
            />
            <TimeInput
              value={time}
              onChange={(v) => {
                setTime(v);
                setTimeEdited(true);
              }}
            />
            <span className="ml-auto text-xs text-muted-foreground">{totalKantong} kantong</span>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex max-h-64 flex-col divide-y overflow-y-auto rounded-lg border">
            {deliveries.map((d) => (
              <div key={d.DeliveryOrderID} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {d.CustomerName} <span className="text-xs text-muted-foreground">· {formatTime(d.TransDate)}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{d.TotalKantong} kantong</span>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button disabled={pending || deliveries.length === 0 || armadaId == null} onClick={handleSubmit} className="ml-auto">
            {pending ? "Menyimpan..." : `Gabungkan (${deliveries.length} DO)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {conflict && (
      <ArmadaConflictDialog
        conflict={conflict.info}
        onCancel={() => setConflict(null)}
        onConfirm={() => {
          const jamJadwal = conflict.jamJadwal;
          setConflict(null);
          doMerge(jamJadwal);
        }}
      />
    )}
    </>
  );
}

function DraggableJadwalCard({
  jadwal: j,
  hourWidth,
  cardWidth,
  top,
  onCardClick,
}: {
  jadwal: JadwalCardData;
  hourWidth: number;
  cardWidth: number;
  top: number;
  onCardClick: (jadwalId: number) => void;
}) {
  const isDraft = j.Status === "Draft";
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `jadwal-${j.JadwalID}`,
    data: { jadwalId: j.JadwalID },
    disabled: !isDraft,
  });
  const lokasiTerjauh = j.LokasiTerjauh
    ? `${j.LokasiTerjauh.Wilayah}${j.LokasiTerjauh.Kecamatan ? ` - ${j.LokasiTerjauh.Kecamatan}` : ""}`
    : null;

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      onClick={() => !isDragging && onCardClick(j.JadwalID)}
      title={lokasiTerjauh ? `Lokasi pengiriman terjauh: ${lokasiTerjauh}` : undefined}
      className={cn(
        "absolute flex flex-col justify-between overflow-hidden rounded-md border p-1.5 text-left shadow-sm",
        isDraft ? "border-dashed border-muted-foreground/40 bg-muted/40" : "border-primary/30 bg-primary/10",
        isDragging && "z-20 opacity-70 shadow-lg"
      )}
      style={{
        left: hourFraction(j.JamJadwal) * hourWidth,
        top,
        width: cardWidth,
        height: CARD_HEIGHT,
        // Both axes now (was X-only): dragging vertically into a different
        // armada's row is how a card gets reassigned (see handleDragEnd /
        // useDroppable on ArmadaRowBoard) — the card needs to visually
        // follow the cursor there too, not just slide sideways.
        transform: CSS.Translate.toString(transform),
      }}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-semibold tabular-nums">{formatTime(j.JamJadwal)}</span>
        <span
          className={cn(
            "rounded px-1 py-px text-[8px] font-medium",
            isDraft ? "bg-muted-foreground/20 text-muted-foreground" : "bg-primary/20 text-primary"
          )}
        >
          {isDraft ? "Draf" : "Berangkat"}
        </span>
      </div>
      <div className="flex flex-col items-center leading-none">
        <span className="text-sm font-bold tabular-nums">{j.TotalKantong}</span>
        <span className="text-[8px] text-muted-foreground">kantong</span>
      </div>
      {/* Kept on the SAME line as "N tujuan" (not its own 4th line) — a
          standalone line at this card's tiny fixed height either clipped
          silently against overflow-hidden or forced the whole card taller,
          so this stayed reachable only via the button's title tooltip.
          One truncated line, always in the DOM whenever there's a farthest
          stop, is the concise, always-visible fix the user asked for. */}
      <p className="truncate text-center text-[9px] tabular-nums text-muted-foreground">
        {j.TotalStop} tujuan{lokasiTerjauh ? ` · ${lokasiTerjauh}` : ""}
      </p>
    </button>
  );
}

const ACTIVITY_COLOR: Record<ArmadaActivityType, string> = {
  Perawatan: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  Pencucian: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  IsiBBM: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  Menganggur: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
};

// Manually-logged, non-delivery armada states (Perawatan/Pencucian/Isi
// BBM/Menganggur) — clicking opens ArmadaActivityFormDialog pre-filled for
// editing (type/time/notes) or deleting, instead of the old v1 behavior of
// an instant delete-confirm on click. No drag-to-reschedule still, since
// these remain simple fixed blocks a dispatcher logs after the fact, not
// something that needs the Pengiriman draft's kind of rescheduling.
function ArmadaActivityCard({
  activity,
  hourWidth,
  width,
  top,
  onEdit,
}: {
  activity: ArmadaActivity;
  hourWidth: number;
  width: number;
  top: number;
  onEdit: (activity: ArmadaActivity) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onEdit(activity)}
      title="Klik untuk mengedit atau menghapus"
      className={cn(
        "absolute flex flex-col justify-center overflow-hidden rounded-md border px-1.5 py-1 text-left text-[9px]",
        ACTIVITY_COLOR[activity.ActivityType]
      )}
      style={{ left: hourFraction(activity.StartTime) * hourWidth, top, width, height: CARD_HEIGHT }}
    >
      <span className="truncate font-semibold">{ARMADA_ACTIVITY_LABEL[activity.ActivityType]}</span>
      <span className="truncate tabular-nums opacity-80">
        {formatTime(activity.StartTime)}&ndash;{formatTime(activity.EndTime)}
      </span>
      {activity.Notes && <span className="truncate opacity-70">{activity.Notes}</span>}
    </button>
  );
}

// Auto-derived (never stored) segments for a Terbit Jadwal's own lifecycle
// — Sedang Memuat (JamMulaiMuat -> JamAktualBerangkat) and Dalam Perjalanan
// + Kembali ke Pabrik (JamAktualBerangkat -> +DurasiMenit, then a short
// arrival marker). Read-only visual context, not its own record — clicking
// one opens the same Validasi Rute the Pengiriman card itself opens, since
// they describe the same trip.
function AutoSegmentCard({
  label,
  left,
  width,
  top,
  onClick,
}: {
  label: string;
  left: number;
  width: number;
  top: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute flex items-center justify-center overflow-hidden rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 px-1 text-[9px] text-muted-foreground"
      style={{ left, width, top, height: CARD_HEIGHT }}
    >
      <span className="truncate">{label}</span>
    </button>
  );
}

const EXTERNAL_DO_WIDTH = 80;

// A DeliveryOrder created directly in the desktop ERP app, resolved to this
// armada via VehicleNo (see ExternalDelivery in pengiriman-jadwal.ts) —
// shown as a read-only marker (amber dashed border, distinct from
// AutoSegmentCard's neutral one) since it was never scheduled through this
// dashboard. Clickable to select (checkbox) for merging several of these
// into one real Jadwal via "Gabungkan jadi Jadwal" — see MergeExternalDialog.
// Positioned at a single point (TransDate) rather than a duration, since a
// raw DeliveryOrder carries no departure/arrival time.
function ExternalDoCard({
  delivery,
  hourWidth,
  top,
  selected,
  onToggle,
}: {
  delivery: ExternalDelivery;
  hourWidth: number;
  top: number;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={`${delivery.VoucherNo} — ${delivery.CustomerName} (${delivery.TotalKantong} kantong) — dari ERP, belum dijadwalkan lewat dashboard`}
      className={cn(
        "absolute flex flex-col justify-center overflow-hidden rounded-md border border-dashed px-1.5 py-1 text-left text-[9px] transition-colors",
        selected ? "border-warning bg-warning/25 text-warning" : "border-warning/50 bg-warning/10 text-warning hover:bg-warning/20"
      )}
      style={{ left: hourFraction(delivery.TransDate) * hourWidth, top, width: EXTERNAL_DO_WIDTH, height: CARD_HEIGHT }}
    >
      <span className="flex items-center gap-1">
        <span
          className={cn(
            "size-2.5 shrink-0 rounded-sm border border-warning",
            selected && "bg-warning"
          )}
        />
        <span className="truncate font-semibold">{delivery.CustomerName}</span>
      </span>
      <span className="truncate tabular-nums opacity-80">{formatTime(delivery.TransDate)} &middot; {delivery.TotalKantong} kantong</span>
      <span className="truncate opacity-70">ERP &middot; belum terjadwal</span>
    </button>
  );
}

// Mirrors whichever driver is on whatever's happening in the Armada row
// directly above it, at the same horizontal position — not an independent
// schedule, just a second read of the same Jadwal-derived segments with
// the driver's name instead of delivery details (per design decision: no
// separate driver-shift data model backs this row).
function DriverBlock({ name, left, width, top }: { name: string; left: number; width: number; top: number }) {
  return (
    <div
      className="absolute flex items-center gap-1 overflow-hidden rounded-md border border-primary/20 bg-primary/5 px-1.5 text-[9px] text-primary"
      style={{ left, width, top, height: CARD_HEIGHT }}
    >
      <User className="size-3 shrink-0" />
      <span className="truncate font-medium">{name}</span>
    </div>
  );
}

function ArmadaActivityFormDialog({
  open,
  onOpenChange,
  armadaId,
  businessDate,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  armadaId: number | null;
  businessDate: string;
  // Non-null puts the dialog in edit mode (pre-filled from this activity,
  // Simpan updates it in place, and a Hapus button appears) instead of
  // create mode.
  editing: ArmadaActivity | null;
}) {
  const [activityType, setActivityType] = useState<ArmadaActivityType>("Perawatan");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("10:00");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    // Pre-fills from the activity being edited, or resets to blank
    // create-mode defaults — not derivable from render since these are
    // user-editable fields with no other server-sourced initial value.
    if (editing) {
      const s = new Date(editing.StartTime);
      const e = new Date(editing.EndTime);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActivityType(editing.ActivityType);
      setStartTime(`${String(s.getHours()).padStart(2, "0")}:${String(s.getMinutes()).padStart(2, "0")}`);
      setEndTime(`${String(e.getHours()).padStart(2, "0")}:${String(e.getMinutes()).padStart(2, "0")}`);
      setNotes(editing.Notes ?? "");
    } else {
      setActivityType("Perawatan");
      setStartTime("08:00");
      setEndTime("10:00");
      setNotes("");
    }
    setError(null);
  }, [open, editing]);

  function handleSubmit() {
    if (armadaId == null) return;
    setError(null);
    startTransition(async () => {
      const result = editing
        ? await updateArmadaActivityAction(editing.ActivityID, {
            activityType,
            startTime: resolveBusinessDateTime(businessDate, startTime),
            endTime: resolveBusinessDateTime(businessDate, endTime),
            notes: notes.trim() || null,
          })
        : await createArmadaActivityAction({
            armadaId,
            activityType,
            startTime: resolveBusinessDateTime(businessDate, startTime),
            endTime: resolveBusinessDateTime(businessDate, endTime),
            notes: notes.trim() || null,
          });
      if (!result.success) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
    });
  }

  function handleDelete() {
    if (!editing) return;
    if (!confirm(`Hapus aktivitas ${ARMADA_ACTIVITY_LABEL[editing.ActivityType]}?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteArmadaActivityAction(editing.ActivityID);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Aktivitas Armada" : "Aktivitas Armada"}</DialogTitle>
          <DialogDescription>
            Catat kondisi armada di luar pengiriman — Perawatan, Pencucian, Isi BBM, atau Menganggur.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Select value={activityType} onValueChange={(v) => setActivityType((v as ArmadaActivityType) ?? "Perawatan")}>
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string) => ARMADA_ACTIVITY_LABEL[v as ArmadaActivityType]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ARMADA_ACTIVITY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {ARMADA_ACTIVITY_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <TimeInput value={startTime} onChange={setStartTime} className="w-full" />
            <TimeInput value={endTime} onChange={setEndTime} className="w-full" />
          </div>
          <Input placeholder="Catatan (opsional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter className={editing ? "sm:justify-between" : undefined}>
          {editing && (
            <Button type="button" variant="outline" className="text-destructive" disabled={pending} onClick={handleDelete}>
              Hapus
            </Button>
          )}
          <Button disabled={pending} onClick={handleSubmit}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Fixed width for the auto-derived segments and the "Kembali ke Pabrik"
// arrival marker — these don't ride on cardWidth (that's sized for the
// Jadwal card's own 4 lines of text) since they only need to show a short
// label, and a real Perjalanan span can be much shorter than a hover slot.
const MIN_AUTO_WIDTH = 56;
const RETURN_MARKER_WIDTH = 64;

function ArmadaRowBoard({
  armada,
  jadwal,
  activities,
  externalDeliveries,
  hourWidth,
  dayWidth,
  onCardClick,
  onCreateClick,
  onCreateActivityClick,
  onEditActivity,
  expeditionOptions,
}: {
  armada: ArmadaRow;
  jadwal: JadwalCardData[];
  activities: ArmadaActivity[];
  externalDeliveries: ExternalDelivery[];
  hourWidth: number;
  dayWidth: number;
  onCardClick: (jadwalId: number) => void;
  onCreateClick: (armadaId: number) => void;
  onCreateActivityClick: (armadaId: number) => void;
  onEditActivity: (activity: ArmadaActivity) => void;
  expeditionOptions: ExpeditionVehicleOption[];
}) {
  const [selectedExternal, setSelectedExternal] = useState<Set<string>>(new Set());
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);

  function toggleExternal(deliveryOrderId: string) {
    setSelectedExternal((prev) => {
      const next = new Set(prev);
      if (next.has(deliveryOrderId)) next.delete(deliveryOrderId);
      else next.add(deliveryOrderId);
      return next;
    });
  }

  const selectedExternalDeliveries = externalDeliveries.filter((d) => selectedExternal.has(d.DeliveryOrderID));

  // Card width now scales with the summed per-stop delivery-time estimate
  // (see delivery-duration.ts) instead of a fixed hourWidth-derived size —
  // a Jadwal with more/bigger stops visibly takes longer on the timeline.
  // useCallback so the lane-layout useMemo below can depend on it directly
  // instead of missing-dep warnings from redefining it every render.
  const cardWidthFor = useCallback(
    (j: JadwalCardData) => Math.max(MIN_CARD_WIDTH, (j.EstimasiDurasiMenit / 60) * hourWidth),
    [hourWidth]
  );

  // Auto-derived Memuat/Perjalanan/Kembali segments — only for Jadwal that
  // have actually departed (Terbit) with the timestamps needed to compute
  // them; a Draft has no real duration yet, and older Terbit rows created
  // before DurasiMenit existed simply skip the Perjalanan/Kembali pair.
  const autoSegments = useMemo(() => {
    type AutoSegment = { key: string; jadwalId: number; label: string; start: Date; end: Date };
    const segments: AutoSegment[] = [];
    const now = new Date();
    for (const j of jadwal) {
      if (j.Status !== "Terbit") continue;
      if (j.JamMulaiMuat && j.JamSelesaiMuat) {
        segments.push({
          key: `memuat-${j.JadwalID}`,
          jadwalId: j.JadwalID,
          label: "Sedang Memuat",
          start: new Date(j.JamMulaiMuat),
          end: new Date(j.JamSelesaiMuat),
        });
      }
      if (j.JamSelesaiMuat) {
        segments.push({
          key: `tunggu-${j.JadwalID}`,
          jadwalId: j.JadwalID,
          label: "Menunggu Keberangkatan",
          start: new Date(j.JamSelesaiMuat),
          end: j.JamAktualBerangkat ? new Date(j.JamAktualBerangkat) : now,
        });
      }
      if (j.JamAktualBerangkat && j.DurasiMenit != null) {
        const start = new Date(j.JamAktualBerangkat);
        const estimatedEnd = new Date(start.getTime() + j.DurasiMenit * 60_000);
        const end = j.JamKembaliAktual ? new Date(j.JamKembaliAktual) : estimatedEnd;
        segments.push({ key: `jalan-${j.JadwalID}`, jadwalId: j.JadwalID, label: "Dalam Perjalanan", start, end });
        segments.push({
          key: `kembali-${j.JadwalID}`,
          jadwalId: j.JadwalID,
          label: "Kembali ke Pabrik",
          start: end,
          end: new Date(end.getTime() + 15 * 60_000),
        });
      }
    }
    return segments;
  }, [jadwal]);

  const { laneOf, laneCount } = useMemo(() => {
    const blocks: TimelineBlock[] = [
      ...jadwal.map((j) => ({ key: `j-${j.JadwalID}`, left: hourFraction(j.JamJadwal) * hourWidth, width: cardWidthFor(j) })),
      ...activities.map((a) => ({
        key: `a-${a.ActivityID}`,
        left: hourFraction(a.StartTime) * hourWidth,
        width: Math.max(MIN_AUTO_WIDTH, durationHours(a.StartTime, a.EndTime) * hourWidth),
      })),
      ...autoSegments.map((s) => ({
        key: s.key,
        left: hourFraction(s.start) * hourWidth,
        width:
          s.label === "Kembali ke Pabrik"
            ? RETURN_MARKER_WIDTH
            : Math.max(MIN_AUTO_WIDTH, durationHours(s.start, s.end) * hourWidth),
      })),
      ...externalDeliveries.map((d) => ({
        key: `ext-${d.DeliveryOrderID}`,
        left: hourFraction(d.TransDate) * hourWidth,
        width: EXTERNAL_DO_WIDTH,
      })),
    ];
    return assignLanes(blocks);
  }, [jadwal, activities, autoSegments, externalDeliveries, hourWidth, cardWidthFor]);

  // Drag-to-select (marquee) for external DO cards — an alternative to
  // clicking each checkbox one by one when several need selecting at once.
  // Only starts when the mousedown lands on empty timeline background (not
  // on a card, all of which render as <button>), so it never fights the
  // existing dnd-kit drag-to-reschedule on Jadwal cards.
  const timelineRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);

  function handleTimelineMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    if (externalDeliveries.length === 0) return;
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragStart(point);
    setDragCurrent(point);
  }

  useEffect(() => {
    if (!dragStart) return;
    function relativePoint(e: MouseEvent) {
      const rect = timelineRef.current?.getBoundingClientRect();
      return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : null;
    }
    function handleMove(e: MouseEvent) {
      const point = relativePoint(e);
      if (point) setDragCurrent(point);
    }
    function handleUp(e: MouseEvent) {
      const end = relativePoint(e);
      if (end && dragStart) {
        const minX = Math.min(dragStart.x, end.x);
        const maxX = Math.max(dragStart.x, end.x);
        const minY = Math.min(dragStart.y, end.y);
        const maxY = Math.max(dragStart.y, end.y);
        // A real drag, not just a click that barely moved — small clicks on
        // empty background leave the current selection untouched instead of
        // selecting nothing.
        if (maxX - minX > 4 || maxY - minY > 4) {
          const hits = new Set<string>();
          for (const d of externalDeliveries) {
            const left = hourFraction(d.TransDate) * hourWidth;
            const top = ROW_TOP_PADDING + (laneOf.get(`ext-${d.DeliveryOrderID}`) ?? 0) * (CARD_HEIGHT + CARD_GAP);
            if (left < maxX && left + EXTERNAL_DO_WIDTH > minX && top < maxY && top + CARD_HEIGHT > minY) {
              hits.add(d.DeliveryOrderID);
            }
          }
          setSelectedExternal(hits);
        }
      }
      setDragStart(null);
      setDragCurrent(null);
    }
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragStart, externalDeliveries, hourWidth, laneOf]);

  const laneCountSafe = Math.max(1, laneCount);
  const rowHeight = ROW_TOP_PADDING + laneCountSafe * CARD_HEIGHT + Math.max(0, laneCountSafe - 1) * CARD_GAP;
  const totalKantongHariIni =
    jadwal.reduce((sum, j) => sum + j.TotalKantong, 0) + externalDeliveries.reduce((sum, d) => sum + d.TotalKantong, 0);
  // "telah ditempuh" (already traveled) — only Jadwal that actually
  // departed (JamAktualBerangkat set) contribute; a Draft hasn't gone
  // anywhere yet, so it contributes 0 regardless of its JarakKM (which is
  // always null for a Draft anyway — JarakKM is only ever set at
  // startBerangkat).
  const totalJarakHariIni = jadwal
    .filter((j) => j.JamAktualBerangkat != null)
    .reduce((sum, j) => sum + (j.JarakKM ?? 0), 0);

  const [editing, setEditing] = useState(false);
  const [editPending, startEditTransition] = useTransition();
  const [editError, setEditError] = useState<string | null>(null);

  // Drop target for reassigning a dragged Jadwal card to this armada — see
  // handleDragEnd in PengirimanBoard, which reads event.over.id back out.
  // Disabled for a non-"Baik" armada, matching "Aktivitas Armada"/
  // "Pengiriman Baru" already refusing new dispatch work there.
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `armada-${armada.ArmadaID}`,
    disabled: armada.Status !== "Baik",
  });

  function handleUpdateArmada(input: ArmadaInput) {
    setEditError(null);
    startEditTransition(async () => {
      const result = await updateArmadaAction(armada.ArmadaID, input);
      if (!result.success) {
        setEditError(result.error);
        return;
      }
      setEditing(false);
    });
  }

  return (
    <div
      ref={setDroppableRef}
      className={cn("flex flex-col rounded-lg transition-colors", isOver && "bg-primary/5 ring-2 ring-primary/40")}
    >
    <div className="flex items-stretch self-start">
      {/* Whole box opens the edit form — the "+" button below is the one
          exception, since it's its own action (start a new Draft here),
          not "edit this armada"; it stops propagation so a click there
          doesn't also pop the edit dialog open underneath it. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
        className="sticky left-0 z-10 flex w-56 shrink-0 cursor-pointer flex-col gap-1.5 bg-card py-3 pr-3 text-left transition-colors hover:bg-muted/30"
      >
        <div className="flex items-center gap-2">
          {armada.FotoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={armada.FotoPath} alt={armada.Nama} className="size-10 shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground">
              Foto
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <p className="truncate text-sm font-medium">{armada.Nama}</p>
              <Badge className={cn("h-5 shrink-0 px-1.5 text-[10px]", STATUS_BADGE[armada.Status])}>
                {armada.Status}
              </Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">{armada.PlatNomor ?? "-"}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-6"
            disabled={armada.Status !== "Baik"}
            title="Aktivitas Armada"
            onClick={(e) => {
              e.stopPropagation();
              onCreateActivityClick(armada.ArmadaID);
            }}
          >
            <Wrench className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-6"
            disabled={armada.Status !== "Baik"}
            title="Pengiriman Baru"
            onClick={(e) => {
              e.stopPropagation();
              onCreateClick(armada.ArmadaID);
            }}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-md border bg-muted/20 px-1.5 py-1 text-center">
          <div>
            <p className="text-[9px] text-muted-foreground">Kapasitas</p>
            <p className="text-xs font-medium tabular-nums">{armada.KapasitasMaks ?? "-"}</p>
          </div>
          <div>
            <p className="text-[9px] text-muted-foreground">Kantong</p>
            <p className="text-xs font-medium tabular-nums">{totalKantongHariIni}</p>
          </div>
          <div>
            <p className="text-[9px] text-muted-foreground">Jarak</p>
            <p className="text-xs font-medium tabular-nums">
              {totalJarakHariIni.toLocaleString("id-ID", { maximumFractionDigits: 1 })} km
            </p>
          </div>
        </div>
        {selectedExternal.size > 0 && (
          <Button
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              setMergeDialogOpen(true);
            }}
          >
            <Combine className="size-3.5" />
            Gabungkan {selectedExternal.size} jadi Jadwal
          </Button>
        )}
      </div>
      <ArmadaFormDialog
        open={editing}
        onOpenChange={setEditing}
        initial={rowToForm(armada)}
        title={`Edit Armada — ${armada.Nama}`}
        onSubmit={handleUpdateArmada}
        pending={editPending}
        error={editError}
        expeditionOptions={expeditionOptions}
      />
      <MergeExternalDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        armadaId={armada.ArmadaID}
        deliveries={selectedExternalDeliveries}
        onDone={() => setSelectedExternal(new Set())}
      />
      <div
        ref={timelineRef}
        onMouseDown={handleTimelineMouseDown}
        className="relative shrink-0 border-l"
        style={{ width: dayWidth, height: rowHeight }}
      >
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="absolute top-0 h-full border-r" style={{ left: h * hourWidth, width: hourWidth }} />
        ))}
        {dragStart && dragCurrent && (
          <div
            className="pointer-events-none absolute z-30 rounded border-2 border-primary/60 bg-primary/10"
            style={{
              left: Math.min(dragStart.x, dragCurrent.x),
              top: Math.min(dragStart.y, dragCurrent.y),
              width: Math.abs(dragCurrent.x - dragStart.x),
              height: Math.abs(dragCurrent.y - dragStart.y),
            }}
          />
        )}
        {jadwal.map((j) => (
          <DraggableJadwalCard
            key={j.JadwalID}
            jadwal={j}
            hourWidth={hourWidth}
            cardWidth={cardWidthFor(j)}
            top={ROW_TOP_PADDING + (laneOf.get(`j-${j.JadwalID}`) ?? 0) * (CARD_HEIGHT + CARD_GAP)}
            onCardClick={onCardClick}
          />
        ))}
        {activities.map((a) => (
          <ArmadaActivityCard
            key={a.ActivityID}
            activity={a}
            hourWidth={hourWidth}
            width={Math.max(MIN_AUTO_WIDTH, durationHours(a.StartTime, a.EndTime) * hourWidth)}
            top={ROW_TOP_PADDING + (laneOf.get(`a-${a.ActivityID}`) ?? 0) * (CARD_HEIGHT + CARD_GAP)}
            onEdit={onEditActivity}
          />
        ))}
        {autoSegments.map((s) => (
          <AutoSegmentCard
            key={s.key}
            label={s.label}
            left={hourFraction(s.start) * hourWidth}
            width={s.label === "Kembali ke Pabrik" ? RETURN_MARKER_WIDTH : Math.max(MIN_AUTO_WIDTH, durationHours(s.start, s.end) * hourWidth)}
            top={ROW_TOP_PADDING + (laneOf.get(s.key) ?? 0) * (CARD_HEIGHT + CARD_GAP)}
            onClick={() => onCardClick(s.jadwalId)}
          />
        ))}
        {externalDeliveries.map((d) => (
          <ExternalDoCard
            key={d.DeliveryOrderID}
            delivery={d}
            hourWidth={hourWidth}
            top={ROW_TOP_PADDING + (laneOf.get(`ext-${d.DeliveryOrderID}`) ?? 0) * (CARD_HEIGHT + CARD_GAP)}
            selected={selectedExternal.has(d.DeliveryOrderID)}
            onToggle={() => toggleExternal(d.DeliveryOrderID)}
          />
        ))}
      </div>
    </div>
    {/* Driver row — mirrors whichever Jadwal card (only ones that carry a
        driver) sits in the row above, at the same horizontal position, so
        the two rows read as one strip per trip. Fixed to a single card's
        height rather than inheriting the main row's (possibly multi-lane)
        rowHeight: one armada can never have two genuinely overlapping
        departures (same-armada+same-time Jadwal always merge into one, see
        createPemesanan/reschedulePemesanan), so this row never actually
        needs more than one lane — no independent driver-schedule data
        model backs this (see driver-manager.tsx). */}
    <div className="flex items-stretch self-start border-t border-dashed">
      <div className="sticky left-0 z-10 flex w-56 shrink-0 items-center bg-card py-1 pr-3 text-[10px] text-muted-foreground">
        Driver
      </div>
      <div className="relative shrink-0 border-l" style={{ width: dayWidth, height: ROW_TOP_PADDING + CARD_HEIGHT }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="absolute top-0 h-full border-r" style={{ left: h * hourWidth, width: hourWidth }} />
        ))}
        {jadwal
          .filter((j) => j.DriverName)
          .map((j) => (
            <DriverBlock
              key={j.JadwalID}
              name={j.DriverName as string}
              left={hourFraction(j.JamJadwal) * hourWidth}
              width={cardWidthFor(j)}
              top={ROW_TOP_PADDING}
            />
          ))}
      </div>
    </div>
    </div>
  );
}

export function PengirimanBoard({
  armada,
  jadwal,
  externalDeliveries,
  activities,
  driverProfiles,
  drivers,
  businessDate,
  todayISO,
  expeditionOptions,
  isSatpam,
}: {
  armada: ArmadaRow[];
  jadwal: JadwalCardData[];
  externalDeliveries: ExternalDelivery[];
  activities: ArmadaActivity[];
  driverProfiles: DriverProfileRow[];
  drivers: DriverOption[];
  businessDate: string;
  todayISO: string;
  expeditionOptions: ExpeditionVehicleOption[];
  // Current session's Satpam flag, resolved server-side by the page —
  // threaded straight through to RouteValidationDialog/VehicleCheckPanel.
  isSatpam: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const isToday = businessDate === todayISO;
  const [detailJadwalId, setDetailJadwalId] = useState<number | null>(null);
  const [createArmadaId, setCreateArmadaId] = useState<number | null>(null);
  const [createActivityArmadaId, setCreateActivityArmadaId] = useState<number | null>(null);
  const [editingActivity, setEditingActivity] = useState<ArmadaActivity | null>(null);
  const [editingSalesOrder, setEditingSalesOrder] = useState<UbahPemesananTarget | null>(null);
  const [dragConflict, setDragConflict] = useState<{
    info: ArmadaConflictInfo;
    jadwalId: number;
    targetArmadaId: number;
    currentArmadaId: number;
    newJamJadwal: Date | undefined; // undefined = time unchanged (pure armada-row move)
    salesmanId: string | null;
  } | null>(null);
  // Bumped every time UbahPemesananDialog closes (saved or cancelled — both
  // are handled the same way here) — RouteValidationDialog watches this to
  // refetch its stop list, since it deliberately stays open underneath
  // UbahPemesananDialog (see onEditSalesOrder below) and its own `order`
  // state would otherwise go stale after an in-place Qty edit reachable
  // through that dialog.
  const [salesOrderEditSignal, setSalesOrderEditSignal] = useState(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [containerRef, containerWidth] = useContainerWidth<HTMLDivElement>();
  const cardHeaderRef = useRef<HTMLDivElement>(null);
  const timelineHeaderRef = useRef<HTMLDivElement>(null);
  useStickyBelow(cardHeaderRef, timelineHeaderRef);
  const hourWidth = Math.max(MIN_HOUR_WIDTH, (containerWidth - INFO_COL_WIDTH) / 24);
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

  const activitiesByArmada = useMemo(() => {
    const map = new Map<number, ArmadaActivity[]>();
    for (const a of activities) {
      const list = map.get(a.ArmadaID) ?? [];
      list.push(a);
      map.set(a.ArmadaID, list);
    }
    return map;
  }, [activities]);

  const externalByArmada = useMemo(() => {
    const map = new Map<number, ExternalDelivery[]>();
    for (const d of externalDeliveries) {
      const list = map.get(d.ArmadaID) ?? [];
      list.push(d);
      map.set(d.ArmadaID, list);
    }
    return map;
  }, [externalDeliveries]);

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
  const createArmada = createArmadaId != null ? armada.find((a) => a.ArmadaID === createArmadaId) : null;

  function goToDate(newDate: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("pengirimanDate", newDate);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function shiftDate(deltaDays: number) {
    goToDate(shiftDateISO(businessDate, deltaDays));
  }

  async function commitDragMove(pending: {
    jadwalId: number;
    targetArmadaId: number;
    currentArmadaId: number;
    newJamJadwal: Date | undefined;
    salesmanId: string | null;
  }) {
    if (pending.targetArmadaId !== pending.currentArmadaId) {
      // Dropped on a different armada's row — reassigns the Jadwal
      // there, carrying the new time along too if the drag also moved
      // horizontally (a diagonal drag changes both at once).
      const result = await updateJadwalArmadaAction(pending.jadwalId, pending.targetArmadaId, pending.newJamJadwal);
      if (!result.success) toast.error(result.error);
    } else if (pending.newJamJadwal != null) {
      // Same armada, time-only reschedule-by-drag — driver stays as-is.
      const result = await updateJadwalDriverTimeAction(pending.jadwalId, {
        jamJadwal: pending.newJamJadwal,
        salesmanId: pending.salesmanId,
      });
      if (!result.success) toast.error(result.error);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const jadwalId = event.active.data.current?.jadwalId as number | undefined;
    if (jadwalId == null) return;

    const current = jadwal.find((j) => j.JadwalID === jadwalId);
    if (!current) return;

    // Which armada row (if any) the card was released over — see the
    // useDroppable({id: `armada-${ArmadaID}`}) on each ArmadaRowBoard.
    // Falls back to the card's own current armada when dropped somewhere
    // that isn't a valid row (e.g. released over the date/hour ruler, or
    // over a non-"Baik" armada whose droppable is disabled).
    const overId = event.over?.id;
    const targetArmadaId =
      typeof overId === "string" && overId.startsWith("armada-") ? Number(overId.slice("armada-".length)) : current.ArmadaID;

    let newTime: string | null = null;
    if (event.delta.x !== 0) {
      const currentHour = hourFraction(current.JamJadwal); // timeline-relative
      const deltaHours = event.delta.x / hourWidth;
      const newTimelineHour = Math.min(23.75, Math.max(0, Math.round((currentHour + deltaHours) * 4) / 4));
      // Convert back to an actual wall-clock hour before formatting/resolving
      // the calendar day — hourFraction/newTimelineHour are both relative to
      // the ROLLOVER_HOUR-based axis, not the real hour of day.
      const actualHour = (newTimelineHour + ROLLOVER_HOUR) % 24;
      const hour = Math.floor(actualHour);
      const minute = Math.round((actualHour - hour) * 60);
      newTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }

    if (targetArmadaId === current.ArmadaID && newTime == null) return; // dropped back where it started

    const newJamJadwal = newTime != null ? resolveBusinessDateTime(businessDate, newTime) : undefined;
    const candidateStart = newJamJadwal ?? new Date(current.JamJadwal);
    const pending = {
      jadwalId,
      targetArmadaId,
      currentArmadaId: current.ArmadaID,
      newJamJadwal,
      salesmanId: current.SalesmanID,
    };

    startTransition(async () => {
      const check = await checkArmadaConflictAction(targetArmadaId, candidateStart, current.TotalKantong, jadwalId);
      if (check) {
        setDragConflict({ info: check, ...pending });
        return;
      }
      await commitDragMove(pending);
    });
  }

  return (
    <Card className="relative overflow-visible">
      <div ref={cardHeaderRef} className="sticky top-14 z-30 border-b bg-card">
        {isPending && (
          <div className="absolute inset-x-0 bottom-0 z-10 h-0.5 overflow-hidden bg-primary/15">
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
            <ArmadaManager armada={armada} expeditionOptions={expeditionOptions} />
            <DriverManager drivers={driverProfiles} />
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="size-8" disabled={isPending} onClick={() => shiftDate(-1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <Input
                type="date"
                value={businessDate}
                disabled={isPending}
                onChange={(e) => e.target.value && goToDate(e.target.value)}
                className="h-8 w-40 text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={isPending}
                onClick={() => shiftDate(1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
      </div>
      <CardContent>
        {sortedArmada.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada armada. Tambah lewat &quot;Kelola Armada&quot;.</p>
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div ref={containerRef} className="overflow-x-auto overflow-y-visible">
              {/* Date segment bar + hour ruler — shared rows instead of
                  repeating labels per armada, aligned to the exact same
                  hourWidth grid every ArmadaRowBoard draws its own
                  gridlines against, so both stay lined up while scrolling
                  horizontally with the rows below. The axis starts at
                  ROLLOVER_HOUR (14:00 WIB), not midnight, matching the
                  business-date label this board is keyed on (see
                  ROLLOVER_HOUR in business-date.ts) — so it spans two
                  actual calendar dates, called out here since the hour
                  numbers alone (14..23, 00..13) don't make that obvious.
                  Sticky directly below the sticky CardHeader — top is
                  synced live to CardHeader's own bottom edge (useStickyBelow
                  above), not a precomputed height, so both stay pinned
                  together with no gap while the armada rows scroll
                  underneath; w-fit keeps its background covering the full
                  scrollable width, not just the viewport-visible slice. */}
              <div
                ref={timelineHeaderRef}
                className="sticky z-20 w-fit border-b bg-card"
                style={{ top: "7rem" }}
              >
                <div className="flex items-stretch">
                  <div className="sticky left-0 z-10 w-56 shrink-0 bg-card" />
                  <div className="relative shrink-0 border-l" style={{ width: dayWidth, height: DATE_SEGMENT_HEIGHT }}>
                    <div
                      className="absolute top-0 flex h-full items-center justify-center truncate border-r px-1 text-[10px] font-medium text-muted-foreground"
                      style={{ left: 0, width: (24 - ROLLOVER_HOUR) * hourWidth }}
                    >
                      {formatDate(shiftDateISO(businessDate, -1))}
                    </div>
                    <div
                      className="absolute top-0 flex h-full items-center justify-center truncate border-r px-1 text-[10px] font-medium text-muted-foreground"
                      style={{ left: (24 - ROLLOVER_HOUR) * hourWidth, width: ROLLOVER_HOUR * hourWidth }}
                    >
                      {formatDate(businessDate)}
                    </div>
                  </div>
                </div>
                <div className="flex items-stretch">
                  <div className="sticky left-0 z-10 w-56 shrink-0 bg-card" />
                  <div className="relative shrink-0 border-l" style={{ width: dayWidth, height: HOUR_RULER_HEIGHT }}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <div
                        key={h}
                        className="absolute top-0 flex h-full items-center border-r pl-1 text-[9px] tabular-nums text-muted-foreground"
                        style={{ left: h * hourWidth, width: hourWidth }}
                      >
                        {String((h + ROLLOVER_HOUR) % 24).padStart(2, "0")}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* gap-y-3 separates one armada's whole block (its own
                  timeline + its driver row underneath) from the next
                  armada's block, so they don't visually stick together —
                  the tight spacing WITHIN one armada's block (timeline to
                  its own driver row, just a dashed border-t) is untouched. */}
              <div className="flex flex-col divide-y gap-y-3">
                {sortedArmada.map((a) => (
                  <ArmadaRowBoard
                    key={a.ArmadaID}
                    armada={a}
                    jadwal={jadwalByArmada.get(a.ArmadaID) ?? []}
                    activities={activitiesByArmada.get(a.ArmadaID) ?? []}
                    externalDeliveries={externalByArmada.get(a.ArmadaID) ?? []}
                    hourWidth={hourWidth}
                    dayWidth={dayWidth}
                    onCardClick={setDetailJadwalId}
                    onCreateClick={setCreateArmadaId}
                    onCreateActivityClick={setCreateActivityArmadaId}
                    onEditActivity={setEditingActivity}
                    expeditionOptions={expeditionOptions}
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
        todayISO={todayISO}
        drivers={drivers}
        armadaId={openArmada?.ArmadaID ?? null}
        armadaNama={openArmada?.Nama ?? null}
        konsumsiBBM={openArmada?.KonsumsiBBM ?? null}
        kapasitasMaks={openArmada?.KapasitasMaks ?? null}
        jenisBBM={openArmada?.JenisBBM ?? null}
        biayaBBMPerLiter={openArmada?.BiayaBBMPerLiter ?? null}
        isSatpam={isSatpam}
        onOpenChange={(open) => !open && setDetailJadwalId(null)}
        onDeleted={() => setDetailJadwalId(null)}
        salesOrderEditSignal={salesOrderEditSignal}
        onEditSalesOrder={(detail) => {
          // Validasi Rute deliberately stays open underneath — Ubah
          // Pemesanan is meant to be a quick in-place edit for one stop,
          // and closing/reopening the route dialog around it would lose
          // scroll position and re-trigger its own data fetch for no reason.
          setEditingSalesOrder({
            salesOrderId: detail.SalesOrderID,
            customerName: detail.CustomerName,
            wilayah: detail.Wilayah,
            qty: detail.Qty,
            qty10KG: detail.Qty10KG,
            qty5KG: detail.Qty5KG,
          });
        }}
      />
      <CreateJadwalDialog
        open={createArmadaId != null}
        onOpenChange={(open) => !open && setCreateArmadaId(null)}
        armadaId={createArmadaId}
        businessDate={businessDate}
        kapasitasMaks={createArmada?.KapasitasMaks ?? null}
      />
      <ArmadaActivityFormDialog
        open={createActivityArmadaId != null || editingActivity != null}
        onOpenChange={(open) => {
          if (!open) {
            setCreateActivityArmadaId(null);
            setEditingActivity(null);
          }
        }}
        armadaId={editingActivity ? editingActivity.ArmadaID : createActivityArmadaId}
        businessDate={businessDate}
        editing={editingActivity}
      />
      <UbahPemesananDialog
        target={editingSalesOrder}
        onOpenChange={(open) => {
          if (!open) {
            setEditingSalesOrder(null);
            setSalesOrderEditSignal((n) => n + 1);
          }
        }}
        armadaList={armada}
        drivers={drivers}
      />
      {dragConflict && (
        <ArmadaConflictDialog
          conflict={dragConflict.info}
          onCancel={() => setDragConflict(null)}
          onConfirm={() => {
            const pending = dragConflict;
            setDragConflict(null);
            startTransition(async () => {
              await commitDragMove(pending);
            });
          }}
        />
      )}
    </Card>
  );
}
