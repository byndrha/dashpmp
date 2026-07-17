import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatRupiah, formatTime, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TodayReceivablePayment } from "@/lib/queries/piutang-payments";
import type { PiutangStatus } from "@/lib/queries/aging";

const STATUS_BADGE: Record<PiutangStatus, string> = {
  Sehat: "bg-primary/15 text-primary",
  Perhatian: "bg-warning/15 text-warning",
  Kritis: "bg-destructive/15 text-destructive",
};

export function TodayPaymentsTable({ rows }: { rows: TodayReceivablePayment[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Pembayaran Piutang Hari Ini</CardTitle>
        <CardDescription>Pelunasan yang diterima dari mitra hari ini.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.SalesPaymentID} className="py-3">
              <CardContent className="flex flex-col gap-1.5 px-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.CustomerName}</p>
                    <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        {r.PartnerType}
                      </Badge>
                      <span>{r.Wilayah}</span>
                      {r.Kecamatan && <span>&middot; {r.Kecamatan}</span>}
                      <span className="font-data">&middot; {formatTime(r.TransDate)}</span>
                    </p>
                  </div>
                  <span className={cn("shrink-0 rounded px-2 py-0.5 text-[11px] font-medium", STATUS_BADGE[r.Status])}>
                    {r.Status}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-1.5 text-xs">
                  <span className="text-muted-foreground">Pemesanan {formatQty(r.AvgQtyPerOrderDay)}</span>
                  <span className="text-muted-foreground">Sisa Piutang {formatRupiah(r.SisaPiutang)}</span>
                  <span className="font-display text-base font-semibold tabular-nums text-primary">
                    +{formatRupiah(r.Amount)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
          {rows.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
              Belum ada pembayaran piutang hari ini.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
