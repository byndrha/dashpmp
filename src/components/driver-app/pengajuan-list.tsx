"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatDate, formatRupiah, formatTime } from "@/lib/format";
import { getOwnPengajuanListAction, getPriceLevelOptionsForDriverAction } from "@/app/mkesindo/driver-app/actions";
import type { PengajuanRow, PengajuanStatus } from "@/lib/queries/mitra-pengajuan";
// Value import (not just types) from the plain, DB-import-free module — see
// pengajuan-sub-tab.tsx's identical comment for why not queries/mitra-pengajuan.ts.
import { AGEN_QTY_THRESHOLD, RPA_QTY_THRESHOLD } from "@/lib/mitra-classification";
import type { PriceLevelOption } from "@/lib/queries/mitra";

const MitraLocationMap = dynamic(
  () => import("@/components/dashboard/mitra-location-map").then((m) => m.MitraLocationMap),
  { ssr: false, loading: () => <Skeleton className="h-[260px] w-full rounded-lg" /> }
);

const STATUS_VARIANT: Record<PengajuanStatus, "default" | "outline" | "destructive"> = {
  Menunggu: "outline",
  Diproses: "outline",
  Disetujui: "default",
  Ditolak: "destructive",
};

// Mirrors approvePengajuan()'s Gender classification exactly — same helper
// as pengajuan-sub-tab.tsx (pemasaran-app), duplicated here since driver-app
// and pemasaran-app are separate app surfaces (existing codebase convention,
// see e.g. KendalaDialog vs other apps' own dialogs).
function classifyPartnerType(qtyKantong: number | null): "Outlet" | "Agen" | "RPA" | null {
  if (qtyKantong == null) return null;
  if (qtyKantong > RPA_QTY_THRESHOLD) return "RPA";
  if (qtyKantong > AGEN_QTY_THRESHOLD) return "Agen";
  return "Outlet";
}

export function PengajuanList() {
  const router = useRouter();
  const [rows, setRows] = useState<PengajuanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [priceLevels, setPriceLevels] = useState<PriceLevelOption[]>([]);
  const [mapRow, setMapRow] = useState<PengajuanRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOwnPengajuanListAction().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setRows(result.data);
    });
    getPriceLevelOptionsForDriverAction().then((result) => {
      if (cancelled) return;
      if (result.success) setPriceLevels(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const priceByLevel = useMemo(() => new Map(priceLevels.map((p) => [p.Level, p.Price])), [priceLevels]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-display text-base font-semibold">Pengajuan Mitra</h1>
      </header>

      <div className="flex flex-col gap-2 p-4">
        <Button render={<Link href="/mkesindo/driver-app/pengajuan/baru" />} className="w-full gap-1.5">
          <Plus className="size-4" /> Pengajuan Baru
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {!rows && !error && (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {rows?.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">Belum ada pengajuan mitra.</p>
        )}
        {rows?.map((r) => {
          const partnerType = classifyPartnerType(r.QtyKantong);
          const hasLocation = r.Latitude != null && r.Longitude != null;
          const harga =
            r.PriceLevel != null && priceByLevel.has(r.PriceLevel) ? formatRupiah(priceByLevel.get(r.PriceLevel)!) : "-";

          return (
            <Card
              key={r.PengajuanID}
              className={cn(hasLocation && "cursor-pointer transition-colors hover:bg-accent/50")}
              onClick={hasLocation ? () => setMapRow(r) : undefined}
            >
              <CardContent className="flex flex-col gap-1 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{r.NamaCalon}</p>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {partnerType && (
                      <Badge variant="outline" className="text-[10px]">
                        {partnerType}
                      </Badge>
                    )}
                    <Badge variant={STATUS_VARIANT[r.Status]} className="shrink-0 text-[10px]">
                      {r.Status}
                    </Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.Wilayah}
                  {r.Kecamatan ? ` - ${r.Kecamatan}` : ""} · {formatDate(r.CreatedAt)}
                </p>
                {r.NoHP && <p className="text-xs text-muted-foreground">{r.NoHP}</p>}
                <p className="text-xs text-muted-foreground">
                  Diminta sampai{" "}
                  {r.WaktuPermintaanSampai
                    ? `${formatDate(r.WaktuPermintaanSampai)} ${formatTime(r.WaktuPermintaanSampai)}`
                    : "-"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.QtyKantong != null ? `${r.QtyKantong.toLocaleString("id-ID")} kantong` : "-"} · {harga}
                </p>
                {r.Status !== "Menunggu" && (r.Keterangan ?? r.CatatanTolak) && (
                  <p
                    className={cn(
                      "rounded-md px-2 py-1.5 text-xs",
                      r.Status === "Ditolak" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                    )}
                  >
                    {r.Keterangan ?? r.CatatanTolak}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!mapRow} onOpenChange={(open) => !open && setMapRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lokasi — {mapRow?.NamaCalon}</DialogTitle>
            <DialogDescription className="sr-only">Lokasi pengajuan pada peta.</DialogDescription>
          </DialogHeader>
          {mapRow?.Latitude != null && mapRow?.Longitude != null && (
            <div className="flex flex-col gap-2">
              <MitraLocationMap latitude={mapRow.Latitude} longitude={mapRow.Longitude} onChange={() => {}} recenterKey={0} readOnly />
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                render={
                  <a href={`https://www.google.com/maps?q=${mapRow.Latitude},${mapRow.Longitude}`} target="_blank" rel="noopener noreferrer" />
                }
              >
                Buka di Google Maps
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
