import { ShoppingCart, Truck, Receipt, Wallet, Package, Coins, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DocChip, QtyChip } from "@/components/dashboard/sales-chips";
import { SalesTodayPanel } from "@/components/dashboard/sales-today-panel";
import { ComparisonCard } from "@/components/dashboard/sales-comparison-card";
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
  const [monthComparison, yoyLastYear, yoyTwoYearsAgo] = comparisons;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SalesTodayPanel
          initialData={overview.today}
          initialDateISO={businessTodayISO}
          businessTodayISO={businessTodayISO}
        />

        <ComparisonCard title="Bulan Ini vs Bulan Lalu" comparison={monthComparison} />
      </div>

      <div>
        <h2 className="mb-2 font-display text-sm font-semibold text-muted-foreground">Perbandingan Tahunan</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ComparisonCard title={`Bulan Ini vs ${yoyLastYear.previousLabel}`} comparison={yoyLastYear} />
          <ComparisonCard title={`Bulan Ini vs ${yoyTwoYearsAgo.previousLabel}`} comparison={yoyTwoYearsAgo} />
        </div>
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
