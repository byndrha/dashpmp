import { ShoppingCart, Truck, Receipt, Wallet, Package, Coins, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DocChip, QtyChip } from "@/components/dashboard/sales-chips";
import { SalesTodayPanel } from "@/components/dashboard/sales-today-panel";
import { SalesComparisonPanel } from "@/components/dashboard/sales-comparison-panel";
import { formatRupiah } from "@/lib/format";
import type { SalesOverview } from "@/lib/queries/sales-overview";

export function SalesOverviewPanels({
  overview,
  businessTodayISO,
}: {
  overview: SalesOverview;
  businessTodayISO: string;
}) {
  const { comparisons, ytd } = overview;

  return (
    // Container-query breakpoints (@2xl/@4xl), not viewport ones (sm/lg):
    // the sidebar can be collapsed or expanded at the same viewport width,
    // which changes how much room this grid actually has without changing
    // the viewport — sm:/lg: can't see that, @-variants (keyed to the
    // @container on the dashboard <main>) do.
    <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3">
      <SalesTodayPanel
        initialData={overview.today}
        initialDateISO={businessTodayISO}
        businessTodayISO={businessTodayISO}
      />

      <SalesComparisonPanel comparisons={comparisons} />

      {/* Below @4xl, this wrapper is `contents` — it disappears from layout
          so Nominal Penjualan and Total Qty behave as independent grid
          items and land in a clean 1-up or 2-up flow with the other two
          cards. At @4xl the wrapper becomes a flex column, nesting both
          into a single 3rd grid cell so the 3-up row lands exactly on 3
          items — no dangling row with two empty columns beside a lone
          card. */}
      <div className="contents @4xl:flex @4xl:flex-col @4xl:gap-3">
        <h2 className="col-span-full font-display text-sm font-semibold text-muted-foreground">Tahun Berjalan</h2>

        <Card className="py-4">
          <CardContent className="flex flex-col gap-2 px-4">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Nominal Penjualan</p>
                <Tooltip>
                  <TooltipTrigger className="flex items-center gap-1.5">
                    <Coins className="size-4 text-muted-foreground" />
                    <span className="font-display text-sm font-semibold tabular-nums">{formatRupiah(ytd.AvgPrice)}</span>
                  </TooltipTrigger>
                  <TooltipContent>Harga Rata-rata</TooltipContent>
                </Tooltip>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="font-display text-xl font-semibold tabular-nums text-primary">{formatRupiah(ytd.NetSales)}</p>
                <Tooltip>
                  <TooltipTrigger className="flex items-center gap-1.5">
                    <Users className="size-4 text-muted-foreground" />
                    <span className="font-display text-sm font-semibold tabular-nums">
                      {ytd.UniqueMitraOrdering.toLocaleString("id-ID")} mitra
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Mitra Memesan</TooltipContent>
                </Tooltip>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <DocChip icon={ShoppingCart} label="SO" value={ytd.SOCount} />
              <DocChip icon={Truck} label="DO" value={ytd.DOCount} />
              <DocChip icon={Receipt} label="SI" value={ytd.SICount} />
              <DocChip icon={Wallet} label="SP" value={ytd.SPCount} />
            </div>
          </CardContent>
        </Card>

        <Card className="py-4">
          <CardContent className="flex flex-wrap items-start justify-between gap-3 px-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Package className="size-3.5" /> Total Qty
                </span>
                <span className="font-display text-lg font-semibold tabular-nums">
                  {(ytd.Qty10KG + ytd.Qty5KG).toLocaleString("id-ID")}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Wallet className="size-3.5" /> Pembayaran
                </span>
                <span className="font-display text-sm font-semibold tabular-nums">{formatRupiah(ytd.TotalPayment)}</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 border-l border-border pl-3">
              <QtyChip label="10KG" value={ytd.Qty10KG} />
              <QtyChip label="5KG" value={ytd.Qty5KG} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
