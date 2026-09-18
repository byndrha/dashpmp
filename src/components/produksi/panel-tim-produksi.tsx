"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { tambahAnggotaTimAction, updateAnggotaTimAction, hapusAnggotaTimAction, updateTimKepalaAction, updateTimWakilKepalaAction } from "@/app/mkesindo/produksi/actions";
import type { AnggotaTimRow, TimRow } from "@/lib/queries/tim-produksi";
import type { StafOperasionalOption } from "@/lib/queries/akun";

const UNSET = "__unset__";

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

// Satu warna per Tim (siklus kalau Tim lebih banyak dari palet) -- sama
// dengan bar warna kartu ringkasan di jadwal-tim-bulanan.tsx.
const TIM_BORDER_COLORS = ["border-sky-600", "border-emerald-600", "border-amber-600", "border-violet-600", "border-rose-600", "border-cyan-600"];

// Kartu ringkas (bar warna + nama Tim + "KP, Wakil") -- klik untuk membuka
// dialog berisi pengaturan lengkap (pilih KP/Wakil, daftar & tambah
// anggota), persis konten yang sebelumnya selalu tampil langsung di kartu.
function TimCard({
  tim,
  timIdx,
  anggotaList,
  timList,
  produksiAkunOptions,
}: {
  tim: TimRow;
  timIdx: number;
  anggotaList: AnggotaTimRow[];
  timList: TimRow[];
  produksiAkunOptions: StafOperasionalOption[];
}) {
  const [open, setOpen] = useState(false);
  const kepalaNama = produksiAkunOptions.find((o) => o.akunId === tim.kepalaAkunId)?.nama ?? null;
  const wakilNama = produksiAkunOptions.find((o) => o.akunId === tim.wakilKepalaAkunId)?.nama ?? null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex w-full flex-col gap-1 rounded-lg border-l-4 border-y border-r border-border bg-muted/20 p-3 text-left hover:bg-muted/40",
              TIM_BORDER_COLORS[timIdx % TIM_BORDER_COLORS.length]
            )}
          />
        }
      >
        <p className="text-sm font-semibold">{tim.nama}</p>
        <p className="truncate text-xs text-muted-foreground">
          {kepalaNama || wakilNama ? [kepalaNama, wakilNama].filter(Boolean).join(", ") : "Belum ditentukan"}
        </p>
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

export function PanelTimProduksi({
  timList,
  anggotaList,
  produksiAkunOptions,
}: {
  timList: TimRow[];
  anggotaList: AnggotaTimRow[];
  produksiAkunOptions: StafOperasionalOption[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {timList.map((tim, idx) => (
        <TimCard
          key={tim.timId}
          tim={tim}
          timIdx={idx}
          anggotaList={anggotaList}
          timList={timList}
          produksiAkunOptions={produksiAkunOptions}
        />
      ))}
    </div>
  );
}
