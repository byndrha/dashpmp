"use client";

import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, formatTime } from "@/lib/format";

export function BerhasilStep({ salesInvoiceId, onSelesai }: { salesInvoiceId: string | null; onSelesai: () => void }) {
  const now = new Date();
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <CheckCircle2 className="size-16 text-green-600" />
      <h1 className="font-display text-xl font-semibold">Pengiriman Berhasil</h1>
      <p className="text-sm text-muted-foreground">
        {salesInvoiceId ? "Transaksi untuk lokasi ini telah selesai." : "Pengiriman telah dikonfirmasi tanpa penagihan."}
      </p>
      <div className="w-full rounded-lg border border-border p-3 text-left text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Waktu</span>
          <span>
            {formatDate(now)}, {formatTime(now)}
          </span>
        </div>
      </div>
      <Button className="w-full" onClick={onSelesai}>
        Selesai &amp; Kembali ke Tugas
      </Button>
    </div>
  );
}
