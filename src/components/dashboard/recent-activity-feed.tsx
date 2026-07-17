import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatRupiah, formatRelativeTime, formatTime } from "@/lib/format";
import type { RecentInvoice } from "@/lib/queries/activity";

export function RecentActivityFeed({ invoices }: { invoices: RecentInvoice[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Transaksi Terbaru</CardTitle>
        <CardDescription>Invoice penjualan terbaru, real-time dari seluruh wilayah.</CardDescription>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada transaksi.</p>
        ) : (
          <ol className="relative flex flex-col gap-0.5">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" aria-hidden />
            {invoices.map((inv) => (
              <li key={inv.SalesInvoiceID} className="relative flex items-start gap-3 py-2.5 pl-0.5">
                <span className="relative z-10 mt-1.5 size-[15px] shrink-0 rotate-45 rounded-[3px] border-2 border-primary bg-background" />
                <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{inv.CustomerName ?? "Mitra Umum"}</p>
                    <p className="truncate font-data text-xs text-muted-foreground">
                      {inv.Wilayah} &middot; {formatTime(inv.TransDate)} &middot;{" "}
                      {formatRelativeTime(inv.TransDate)}
                    </p>
                  </div>
                  <p className="shrink-0 font-display text-sm font-semibold tabular-nums text-primary">
                    {formatRupiah(inv.Netto)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
