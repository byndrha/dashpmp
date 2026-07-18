"use client";

import { useState, useTransition } from "react";
import { Target, TrendingUp, TrendingDown, Minus } from "lucide-react";
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

function Row({ label, nominal, qty }: { label: string; nominal: React.ReactNode; qty: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3 text-right">
        <span className="tabular-nums font-medium">{nominal}</span>
        <span className="tabular-nums text-xs text-muted-foreground">{qty}</span>
      </div>
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
      <CardContent className="flex flex-col divide-y divide-border">
        <div className="flex items-center justify-between pb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span>Metrik</span>
          <div className="flex items-center gap-3">
            <span>Nominal</span>
            <span>Qty</span>
          </div>
        </div>
        <Row
          label="Target Bulanan"
          nominal={hasTarget ? formatRupiah(target.TargetNominalMonthly!) : "-"}
          qty={hasTarget ? formatQtyPlain(target.TargetQtyMonthly) : "-"}
        />
        <Row
          label="Target / Hari"
          nominal={hasTarget ? formatRupiah(target.TargetNominalDaily!) : "-"}
          qty={hasTarget ? formatQtyPlain(target.TargetQtyDaily) : "-"}
        />
        <Row
          label={`Target s.d. Hari ke-${target.CurrentDay}`}
          nominal={hasTarget ? formatRupiah(target.TargetNominalToDate!) : "-"}
          qty={hasTarget ? formatQtyPlain(target.TargetQtyToDate) : "-"}
        />
        <Row
          label={`Realisasi s.d. Hari ke-${target.CurrentDay}`}
          nominal={formatRupiah(target.RealisasiNominalToDate)}
          qty={formatQtyPlain(target.RealisasiQtyToDate)}
        />
        <div className="flex items-center justify-between py-1.5 text-sm">
          <span className="text-muted-foreground">Growth (Realisasi &minus; Target)</span>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end gap-0.5">
              <span className="tabular-nums font-medium">
                {target.GrowthNominal != null ? formatRupiah(target.GrowthNominal) : "-"}
              </span>
              <GrowthBadge value={target.GrowthNominal} percent={target.GrowthNominalPercent} />
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="tabular-nums text-xs text-muted-foreground">
                {target.GrowthQty != null ? target.GrowthQty.toLocaleString("id-ID", { maximumFractionDigits: 0 }) : "-"}
              </span>
              <GrowthBadge value={target.GrowthQty} percent={target.GrowthQtyPercent} />
            </div>
          </div>
        </div>
        <Row
          label="Target Revenue Besok"
          nominal={target.TargetNominalBesok != null ? formatRupiah(target.TargetNominalBesok) : "-"}
          qty={formatQtyPlain(target.TargetQtyBesok)}
        />
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
