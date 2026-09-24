// src/components/dashboard/mitra-es-balok-detail-dialog.tsx
"use client";

import dynamic from "next/dynamic";
import { Phone, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRupiah } from "@/lib/format";
import type { MitraCard } from "@/lib/queries/mitra-es-balok";
import { SEGMENTASI_OPTIONS } from "@/lib/segmentasi-mitra";

const AgenLocationMap = dynamic(
  () => import("@/components/dashboard/agen-location-map").then((m) => m.AgenLocationMap),
  { ssr: false, loading: () => <Skeleton className="h-[220px] w-full rounded-lg" /> }
);

function formatQtyPlain(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

function segmentasiLabel(value: MitraCard["segmentasi"]): string {
  return SEGMENTASI_OPTIONS.find((s) => s.value === value)?.label ?? "Belum ditentukan";
}

// Purely a profile view now -- no Piutang, no Pembayaran, no riwayat
// pesanan. All fields here already come from the same MitraCard the list
// already fetched, so this dialog needs no fetch of its own (unlike the
// earlier version, which lazy-loaded per-Agen financial/order-history data
// that no longer exists in this module at all).
export function MitraEsBalokDetailDialog({
  open,
  onOpenChange,
  kode,
  data,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kode: string;
  data: MitraCard | null;
  onEdit: (data: MitraCard) => void;
}) {
  const isSharedLogistik = data?.sumber === "logistik" && (kode === "pmpersada" || kode === "pmpakis");
  const pasangan = kode === "pmpersada" ? "pmpakis" : "pmpersada";
  // PMPakis only sells Balok Kecil -- Balok Besar is never shown here.
  // User decision 2026-09-24.
  const isPmpakis = kode === "pmpakis";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{data?.nama ?? "Detail Mitra"}</DialogTitle>
        </DialogHeader>

        {data && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={data.isActive ? "secondary" : "destructive"}>{data.isActive ? "Aktif" : "Nonaktif"}</Badge>
              <Badge variant="outline">{segmentasiLabel(data.segmentasi)}</Badge>
              {isSharedLogistik && <Badge variant="outline">Logistik (Bersama {pasangan})</Badge>}
              {data.telepon && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Phone className="size-3.5" />
                  {data.telepon}
                </span>
              )}
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => onEdit(data)}>
                <Pencil className="size-3.5" />
                Edit
              </Button>
            </div>

            {isSharedLogistik && (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Mitra ini berasal dari database logistik yang dipakai bersama pmpersada &amp; pmpakis — akan muncul identik di
                modul Mitra perusahaan pasangannya ({pasangan}).
              </p>
            )}

            <div>
              <p className="text-xs text-muted-foreground">Alamat Lengkap</p>
              <p className="text-sm">{[data.alamat, data.wilayah].filter(Boolean).join(", ") || "-"}</p>
            </div>

            <div className="flex flex-col divide-y rounded-md border text-sm">
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-muted-foreground">Balok Kecil</span>
                <span>{formatRupiah(data.hargaBalokKecil)}</span>
                <span className="text-muted-foreground">
                  Kapasitas: {data.kapasitasBalokKecil != null ? `${formatQtyPlain(data.kapasitasBalokKecil)} /hari` : "-"}
                </span>
              </div>
              {!isPmpakis && (
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-muted-foreground">Balok Besar</span>
                  <span>{formatRupiah(data.hargaBalokBesar)}</span>
                  <span className="text-muted-foreground">
                    Kapasitas: {data.kapasitasBalokBesar != null ? `${formatQtyPlain(data.kapasitasBalokBesar)} /hari` : "-"}
                  </span>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs text-muted-foreground">Batas Hutang</p>
              <p className="text-sm">{formatRupiah(data.maksimumHutang)}</p>
            </div>

            {data.latitude != null && data.longitude != null && (
              <AgenLocationMap latitude={data.latitude} longitude={data.longitude} onChange={() => {}} recenterKey={0} readOnly />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
