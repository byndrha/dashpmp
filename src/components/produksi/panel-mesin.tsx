"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { updateMesinAction } from "@/app/mkesindo/produksi/actions";
import type { MesinRow } from "@/lib/queries/produksi-mesin";

export function PanelMesin({ mesinList }: { mesinList: MesinRow[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {mesinList.map((mesin) => (
        <MesinCard key={mesin.MesinID} mesin={mesin} />
      ))}
    </div>
  );
}

function MesinCard({ mesin }: { mesin: MesinRow }) {
  const [open, setOpen] = useState(false);
  const [nama, setNama] = useState(mesin.Nama);
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
          setKapasitas(String(mesin.KapasitasProduksiPerHari));
          setListrik(String(mesin.KonsumsiListrikKWh));
          setLamaProduksi(String(mesin.LamaProduksiMenit));
          setLamaKemas(String(mesin.LamaPengemasanMenit));
          setError(null);
        }
      }}
    >
      <DialogTrigger className="rounded-lg border border-border p-3 text-left text-sm hover:bg-muted/50">
        <p className="font-semibold">{mesin.Nama}</p>
        <p className="text-xs text-muted-foreground">Kapasitas: {mesin.KapasitasProduksiPerHari} kantong/hari</p>
        <p className="text-xs text-muted-foreground">Listrik: {mesin.KonsumsiListrikKWh} kWh</p>
        <p className="text-xs text-muted-foreground">Produksi: {mesin.LamaProduksiMenit} menit</p>
        <p className="text-xs text-muted-foreground">Kemas: {mesin.LamaPengemasanMenit} menit</p>
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
