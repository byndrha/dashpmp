"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createBatchAction } from "@/app/mkesindo/produksi/actions";
import { getBusinessDateISO } from "@/lib/business-date";
import { SHIFT_LABEL } from "@/lib/queries/produksi-warehouse";
import type { MesinRow } from "@/lib/queries/produksi-mesin";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";

const SHIFT_OPTIONS = [1, 2, 3] as const;

export function ProduksiBaruForm({
  mesinList,
  posisi,
  onAfterSimpan,
}: {
  mesinList: MesinRow[];
  posisi: PalletPosisiRow[];
  onAfterSimpan: () => void;
}) {
  const [tanggalLabel, setTanggalLabel] = useState(() => getBusinessDateISO());
  const [shift, setShift] = useState<string>("1");
  const [mesinId, setMesinId] = useState<string>("");
  const [posisiId, setPosisiId] = useState<string>("");
  const [qty10, setQty10] = useState("");
  const [qty5, setQty5] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  const posisiKosong = posisi.filter((p) => p.BatchIDAktif == null);

  function handleSubmit() {
    setError(null);
    setSuccess(false);
    if (!tanggalLabel) {
      setError("Isi tanggal produksi.");
      return;
    }
    if (!shift) {
      setError("Pilih shift.");
      return;
    }
    if (!mesinId) {
      setError("Pilih mesin yang dipakai.");
      return;
    }
    if (!posisiId) {
      setError("Pilih posisi pallet.");
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
        posisiId: Number(posisiId),
        qty10KG: Number(qty10) || 0,
        qty5KG: Number(qty5) || 0,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSuccess(true);
      setQty10("");
      setQty5("");
      setPosisiId("");
      onAfterSimpan();
    });
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <Label>Tanggal Produksi</Label>
        <Input type="date" value={tanggalLabel} onChange={(e) => setTanggalLabel(e.target.value)} />
      </div>

      <div>
        <Label>Shift</Label>
        <Select value={shift} onValueChange={(v) => setShift(v ?? "1")}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pilih shift">
              {(v: string) => SHIFT_LABEL[Number(v) as 1 | 2 | 3]}
            </SelectValue>
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
        <Label>Jumlah Kantong 10kg</Label>
        <Input type="number" value={qty10} onChange={(e) => setQty10(e.target.value)} />
      </div>
      <div>
        <Label>Jumlah Kantong 5kg</Label>
        <Input type="number" value={qty5} onChange={(e) => setQty5(e.target.value)} />
      </div>

      <div>
        <Label>Posisi Pallet Kosong</Label>
        <div className="mt-1 grid grid-cols-4 gap-2">
          {posisiKosong.map((p) => (
            <button
              key={p.PosisiID}
              type="button"
              onClick={() => setPosisiId(String(p.PosisiID))}
              className={
                String(p.PosisiID) === posisiId
                  ? "rounded-md border-2 border-primary bg-primary/10 py-2 text-sm font-semibold"
                  : "rounded-md border border-border py-2 text-sm"
              }
            >
              {p.Kode}
            </button>
          ))}
        </div>
        {posisiKosong.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">Tidak ada posisi pallet kosong saat ini.</p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-emerald-600">Produksi baru berhasil dicatat.</p>}
      <Button disabled={pending} onClick={handleSubmit}>
        {pending ? "Menyimpan..." : "Simpan"}
      </Button>
    </div>
  );
}
