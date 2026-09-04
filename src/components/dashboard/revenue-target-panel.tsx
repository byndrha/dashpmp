"use client";

import { useState, useTransition } from "react";
import {
  Target,
  TrendingUp,
  TrendingDown,
  Minus,
  CalendarDays,
  Wallet,
  Gauge,
  Rocket,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
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
import { saveMonthlyTargetAction, getRevenueTargetForMonthAction } from "@/app/mkesindo/(dashboard)/sales/actions";

function formatQtyPlain(value: number | null): string {
  if (value == null) return "-";
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: 0 })} kantong`;
}

const INDONESIAN_MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

// Plain string/integer arithmetic, not Date/date-fns — a "YYYY-MM-01" parsed
// into a Date and read back via local getters can land on the wrong month
// depending on the host's ambient timezone offset.
function monthLabel(year: number, month: number): string {
  return `${INDONESIAN_MONTHS[month - 1]} ${year}`;
}

function shiftMonthISO(monthISO: string, delta: number): string {
  const [year, month] = monthISO.split("-").map(Number);
  const zeroBased = month - 1 + delta;
  const shiftedYear = year + Math.floor(zeroBased / 12);
  const shiftedMonth = ((zeroBased % 12) + 12) % 12;
  return `${shiftedYear}-${String(shiftedMonth + 1).padStart(2, "0")}-01`;
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
  tone?: "default" | "primary" | "destructive";
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
          tone === "primary" && "text-primary",
          tone === "destructive" && "text-destructive",
          tone === "default" && "text-foreground"
        )}
      >
        {nominal}
      </p>
      {qty && <p className="text-xs text-muted-foreground">{qty}</p>}
    </div>
  );
}

export function RevenueTargetPanel({
  target: initialTarget,
  businessTodayISO,
}: {
  target: RevenueTarget;
  businessTodayISO: string;
}) {
  const [target, setTarget] = useState(initialTarget);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [navPending, startNavTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const monthISO = `${target.Year}-${String(target.Month).padStart(2, "0")}-01`;
  const currentMonthISO = businessTodayISO.slice(0, 7) + "-01";
  const canGoNext = monthISO < currentMonthISO;

  function navigate(nextMonthISO: string) {
    startNavTransition(async () => {
      const result = await getRevenueTargetForMonthAction(nextMonthISO);
      setTarget(result);
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setError(null);
  }

  function handleSubmit(formData: FormData) {
    const targetNominal = Number(formData.get("targetNominal"));
    const targetQty = Number(formData.get("targetQty"));
    setError(null);
    startTransition(async () => {
      const result = await saveMonthlyTargetAction({ year: target.Year, month: target.Month, targetNominal, targetQty });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  const hasTarget = target.TargetNominalMonthly != null;
  // `target.TargetNominalToDate` used as a truthy gate would also treat an
  // explicitly-set 0 target (a real, submittable value in the "Set Target"
  // dialog below) as "no target data" and hide the bar instead of showing
  // 0% — check for null/undefined instead of truthiness.
  const progressPct =
    hasTarget && target.TargetNominalToDate != null
      ? target.TargetNominalToDate
        ? Math.min(150, (target.RealisasiNominalToDate / target.TargetNominalToDate) * 100)
        : 0
      : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="font-display">
            Target Revenue vs Realisasi &mdash; {monthLabel(target.Year, target.Month)}
          </CardTitle>
          <CardDescription>
            {target.IsCurrentMonth
              ? `Hari ke-${target.CurrentDay} dari ${target.DaysInMonth} hari (${formatDate(target.Today)})`
              : `Bulan penuh — ${target.DaysInMonth} hari`}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={navPending}
              onClick={() => navigate(shiftMonthISO(monthISO, -1))}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={navPending || !canGoNext}
              onClick={() => canGoNext && navigate(shiftMonthISO(monthISO, 1))}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => handleOpenChange(true)}>
            <Target className="size-3.5" />
            Set Target
          </Button>
        </div>
      </CardHeader>
      <CardContent className={cn("flex flex-col gap-3", navPending && "opacity-50 transition-opacity")}>
        {/* Hero: progress s.d. hari ini (bulan berjalan) atau realisasi
            penuh sebulan (bulan lampau, dipilih lewat tombol navigasi) */}
        <div className="rounded-lg border border-primary/25 bg-primary/5 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {target.IsCurrentMonth
                  ? `Realisasi vs Target s.d. Hari ke-${target.CurrentDay}`
                  : "Realisasi vs Target — Bulan Penuh"}
              </p>
              <p className="font-display text-2xl font-semibold tabular-nums text-primary">
                {formatRupiah(target.RealisasiNominalToDate)}
              </p>
              <p className="text-xs text-muted-foreground">
                dari target {hasTarget ? formatRupiah(target.TargetNominalToDate!) : "-"} &middot;{" "}
                {formatQtyPlain(target.RealisasiQtyToDate)}
                {hasTarget && ` dari ${formatQtyPlain(target.TargetQtyToDate)}`}
              </p>
              {!target.IsCurrentMonth && progressPct != null && (
                <p className="mt-1 text-xs font-medium text-primary">
                  {progressPct.toFixed(0)}% capaian bulan tsb
                </p>
              )}
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

        {/* Container query (not sm:) — this panel sits on the same page as
            the overview grid, which switched to @container-based
            breakpoints because a viewport breakpoint can't see that the
            sidebar's collapsed/expanded state changes actual content width
            at a fixed viewport size. A `sm:` breakpoint here would squeeze
            these tiles at the same widths that grid was fixed to avoid. */}
        <div className={cn("grid grid-cols-2 gap-3", target.IsCurrentMonth ? "@2xl:grid-cols-4" : "@2xl:grid-cols-3")}>
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
            tone={target.GrowthQty == null ? "default" : target.GrowthQty >= 0 ? "primary" : "destructive"}
          />
          {target.IsCurrentMonth && (
            <StatTile
              icon={Rocket}
              label="Target Revenue Besok"
              nominal={target.TargetNominalBesok != null ? formatRupiah(target.TargetNominalBesok) : "-"}
              qty={formatQtyPlain(target.TargetQtyBesok)}
              tone="primary"
            />
          )}
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={handleOpenChange}>
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
            {error && <p className="text-xs text-destructive">{error}</p>}
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
