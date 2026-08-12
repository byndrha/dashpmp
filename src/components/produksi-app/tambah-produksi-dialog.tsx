"use client";

import { useEffect, useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { createBatchAction, getRiwayatProduksiForPosisiAction } from "@/app/mkesindo/produksi/actions";
import type { RiwayatProduksiRowWithNama } from "@/app/mkesindo/produksi/actions";
import { getBusinessDateISO } from "@/lib/business-date";
import { SHIFT_LABEL } from "@/lib/produksi-shift";
import { STATUS_MESIN_LABEL } from "@/lib/produksi-mesin-status";
import type { MesinRow } from "@/lib/queries/produksi-mesin";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";

const SHIFT_OPTIONS = [1, 2, 3] as const;

function RiwayatPosisiList({ posisiId, open }: { posisiId: number; open: boolean }) {
  const [riwayat, setRiwayat] = useState<{ posisiId: number; rows: RiwayatProduksiRowWithNama[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getRiwayatProduksiForPosisiAction(posisiId).then((result) => {
      if (cancelled) return;
      if (result.success) setRiwayat({ posisiId, rows: result.data });
    });
    return () => {
      cancelled = true;
    };
  }, [open, posisiId]);

  if (!open) return null;

  const rows = riwayat && riwayat.posisiId === posisiId ? riwayat.rows : null;

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-2.5">
      <p className="text-xs font-semibold text-muted-foreground">Riwayat Produksi Pallete Ini</p>
      {rows === null ? (
        <p className="text-xs text-muted-foreground">Memuat...</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Belum ada riwayat.</p>
      ) : (
        <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
          {rows.map((r) => (
            <p key={r.BatchID} className="text-[11px] text-muted-foreground">
              {new Date(r.TanggalLabel).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
              {" — Shift "}
              {r.Shift}
              {" — "}
              {r.JamPanen}
              {" — "}
              {r.MesinNama}
              {" — "}
              {r.Qty10KG}-{r.Qty5KG}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

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
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <div className="flex flex-col gap-3">
          {posisi && <RiwayatPosisiList posisiId={posisi.PosisiID} open={open} />}
          <DialogHeader>
            <DialogTitle>Tambah Produksi — Pallete {posisi?.Kode}</DialogTitle>
          </DialogHeader>


          <div className="grid grid-cols-[135px_128px_98px] gap-0">
            <div>
              <Input type="date" value={tanggalLabel} onChange={(e) => setTanggalLabel(e.target.value)} />
            </div>
            <div>
              <Select value={shift} onValueChange={(v) => setShift(v ?? "1")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Shift">{(v: string) => SHIFT_LABEL[Number(v) as 1 | 2 | 3]}</SelectValue>
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
              <Input type="time" value={jamPanen} onChange={(e) => setJamPanen(e.target.value)} />
            </div>
          </div>

          <div>
            <div className="grid grid-cols-3 gap-2">
              {mesinList.map((m) => {
                const disabled = m.Status !== "AKTIF";
                const active = mesinId === String(m.MesinID);
                return (
                  <button
                    key={m.MesinID}
                    type="button"
                    disabled={disabled}
                    onClick={() => setMesinId(String(m.MesinID))}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-lg border p-2 text-left text-xs transition-colors",
                      disabled ? "cursor-not-allowed border-border bg-muted/40 opacity-50" : "border-border hover:bg-muted/50",
                      active && !disabled && "border-primary bg-primary/10"
                    )}
                  >
                    <span className="font-semibold">{m.Nama}</span>
                    <span
                      className={cn(
                        "text-[10px] font-medium",
                        m.Status === "AKTIF" ? "text-emerald-600" : m.Status === "MAINTENANCE" ? "text-amber-600" : "text-destructive"
                      )}
                    >
                      {STATUS_MESIN_LABEL[m.Status]}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{m.KapasitasProduksiPerHari} kantong/hari</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="relative">
              <Input
                type="number"
                value={qty10}
                onChange={(e) => setQty10(e.target.value)}
                className="pr-12"
              />
              <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground">
                10KG
              </span>
            </div>
          </div>

          <div>
            <div className="relative">
              <Input
                type="number"
                value={qty5}
                onChange={(e) => setQty5(e.target.value)}
                className="pr-12"
              />
              <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground">
                5KG
              </span>
            </div>
          </div>

          <div className="flex flex-col justify-end">
            <Button disabled={pending} onClick={handleSubmit}>
              {pending ? "..." : "Simpan"}
            </Button>
          </div>
        </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
