"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  addSatpamJadwalJagaAction,
  removeSatpamJadwalJagaAction,
  getSatpamJadwalJagaListAction,
} from "@/app/mkesindo/(dashboard)/keamanan/actions";
import { SATPAM_SHIFT_LIST, SATPAM_SHIFT_LABEL, type SatpamShiftType } from "@/lib/satpam-shift";
import type { SatpamJadwalDisplayRow } from "@/lib/queries/satpam-jadwal-jaga";
import type { StafOperasionalOption } from "@/lib/queries/akun";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateOnlyISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Panel admin roster shift Satpam -- form tambah + daftar dikelompokkan per
// tanggal, ditaruh langsung di halaman /mkesindo/keamanan (bukan di dalam
// Dialog seperti MarketingWilayahPanel, karena halaman ini SATU-SATUNYA isi
// halaman itu, bukan fitur tambahan di atas halaman lain yang sudah padat).
export function SatpamRosterPanel({
  initialRows,
  satpamOptions,
  initialRange,
}: {
  initialRows: SatpamJadwalDisplayRow[];
  satpamOptions: StafOperasionalOption[];
  initialRange: { start: string; end: string };
}) {
  const [rows, setRows] = useState(initialRows);
  const [range, setRange] = useState(initialRange);
  const [tanggal, setTanggal] = useState(todayISO());
  const [shiftType, setShiftType] = useState<SatpamShiftType | "">("");
  const [satpamAkunId, setSatpamAkunId] = useState("");
  const [catatan, setCatatan] = useState("");
  const [pending, startTransition] = useTransition();
  const [filterPending, startFilterTransition] = useTransition();
  const [removingId, setRemovingId] = useState<number | null>(null);

  function resetForm() {
    setShiftType("");
    setSatpamAkunId("");
    setCatatan("");
  }

  function refetchRange(nextRange: { start: string; end: string }) {
    startFilterTransition(async () => {
      const result = await getSatpamJadwalJagaListAction(nextRange.start, nextRange.end);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setRows(result.data);
      setRange(nextRange);
    });
  }

  function handleAdd() {
    if (!tanggal || !shiftType || !satpamAkunId) {
      toast.error("Pilih Tanggal, Tipe Shift, dan Satpam.");
      return;
    }
    startTransition(async () => {
      const result = await addSatpamJadwalJagaAction({
        tanggalUsaha: tanggal,
        shiftType,
        satpamAkunId: Number(satpamAkunId),
        catatan: catatan || undefined,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      resetForm();
      refetchRange(range);
    });
  }

  function handleRemove(id: number) {
    setRemovingId(id);
    startTransition(async () => {
      const result = await removeSatpamJadwalJagaAction(id);
      if (!result.success) {
        toast.error(result.error);
      } else {
        refetchRange(range);
      }
      setRemovingId(null);
    });
  }

  // Peringatan tabrakan -- dihitung dari `rows` yang SUDAH dimuat untuk
  // rentang filter yang sedang aktif, bukan query tambahan ke server. Kalau
  // tanggal yang mau ditambahkan berada di luar rentang filter yang sedang
  // ditampilkan, peringatan ini tidak akan muncul -- keterbatasan yang
  // disengaja, lihat spec.
  const collision = useMemo(() => {
    if (!tanggal || !shiftType) return undefined;
    return rows.find((r) => dateOnlyISO(r.tanggalUsaha) === tanggal && r.shiftType === shiftType);
  }, [rows, tanggal, shiftType]);

  const groupedByDate = useMemo(() => {
    const byDate = new Map<string, SatpamJadwalDisplayRow[]>();
    for (const row of rows) {
      const key = dateOnlyISO(row.tanggalUsaha);
      const list = byDate.get(key) ?? [];
      list.push(row);
      byDate.set(key, list);
    }
    return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-lg border bg-secondary/30 p-4">
        <h3 className="text-sm font-semibold">Tambah Jadwal Jaga</h3>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex w-40 flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tanggal</span>
            <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
          </div>
          <div className="flex w-56 flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tipe Shift</span>
            <Select value={shiftType} onValueChange={(v) => setShiftType((v as SatpamShiftType) ?? "")}>
              <SelectTrigger className="w-full" aria-label="Tipe Shift">
                <SelectValue placeholder="Pilih tipe shift">
                  {(v: string) => SATPAM_SHIFT_LABEL[v as SatpamShiftType] ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SATPAM_SHIFT_LIST.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SATPAM_SHIFT_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-48 flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Satpam</span>
            <Select value={satpamAkunId} onValueChange={(v) => setSatpamAkunId(v ?? "")}>
              <SelectTrigger className="w-full" aria-label="Satpam">
                <SelectValue placeholder="Pilih Satpam">
                  {(v: string) => satpamOptions.find((o) => String(o.akunId) === v)?.nama ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {satpamOptions.map((o) => (
                  <SelectItem key={o.akunId} value={String(o.akunId)}>
                    {o.nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-56 flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Catatan (opsional)
            </span>
            <Input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Mis. pengganti sementara" />
          </div>
          <Button type="button" disabled={pending} onClick={handleAdd}>
            Tambah
          </Button>
        </div>
        {collision && (
          <p className="text-xs text-amber-600">
            Slot ini sudah diisi oleh {collision.satpamNama} — menambah lagi tetap diizinkan, tidak akan diblokir.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex w-40 flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Dari Tanggal</span>
            <Input type="date" value={range.start} onChange={(e) => refetchRange({ ...range, start: e.target.value })} />
          </div>
          <div className="flex w-40 flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Sampai Tanggal</span>
            <Input type="date" value={range.end} onChange={(e) => refetchRange({ ...range, end: e.target.value })} />
          </div>
          {filterPending && <span className="text-xs text-muted-foreground">Memuat...</span>}
        </div>

        {groupedByDate.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tidak ada jadwal jaga pada rentang tanggal ini.</p>
        ) : (
          groupedByDate.map(([dateISO, dateRows]) => (
            <div key={dateISO} className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-semibold">
                {new Date(dateISO).toLocaleDateString("id-ID", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </p>
              <div className="flex flex-col gap-2">
                {dateRows.map((row) => (
                  <div
                    key={row.jadwalJagaId}
                    className="flex items-center justify-between gap-2 rounded-md bg-secondary/40 px-3 py-2"
                  >
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {SATPAM_SHIFT_LABEL[row.shiftType]}
                      </span>
                      <span className="text-sm">{row.satpamNama}</span>
                      {row.catatan && <span className="text-xs text-muted-foreground">{row.catatan}</span>}
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={pending && removingId === row.jadwalJagaId}
                      onClick={() => handleRemove(row.jadwalJagaId)}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
