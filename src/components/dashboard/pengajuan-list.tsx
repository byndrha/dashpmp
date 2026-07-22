"use client";

import { useState, useTransition } from "react";
import { MapPin, Phone, Calendar, Package } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PengajuanRow } from "@/lib/queries/mitra-pengajuan";
import { approvePengajuanAction, rejectPengajuanAction } from "@/app/(dashboard)/pemasaran/actions";

const STATUS_BADGE: Record<PengajuanRow["Status"], string> = {
  Menunggu: "bg-warning/15 text-warning",
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

export function PengajuanList({ rows, canApprove }: { rows: PengajuanRow[]; canApprove: boolean }) {
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState<PengajuanRow | null>(null);

  function handleApprove(row: PengajuanRow) {
    if (!confirm(`Setujui pengajuan "${row.NamaCalon}"? Mitra baru akan otomatis dibuat.`)) return;
    startTransition(async () => {
      await approvePengajuanAction(row.PengajuanID);
    });
  }

  function handleReject(catatan: string | null) {
    if (!rejecting) return;
    const id = rejecting.PengajuanID;
    startTransition(async () => {
      await rejectPengajuanAction(id, catatan);
      setRejecting(null);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3">
        {rows.map((row) => (
          <Card key={row.PengajuanID} className="py-3.5">
            <CardContent className="flex flex-col gap-2 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.NamaCalon}</p>
                  <p className="text-xs text-muted-foreground">
                    Marketing: <span className="text-foreground">{row.MarketingNama}</span>
                  </p>
                </div>
                <span className={cn("shrink-0 rounded px-2 py-0.5 text-[11px] font-medium", STATUS_BADGE[row.Status])}>
                  {row.Status}
                </span>
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
                  <Button size="sm" className="flex-1" disabled={pending} onClick={() => handleApprove(row)}>
                    Setujui
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={pending}
                    onClick={() => setRejecting(row)}
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
    </div>
  );
}
