"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { tambahAnggotaTimAction, updateAnggotaTimAction, hapusAnggotaTimAction, updateTimKepalaAction } from "@/app/mkesindo/produksi/actions";
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

  return (
    <Select value={tim.kepalaAkunId != null ? String(tim.kepalaAkunId) : UNSET} onValueChange={handleChange} disabled={pending}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Pilih Kepala Produksi">
          {(v: string) =>
            v === UNSET ? "Pilih Kepala Produksi" : (produksiAkunOptions.find((o) => String(o.akunId) === v)?.nama ?? "Pilih Kepala Produksi")
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET}>Belum ditentukan</SelectItem>
        {produksiAkunOptions.map((o) => (
          <SelectItem key={o.akunId} value={String(o.akunId)}>
            {o.nama}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
      {timList.map((tim) => (
        <div key={tim.timId} className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p className="text-sm font-semibold">{tim.nama}</p>
          <div>
            <Label className="text-xs">Kepala Produksi</Label>
            <KepalaSelect tim={tim} produksiAkunOptions={produksiAkunOptions} />
          </div>
          {anggotaList
            .filter((a) => a.timId === tim.timId)
            .map((a) => (
              <AnggotaCard key={a.anggotaId} anggota={a} timList={timList} />
            ))}
          <TambahAnggotaDialog tim={tim} />
        </div>
      ))}
    </div>
  );
}
