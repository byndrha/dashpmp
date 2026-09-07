"use client";

import Link from "next/link";
import { Truck, Clock, PackageCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/format";
import type { DriverJadwalCard } from "@/lib/queries/pengiriman-jadwal";

function statusInfo(j: DriverJadwalCard): { label: string; variant: "outline" | "default" | "secondary"; accent: string } {
  if (j.IsSelesai) return { label: "Selesai", variant: "secondary", accent: "border-l-muted-foreground/40" };
  if (j.IsBerjalan) return { label: "Dalam Pengiriman", variant: "default", accent: "border-l-primary" };
  if (j.JamSelesaiMuat) return { label: "Menunggu Keberangkatan", variant: "outline", accent: "border-l-warning" };
  if (j.Status === "Draft") return { label: "Dijadwalkan", variant: "outline", accent: "border-l-border" };
  return { label: "Proses Muat", variant: "outline", accent: "border-l-border" };
}

// Shared card for one Jadwal, used by both the Tugas list and the Riwayat
// view — kept as its own component (rather than inline JSX duplicated in
// each screen) so the two never visually drift apart.
export function DriverJadwalCardItem({ jadwal: j }: { jadwal: DriverJadwalCard }) {
  const status = statusInfo(j);
  const progressPct = j.TotalStop > 0 ? Math.round((j.StopSelesai / j.TotalStop) * 100) : 0;

  return (
    <Link href={`/mkesindo/driver-app/jadwal/${j.JadwalID}`}>
      <div
        className={cn(
          "flex flex-col gap-2.5 rounded-xl border border-l-4 bg-card p-4 shadow-sm transition-colors active:bg-accent/40",
          status.accent,
          j.IsBerjalan && "bg-primary/[0.03] ring-1 ring-primary/30"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xl font-bold tracking-tight">{formatTime(j.JamJadwal)}</span>
          <Badge variant={status.variant} className="shrink-0">
            {status.label}
          </Badge>
        </div>

        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Truck className="size-3.5 shrink-0" />
          <span className="truncate">
            {j.ArmadaNama}
            {j.VehicleNo ? ` • ${j.VehicleNo}` : ""}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-[width]", j.IsSelesai ? "bg-emerald-500" : "bg-primary")}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {j.StopSelesai}/{j.TotalStop}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <PackageCheck className="size-3.5" />
            {j.TotalKantong} kantong
          </span>
          {j.EstimasiSampai && !j.IsSelesai && (
            <span className="flex items-center gap-1 font-medium text-foreground">
              <Clock className="size-3.5" />
              Estimasi {formatTime(j.EstimasiSampai)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
