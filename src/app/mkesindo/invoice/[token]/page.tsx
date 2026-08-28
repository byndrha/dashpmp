import type { Metadata } from "next";
import Link from "next/link";
import { getInvoiceByToken } from "@/lib/queries/invoice-public";
import { getMkesindoPerusahaanId } from "@/lib/queries/perusahaan";
import { formatDate, formatTime, formatRupiah } from "@/lib/format";
import { utcInstantToWibDisplay } from "@/lib/business-date";
import { InvoicePaymentRedirect } from "@/components/invoice-payment-redirect";
import { QrPaymentPanel } from "@/components/dashboard/qr-payment-panel";

// Public, unguessable-token page — no reason for a search engine to index
// it, and the generic title avoids leaking the internal dashboard's name
// on an otherwise customer-facing tab. `absolute` (not a plain string)
// deliberately bypasses the root layout's "%s | <site title>" template —
// this page's whole point is to NOT show that name.
export const metadata: Metadata = {
  title: { absolute: "Tagihan" },
  robots: { index: false, follow: false },
};

function LineItemTable({ lines }: { lines: { Name: string; Qty: number; Amount: number }[] }) {
  return (
    <div className="mt-2 flex flex-col gap-1 text-sm">
      {lines.map((line, i) => (
        <div key={i} className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-muted-foreground">
            {line.Name} <span className="tabular-nums">&times;{line.Qty}</span>
          </span>
          <span className="shrink-0 tabular-nums">{formatRupiah(line.Amount)}</span>
        </div>
      ))}
    </div>
  );
}

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invoice, perusahaanId] = await Promise.all([getInvoiceByToken(token), getMkesindoPerusahaanId()]);

  if (!invoice) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Invoice tidak ditemukan</h1>
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
        <p className="text-xs text-muted-foreground">Tagihan untuk</p>
        <h1 className="text-lg font-semibold">{invoice.CustomerName}</h1>

        <div className="mt-4 flex flex-col gap-1 rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">No. Voucher</span>
            <span className="font-medium">{invoice.VoucherNo}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tanggal</span>
            <span className="font-medium">{formatDate(invoice.TransDate)}</span>
          </div>
          {invoice.DueDate && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Jatuh Tempo</span>
              <span className="font-medium">{formatDate(invoice.DueDate)}</span>
            </div>
          )}
        </div>

        {invoice.IsPaid ? (
          <div className="mt-4 text-center">
            <p className="inline-block rounded-full bg-primary/15 px-3 py-1 text-sm font-medium text-primary">Lunas</p>
            <p className="mt-2 text-2xl font-semibold">{formatRupiah(invoice.Netto)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Tagihan ini telah lunas dibayarkan. Terima kasih.</p>
            {invoice.PaymentToken && <InvoicePaymentRedirect paymentToken={invoice.PaymentToken} />}
          </div>
        ) : (
          <>
            <div className="mt-4 text-center">
              <p className="text-xs text-muted-foreground">Total Tagihan</p>
              <p className="text-2xl font-semibold">{formatRupiah(invoice.Netto)}</p>
            </div>
            <div className="mt-4">
              <QrPaymentPanel perusahaanId={perusahaanId} konteks="publik" amount={invoice.Netto} />
            </div>
          </>
        )}

        {invoice.SalesOrder && (
          <div className="mt-4 border-t pt-4">
            <p className="text-xs font-medium text-muted-foreground">
              Rincian Pesanan &mdash; {invoice.SalesOrder.VoucherNo} &middot; {formatDate(invoice.SalesOrder.TransDate)}
            </p>
            <LineItemTable lines={invoice.SalesOrder.Lines} />
            <div className="mt-1 flex justify-between border-t pt-1 text-sm font-medium">
              <span>Subtotal Pesanan</span>
              <span className="tabular-nums">{formatRupiah(invoice.SalesOrder.Total)}</span>
            </div>
          </div>
        )}

        {invoice.Delivery && (
          <div className="mt-4 border-t pt-4">
            <p className="text-xs font-medium text-muted-foreground">
              Rincian Pengiriman &mdash; {invoice.Delivery.VoucherNo} &middot; {formatDate(invoice.Delivery.TransDate)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {invoice.Delivery.VehicleNo && <>Armada {invoice.Delivery.VehicleNo}</>}
              {invoice.Delivery.Driver && <> &middot; Driver {invoice.Delivery.Driver}</>}
              {invoice.Delivery.DepartureTime && (
                <> &middot; Berangkat {formatTime(utcInstantToWibDisplay(new Date(invoice.Delivery.DepartureTime)))}</>
              )}
            </p>
            <div className="mt-2 flex flex-col gap-1 text-sm">
              {invoice.Delivery.Lines.map((line, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {line.Name} <span className="tabular-nums">&times;{line.Delivered}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatRupiah(line.Amount)}</span>
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between border-t pt-1 text-sm font-medium">
              <span>Subtotal Pengiriman</span>
              <span className="tabular-nums">{formatRupiah(invoice.Delivery.Total)}</span>
            </div>
          </div>
        )}

        {invoice.OtherOutstanding.length > 0 && (
          <div className="mt-4 border-t pt-4">
            <p className="text-xs font-medium text-muted-foreground">Tagihan Lain yang Masih Berjalan</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {invoice.OtherOutstanding.map((other) => (
                <Link
                  key={other.SalesInvoiceID}
                  href={`/mkesindo/invoice/${other.Token}`}
                  className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors hover:bg-accent/50"
                >
                  <span className="min-w-0 truncate text-muted-foreground">
                    {other.VoucherNo} &middot; {formatDate(other.TransDate)}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{formatRupiah(other.Outstanding)}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
