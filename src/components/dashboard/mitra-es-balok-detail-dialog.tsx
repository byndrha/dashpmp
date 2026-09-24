// src/components/dashboard/mitra-es-balok-detail-dialog.tsx
"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Phone, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format";
import type { MitraDetailData, SumberAgen } from "@/lib/queries/mitra-es-balok";

const AgenLocationMap = dynamic(
  () => import("@/components/dashboard/agen-location-map").then((m) => m.AgenLocationMap),
  { ssr: false, loading: () => <Skeleton className="h-[220px] w-full rounded-lg" /> }
);

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  return `${MONTH_LABELS[Number(month) - 1]} ${year}`;
}

function formatQtyPlain(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

export function MitraEsBalokDetailDialog({
  open,
  onOpenChange,
  kode,
  sumber,
  agenId,
  fetchDetail,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kode: string;
  sumber: SumberAgen;
  agenId: string | null;
  fetchDetail: (kode: string, sumber: SumberAgen, agenId: string) => Promise<MitraDetailData | null>;
  onEdit: (data: MitraDetailData) => void;
}) {
  const [data, setData] = useState<MitraDetailData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!open || !agenId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData(null);
      return;
    }
    setLoading(true);
    fetchDetail(kode, sumber, agenId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, kode, sumber, agenId, fetchDetail]);

  const isSharedLogistik = sumber === "logistik" && (kode === "pmpersada" || kode === "pmpakis");
  const pasangan = kode === "pmpersada" ? "pmpakis" : "pmpersada";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{data?.nama ?? "Detail Mitra"}</DialogTitle>
        </DialogHeader>

        {loading && <Skeleton className="h-64 w-full" />}

        {!loading && data && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={data.isActive ? "secondary" : "destructive"}>{data.isActive ? "Aktif" : "Nonaktif"}</Badge>
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

            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Wilayah</p>
                <p>{data.wilayah ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Alamat</p>
                <p>{data.alamat ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Harga Kecil / Besar</p>
                <p>
                  {formatRupiah(data.hargaBalokKecil)} / {formatRupiah(data.hargaBalokBesar)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Batas Hutang</p>
                <p>{formatRupiah(data.maksimumHutang)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Saldo Awal Piutang</p>
                <p>{formatRupiah(data.piutangSaldoAwal)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Saldo Awal Tabungan</p>
                <p>{formatRupiah(data.tabunganSaldoAwal)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">Piutang Baru (Bulan Ini)</p>
                <p className="text-lg font-semibold">{formatRupiah(data.piutangBaruBulanIni)}</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">Pembayaran (Bulan Ini, Perkiraan)</p>
                <p className="text-lg font-semibold">{formatRupiah(data.pembayaranEstimasiBulanIni)}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Piutang Baru dihitung andal dari data pesanan. Pembayaran adalah perkiraan (dicocokkan dari nama), totalnya
              mungkin tidak pas 100% dengan saldo agregat perusahaan.
            </p>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bulan</TableHead>
                    <TableHead className="text-right">Balok Kecil</TableHead>
                    <TableHead className="text-right">Balok Besar</TableHead>
                    <TableHead className="text-right">Total Balok</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.riwayatBulanan.map((m) => (
                    <TableRow key={m.bulan}>
                      <TableCell>{formatMonthLabel(m.bulan)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQtyPlain(m.balokKecil)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQtyPlain(m.balokBesar)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatQtyPlain(m.totalBalok)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
