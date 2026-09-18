"use client";

import { useState, useTransition } from "react";
import { Package, Zap, Timer, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateMesinAction } from "@/app/mkesindo/produksi/actions";
import { STATUS_MESIN_LABEL, type StatusMesin } from "@/lib/produksi-mesin-status";
import type { MesinRow } from "@/lib/queries/produksi-mesin";

const STATUS_OPTIONS: StatusMesin[] = ["AKTIF", "MAINTENANCE", "RUSAK"];

const STATUS_BADGE_CLASS: Record<StatusMesin, string> = {
  AKTIF: "bg-emerald-500/15 text-emerald-600",
  MAINTENANCE: "bg-amber-500/15 text-amber-600",
  RUSAK: "bg-destructive/15 text-destructive",
};

export function PanelMesin({ mesinList }: { mesinList: MesinRow[] }) {
  // Tampilkan Mesin 3 -> 2 -> 1 (kebalikan urutan query yang ascending
  // MesinID) sesuai permintaan user 2026-09-19 -- murni urutan tampil,
  // tidak mengubah ORDER BY di query supaya konsumen getMesinList lain
  // (produksi-app, laporan-shift-detail) tidak ikut terdampak.
  const urutanTampil = [...mesinList].reverse();
  return (
    <div className="flex flex-wrap gap-3">
      {urutanTampil.map((mesin) => (
        <MesinCard key={mesin.MesinID} mesin={mesin} />
      ))}
    </div>
  );
}

function MesinCard({ mesin }: { mesin: MesinRow }) {
  const [open, setOpen] = useState(false);
  const [nama, setNama] = useState(mesin.Nama);
  const [status, setStatus] = useState<StatusMesin>(mesin.Status);
  const [kapasitas, setKapasitas] = useState(String(mesin.KapasitasProduksiPerHari));
  const [listrik, setListrik] = useState(String(mesin.KonsumsiListrikKWh));
  const [lamaProduksi, setLamaProduksi] = useState(String(mesin.LamaProduksiMenit));
  const [lamaKemas, setLamaKemas] = useState(String(mesin.LamaPengemasanMenit));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateMesinAction({
        mesinId: mesin.MesinID,
        nama,
        status,
        kapasitasProduksiPerHari: Number(kapasitas),
        konsumsiListrikKWh: Number(listrik),
        lamaProduksiMenit: Number(lamaProduksi),
        lamaPengemasanMenit: Number(lamaKemas),
      });
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
          // MesinCard stays mounted across open/close cycles (keyed by
          // MesinID, not remounted), so abandoned edits from a previous
          // open that was dismissed without saving (X button, Escape,
          // backdrop click) would otherwise still be sitting in state the
          // next time the dialog opens. Reseed from the live `mesin` prop
          // every time it opens so it always starts from the true current
          // values.
          setNama(mesin.Nama);
          setStatus(mesin.Status);
          setKapasitas(String(mesin.KapasitasProduksiPerHari));
          setListrik(String(mesin.KonsumsiListrikKWh));
          setLamaProduksi(String(mesin.LamaProduksiMenit));
          setLamaKemas(String(mesin.LamaPengemasanMenit));
          setError(null);
        }
      }}
    >
      <DialogTrigger className="rounded-lg border border-border bg-background p-3 text-left text-sm hover:bg-muted/50">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">{mesin.Nama}</p>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE_CLASS[mesin.Status]}`}>
            {STATUS_MESIN_LABEL[mesin.Status]}
          </span>
        </div>
        <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1" title="Kapasitas Produksi">
            <Package className="size-3.5" />
            {mesin.KapasitasProduksiPerHari}/hari
          </span>
          <span className="flex items-center gap-1" title="Konsumsi Listrik">
            <Zap className="size-3.5" />
            {mesin.KonsumsiListrikKWh} kWh
          </span>
          <span className="flex items-center gap-1" title="Lama Produksi">
            <Timer className="size-3.5" />
            {mesin.LamaProduksiMenit} mnt
          </span>
          <span className="flex items-center gap-1" title="Lama Pengemasan">
            <PackageCheck className="size-3.5" />
            {mesin.LamaPengemasanMenit} mnt
          </span>
        </div>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ubah Data Mesin</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Nama</Label>
            <Input value={nama} onChange={(e) => setNama(e.target.value)} />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus((v as StatusMesin) ?? "AKTIF")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pilih status">{(v: string) => STATUS_MESIN_LABEL[v as StatusMesin]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_MESIN_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Kapasitas Produksi (kantong/hari)</Label>
            <Input type="number" value={kapasitas} onChange={(e) => setKapasitas(e.target.value)} />
          </div>
          <div>
            <Label>Konsumsi Listrik (kWh)</Label>
            <Input type="number" value={listrik} onChange={(e) => setListrik(e.target.value)} />
          </div>
          <div>
            <Label>Lama Produksi (menit)</Label>
            <Input type="number" value={lamaProduksi} onChange={(e) => setLamaProduksi(e.target.value)} />
          </div>
          <div>
            <Label>Lama Pengemasan (menit)</Label>
            <Input type="number" value={lamaKemas} onChange={(e) => setLamaKemas(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleSave} disabled={pending}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
