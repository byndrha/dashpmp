"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatRupiah, formatDate, formatTime, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TodayReceivablePayment } from "@/lib/queries/piutang-payments";
import type { PiutangStatus } from "@/lib/queries/aging";

const STATUS_BADGE: Record<PiutangStatus, string> = {
  Sehat: "bg-primary/15 text-primary",
  Perhatian: "bg-warning/15 text-warning",
  Kritis: "bg-destructive/15 text-destructive",
};

// businessDate/todayISO are both "YYYY-MM-DD" business-date strings (WIB,
// see business-date.ts) — plain string comparison/arithmetic is safe since
// that format sorts and diffs correctly without parsing.
export function PiutangPaymentsPanel({
  rows,
  businessDate,
  todayISO,
}: {
  rows: TodayReceivablePayment[];
  businessDate: string;
  todayISO: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isToday = businessDate === todayISO;
  const totalAmount = rows.reduce((sum, r) => sum + r.Amount, 0);

  function goToDate(newDate: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("piutangDate", newDate);
    router.push(`${pathname}?${params.toString()}`);
  }

  function shiftDate(deltaDays: number) {
    const d = new Date(businessDate);
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + deltaDays));
    goToDate(next.toISOString().slice(0, 10));
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="font-display">
            Pembayaran Piutang {isToday ? "Hari Ini" : formatDate(businessDate)}
          </CardTitle>
          <CardDescription>
            {rows.length} dokumen SP &middot; total {formatRupiah(totalAmount)}
          </CardDescription>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-8" onClick={() => shiftDate(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Input
            type="date"
            value={businessDate}
            max={todayISO}
            onChange={(e) => e.target.value && goToDate(e.target.value)}
            className="h-8 w-40 text-xs"
          />
          <Button variant="outline" size="icon" className="size-8" disabled={isToday} onClick={() => shiftDate(1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="grid grid-cols-1 gap-2 @2xl:grid-cols-2 @4xl:grid-cols-3">
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
              Belum ada pembayaran piutang {isToday ? "hari ini" : "pada tanggal ini"}.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
