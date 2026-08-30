"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SHIFT_LABEL } from "@/lib/produksi-shift";
import { tambahAnggotaTimAction, updateAnggotaTimAction, hapusAnggotaTimAction } from "@/app/mkesindo/produksi/actions";
import type { AnggotaTimRow } from "@/lib/queries/tim-produksi";

const SHIFTS = [1, 2, 3] as const;

function AnggotaCard({ anggota }: { anggota: AnggotaTimRow }) {
  const [open, setOpen] = useState(false);
  const [nama, setNama] = useState(anggota.nama);
  const [shift, setShift] = useState<1 | 2 | 3>(anggota.shift);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateAnggotaTimAction(anggota.anggotaId, { nama, shift });
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
          setShift(anggota.shift);
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
            <Label>Tim (Shift)</Label>
            <Select value={String(shift)} onValueChange={(v) => setShift((Number(v) as 1 | 2 | 3) ?? shift)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIFTS.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {SHIFT_LABEL[s]}
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

function TambahAnggotaDialog({ shift }: { shift: 1 | 2 | 3 }) {
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
      const result = await tambahAnggotaTimAction(shift, nama.trim());
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
          <DialogTitle>Tambah Anggota — {SHIFT_LABEL[shift]}</DialogTitle>
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

export function PanelTimProduksi({ anggotaList }: { anggotaList: AnggotaTimRow[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {SHIFTS.map((shift) => (
        <div key={shift} className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p className="text-sm font-semibold">{SHIFT_LABEL[shift]}</p>
          {anggotaList
            .filter((a) => a.shift === shift)
            .map((a) => (
              <AnggotaCard key={a.anggotaId} anggota={a} />
            ))}
          <TambahAnggotaDialog shift={shift} />
        </div>
      ))}
    </div>
  );
}
