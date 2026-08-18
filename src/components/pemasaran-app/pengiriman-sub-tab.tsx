"use client";

import { useEffect, useState } from "react";
import { Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getWilayahDeliveryAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { PemasaranWilayahDeliveryRow } from "@/lib/queries/pemasaran-wilayah-delivery";

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

export function PengirimanSubTab() {
  const [rows, setRows] = useState<PemasaranWilayahDeliveryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getWilayahDeliveryAction().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setRows(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (!rows) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <p className="text-xs text-muted-foreground">Rata-rata kantong/hari bulan berjalan vs bulan lalu, per wilayah.</p>
      {rows.map((r) => {
        const up = r.PctChange != null && r.PctChange >= 0;
        return (
          <Card key={r.Wilayah}>
            <CardContent className="flex flex-col gap-2 p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">{r.Wilayah}</p>
                {r.PctChange != null && (
                  <span className={up ? "flex items-center gap-0.5 text-xs text-primary" : "flex items-center gap-0.5 text-xs text-destructive"}>
                    {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                    {r.PctChange.toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <p className="tabular-nums font-semibold">{formatQty(r.AvgPerHariThisMonth)}/hari</p>
                  <p className="text-muted-foreground">Bulan Ini</p>
                </div>
                <div>
                  <p className="tabular-nums font-semibold">{formatQty(r.AvgPerHariLastMonth)}/hari</p>
                  <p className="text-muted-foreground">Bulan Lalu</p>
                </div>
                <div>
                  <p className="tabular-nums font-semibold">{formatQty(r.TotalTarget)}</p>
                  <p className="text-muted-foreground">Total Target</p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
