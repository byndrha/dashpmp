"use client";

import { useEffect, useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createBatchAction,
  getRiwayatProduksiForPosisiAction,
  getKualitasRiwayatAction,
} from "@/app/mkesindo/produksi/actions";
import type { RiwayatProduksiRowWithNama } from "@/app/mkesindo/produksi/actions";
import { SHIFT_LABEL } from "@/lib/produksi-shift";
import { KAPASITAS_PALLET_10KG } from "@/lib/produksi-warehouse-constants";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
import type { KualitasRow } from "@/lib/queries/produksi-kualitas";

export function RiwayatPosisiList({ posisiId, open }: { posisiId: number; open: boolean }) {
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
              {r.Qty10KG} kantong 10kg
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
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  posisi: PalletPosisiRow | null;
  onSaved: () => void;
}) {
  // Tanggal/Jam/Shift/Mesin are no longer typed in here — explicit request:
  // picking a Pemeriksaan Kualitas record below carries all four along with
  // it (see CreateBatchInput's own comment), so a stock entry always traces
  // back to exactly when/who/which-machine it was produced under.
  const [kualitasList, setKualitasList] = useState<KualitasRow[] | null>(null);
  const [kualitasId, setKualitasId] = useState<string>("");
  const [qty10, setQty10] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sisaKapasitas = posisi ? KAPASITAS_PALLET_10KG - posisi.TotalSisaQty10KG : KAPASITAS_PALLET_10KG;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getKualitasRiwayatAction().then((result) => {
      if (cancelled) return;
      if (result.success) setKualitasList(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function reset() {
    setKualitasId("");
    setQty10("");
    setError(null);
  }

  function handleSubmit() {
    if (!posisi) return;
    setError(null);
    if (!kualitasId) {
      setError("Pilih Pemeriksaan Kualitas terkait.");
      return;
    }
    const qty10Num = Number(qty10) || 0;
    if (qty10Num <= 0) {
      setError("Isi jumlah kantong 10kg.");
      return;
    }
    if (qty10Num > sisaKapasitas) {
      setError(`Melebihi sisa kapasitas pallet ini (sisa ${sisaKapasitas} kantong).`);
      return;
    }
    startTransition(async () => {
      const result = await createBatchAction({
        kualitasId: Number(kualitasId),
        posisiId: posisi.PosisiID,
        qty10KG: qty10Num,
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
            {posisi && (
              <p className="text-xs text-muted-foreground">
                Terisi {posisi.TotalSisaQty10KG}/{KAPASITAS_PALLET_10KG} — sisa ruang {sisaKapasitas} kantong
              </p>
            )}
          </DialogHeader>


          {/* Pemeriksaan Kualitas terkait — replaces the old manual
              Tanggal/Jam/Shift/Mesin inputs (explicit request): picking one
              here carries all four along with it. */}
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">Pemeriksaan Kualitas Terkait</p>
            {kualitasList === null ? (
              <p className="py-4 text-center text-xs text-muted-foreground">Memuat riwayat...</p>
            ) : kualitasList.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                Belum ada Pemeriksaan Kualitas — catat dulu di tab Kualitas.
              </p>
            ) : (
              <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                {kualitasList.map((k) => {
                  const active = kualitasId === String(k.KualitasID);
                  const allPass = k.CekKejernihan && k.CekUkuranBentuk && k.CekKontaminasi && k.CekKemasan;
                  return (
                    <button
                      key={k.KualitasID}
                      type="button"
                      onClick={() => setKualitasId(String(k.KualitasID))}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-lg border p-2 text-left text-xs transition-colors",
                        "border-border hover:bg-muted/50",
                        active && "border-primary bg-primary/10"
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{k.MesinNama}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {new Date(k.TanggalLabel).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                          {" • "}
                          {k.Waktu}
                          {" • "}
                          {SHIFT_LABEL[k.Shift]}
                        </p>
                      </div>
                      {!allPass && (
                        <span className="shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                          Ada temuan
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
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
