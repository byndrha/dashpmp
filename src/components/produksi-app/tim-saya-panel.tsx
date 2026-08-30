"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { tambahAnggotaTimSayaAction, hapusAnggotaTimSayaAction } from "@/app/mkesindo/produksi/actions";
import type { AnggotaTimRow } from "@/lib/queries/tim-produksi";

export function TimSayaPanel({
  timNama,
  anggota,
  onChanged,
}: {
  timNama: string;
  anggota: AnggotaTimRow[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [nama, setNama] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleTambah() {
    if (!nama.trim()) {
      setError("Nama tidak boleh kosong.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await tambahAnggotaTimSayaAction(nama.trim());
      if (!result.success) {
        setError(result.error);
        return;
      }
      setNama("");
      setOpen(false);
      onChanged();
    });
  }

  function handleNonaktifkan(anggotaId: number, namaAnggota: string) {
    if (!confirm(`Nonaktifkan ${namaAnggota} dari ${timNama}?`)) return;
    startTransition(async () => {
      const result = await hapusAnggotaTimSayaAction(anggotaId);
      if (result.success) onChanged();
    });
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Tim Saya — {timNama}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {anggota.map((a) => (
          <div key={a.anggotaId} className="flex items-center justify-between rounded-md border border-border px-2 py-1.5 text-sm">
            <span>{a.nama}</span>
            <button
              type="button"
              onClick={() => handleNonaktifkan(a.anggotaId, a.nama)}
              disabled={pending}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-2 text-sm text-muted-foreground hover:bg-muted/50">
            <Plus className="size-4" /> Tambah Anggota
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Tambah Anggota — {timNama}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Nama anggota" />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button disabled={pending} onClick={handleTambah}>
                {pending ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
