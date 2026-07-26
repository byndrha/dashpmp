import type { Metadata } from "next";
import Link from "next/link";
import { getPaymentByToken } from "@/lib/queries/payment-public";
import { formatDate, formatRupiah } from "@/lib/format";

// Public, unguessable-token page — same posture as /invoice/[token].
export const metadata: Metadata = {
  title: "Dokumen Pembayaran",
  robots: { index: false, follow: false },
};

export default async function PublicPaymentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payment = await getPaymentByToken(token);

  if (!payment) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Dokumen tidak ditemukan</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Link ini tidak valid atau sudah tidak berlaku. Hubungi PT Mitra Kelola Esindo untuk bantuan.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <p className="text-xs text-muted-foreground">Dokumen Pembayaran untuk</p>
        <h1 className="text-lg font-semibold">{payment.CustomerName}</h1>

        <div className="mt-4 flex flex-col gap-1 rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">No. Voucher</span>
            <span className="font-medium">{payment.VoucherNo}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tanggal</span>
            <span className="font-medium">{formatDate(payment.TransDate)}</span>
          </div>
        </div>

        <div className="mt-4 text-center">
          <p className="text-xs text-muted-foreground">Total Dibayarkan</p>
          <p className="text-2xl font-semibold">{formatRupiah(payment.Amount)}</p>
        </div>

        {payment.Invoices.length > 0 && (
          <div className="mt-4 border-t pt-4">
            <p className="text-xs font-medium text-muted-foreground">
              {payment.Invoices.length > 1 ? "Menutup Tagihan Berikut" : "Menutup Tagihan"}
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {payment.Invoices.map((inv) => (
                <Link
                  key={inv.SalesInvoiceID}
                  href={`/invoice/${inv.Token}`}
                  className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors hover:bg-accent/50"
                >
                  <span className="min-w-0 truncate text-muted-foreground">{inv.VoucherNo}</span>
                  <span className="shrink-0 font-medium tabular-nums">{formatRupiah(inv.Amount)}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
