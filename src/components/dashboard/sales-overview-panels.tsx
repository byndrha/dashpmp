import { TrendingUp, TrendingDown, Minus, ShoppingCart, Truck, Receipt, Wallet, Package, Coins, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatRupiah, formatRupiahAvg, formatPercentPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SalesOverview } from "@/lib/queries/sales-overview";

function DocChip({ icon: Icon, label, value }: { icon: typeof ShoppingCart; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
      <Icon className="size-3" />
      {label} {value.toLocaleString("id-ID")}
    </span>
  );
}

function QtyChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
      <Package className="size-3" />
      {label} {value.toLocaleString("id-ID")} kantong
    </span>
  );
}

export function SalesOverviewPanels({ overview }: { overview: SalesOverview }) {
  const { today, monthComparison, ytd } = overview;
  const pct = monthComparison.PctChange;
  const trendUp = pct != null && pct > 0;
  const trendDown = pct != null && pct < 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="py-4">
          <CardContent className="flex flex-col gap-2 px-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Penjualan Hari Ini</p>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-display text-2xl font-semibold tabular-nums text-primary">
                {formatRupiah(today.NetSales)}
              </p>
              <span
                title="Harga rata-rata"
                aria-label="Harga rata-rata"
                className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
              >
                <Coins className="size-3" />
                {formatRupiahAvg(today.AvgPrice)}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <DocChip icon={ShoppingCart} label="SO" value={today.SOCount} />
              <DocChip icon={Truck} label="DO" value={today.DOCount} />
              <DocChip icon={Receipt} label="SI" value={today.SICount} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
              <QtyChip label="10KG" value={today.Qty10KG} />
              <QtyChip label="5KG" value={today.Qty5KG} />
            </div>
          </CardContent>
        </Card>

        <Card className="py-4">
          <CardContent className="flex flex-col gap-2 px-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Bulan Ini vs Bulan Lalu
            </p>
            <div className="flex items-center gap-2">
              <p className="font-display text-2xl font-semibold tabular-nums">
                {formatRupiah(monthComparison.ThisMonth)}
              </p>
              {pct != null && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium",
                    trendUp && "bg-primary/15 text-primary",
                    trendDown && "bg-destructive/15 text-destructive",
                    !trendUp && !trendDown && "bg-secondary text-muted-foreground"
                  )}
                >
                  {trendUp && <TrendingUp className="size-3" />}
                  {trendDown && <TrendingDown className="size-3" />}
                  {!trendUp && !trendDown && <Minus className="size-3" />}
                  {formatPercentPoints(Math.abs(pct))}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Bulan lalu {formatRupiah(monthComparison.LastMonth)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-2 font-display text-sm font-semibold text-muted-foreground">Tahun Berjalan</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="py-4">
            <CardContent className="flex flex-col gap-2 px-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Nominal Penjualan</p>
              <p className="font-display text-xl font-semibold tabular-nums text-primary">{formatRupiah(ytd.NetSales)}</p>
              <div className="flex flex-wrap gap-1.5">
                <DocChip icon={ShoppingCart} label="SO" value={ytd.SOCount} />
                <DocChip icon={Truck} label="DO" value={ytd.DOCount} />
                <DocChip icon={Receipt} label="SI" value={ytd.SICount} />
              </div>
            </CardContent>
          </Card>
          <Card className="py-4">
            <CardContent className="flex flex-col gap-1.5 px-4">
              <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Package className="size-3.5" /> Total Qty
              </div>
              <p className="font-display text-xl font-semibold tabular-nums">
                {(ytd.Qty10KG + ytd.Qty5KG).toLocaleString("id-ID")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <QtyChip label="10KG" value={ytd.Qty10KG} />
                <QtyChip label="5KG" value={ytd.Qty5KG} />
              </div>
            </CardContent>
          </Card>
          <Card className="py-4">
            <CardContent className="flex flex-col gap-1.5 px-4">
              <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Wallet className="size-3.5" /> Total Pembayaran
              </div>
              <p className="font-display text-xl font-semibold tabular-nums">{formatRupiah(ytd.TotalPayment)}</p>
            </CardContent>
          </Card>
          <Card className="py-4">
            <CardContent className="flex flex-col gap-1.5 px-4">
              <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Coins className="size-3.5" /> Harga Rata-rata
              </div>
              <p className="font-display text-xl font-semibold tabular-nums">{formatRupiah(ytd.AvgPrice)}</p>
            </CardContent>
          </Card>
          <Card className="py-4">
            <CardContent className="flex flex-col gap-1.5 px-4">
              <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Users className="size-3.5" /> Mitra Memesan
              </div>
              <p className="font-display text-xl font-semibold tabular-nums">
                {ytd.UniqueMitraOrdering.toLocaleString("id-ID")}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
