"use client";

import { useMemo, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  getJadwalBulanAction,
  setJadwalTimAction,
  swapJadwalTimAction,
  tambahAnggotaTimAction,
  updateAnggotaTimAction,
  hapusAnggotaTimAction,
  updateTimKepalaAction,
  updateTimWakilKepalaAction,
} from "@/app/mkesindo/produksi/actions";
import type { JadwalTimRow } from "@/lib/queries/jadwal-tim-produksi";
import type { AnggotaTimRow, TimRow } from "@/lib/queries/tim-produksi";
import type { StafOperasionalOption } from "@/lib/queries/akun";
import type { ShiftNumber } from "@/lib/report-shift";

const UNSET = "__unset__";

const BULAN_NAMA = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const BULAN_SINGKAT = ["JAN", "FEB", "MAR", "APR", "MEI", "JUN", "JUL", "AGU", "SEP", "OKT", "NOV", "DES"];
const HARI_SINGKAT = ["MIN", "SEN", "SEL", "RAB", "KAM", "JUM", "SAB"];
const SHIFT_URUTAN: ShiftNumber[] = [1, 2, 3];
// Urutan tampil kotak Tim DI DALAM tiap sel kalender -- urutan kronologis
// shift dalam satu TanggalUsaha (Shift 2 mulai duluan, lalu 3, lalu 1),
// beda dengan SHIFT_URUTAN di atas yang dipakai badge S1/S2/S3 kartu
// ringkasan. Posisi kotak di sini TETAP per-shift; Tim yang mengisi posisi
// itu yang berubah-ubah sesuai data, sesuai permintaan user 2026-09-19.
const SHIFT_URUTAN_KALENDER: ShiftNumber[] = [2, 3, 1];

// Satu warna per Tim (siklus kalau Tim lebih banyak dari palet) -- dipakai
// bar warna kartu ringkasan & badge shift di kalender, sama sekali tidak
// menyimpan makna bisnis apa pun.
const TIM_COLORS = ["bg-sky-600", "bg-emerald-600", "bg-amber-600", "bg-violet-600", "bg-rose-600", "bg-cyan-600"];
const TIM_BORDER_COLORS = ["border-sky-600", "border-emerald-600", "border-amber-600", "border-violet-600", "border-rose-600", "border-cyan-600"];
// Warna teks label "S{n}" DI BAWAH kotak huruf Tim -- teks terpisah (bukan
// digabung dalam satu badge), tetap satu warna dengan kotak huruf di
// atasnya. Sesuai referensi desain user 2026-09-19.
const TIM_TEXT_COLORS = ["text-sky-400", "text-emerald-400", "text-amber-400", "text-violet-400", "text-rose-400", "text-cyan-400"];
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
    return <div className="size-7" />;
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
      className={cn("flex flex-col items-center gap-0.5", isDragging && "z-20 opacity-50")}
    >
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded text-xs font-bold text-white",
          TIM_COLORS[timIdx % TIM_COLORS.length],
          isOver && "ring-2 ring-offset-1 ring-offset-background ring-primary"
        )}
      >
        {timLetter(tim.nama)}
      </span>
      <span className={cn("text-[10px] font-semibold", TIM_TEXT_COLORS[timIdx % TIM_TEXT_COLORS.length])}>S{entry.shift}</span>
    </button>
  );
}

// Badge kosong untuk satu SLOT SHIFT (posisi kotak tetap per-shift) yang
// masih bisa diklik untuk memilih Tim mana yang mengisi shift itu hari ini
// -- hanya menawarkan Tim yang hari itu belum punya shift lain, supaya
// tidak pernah menimpa penugasan Tim lain secara diam-diam. Untuk menukar
// shift dua Tim yang SAMA-SAMA sudah terisi, pakai drag & drop (TimBadge).
function BadgeKosongPopoverShift({
  tanggalUsaha,
  shift,
  timTersisa,
  disabled,
  onAssigned,
}: {
  tanggalUsaha: string;
  shift: ShiftNumber;
  timTersisa: TimRow[];
  disabled: boolean;
  onAssigned: (timId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function pilih(timId: number) {
    startTransition(async () => {
      const result = await setJadwalTimAction(tanggalUsaha, shift, timId);
      if (result.success) {
        onAssigned(timId);
        setOpen(false);
      }
    });
  }

  if (disabled || timTersisa.length === 0) {
    return <div className="size-7" />;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<button type="button" title={`Shift ${shift} — belum dijadwalkan, klik untuk isi`} className="flex flex-col items-center gap-0.5" />}
      >
        <span className="flex size-7 items-center justify-center rounded border border-dashed border-muted-foreground/40 text-xs text-muted-foreground hover:bg-muted">
          +
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1.5">
        <p className="mb-1 px-1 text-[10px] text-muted-foreground">Jadwalkan Shift {shift} dengan:</p>
        {timTersisa.map((t) => (
          <button
            key={t.timId}
            type="button"
            disabled={pending}
            onClick={() => pilih(t.timId)}
            className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted disabled:opacity-50"
          >
            {t.nama}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function AnggotaCard({ anggota, timList }: { anggota: AnggotaTimRow; timList: TimRow[] }) {
  const [open, setOpen] = useState(false);
  const [nama, setNama] = useState(anggota.nama);
  const [timId, setTimId] = useState(anggota.timId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateAnggotaTimAction(anggota.anggotaId, { nama, timId });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  function handleNonaktifkan() {
    if (!confirm(`Nonaktifkan ${anggota.nama}? Tindakan ini tidak bisa dibatalkan dari sini.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await hapusAnggotaTimAction(anggota.anggotaId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setNama(anggota.nama);
          setTimId(anggota.timId);
          setError(null);
        }
      }}
    >
      <DialogTrigger className="w-full rounded-lg border border-border p-2 text-left text-sm hover:bg-muted/50">
        {anggota.nama}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ubah Anggota Tim Produksi</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Nama</Label>
            <Input value={nama} onChange={(e) => setNama(e.target.value)} />
          </div>
          <div>
            <Label>Tim</Label>
            <Select value={String(timId)} onValueChange={(v) => setTimId(Number(v))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timList.map((t) => (
                  <SelectItem key={t.timId} value={String(t.timId)}>
                    {t.nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={pending} onClick={handleNonaktifkan}>
            Nonaktifkan
          </Button>
          <Button disabled={pending} onClick={handleSave}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TambahAnggotaDialog({ tim }: { tim: TimRow }) {
  const [open, setOpen] = useState(false);
  const [nama, setNama] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    if (!nama.trim()) {
      setError("Nama tidak boleh kosong.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await tambahAnggotaTimAction(tim.timId, nama.trim());
      if (!result.success) {
        setError(result.error);
        return;
      }
      setNama("");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-2 text-sm text-muted-foreground hover:bg-muted/50">
        <Plus className="size-4" /> Tambah Anggota
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah Anggota — {tim.nama}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Nama</Label>
            <Input value={nama} onChange={(e) => setNama(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button disabled={pending} onClick={handleSubmit}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KepalaSelect({ tim, produksiAkunOptions }: { tim: TimRow; produksiAkunOptions: StafOperasionalOption[] }) {
  const [pending, startTransition] = useTransition();

  function handleChange(value: string | null) {
    startTransition(async () => {
      await updateTimKepalaAction(tim.timId, !value || value === UNSET ? null : Number(value));
    });
  }

  const options = produksiAkunOptions.filter((o) => o.akunId !== tim.wakilKepalaAkunId);

  return (
    <Select value={tim.kepalaAkunId != null ? String(tim.kepalaAkunId) : UNSET} onValueChange={handleChange} disabled={pending}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Pilih Kepala Produksi">
          {(v: string) => (v === UNSET ? "Pilih Kepala Produksi" : (options.find((o) => String(o.akunId) === v)?.nama ?? "Pilih Kepala Produksi"))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET}>Belum ditentukan</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.akunId} value={String(o.akunId)}>
            {o.nama}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function WakilKepalaSelect({ tim, produksiAkunOptions }: { tim: TimRow; produksiAkunOptions: StafOperasionalOption[] }) {
  const [pending, startTransition] = useTransition();

  function handleChange(value: string | null) {
    startTransition(async () => {
      await updateTimWakilKepalaAction(tim.timId, !value || value === UNSET ? null : Number(value));
    });
  }

  const options = produksiAkunOptions.filter((o) => o.akunId !== tim.kepalaAkunId);

  return (
    <Select value={tim.wakilKepalaAkunId != null ? String(tim.wakilKepalaAkunId) : UNSET} onValueChange={handleChange} disabled={pending}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Pilih Wakil Kepala Produksi">
          {(v: string) =>
            v === UNSET ? "Pilih Wakil Kepala Produksi" : (options.find((o) => String(o.akunId) === v)?.nama ?? "Pilih Wakil Kepala Produksi")
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET}>Belum ditentukan</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.akunId} value={String(o.akunId)}>
            {o.nama}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Kartu ringkasan Tim -- sekaligus pemicu dialog "UI - Pengaturan Tim"
// (pilih Kepala/Wakil, daftar & tambah anggota) yang sebelumnya berada di
// section terpisah "Tim Produksi" (dihapus, digabung ke sini sesuai
// permintaan user 2026-09-19).
function TimRingkasanCard({
  tim,
  timIdx,
  kepalaNama,
  wakilNama,
  stats,
  anggotaList,
  timList,
  produksiAkunOptions,
}: {
  tim: TimRow;
  timIdx: number;
  kepalaNama: string | null;
  wakilNama: string | null;
  stats: Record<ShiftNumber, number>;
  anggotaList: AnggotaTimRow[];
  timList: TimRow[];
  produksiAkunOptions: StafOperasionalOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex items-center gap-3 rounded-lg border-l-4 border-y border-r border-border bg-muted/20 p-3 text-left hover:bg-muted/40",
              TIM_BORDER_COLORS[timIdx % TIM_BORDER_COLORS.length]
            )}
          />
        }
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
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pengaturan {tim.nama}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <div>
            <Label className="text-xs">Kepala Produksi</Label>
            <KepalaSelect tim={tim} produksiAkunOptions={produksiAkunOptions} />
          </div>
          <div>
            <Label className="text-xs">Wakil Kepala Produksi</Label>
            <WakilKepalaSelect tim={tim} produksiAkunOptions={produksiAkunOptions} />
          </div>
          {anggotaList
            .filter((a) => a.timId === tim.timId)
            .map((a) => (
              <AnggotaCard key={a.anggotaId} anggota={a} timList={timList} />
            ))}
          <TambahAnggotaDialog tim={tim} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function JadwalTimBulanan({
  tahunAwal,
  bulanAwal,
  jadwalAwal,
  timList,
  anggotaList,
  produksiAkunOptions,
  tanggalUsahaHariIni,
}: {
  tahunAwal: number;
  bulanAwal: number;
  jadwalAwal: JadwalTimRow[];
  timList: TimRow[];
  anggotaList: AnggotaTimRow[];
  produksiAkunOptions: StafOperasionalOption[];
  // TanggalUsaha (bukan tanggal kalender biasa) untuk highlight kotak "hari
  // ini" -- shift 2 mulai 15:00 WIB sudah masuk TanggalUsaha besok, lihat
  // report-shift.ts. Dikirim dari page.tsx (getCurrentShift().tanggalUsaha)
  // bukan dihitung dari `new Date()` di sini, supaya konsisten dengan
  // rollover WIB yang sama dipakai seluruh sistem shift produksi.
  tanggalUsahaHariIni: string;
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
            <TimRingkasanCard
              key={tim.timId}
              tim={tim}
              timIdx={idx}
              kepalaNama={kepalaNama}
              wakilNama={wakilNama}
              stats={stats}
              anggotaList={anggotaList}
              timList={timList}
              produksiAkunOptions={produksiAkunOptions}
            />
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
            <div className="grid grid-cols-7">
              {cells.map((cell) => {
                const dayByShift = entryByDayShift.get(cell.tanggalUsaha);
                const dayByTim = entryByDayTim.get(cell.tanggalUsaha);
                const timTersisa = timList.filter((t) => !dayByTim?.has(t.timId));
                return (
                  <div
                    key={cell.tanggalUsaha}
                    className={cn(
                      "flex min-h-[76px] items-center justify-between gap-2 border-b border-r border-border p-2 last:border-r-0",
                      !cell.inMonth && "bg-muted/10",
                      cell.tanggalUsaha === tanggalUsahaHariIni && "relative z-10 bg-sky-50 ring-2 ring-inset ring-sky-500 dark:bg-sky-950/40"
                    )}
                  >
                    {/* Blok tanggal+nama hari di kiri -- untuk tanggal luar
                        bulan, sub-label menunjukkan BULAN asalnya (mis.
                        "AGU"), bukan nama hari, supaya jelas ini luapan dari
                        bulan lain; label "Lalu"/"Depan" menggantikan posisi
                        badge Tim di kanan (tanggal luar bulan tidak
                        menampilkan/bisa diedit jadwalnya di sini). */}
                    <div className="flex shrink-0 flex-col">
                      <span className={cn("text-xl font-bold leading-none", !cell.inMonth && "text-muted-foreground/40")}>
                        {cell.date.getUTCDate()}
                      </span>
                      <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                        {cell.inMonth ? HARI_SINGKAT[cell.date.getUTCDay()] : BULAN_SINGKAT[cell.date.getUTCMonth()]}
                      </span>
                    </div>
                    {!cell.inMonth ? (
                      <span className="text-xs italic text-muted-foreground/50">{cell.before ? "Lalu" : "Depan"}</span>
                    ) : (
                      <div className="flex shrink-0 gap-1.5">
                        {SHIFT_URUTAN_KALENDER.map((shift) => {
                          const entry = dayByShift?.get(shift);
                          const timIdx = entry ? timList.findIndex((t) => t.timId === entry.timId) : -1;
                          const tim = timIdx >= 0 ? timList[timIdx] : undefined;
                          return entry && tim ? (
                            <TimBadge
                              key={shift}
                              tanggalUsaha={cell.tanggalUsaha}
                              tim={tim}
                              timIdx={timIdx}
                              entry={entry}
                              disabled={!cell.inMonth}
                            />
                          ) : (
                            <BadgeKosongPopoverShift
                              key={shift}
                              tanggalUsaha={cell.tanggalUsaha}
                              shift={shift}
                              timTersisa={timTersisa}
                              disabled={!cell.inMonth}
                              onAssigned={(id) => updateEntry(cell.tanggalUsaha, shift, id)}
                            />
                          );
                        })}
                      </div>
                    )}
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
