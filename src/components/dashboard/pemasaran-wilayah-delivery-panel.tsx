"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatPercentPoints } from "@/lib/format";
import type { PemasaranWilayahDeliveryRow } from "@/lib/queries/pemasaran-wilayah-delivery";
import { setWilayahPotentialTargetAction } from "@/app/(dashboard)/pemasaran/actions";

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

function TrendIcon({ pct }: { pct: number | null }) {
  if (pct == null || pct === 0) return <Minus className="size-3.5 text-muted-foreground" />;
  if (pct > 0) return <TrendingUp className="size-3.5 text-primary" />;
  return <TrendingDown className="size-3.5 text-destructive" />;
}

// Inline click-to-edit for PotentialTarget, same pattern as mitra-do-panel's
// TargetButton — pill showing the current value that doubles as its own
// popover editor.
function PotentialTargetButton({
  wilayah,
  value,
  canEdit,
}: {
  wilayah: string;
  value: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [pending, startTransition] = useTransition();

  if (!canEdit) {
    return <span className="tabular-nums">{formatQty(value)}</span>;
  }

  function handleSave() {
    const parsed = Number(draft);
    if (Number.isNaN(parsed) || parsed < 0) {
      toast.error("Potensial target harus berupa angka positif.");
      return;
    }
    startTransition(async () => {
      try {
        await setWilayahPotentialTargetAction({ wilayah, potentialTarget: parsed });
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Gagal menyimpan potensial target.");
      }
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(String(value));
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 tabular-nums transition-colors hover:bg-muted"
          />
        }
      >
        <span className="size-1.5 shrink-0 rounded-full bg-primary" />
        {formatQty(value)}
      </PopoverTrigger>
      <PopoverContent className="w-56" align="center">
        <p className="mb-1.5 text-xs font-medium">Ubah Potensial Target &mdash; {wilayah}</p>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Kantong"
            className="h-8 text-xs"
          />
          <Button size="sm" disabled={pending} onClick={handleSave}>
            {pending ? "..." : "Simpan"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function WilayahTile({ row, canEditTarget }: { row: PemasaranWilayahDeliveryRow; canEditTarget: boolean }) {
  return (
    <div className="rounded-lg border bg-card/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium">{row.Wilayah}</p>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums">
          <TrendIcon pct={row.PctChange} />
          {row.PctChange != null ? formatPercentPoints(Math.abs(row.PctChange)) : "-"}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div>
          <p className="font-display text-sm font-semibold tabular-nums">
            &plusmn;{formatQty(row.AvgPerHariThisMonth)} <span className="text-[10px] font-normal text-muted-foreground">/bulan berjalan</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums text-muted-foreground">
            &plusmn;{formatQty(row.AvgPerHariLastMonth)} <span className="text-[10px] font-normal">bulan lalu</span>
          </p>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2 text-[11px] text-muted-foreground">
        <span className="tabular-nums">Kapasitas {formatQty(row.TargetKapasitas)}</span>
        <span className="flex items-center gap-1">
          Potensial <PotentialTargetButton wilayah={row.Wilayah} value={row.PotentialTarget} canEdit={canEditTarget} />
        </span>
        <span className="font-medium text-foreground tabular-nums">Total {formatQty(row.TotalTarget)}</span>
      </div>
    </div>
  );
}

// Pemasaran's own "Pengiriman per Wilayah" — same tile-grid shape as
// Transaksi's WilayahDeliveryPanel, but the metrics are a month-over-month
// average-per-day comparison plus a manually adjustable capacity target,
// not a period/target-achievement view. Wilayah with no transaction this
// month or last month don't get a card at all.
export function PemasaranWilayahDeliveryPanel({
  data,
  canEditTarget,
}: {
  data: PemasaranWilayahDeliveryRow[];
  canEditTarget: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Pengiriman per Wilayah</CardTitle>
        <CardDescription>
          Rata-rata kantong terkirim per hari, bulan berjalan dibanding bulan lalu, per wilayah dengan transaksi.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada pengiriman bulan ini atau bulan lalu.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((row) => (
              <WilayahTile key={row.Wilayah} row={row} canEditTarget={canEditTarget} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
