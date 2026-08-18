"use client";

import { useEffect, useState } from "react";
import { Star, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getKinerjaMarketingAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { MarketingPerformanceData } from "@/lib/queries/marketing-performance";

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

export function KinerjaMarketingSubTab() {
  const [data, setData] = useState<MarketingPerformanceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getKinerjaMarketingAction().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setData(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (!data) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const ownMitraId = data.cells[0]?.MarketingUserID;
  const roster = ownMitraId ? (data.allMitraByMarketing[ownMitraId] ?? []) : [];
  const totalQty = data.cells.reduce((sum, c) => sum + c.DailyQty.reduce((s, q) => s + q, 0), 0);
  const totalTarget = data.cells.reduce((sum, c) => sum + c.TargetHarian, 0);
  const windowSize = Math.min(5, data.periodDays);
  const last5 = Array.from({ length: windowSize }, (_, i) => data.periodDays - windowSize + i);

  return (
    <div className="flex flex-col gap-2 p-4">
      <Card>
        <CardContent className="flex items-center justify-between p-3">
          <div>
            <p className="text-xs text-muted-foreground">Total kantong periode berjalan</p>
            <p className="font-display text-xl font-semibold tabular-nums">{formatQty(totalQty)}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {totalTarget ? `${Math.round((totalQty / (totalTarget * data.periodDays)) * 100)}% pencapaian` : ""}
          </p>
        </CardContent>
      </Card>

      {[...roster]
        .sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0))
        .map((m) => {
          const daily = data.mitraDailyQty[m.BusinessPartnerID] ?? [];
          const total = daily.reduce((s, q) => s + q, 0);
          return (
            <Card key={m.BusinessPartnerID}>
              <CardContent className="flex flex-col gap-1.5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-1 text-sm font-medium">
                      {(m.Capacity ?? 0) > 0 && <Star className="size-3 fill-warning text-warning" />}
                      {m.Name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {m.Wilayah}
                      {m.Kecamatan ? ` - ${m.Kecamatan}` : ""} · Target {formatQty(m.Capacity ?? 0)}/hari
                    </p>
                  </div>
                  <p className="shrink-0 tabular-nums font-medium">{formatQty(total)} kantong</p>
                </div>
                <div className="flex gap-1.5">
                  {last5.map((i) => (
                    <span key={i} className="rounded bg-muted px-2 py-0.5 text-[11px] tabular-nums">
                      {formatQty(daily[i] ?? 0)}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
    </div>
  );
}
