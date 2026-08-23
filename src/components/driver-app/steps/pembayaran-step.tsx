"use client";

import { useEffect, useState } from "react";
import { formatRupiah } from "@/lib/format";
import { getInvoiceOutstandingAction, recordDriverPaymentAction } from "@/app/mkesindo/driver-app/actions";
import { QrPaymentPanel } from "@/components/dashboard/qr-payment-panel";

export function PembayaranStep({
  salesInvoiceId,
  businessPartnerId,
  perusahaanId,
  onDone,
}: {
  salesInvoiceId: string;
  businessPartnerId: string;
  perusahaanId: number;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by the "Coba Lagi" button below to re-run the effect. Without
  // this, a failed getInvoiceOutstandingAction call (network blip, transient
  // DB error) left the driver stuck forever: amount stays null so the
  // submit button is permanently disabled, and there was no way to
  // re-trigger the fetch short of leaving and re-entering the flow.
  const [retryToken, setRetryToken] = useState(0);

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
  }, [businessPartnerId, salesInvoiceId, retryToken]);

  async function handleSubmit(input: { metodeKode: string; catatan: string | null }) {
    if (amount == null) return;
    const result = await recordDriverPaymentAction({
      businessPartnerId,
      perusahaanId,
      metodePembayaranKode: input.metodeKode,
      notes: input.catatan ?? undefined,
      allocations: [{ salesInvoiceId, amount }],
    });
    if (!result.success) throw new Error(result.error);
    onDone();
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="font-display text-lg font-semibold">Pembayaran</h1>

      <div className="rounded-lg border border-border p-4 text-center">
        <p className="text-xs uppercase text-muted-foreground">Total Pembayaran</p>
        <p className="text-2xl font-semibold">{loading ? "Memuat..." : amount != null ? formatRupiah(amount) : "-"}</p>
      </div>

      {error && amount == null && !loading ? (
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm"
          onClick={() => {
            setLoading(true);
            setError(null);
            setRetryToken((t) => t + 1);
          }}
        >
          Coba Lagi
        </button>
      ) : (
        amount != null && <QrPaymentPanel perusahaanId={perusahaanId} konteks="driver" amount={amount} onSubmit={handleSubmit} />
      )}
      {error && amount != null && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
