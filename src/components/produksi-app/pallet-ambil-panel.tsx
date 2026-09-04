"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WarehouseCell } from "@/components/produksi/warehouse-cell";
import {
  produksiSelesaiMuatAction,
  getBatchAktifForAlokasiAction,
  getJadwalDetailForProduksiAction,
} from "@/app/mkesindo/produksi/actions";
import type { DraftJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import type { BatchAktifRow, PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
import type { JadwalDetailRow } from "@/lib/queries/pengiriman-jadwal";

// Satu pallet FISIK (satu PosisiID) bisa punya lebih dari satu batch aktif
// (badge "×N" di WarehouseCell) -- popover hanya menampilkan SATU angka
// gabungan untuk posisi itu (sesuai kenyataan fisik yang dilihat operator),
// fungsi ini yang membagi angka itu ke batch-batch di posisi tersebut
// secara FIFO (batch termalam duluan) sebelum dikirim ke
// produksiSelesaiMuatAction (yang tetap menerima daftar per-BatchID).
export function splitAlokasiFifo(
  posisiId: number,
  qtyDiminta: number,
  batchList: BatchAktifRow[]
): { batchId: number; qty10KG: number }[] {
  const batchesDiPosisi = batchList
    .filter((b) => b.PosisiID === posisiId)
    .sort((a, b) => {
      const tanggalA = new Date(a.TanggalLabel).toISOString().slice(0, 10);
      const tanggalB = new Date(b.TanggalLabel).toISOString().slice(0, 10);
      const waktuA = new Date(`${tanggalA}T${a.JamPanen}`).getTime();
      const waktuB = new Date(`${tanggalB}T${b.JamPanen}`).getTime();
      return waktuA - waktuB;
    });

  const hasil: { batchId: number; qty10KG: number }[] = [];
  let sisaDiminta = qtyDiminta;
  for (const batch of batchesDiPosisi) {
    if (sisaDiminta <= 0) break;
    const ambil = Math.min(sisaDiminta, batch.SisaQty10KG);
    if (ambil > 0) {
      hasil.push({ batchId: batch.BatchID, qty10KG: ambil });
      sisaDiminta -= ambil;
    }
  }
  return hasil;
}

interface AlokasiPosisiState {
  [posisiId: number]: number;
}

// Dipanggil TANPA SYARAT di WarehouseView (aturan Hooks React), dijaga di
// dalam sendiri lewat null-check `jadwal` -- supaya WarehouseView tidak
// perlu memanggil hook ini secara kondisional. Setiap kali `jadwal` berganti
// identitas (termasuk dari ada -> null saat sesi ditutup), seluruh state
// sesi di-reset -- WarehouseView sendiri tidak remount di antara sesi.
export function usePalletAmbilStok(jadwal: DraftJadwalForProduksi | null, onDone: () => void) {
  const [batchList, setBatchList] = useState<BatchAktifRow[] | null>(null);
  const [alokasiPosisi, setAlokasiPosisi] = useState<AlokasiPosisiState>({});
  const [qty5Dimuat, setQty5Dimuat] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmDetail, setConfirmDetail] = useState<JadwalDetailRow[] | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBatchList(null);
    setAlokasiPosisi({});
    setQty5Dimuat(jadwal ? String(jadwal.Qty5KGDibutuhkan) : "0");
    setError(null);
    setConfirmDetail(null);
    if (!jadwal) return;
    getBatchAktifForAlokasiAction().then((result) => {
      if (result.success) setBatchList(result.data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jadwal?.JadwalID]);

  const sisaPerPosisi = new Map<number, number>();
  for (const b of batchList ?? []) {
    sisaPerPosisi.set(b.PosisiID, (sisaPerPosisi.get(b.PosisiID) ?? 0) + b.SisaQty10KG);
  }
  const fifoFrontPosisiId = batchList && batchList.length > 0 ? batchList[0].PosisiID : null;

  const totalQty10 = Object.values(alokasiPosisi).reduce((sum, q) => sum + q, 0);
  const qty5Num = Number(qty5Dimuat) || 0;
  const cukup = jadwal != null && totalQty10 >= jadwal.Qty10KGDibutuhkan && qty5Num >= jadwal.Qty5KGDibutuhkan;

  function setAmbilUntukPosisi(posisiId: number, value: number) {
    const max = sisaPerPosisi.get(posisiId) ?? 0;
    setAlokasiPosisi((prev) => ({ ...prev, [posisiId]: Math.min(Math.max(0, value), max) }));
  }

  function handleOpenConfirm() {
    if (!jadwal) return;
    setError(null);
    setConfirmLoading(true);
    getJadwalDetailForProduksiAction(jadwal.JadwalID).then((result) => {
      setConfirmLoading(false);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setConfirmDetail(result.data);
    });
  }

  function handleConfirmYa() {
    if (!jadwal || !batchList) return;
    const alokasiList = Object.entries(alokasiPosisi).flatMap(([posisiId, qty]) =>
      qty > 0 ? splitAlokasiFifo(Number(posisiId), qty, batchList) : []
    );
    startTransition(async () => {
      const result = await produksiSelesaiMuatAction({
        jadwalId: jadwal.JadwalID,
        alokasi: alokasiList,
        qty5KGDimuat: qty5Num,
      });
      if (!result.success) {
        setConfirmDetail(null);
        setError(result.error);
        return;
      }
      onDone();
    });
  }

  return {
    batchList,
    sisaPerPosisi,
    fifoFrontPosisiId,
    alokasiPosisi,
    qty5Dimuat,
    setQty5Dimuat,
    totalQty10,
    cukup,
    error,
    pending,
    confirmDetail,
    confirmLoading,
    setAmbilUntukPosisi,
    handleOpenConfirm,
    handleConfirmYa,
    closeConfirm: () => setConfirmDetail(null),
  };
}

export function PalletCellAmbilPopover({
  kode,
  row,
  pallet,
  open,
  onOpenChange,
}: {
  kode: string;
  row: PalletPosisiRow | undefined;
  pallet: ReturnType<typeof usePalletAmbilStok>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const terisi = (row?.JumlahBatchAktif ?? 0) > 0;
  if (!terisi || !row) {
    // Dark overlay for empty pallets during an active Mulai Muat session --
    // only pallets that actually have stock stay fully "lit" and clickable
    // (see WarehouseView/TruckDockColumn for the same treatment applied to
    // the rest of the screen).
    return (
      <div className="relative">
        <WarehouseCell kode={kode} row={row} disabled />
        <div className="pointer-events-none absolute inset-0 rounded-md bg-black/60" />
      </div>
    );
  }

  const posisiId = row.PosisiID;
  const max = pallet.sisaPerPosisi.get(posisiId) ?? 0;
  const nilai = pallet.alokasiPosisi[posisiId] ?? 0;
  const highlighted = pallet.fifoFrontPosisiId === posisiId;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<span className="contents" />}>
        <WarehouseCell kode={kode} row={row} highlighted={highlighted} />
      </PopoverTrigger>
      <PopoverContent className="w-48">
        <p className="text-xs font-medium">
          Pallet {kode}
          {highlighted && <span className="ml-1 text-amber-600">· Paling lama</span>}
        </p>
        {nilai > 0 && <p className="text-xs font-medium text-primary">Dialokasikan: {nilai}</p>}
        <p className="text-xs text-muted-foreground">Sisa: {max - nilai} kantong 10kg</p>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={nilai || ""}
            placeholder="0"
            onChange={(e) => pallet.setAmbilUntukPosisi(posisiId, Number(e.target.value))}
            className="h-8"
          />
          <Button size="sm" onClick={() => onOpenChange(false)}>
            OK
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FloatingAmbilPanel({
  jadwal,
  pallet,
  onBatal,
}: {
  jadwal: DraftJadwalForProduksi;
  pallet: ReturnType<typeof usePalletAmbilStok>;
  onBatal: () => void;
}) {
  return (
    <div className="sticky bottom-0 left-0 right-0 z-20 flex flex-col gap-2 border-t border-border bg-background p-3 shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
      <p className="text-sm font-semibold">{jadwal.ArmadaNama}</p>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-2xl font-bold tabular-nums text-primary">{pallet.totalQty10}</span>
        <span className="text-sm text-muted-foreground">/ {jadwal.Qty10KGDibutuhkan} kantong 10kg dialokasikan</span>
      </div>
      {jadwal.Qty5KGDibutuhkan > 0 && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Qty 5kg dimuat (tanpa pallet, langsung)</label>
          <Input type="number" value={pallet.qty5Dimuat} onChange={(e) => pallet.setQty5Dimuat(e.target.value)} className="mt-1 h-8" />
        </div>
      )}
      {pallet.error && <p className="text-xs text-destructive">{pallet.error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={onBatal}>
          Batal
        </Button>
        <Button size="sm" className="flex-1" disabled={!pallet.cukup || pallet.confirmLoading} onClick={pallet.handleOpenConfirm}>
          {pallet.confirmLoading ? "Memuat..." : "Selesai Muat"}
        </Button>
      </div>

      <Dialog open={pallet.confirmDetail != null} onOpenChange={(open) => !open && !pallet.pending && pallet.closeConfirm()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Selesaikan Muat?</DialogTitle>
          </DialogHeader>
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            <p className="text-sm text-muted-foreground">
              Muatan akan dikunci dan Surat Jalan/Invoice diterbitkan untuk tujuan berikut:
            </p>
            {pallet.confirmDetail?.map((d) => (
              <div key={d.JadwalDetailID} className="rounded-md border border-border p-2 text-sm">
                <p className="font-medium">{d.CustomerName}</p>
                <p className="text-xs text-muted-foreground">
                  {d.Qty10KG} kantong 10kg, {d.Qty5KG} kantong 5kg
                </p>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={pallet.pending} onClick={pallet.closeConfirm}>
              Tidak
            </Button>
            <Button disabled={pallet.pending} onClick={pallet.handleConfirmYa}>
              {pallet.pending ? "Memproses..." : "Ya, Selesai Muat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
