"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { updateSalesOrderTransDateAction } from "@/app/(dashboard)/pemesanan/actions";

export interface UbahTanggalPemesananTarget {
  salesOrderId: string;
  customerName: string;
  voucherNo: string;
  transDate: string | Date;
}

// Separate from UbahPemesananDialog (which edits scheduling — armada/waktu/
// driver on the linked Jadwal — and is hidden once Status is Terbit). This
// edits SalesOrder.TransDate itself, which reschedulePemesanan never
// touched. Exists specifically for already-Terbit orders: once an SO has
// shipped, Ubah Pemesanan's own edit path disappears, leaving no way to
// correct a wrong TransDate (routinely bumped by same-day desktop-ERP
// edits — see assertJamJadwalNotBeforeOrders's comment in
// pengiriman-jadwal.ts) without this.
export function UbahTanggalPemesananDialog({
  target,
  onOpenChange,
}: {
  target: UbahTanggalPemesananTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("00:00");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!target) return;
    const d = new Date(target.transDate);
    // Syncs the editable date/time fields to the newly-opened target — not
    // derivable from render since these are user-editable picker fields.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    setError(null);
  }, [target]);

  const canSubmit = !!target && !!date;

  function handleSubmit() {
    if (!target || !canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        await updateSalesOrderTransDateAction(target.salesOrderId, new Date(`${date}T${time}:00`));
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal mengubah tanggal pemesanan.");
      }
    });
  }

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Ubah Tanggal Pemesanan</DialogTitle>
          <DialogDescription>
            Mengubah tanggal &amp; jam pemesanan (TransDate) langsung pada SO ini — dipakai untuk memperbaiki tanggal
            yang salah pada SO yang sudah terbit.
          </DialogDescription>
        </DialogHeader>

        {target && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              <p className="font-medium">{target.customerName}</p>
              <p className="text-muted-foreground">{target.voucherNo}</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ubah-transdate-tanggal" className="sr-only">
                  Tanggal
                </Label>
                <Input id="ubah-transdate-tanggal" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ubah-transdate-jam" className="sr-only">
                  Jam
                </Label>
                <Input id="ubah-transdate-jam" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button disabled={!canSubmit || pending} onClick={handleSubmit}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
