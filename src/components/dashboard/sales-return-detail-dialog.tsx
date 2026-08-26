"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatDate, formatRupiah } from "@/lib/format";
import { getSalesReturnDetailAction } from "@/app/mkesindo/(dashboard)/pemesanan/actions";
import type { SalesReturnDetail } from "@/lib/queries/pemesanan";

// Popup opened from the "Lihat SR" icon on /mkesindo/pemesanan's row list —
// shows what was actually returned on a stop-delivery confirmation. Takes
// the raw internal SalesReturnID directly (not a signed/public token like
// SI's) since this is purely an authenticated internal view, never shared
// outside the dashboard.
export function SalesReturnDetailDialog({
  salesReturnId,
  onOpenChange,
}: {
  // Null closes the dialog — same open-via-prop convention
  // StopSalesInvoiceDialog already uses.
  salesReturnId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = useState<SalesReturnDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!salesReturnId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null);
      return;
    }
    setLoading(true);
    getSalesReturnDetailAction(salesReturnId).then((result) => {
      setDetail(result);
      setLoading(false);
    });
  }, [salesReturnId]);

  return (
    <Dialog open={salesReturnId != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>SR{detail ? ` — ${detail.CustomerName}` : ""}</DialogTitle>
          <DialogDescription className="sr-only">Detail item yang diretur pada pengiriman ini.</DialogDescription>
        </DialogHeader>

        {loading && <p className="py-6 text-center text-sm text-muted-foreground">Memuat...</p>}
        {!loading && !detail && <p className="py-6 text-center text-sm text-muted-foreground">SR tidak ditemukan.</p>}

        {!loading && detail && (
          <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto text-sm">
            <div>
              <p className="font-medium">{detail.VoucherNo}</p>
              <p className="text-xs text-muted-foreground">{formatDate(detail.TransDate)}</p>
            </div>
            {detail.Lines.map((line, i) => (
              <div key={i} className="flex items-center justify-between border-b pb-1.5 text-xs">
                <span>
                  {line.Name} x{line.Qty.toLocaleString("id-ID")} {line.Unit}
                </span>
                <span className="tabular-nums">{formatRupiah(line.Amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t pt-2 font-medium">
              <span>TOTAL RETUR</span>
              <span className="tabular-nums">{formatRupiah(detail.Amount)}</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
