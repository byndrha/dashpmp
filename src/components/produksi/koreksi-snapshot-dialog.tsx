"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getSnapshotStokEsAction, koreksiSnapshotStokEsAction } from "@/app/mkesindo/produksi/actions";
import type { ShiftNumber } from "@/lib/report-shift";

export function KoreksiSnapshotDialog() {
  const [open, setOpen] = useState(false);
  const [tanggalUsaha, setTanggalUsaha] = useState("");
  const [shift, setShift] = useState<ShiftNumber | "">("");
  const [angkaLama, setAngkaLama] = useState<number | null | undefined>(undefined);
  const [qtyBaru, setQtyBaru] = useState("");
  const [alasan, setAlasan] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCekSnapshot() {
    if (!tanggalUsaha || !shift) return;
    setError(null);
    startTransition(async () => {
      const result = await getSnapshotStokEsAction(tanggalUsaha, shift as ShiftNumber);
      if (!result.success) {
        setError(result.error);
        setAngkaLama(undefined);
        return;
      }
      setAngkaLama(result.data);
    });
  }

  function handleSimpan() {
    if (!tanggalUsaha || !shift) return;
    setError(null);
    startTransition(async () => {
      const result = await koreksiSnapshotStokEsAction(tanggalUsaha, shift as ShiftNumber, Number(qtyBaru) || 0, alasan.trim());
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setTanggalUsaha("");
      setShift("");
      setAngkaLama(undefined);
      setQtyBaru("");
      setAlasan("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="h-7 text-xs" />}>Koreksi Riwayat Stok</DialogTrigger>
      <DialogContent className="flex max-w-sm flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Koreksi Snapshot Stok Es Historis</DialogTitle>
        </DialogHeader>
        <Input
          type="date"
          value={tanggalUsaha}
          onChange={(e) => {
            setTanggalUsaha(e.target.value);
            setAngkaLama(undefined);
          }}
          className="h-8 text-xs"
        />
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={shift}
          onChange={(e) => {
            setShift(e.target.value === "" ? "" : (Number(e.target.value) as ShiftNumber));
            setAngkaLama(undefined);
          }}
        >
          <option value="">Pilih Shift</option>
          <option value={1}>Shift 1</option>
          <option value={2}>Shift 2</option>
          <option value={3}>Shift 3</option>
        </select>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pending || !tanggalUsaha || !shift} onClick={handleCekSnapshot}>
          Cek Angka Saat Ini
        </Button>
        {angkaLama !== undefined && (
          <p className="text-xs text-muted-foreground">
            {angkaLama === null ? "Belum ada snapshot untuk shift ini." : `Angka saat ini: ${angkaLama} kantong 10kg.`}
          </p>
        )}
        <Input type="number" placeholder="Qty baru" value={qtyBaru} onChange={(e) => setQtyBaru(e.target.value)} className="h-8 text-xs" />
        <Input type="text" placeholder="Alasan (wajib)" value={alasan} onChange={(e) => setAlasan(e.target.value)} className="h-8 text-xs" />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" disabled={pending || !tanggalUsaha || !shift || !qtyBaru || !alasan.trim() || angkaLama == null} onClick={handleSimpan}>
          Simpan Koreksi
        </Button>
      </DialogContent>
    </Dialog>
  );
}
