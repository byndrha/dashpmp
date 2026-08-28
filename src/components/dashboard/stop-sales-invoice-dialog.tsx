"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDateWib, formatRupiah } from "@/lib/format";
import { getSalesInvoiceForViewAction, enqueueManualReprintAction } from "@/app/mkesindo/(dashboard)/delivery/actions";
import { triggerPrintQueuePollNow } from "@/components/dashboard/print-queue-poller";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";
import type { PublicInvoice } from "@/lib/queries/invoice-public";

// Popup opened from the "Lihat SI" icon that replaced the old standalone
// reprint icon in RouteValidationDialog's SortableStopRow — shows the
// SalesInvoice's content (reusing the same getInvoiceByToken/PublicInvoice
// shape the public /mkesindo/invoice/[token] page already renders) plus a
// reprint button, so viewing and reprinting share one entry point instead
// of two separate icons.
export function StopSalesInvoiceDialog({
  detail,
  onOpenChange,
}: {
  // Null closes the dialog — same open-via-prop convention
  // StopDeliveryProofDialog already uses.
  detail: DriverStopRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [loading, setLoading] = useState(false);
  const [reprinting, startTransition] = useTransition();

  useEffect(() => {
    if (!detail?.InvoiceToken) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInvoice(null);
      return;
    }
    setLoading(true);
    getSalesInvoiceForViewAction(detail.InvoiceToken).then((result) => {
      setInvoice(result.success ? result.data : null);
      setLoading(false);
    });
  }, [detail]);

  function handleReprint() {
    if (!detail) return;
    startTransition(async () => {
      const result = await enqueueManualReprintAction(detail.JadwalDetailID);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("SI ditambahkan ke antrian cetak.");
      triggerPrintQueuePollNow();
    });
  }

  return (
    <Dialog open={detail != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>SI{detail ? ` — ${detail.CustomerName}` : ""}</DialogTitle>
          <DialogDescription className="sr-only">Isi SalesInvoice untuk tujuan ini, dan tombol cetak ulang.</DialogDescription>
        </DialogHeader>

        {loading && <p className="py-6 text-center text-sm text-muted-foreground">Memuat...</p>}
        {!loading && !invoice && <p className="py-6 text-center text-sm text-muted-foreground">SI tidak ditemukan.</p>}

        {!loading && invoice && (
          <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto text-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{invoice.VoucherNo}</p>
                <p className="text-xs text-muted-foreground">{formatDateWib(invoice.TransDate)}</p>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={handleReprint} disabled={reprinting}>
                <Printer className="size-3.5" /> Cetak Ulang
              </Button>
            </div>
            {invoice.Delivery?.Lines.map((line, i) => (
              <div key={i} className="flex items-center justify-between border-b pb-1.5 text-xs">
                <span>
                  {line.Name} x{line.Qty}
                </span>
                <span className="tabular-nums">{formatRupiah(line.Amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t pt-2 font-medium">
              <span>TOTAL</span>
              <span className="tabular-nums">{formatRupiah(invoice.Netto)}</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
