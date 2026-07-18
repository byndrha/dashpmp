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
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <SalesTodayPanel
        initialData={overview.today}
        initialDateISO={businessTodayISO}
        businessTodayISO={businessTodayISO}
      />

      <SalesComparisonPanel comparisons={comparisons} />

      <Card className="py-4">
        <CardContent className="flex items-start justify-between gap-3 px-4">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Nominal Penjualan</p>
            <p className="font-display text-xl font-semibold tabular-nums text-primary">{formatRupiah(ytd.NetSales)}</p>
            <div className="flex flex-wrap gap-1.5">
              <DocChip icon={ShoppingCart} label="SO" value={ytd.SOCount} />
              <DocChip icon={Truck} label="DO" value={ytd.DOCount} />
              <DocChip icon={Receipt} label="SI" value={ytd.SICount} />
              <DocChip icon={Wallet} label="SP" value={ytd.SPCount} />
            </div>
          </div>
          <div className="flex flex-col items-end gap-2.5 border-l border-border pl-4">
            <Tooltip>
              <TooltipTrigger className="flex items-center gap-2">
                <Coins className="size-4 text-muted-foreground" />
                <span className="font-display text-base font-semibold tabular-nums">{formatRupiah(ytd.AvgPrice)}</span>
              </TooltipTrigger>
              <TooltipContent>Harga Rata-rata</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger className="flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" />
                <span className="font-display text-base font-semibold tabular-nums">
                  {ytd.UniqueMitraOrdering.toLocaleString("id-ID")} mitra
                </span>
              </TooltipTrigger>
              <TooltipContent>Mitra Memesan</TooltipContent>
            </Tooltip>
          </div>
        </CardContent>
      </Card>

      <Card className="py-4">
        <CardContent className="flex items-start justify-between gap-3 px-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Package className="size-3.5" /> Total Qty
            </div>
            <p className="font-display text-xl font-semibold tabular-nums">
              {(ytd.Qty10KG + ytd.Qty5KG).toLocaleString("id-ID")}
            </p>
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Wallet className="size-3.5" /> Pembayaran
            </div>
            <p className="font-display text-sm font-semibold tabular-nums">{formatRupiah(ytd.TotalPayment)}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5 border-l border-border pl-3">
            <QtyChip label="10KG" value={ytd.Qty10KG} />
            <QtyChip label="5KG" value={ytd.Qty5KG} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
