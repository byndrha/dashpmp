"use client";

import { useMemo, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getJadwalBulanAction, setJadwalTimAction, swapJadwalTimAction } from "@/app/mkesindo/produksi/actions";
import type { JadwalTimRow } from "@/lib/queries/jadwal-tim-produksi";
import type { TimRow } from "@/lib/queries/tim-produksi";
import type { StafOperasionalOption } from "@/lib/queries/akun";
import type { ShiftNumber } from "@/lib/report-shift";

const BULAN_NAMA = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
// Header kalender Senin-first (bukan Minggu-first), sesuai referensi desain
// user 2026-09-19.
const HARI_HEADER = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const SHIFT_URUTAN: ShiftNumber[] = [1, 2, 3];

// Satu warna per Tim (siklus kalau Tim lebih banyak dari palet) -- dipakai
// bar warna kartu ringkasan & badge shift di kalender, sama sekali tidak
// menyimpan makna bisnis apa pun.
const TIM_COLORS = ["bg-sky-600", "bg-emerald-600", "bg-amber-600", "bg-violet-600", "bg-rose-600", "bg-cyan-600"];
const TIM_BORDER_COLORS = ["border-sky-600", "border-emerald-600", "border-amber-600", "border-violet-600", "border-rose-600", "border-cyan-600"];
// Warna badge S1/S2/S3 di kartu ringkasan -- per NOMOR SHIFT (bukan per
// Tim, warna Tim sendiri sudah dipakai bar kiri kartu), sesuai referensi
// desain user: S1 biru, S2 hijau, S3 oranye.
const SHIFT_BADGE_COLORS: Record<ShiftNumber, string> = {
  1: "bg-sky-500/15 text-sky-400",
  2: "bg-emerald-500/15 text-emerald-400",
  3: "bg-amber-500/15 text-amber-400",
};

// Label pendek badge kalender ("A"/"B"/"C") -- ambil kata terakhir nama Tim
// kalau berpola "Tim X", fallback ke huruf pertama nama untuk Tim yang
// dinamai bebas.
function timLetter(nama: string): string {
  const m = nama.match(/^Tim\s+(.+)$/i);
  return (m ? m[1] : nama).trim().slice(0, 1).toUpperCase() || "?";
}

function tanggalUsahaFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface KalenderCell {
  date: Date;
  tanggalUsaha: string;
  inMonth: boolean;
  // Hanya relevan kalau !inMonth -- "before" = luapan bulan lalu (label
  // "Lalu"), false = luapan bulan depan (label "Depan").
  before: boolean;
}

function buildKalenderCells(tahun: number, bulan: number): KalenderCell[] {
  const firstOfMonth = new Date(Date.UTC(tahun, bulan - 1, 1));
  // JS getUTCDay(): Min=0..Sab=6 -> geser supaya Senin=0.
  const leading = (firstOfMonth.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();

  const cells: KalenderCell[] = [];
  for (let i = leading; i > 0; i--) {
    const d = new Date(Date.UTC(tahun, bulan - 1, 1 - i));
    cells.push({ date: d, tanggalUsaha: tanggalUsahaFromDate(d), inMonth: false, before: true });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(Date.UTC(tahun, bulan - 1, day));
    cells.push({ date: d, tanggalUsaha: tanggalUsahaFromDate(d), inMonth: true, before: false });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const d = new Date(last);
    d.setUTCDate(d.getUTCDate() + 1);
    cells.push({ date: d, tanggalUsaha: tanggalUsahaFromDate(d), inMonth: false, before: false });
  }
  return cells;
}

// Satu badge Tim di satu hari kalender. Draggable+droppable HANYA kalau Tim
// ini sudah punya shift hari itu (entry != null) -- badge kosong (Tim belum
// dijadwalkan hari itu) tidak bisa di-drag (tidak ada shift asal untuk
// dipindah) dan tidak bisa jadi target drop (menghindari kondisi ambigu:
// shift mana yang harus ditinggalkan pengirimnya). Untuk mengisi hari yang
// masih kosong, badge kosong tetap bisa DIKLIK (lihat BadgeKosongPopover).
function TimBadge({
  tanggalUsaha,
  tim,
  timIdx,
  entry,
  disabled,
}: {
  tanggalUsaha: string;
  tim: TimRow;
  timIdx: number;
  entry: JadwalTimRow | undefined;
  disabled: boolean;
}) {
  const dragId = `${tanggalUsaha}__${tim.timId}`;
  const dragData = { tanggalUsaha, timId: tim.timId, shift: entry?.shift ?? null };
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: dragId,
    data: dragData,
    disabled: disabled || !entry,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dragId,
    data: dragData,
    disabled: disabled || !entry,
  });

  if (!entry) {
    return <div className="flex size-6 items-center justify-center rounded text-[9px] text-muted-foreground/40">&ndash;</div>;
  }

  return (
    <button
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      {...listeners}
      {...attributes}
      type="button"
      disabled={disabled}
      title={`${tim.nama} — Shift ${entry.shift}`}
      className={cn(
        "flex h-6 min-w-[34px] items-center justify-center gap-0.5 rounded px-1 text-[9px] font-semibold text-white",
        TIM_COLORS[timIdx % TIM_COLORS.length],
        isDragging && "z-20 opacity-50",
        isOver && "ring-2 ring-offset-1 ring-primary"
      )}
    >
      <span>{timLetter(tim.nama)}</span>
      <span className="opacity-80">S{entry.shift}</span>
    </button>
  );
}

// Badge kosong yang masih bisa diklik untuk mengisi shift Tim ini hari itu
// -- HANYA menawarkan shift yang hari itu juga masih kosong (tidak ada Tim
// lain), supaya tidak pernah menimpa penugasan Tim lain secara diam-diam.
// Untuk menukar shift dua Tim yang SAMA-SAMA sudah terisi, pakai drag & drop
// (TimBadge), bukan popover ini.
function BadgeKosongPopover({
  tanggalUsaha,
  tim,
  shiftKosong,
  disabled,
  onAssigned,
}: {
  tanggalUsaha: string;
  tim: TimRow;
  shiftKosong: ShiftNumber[];
  disabled: boolean;
  onAssigned: (shift: ShiftNumber, timId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function pilih(shift: ShiftNumber) {
    startTransition(async () => {
      const result = await setJadwalTimAction(tanggalUsaha, shift, tim.timId);
      if (result.success) {
        onAssigned(shift, tim.timId);
        setOpen(false);
      }
    });
  }

  if (disabled || shiftKosong.length === 0) {
    return <div className="flex size-6 items-center justify-center rounded text-[9px] text-muted-foreground/40">&ndash;</div>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title={`${tim.nama} — belum dijadwalkan, klik untuk isi`}
            className="flex size-6 items-center justify-center rounded border border-dashed border-muted-foreground/40 text-[9px] text-muted-foreground hover:bg-muted"
          />
        }
      >
        +
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1.5">
        <p className="mb-1 px-1 text-[10px] text-muted-foreground">Jadwalkan {tim.nama} di:</p>
        {shiftKosong.map((s) => (
          <button
            key={s}
            type="button"
            disabled={pending}
            onClick={() => pilih(s)}
            className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted disabled:opacity-50"
          >
            Shift {s}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function JadwalTimBulanan({
  tahunAwal,
  bulanAwal,
  jadwalAwal,
  timList,
  produksiAkunOptions,
}: {
  tahunAwal: number;
  bulanAwal: number;
  jadwalAwal: JadwalTimRow[];
  timList: TimRow[];
  produksiAkunOptions: StafOperasionalOption[];
}) {
  const [tahun, setTahun] = useState(tahunAwal);
  const [bulan, setBulan] = useState(bulanAwal);
  const [jadwal, setJadwal] = useState(jadwalAwal);
  const [loading, setLoading] = useState(false);
  // Sama seperti pengiriman-board.tsx/route-validation-dialog.tsx -- tanpa
  // sensor eksplisit ini drag & drop dnd-kit tidak konsisten terpicu.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const akunNamaById = useMemo(() => new Map(produksiAkunOptions.map((o) => [o.akunId, o.nama])), [produksiAkunOptions]);

  function muatBulan(nextTahun: number, nextBulan: number) {
    setTahun(nextTahun);
    setBulan(nextBulan);
    setLoading(true);
    getJadwalBulanAction(nextTahun, nextBulan).then((result) => {
      if (result.success) setJadwal(result.data);
      setLoading(false);
    });
  }

  function gantiBulan(delta: number) {
    let nextBulan = bulan + delta;
    let nextTahun = tahun;
    if (nextBulan < 1) {
      nextBulan = 12;
      nextTahun -= 1;
    } else if (nextBulan > 12) {
      nextBulan = 1;
      nextTahun += 1;
    }
    muatBulan(nextTahun, nextBulan);
  }

  const cells = useMemo(() => buildKalenderCells(tahun, bulan), [tahun, bulan]);

  // Dua peta turunan dari jadwal, dipakai berulang kali per sel kalender:
  // - entryByDayShift: tanggalUsaha -> shift -> baris (untuk tahu shift mana
  //   yang masih kosong hari itu).
  // - entryByDayTim: tanggalUsaha -> timId -> baris (untuk badge per Tim --
  //   Tim ini shift berapa hari itu, kalau ada).
  const { entryByDayShift, entryByDayTim } = useMemo(() => {
    const byShift = new Map<string, Map<ShiftNumber, JadwalTimRow>>();
    const byTim = new Map<string, Map<number, JadwalTimRow>>();
    for (const j of jadwal) {
      if (!byShift.has(j.tanggalUsaha)) byShift.set(j.tanggalUsaha, new Map());
      byShift.get(j.tanggalUsaha)!.set(j.shift, j);
      if (!byTim.has(j.tanggalUsaha)) byTim.set(j.tanggalUsaha, new Map());
      byTim.get(j.tanggalUsaha)!.set(j.timId, j);
    }
    return { entryByDayShift: byShift, entryByDayTim: byTim };
  }, [jadwal]);

  // Statistik ringkasan per Tim (jumlah hari bertugas di tiap shift) untuk
  // bulan yang sedang ditampilkan -- dihitung dari data jadwal yang sudah
  // dimuat, bukan query baru.
  const statsPerTim = useMemo(() => {
    const stats = new Map<number, Record<ShiftNumber, number>>();
    for (const tim of timList) stats.set(tim.timId, { 1: 0, 2: 0, 3: 0 });
    for (const j of jadwal) {
      const s = stats.get(j.timId);
      if (s) s[j.shift] += 1;
    }
    return stats;
  }, [jadwal, timList]);

  function updateEntry(tanggalUsaha: string, shift: ShiftNumber, timId: number) {
    const tim = timList.find((t) => t.timId === timId);
    if (!tim) return;
    setJadwal((prev) => {
      const tanpaLama = prev.filter((j) => !(j.tanggalUsaha === tanggalUsaha && j.shift === shift));
      return [...tanpaLama, { tanggalUsaha, shift, timId, timNama: tim.nama }];
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const from = event.active.data.current as { tanggalUsaha: string; timId: number; shift: ShiftNumber | null } | undefined;
    const to = event.over?.data.current as { tanggalUsaha: string; timId: number; shift: ShiftNumber | null } | undefined;
    if (!from || !to || from.shift == null || to.shift == null) return;
    if (from.tanggalUsaha !== to.tanggalUsaha) return; // hanya tukar dalam satu hari yang sama
    if (from.timId === to.timId) return; // drop ke badge sendiri

    const tanggalUsaha = from.tanggalUsaha;
    const shiftA = from.shift;
    const shiftB = to.shift;
    // Optimistic update dulu, lalu kirim ke server -- jika gagal, refetch
    // bulan berjalan supaya tidak nyangkut di state yang salah.
    updateEntry(tanggalUsaha, shiftA, to.timId);
    updateEntry(tanggalUsaha, shiftB, from.timId);
    swapJadwalTimAction(tanggalUsaha, shiftA, to.timId, shiftB, from.timId).then((result) => {
      if (!result.success) muatBulan(tahun, bulan);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Kartu ringkasan per Tim + navigasi periode -- referensi desain
          user 2026-09-19. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {timList.map((tim, idx) => {
          const kepalaNama = tim.kepalaAkunId != null ? (akunNamaById.get(tim.kepalaAkunId) ?? "?") : null;
          const wakilNama = tim.wakilKepalaAkunId != null ? (akunNamaById.get(tim.wakilKepalaAkunId) ?? "?") : null;
          const stats = statsPerTim.get(tim.timId) ?? { 1: 0, 2: 0, 3: 0 };
          return (
            <div
              key={tim.timId}
              className={cn("flex items-center gap-3 rounded-lg border-l-4 border-y border-r border-border bg-muted/20 p-3", TIM_BORDER_COLORS[idx % TIM_BORDER_COLORS.length])}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{tim.nama}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {kepalaNama || wakilNama ? [kepalaNama, wakilNama].filter(Boolean).join(", ") : "Belum ditentukan"}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                {SHIFT_URUTAN.map((s) => (
                  <span key={s} className={cn("rounded px-1.5 py-1 text-[10px] font-medium", SHIFT_BADGE_COLORS[s])}>
                    S{s}: {stats[s]}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 p-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Periode Roster</p>
            <p className="text-sm font-semibold">
              {BULAN_NAMA[bulan - 1]} {tahun}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="outline" size="icon" className="size-7" disabled={loading} onClick={() => gantiBulan(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="icon" className="size-7" disabled={loading} onClick={() => gantiBulan(1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Memuat...</p>
      ) : timList.length === 0 ? (
        <p className="text-xs text-muted-foreground">Belum ada Tim Produksi.</p>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-7 border-b border-border bg-muted/40">
              {HARI_HEADER.map((h) => (
                <div key={h} className="p-1.5 text-center text-[11px] font-medium text-muted-foreground">
                  {h}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((cell) => {
                const dayByShift = entryByDayShift.get(cell.tanggalUsaha);
                const dayByTim = entryByDayTim.get(cell.tanggalUsaha);
                const shiftKosong = SHIFT_URUTAN.filter((s) => !dayByShift?.get(s));
                return (
                  <div
                    key={cell.tanggalUsaha}
                    className={cn(
                      "flex min-h-[76px] flex-col gap-1 border-b border-r border-border p-1.5 last:border-r-0",
                      !cell.inMonth && "bg-muted/10"
                    )}
                  >
                    <div className="flex items-baseline justify-between">
                      <span className={cn("text-xs font-semibold", !cell.inMonth && "text-muted-foreground/50")}>
                        {cell.date.getUTCDate()}
                      </span>
                      {!cell.inMonth && <span className="text-[9px] italic text-muted-foreground/50">{cell.before ? "Lalu" : "Depan"}</span>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {timList.map((tim, idx) => {
                        const entry = dayByTim?.get(tim.timId);
                        return entry ? (
                          <TimBadge
                            key={tim.timId}
                            tanggalUsaha={cell.tanggalUsaha}
                            tim={tim}
                            timIdx={idx}
                            entry={entry}
                            disabled={!cell.inMonth}
                          />
                        ) : (
                          <BadgeKosongPopover
                            key={tim.timId}
                            tanggalUsaha={cell.tanggalUsaha}
                            tim={tim}
                            shiftKosong={shiftKosong}
                            disabled={!cell.inMonth}
                            onAssigned={(s, id) => updateEntry(cell.tanggalUsaha, s, id)}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </DndContext>
      )}
    </div>
  );
}
