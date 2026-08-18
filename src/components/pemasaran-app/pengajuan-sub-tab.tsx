"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { getPengajuanListAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { PengajuanRow, PengajuanStatus } from "@/lib/queries/mitra-pengajuan";

const STATUS_VARIANT: Record<PengajuanStatus, "default" | "outline" | "destructive"> = {
  Menunggu: "outline",
  Diproses: "outline",
  Disetujui: "default",
  Ditolak: "destructive",
};

export function PengajuanSubTab() {
  const [rows, setRows] = useState<PengajuanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPengajuanListAction().then((result) => {
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

  return (
    <div className="flex flex-col gap-2 p-4">
      <Button render={<Link href="/mkesindo/pemasaran-app/pengajuan/baru" />} className="w-full gap-1.5">
        <Plus className="size-4" /> Pengajuan Baru
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!rows && !error && (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {rows?.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Belum ada pengajuan.</p>}
      {rows?.map((r) => (
        <Card key={r.PengajuanID}>
          <CardContent className="flex flex-col gap-1 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">{r.NamaCalon}</p>
              <Badge variant={STATUS_VARIANT[r.Status]} className="shrink-0 text-[10px]">
                {r.Status}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {r.Wilayah}
              {r.Kecamatan ? ` - ${r.Kecamatan}` : ""} · {formatDate(r.CreatedAt)}
            </p>
            {r.NoHP && <p className="text-xs text-muted-foreground">{r.NoHP}</p>}
            {r.Status === "Ditolak" && r.CatatanTolak && (
              <p className="text-xs text-destructive">Ditolak: {r.CatatanTolak}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
