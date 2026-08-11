"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createBatchAction } from "@/app/mkesindo/produksi/actions";
import { getBusinessDateISO } from "@/lib/business-date";
import { SHIFT_LABEL } from "@/lib/produksi-shift";
import type { MesinRow } from "@/lib/queries/produksi-mesin";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";

const SHIFT_OPTIONS = [1, 2, 3] as const;

export function TambahProduksiDialog({
  open,
  onOpenChange,
  posisi,
  mesinList,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  posisi: PalletPosisiRow | null;
  mesinList: MesinRow[];
  onSaved: () => void;
}) {
  const [tanggalLabel, setTanggalLabel] = useState(() => getBusinessDateISO());
  const [shift, setShift] = useState<string>("1");
  const [mesinId, setMesinId] = useState<string>("");
  const [jamPanen, setJamPanen] = useState("");
  const [qty10, setQty10] = useState("");
  const [qty5, setQty5] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setTanggalLabel(getBusinessDateISO());
    setShift("1");
    setMesinId("");
    setJamPanen("");
    setQty10("");
    setQty5("");
    setError(null);
  }

  function handleSubmit() {
    if (!posisi) return;
    setError(null);
    if (!mesinId) {
      setError("Pilih mesin yang dipakai.");
      return;
    }
    if (!jamPanen) {
      setError("Isi jam panen.");
      return;
    }
    if ((Number(qty10) || 0) <= 0 && (Number(qty5) || 0) <= 0) {
      setError("Isi jumlah kantong 10kg atau 5kg minimal satu.");
      return;
    }
    startTransition(async () => {
      const result = await createBatchAction({
        tanggalLabel,
        shift: Number(shift) as 1 | 2 | 3,
        mesinId: Number(mesinId),
        posisiId: posisi.PosisiID,
        jamPanen,
        qty10KG: Number(qty10) || 0,
        qty5KG: Number(qty5) || 0,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      reset();
      onSaved();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah Produksi — Slot {posisi?.Kode}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <Label>Tanggal Produksi</Label>
            <Input type="date" value={tanggalLabel} onChange={(e) => setTanggalLabel(e.target.value)} />
          </div>
          <div>
            <Label>Shift</Label>
            <Select value={shift} onValueChange={(v) => setShift(v ?? "1")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pilih shift">{(v: string) => SHIFT_LABEL[Number(v) as 1 | 2 | 3]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SHIFT_OPTIONS.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {SHIFT_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Mesin yang Dipakai</Label>
            <Select value={mesinId} onValueChange={(v) => setMesinId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pilih mesin">
                  {(v: string) => mesinList.find((m) => String(m.MesinID) === v)?.Nama ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {mesinList.map((m) => (
                  <SelectItem key={m.MesinID} value={String(m.MesinID)}>
                    {m.Nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Jam Panen</Label>
            <Input type="time" value={jamPanen} onChange={(e) => setJamPanen(e.target.value)} />
          </div>
          <div>
            <Label>Jumlah Kantong 10kg</Label>
            <Input type="number" value={qty10} onChange={(e) => setQty10(e.target.value)} />
          </div>
          <div>
            <Label>Jumlah Kantong 5kg</Label>
            <Input type="number" value={qty5} onChange={(e) => setQty5(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button disabled={pending} onClick={handleSubmit}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
