"use client";

import { useState, useTransition } from "react";
import { Target, TrendingUp, TrendingDown, Minus, CalendarDays, Wallet, Gauge, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatRupiah, formatDate, formatPercentPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RevenueTarget } from "@/lib/queries/revenue-target";
import { saveMonthlyTargetAction } from "@/app/(dashboard)/sales/actions";

function formatQtyPlain(value: number | null): string {
  if (value == null) return "-";
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: 0 })} kantong`;
}

function GrowthBadge({ value, percent }: { value: number | null; percent: number | null }) {
  if (value == null) return <span className="text-xs text-muted-foreground">Target belum diset</span>;
  const up = value > 0;
  const down = value < 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
        up && "bg-primary/15 text-primary",
        down && "bg-destructive/15 text-destructive",
        !up && !down && "bg-secondary text-muted-foreground"
      )}
    >
      {up && <TrendingUp className="size-3" />}
      {down && <TrendingDown className="size-3" />}
      {!up && !down && <Minus className="size-3" />}
      {percent != null ? formatPercentPoints(Math.abs(percent)) : ""}
    </span>
  );
}

function StatTile({
  icon: Icon,
  label,
  nominal,
  qty,
  tone = "default",
}: {
  icon: typeof Target;
  label: string;
  nominal: React.ReactNode;
  qty?: React.ReactNode;
  tone?: "default" | "primary";
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p
        className={cn(
          "font-display text-lg font-semibold tabular-nums",
          tone === "primary" ? "text-primary" : "text-foreground"
        )}
      >
        {nominal}
      </p>
      {qty && <p className="text-xs text-muted-foreground">{qty}</p>}
    </div>
  );
}

export function RevenueTargetPanel({ target }: { target: RevenueTarget }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    const targetNominal = Number(formData.get("targetNominal"));
    const targetQty = Number(formData.get("targetQty"));
    startTransition(async () => {
      await saveMonthlyTargetAction({ year: target.Year, month: target.Month, targetNominal, targetQty });
      setOpen(false);
    });
  }

  const hasTarget = target.TargetNominalMonthly != null;
  const progressPct =
    hasTarget && target.TargetNominalToDate
      ? Math.min(150, (target.RealisasiNominalToDate / target.TargetNominalToDate) * 100)
      : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="font-display">Target Revenue vs Realisasi &mdash; Bulan Berjalan</CardTitle>
          <CardDescription>
            Hari ke-{target.CurrentDay} dari {target.DaysInMonth} hari ({formatDate(target.Today)})
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Target className="size-3.5" />
          Set Target
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Hero: progress s.d. hari ini */}
        <div className="rounded-lg border border-primary/25 bg-primary/5 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Realisasi vs Target s.d. Hari ke-{target.CurrentDay}
              </p>
              <p className="font-display text-2xl font-semibold tabular-nums text-primary">
                {formatRupiah(target.RealisasiNominalToDate)}
              </p>
              <p className="text-xs text-muted-foreground">
                dari target {hasTarget ? formatRupiah(target.TargetNominalToDate!) : "-"} &middot;{" "}
                {formatQtyPlain(target.RealisasiQtyToDate)}
                {hasTarget && ` dari ${formatQtyPlain(target.TargetQtyToDate)}`}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <GrowthBadge value={target.GrowthNominal} percent={target.GrowthNominalPercent} />
              <span className="text-xs text-muted-foreground">
                {target.GrowthNominal != null ? formatRupiah(target.GrowthNominal) : "-"} growth
              </span>
            </div>
          </div>
          {progressPct != null && (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className={cn("h-2 rounded-full", progressPct >= 100 ? "bg-primary" : "bg-warning")}
                style={{ width: `${Math.min(100, progressPct)}%` }}
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            icon={Wallet}
            label="Target Bulanan"
            nominal={hasTarget ? formatRupiah(target.TargetNominalMonthly!) : "-"}
            qty={hasTarget ? formatQtyPlain(target.TargetQtyMonthly) : undefined}
          />
          <StatTile
            icon={CalendarDays}
            label="Target / Hari"
            nominal={hasTarget ? formatRupiah(target.TargetNominalDaily!) : "-"}
            qty={hasTarget ? formatQtyPlain(target.TargetQtyDaily) : undefined}
          />
          <StatTile
            icon={Gauge}
            label="Growth Qty"
            nominal={
              target.GrowthQty != null
                ? `${target.GrowthQty > 0 ? "+" : ""}${target.GrowthQty.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`
                : "-"
            }
            qty={target.GrowthQtyPercent != null ? formatPercentPoints(Math.abs(target.GrowthQtyPercent)) : undefined}
            tone={target.GrowthQty != null && target.GrowthQty >= 0 ? "primary" : "default"}
          />
          <StatTile
            icon={Rocket}
            label="Target Revenue Besok"
            nominal={target.TargetNominalBesok != null ? formatRupiah(target.TargetNominalBesok) : "-"}
            qty={formatQtyPlain(target.TargetQtyBesok)}
            tone="primary"
          />
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Target Bulan Ini</DialogTitle>
            <DialogDescription>
              Target penjualan untuk bulan ke-{target.Month} tahun {target.Year}.
            </DialogDescription>
          </DialogHeader>
          <form action={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="targetNominal">Target Nominal Bulanan (Rp)</Label>
              <Input
                id="targetNominal"
                name="targetNominal"
                type="number"
                min={0}
                defaultValue={target.TargetNominalMonthly ?? ""}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="targetQty">Target Qty Bulanan (kantong)</Label>
              <Input
                id="targetQty"
                name="targetQty"
                type="number"
                min={0}
                defaultValue={target.TargetQtyMonthly ?? ""}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending} className="ml-auto">
                {pending ? "Menyimpan..." : "Simpan Target"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
