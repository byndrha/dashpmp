import Link from "next/link";
import { redirect } from "next/navigation";
import { Wallet, Receipt, Package, LineChart, Zap, ShoppingCart, ArrowRight, Truck } from "lucide-react";
import { requireModuleAccess } from "@/lib/require-access";
import { getTodayWilayahPulse } from "@/lib/queries/activity";
import { getAgingReceivables, getPiutangStatusOverview } from "@/lib/queries/aging";
import { getSalesForDay, getSalesDayComparison } from "@/lib/queries/sales-overview";
import { getTopMitraPiutang } from "@/lib/queries/top-mitra-piutang";
import { getBusinessDate } from "@/lib/business-date";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { WilayahPulse } from "@/components/dashboard/wilayah-pulse";
import { SalesDayComparisonPanel } from "@/components/dashboard/sales-day-comparison-panel";
import { PiutangOverviewPanel } from "@/components/dashboard/piutang-overview-panel";
import { TopMitraPiutangPanel } from "@/components/dashboard/top-mitra-piutang-panel";
import { GreetingHeader } from "@/components/dashboard/greeting-header";
import { Card, CardContent } from "@/components/ui/card";
import { formatRupiah } from "@/lib/format";
import { MARKETING_ROLE_ID } from "@/lib/roles";

const MODULE_LINKS = [
  { href: "/pnl", label: "Keuangan", desc: "Laba rugi dan titik impas", icon: LineChart },
  { href: "/aging", label: "Piutang", desc: "Umur piutang per mitra", icon: Receipt },
  { href: "/sales", label: "Penjualan", desc: "Penjualan harian per wilayah", icon: ShoppingCart },
  { href: "/electricity", label: "Biaya Listrik", desc: "Biaya listrik vs pendapatan", icon: Zap },
  { href: "/delivery", label: "Pengiriman", desc: "Delivery order terbuka", icon: Truck },
];

export default async function BerandaPage() {
  const session = await requireModuleAccess("beranda");

  // Marketing always lands on Pemasaran instead of Beranda — whether that's
  // right after login or from navigating/clicking back to "/" later, since
  // Beranda's KPIs aren't relevant to their day-to-day work.
  if (!session.user.isSuperAdmin && session.user.roleId === MARKETING_ROLE_ID) {
    redirect("/pemasaran");
  }

  const businessToday = getBusinessDate();
  const [wilayahPulse, aging, todaySales, piutangOverview, topMitraPiutang] = await Promise.all([
    getTodayWilayahPulse(),
    getAgingReceivables(),
    getSalesForDay(businessToday),
    getPiutangStatusOverview(),
    getTopMitraPiutang(),
  ]);
  const salesDayComparison = await getSalesDayComparison(todaySales, businessToday);

  // Penjualan Hari Ini must come from getSalesForDay (the same unrestricted
  // query the Penjualan module's "Hari Ini" card uses), NOT from summing
  // wilayahPulse — that's capped to the top 6 wilayah for the "Pulsa
  // Wilayah" widget below, so summing it silently drops revenue from every
  // wilayah past the top 6 (verified live: today it undercounted by the
  // full Wonogiri total).
  const todayNetSales = todaySales.NetSales;
  const kantongTerkirim = todaySales.Qty10KG + todaySales.Qty5KG;
  const totalOutstanding = aging.reduce((sum, r) => sum + r.Outstanding, 0);

  const name = session?.user?.name ?? session?.user?.username ?? "";

  return (
    <div className="flex flex-col gap-5">
      <GreetingHeader name={name} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Kantong Terkirim" value={kantongTerkirim.toLocaleString("id-ID")} icon={Package} />
        <KpiCard label="Penjualan Hari Ini" value={formatRupiah(todayNetSales)} icon={Wallet} tone="positive" />
        <KpiCard label="Piutang Outstanding" value={formatRupiah(totalOutstanding)} icon={Receipt} tone="warning" />
      </div>

      <div>
        <h2 className="mb-2 font-display text-sm font-semibold text-muted-foreground">Pulsa Wilayah &mdash; Hari Ini</h2>
        <WilayahPulse wilayah={wilayahPulse} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
        <SalesDayComparisonPanel comparisons={salesDayComparison} />

        <div className="flex flex-col gap-3">
          {MODULE_LINKS.map((m) => (
            <Link key={m.href} href={m.href}>
              <Card className="transition-colors hover:border-primary/40 hover:bg-primary/5 py-3.5">
                <CardContent className="flex items-center gap-3 px-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-primary">
                    <m.icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{m.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.desc}</p>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      <PiutangOverviewPanel overview={piutangOverview} />

      <TopMitraPiutangPanel rows={topMitraPiutang} />
    </div>
  );
}
