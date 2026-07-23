"use client";

import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { MapPin, Phone, Calendar, Package, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PengajuanRow } from "@/lib/queries/mitra-pengajuan";
import {
  approvePengajuanAction,
  rejectPengajuanAction,
  deletePengajuanAction,
} from "@/app/(dashboard)/pemasaran/actions";

const LocationViewMap = dynamic(
  () => import("@/components/dashboard/location-view-map").then((m) => m.LocationViewMap),
  { ssr: false, loading: () => <Skeleton className="h-[260px] w-full rounded-lg" /> }
);

function LocationDialog({ row, onOpenChange }: { row: PengajuanRow | null; onOpenChange: (open: boolean) => void }) {
  const hasLocation = row?.Latitude != null && row?.Longitude != null;

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lokasi — {row?.NamaCalon}</DialogTitle>
          <DialogDescription>
            {row?.Alamat || row?.Wilayah
              ? [row?.Alamat, row?.Kecamatan, row?.Wilayah].filter(Boolean).join(", ")
              : "Belum ada alamat tercatat."}
          </DialogDescription>
        </DialogHeader>
        {hasLocation && row ? (
          <div className="flex flex-col gap-2">
            <LocationViewMap latitude={row.Latitude!} longitude={row.Longitude!} />
            <p className="text-xs text-muted-foreground">
              {row.Latitude!.toFixed(6)}, {row.Longitude!.toFixed(6)}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              render={
                <a
                  href={`https://www.google.com/maps?q=${row.Latitude},${row.Longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <ExternalLink className="size-3.5" />
              Lihat di Google Maps
            </Button>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">Belum ada titik lokasi GPS tercatat.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

const STATUS_BADGE: Record<PengajuanRow["Status"], string> = {
  Menunggu: "bg-warning/15 text-warning",
  Diproses: "bg-muted text-muted-foreground",
  Disetujui: "bg-primary/15 text-primary",
  Ditolak: "bg-destructive/15 text-destructive",
};

function RejectDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (catatan: string | null) => void;
  pending: boolean;
}) {
  const [catatan, setCatatan] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) setCatatan("");
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tolak Pengajuan</DialogTitle>
          <DialogDescription>Catatan alasan penolakan bersifat opsional.</DialogDescription>
        </DialogHeader>
        <Textarea placeholder="Catatan (opsional)" value={catatan} onChange={(e) => setCatatan(e.target.value)} />
        <DialogFooter>
          <Button variant="destructive" disabled={pending} onClick={() => onConfirm(catatan || null)}>
            {pending ? "Memproses..." : "Tolak Pengajuan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PengajuanList({
  rows,
  canApprove,
  isSuperAdmin,
}: {
  rows: PengajuanRow[];
  canApprove: boolean;
  isSuperAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState<PengajuanRow | null>(null);
  const [viewingLocation, setViewingLocation] = useState<PengajuanRow | null>(null);

  function handleApprove(row: PengajuanRow) {
    if (!confirm(`Setujui pengajuan "${row.NamaCalon}"? Mitra baru akan otomatis dibuat.`)) return;
    startTransition(async () => {
      try {
        await approvePengajuanAction(row.PengajuanID);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Gagal memproses pengajuan");
      }
    });
  }

  function handleReject(catatan: string | null) {
    if (!rejecting) return;
    const id = rejecting.PengajuanID;
    startTransition(async () => {
      try {
        await rejectPengajuanAction(id, catatan);
        setRejecting(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Gagal memproses pengajuan");
      }
    });
  }

  function handleDelete(row: PengajuanRow) {
    if (!confirm(`Hapus pengajuan "${row.NamaCalon}"? Tindakan ini tidak dapat dibatalkan.`)) return;
    startTransition(async () => {
      try {
        await deletePengajuanAction(row.PengajuanID);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Gagal menghapus pengajuan");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3">
        {rows.map((row) => (
          <Card
            key={row.PengajuanID}
            className="cursor-pointer py-3.5 transition-colors hover:bg-accent/50"
            onClick={() => setViewingLocation(row)}
          >
            <CardContent className="flex flex-col gap-2 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.NamaCalon}</p>
                  <p className="text-xs text-muted-foreground">
                    Marketing: <span className="text-foreground">{row.MarketingNama}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className={cn("rounded px-2 py-0.5 text-[11px] font-medium", STATUS_BADGE[row.Status])}>
                    {row.Status}
                  </span>
                  {isSuperAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      disabled={pending}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(row);
                      }}
                    >
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3" /> {row.NoHP || "-"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3" />
                  {row.Wilayah || "-"}
                  {row.Kecamatan ? ` | ${row.Kecamatan}` : ""}
                </span>
                {row.Alamat && <span className="truncate pl-[18px]">{row.Alamat}</span>}
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="size-3" />
                  Diminta sampai{" "}
                  {row.WaktuPermintaanSampai
                    ? `${formatDate(row.WaktuPermintaanSampai)} ${formatTime(row.WaktuPermintaanSampai)}`
                    : "-"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Package className="size-3" />
                  {row.QtyKantong ? `${row.QtyKantong.toLocaleString("id-ID")} kantong` : "Belum ada minat pesan"}
                </span>
              </div>

              <p className="border-t pt-2 text-[11px] text-muted-foreground">
                Input {formatDate(row.CreatedAt)} {formatTime(row.CreatedAt)}
              </p>

              {row.Status === "Ditolak" && row.CatatanTolak && (
                <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{row.CatatanTolak}</p>
              )}

              {canApprove && row.Status === "Menunggu" && (
                <div className="flex gap-2 border-t pt-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={pending}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleApprove(row);
                    }}
                  >
                    Setujui
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={pending}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRejecting(row);
                    }}
                  >
                    Tolak
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {rows.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Belum ada pengajuan.</p>
        )}
      </div>

      {rejecting && (
        <RejectDialog
          open={!!rejecting}
          onOpenChange={(open) => !open && setRejecting(null)}
          onConfirm={handleReject}
          pending={pending}
        />
      )}

      <LocationDialog row={viewingLocation} onOpenChange={(open) => !open && setViewingLocation(null)} />
    </div>
  );
}
