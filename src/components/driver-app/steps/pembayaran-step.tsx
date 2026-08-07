"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatRupiah } from "@/lib/format";
import { getInvoiceOutstandingAction, recordDriverPaymentAction } from "@/app/driver-app/actions";

export function PembayaranStep({
  salesInvoiceId,
  businessPartnerId,
  onDone,
}: {
  salesInvoiceId: string;
  businessPartnerId: string;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getInvoiceOutstandingAction(businessPartnerId, salesInvoiceId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setAmount(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [businessPartnerId, salesInvoiceId]);

  async function handleTunai() {
    if (amount == null) return;
    setError(null);
    setSubmitting(true);
    const result = await recordDriverPaymentAction({
      businessPartnerId,
      chartOfAccountId: "014",
      allocations: [{ salesInvoiceId, amount }],
    });
    setSubmitting(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onDone();
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="font-display text-lg font-semibold">Pembayaran</h1>

      <div className="rounded-lg border border-border p-4 text-center">
        <p className="text-xs uppercase text-muted-foreground">Total Pembayaran</p>
        <p className="text-2xl font-semibold">{loading ? "Memuat..." : amount != null ? formatRupiah(amount) : "-"}</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button variant="default">Tunai</Button>
        <Button variant="outline" disabled className="opacity-50">
          Dynamic QR
          <span className="block text-[10px]">Segera Hadir</span>
        </Button>
        <Button variant="outline" disabled className="opacity-50">
          QR Statis
          <span className="block text-[10px]">Segera Hadir</span>
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Konfirmasi telah menerima pembayaran tunai dari mitra untuk pengiriman ini.</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" disabled={submitting || loading || amount == null} onClick={handleTunai}>
          {submitting ? "Menyimpan..." : "Selesaikan Pembayaran"}
        </Button>
      </div>
    </div>
  );
}
