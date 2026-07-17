import Link from "next/link";
import { Wallet, Receipt, Truck, LineChart, Zap, ShoppingCart, ArrowRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { getRecentInvoices, getTodayWilayahPulse } from "@/lib/queries/activity";
import { getAgingReceivables } from "@/lib/queries/aging";
import { getOpenDeliveries } from "@/lib/queries/delivery";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { WilayahPulse } from "@/components/dashboard/wilayah-pulse";
import { RecentActivityFeed } from "@/components/dashboard/recent-activity-feed";
import { GreetingHeader } from "@/components/dashboard/greeting-header";
import { Card, CardContent } from "@/components/ui/card";
import { formatRupiah } from "@/lib/format";

const MODULE_LINKS = [
  { href: "/pnl", label: "Keuangan", desc: "Laba rugi dan titik impas", icon: LineChart },
  { href: "/aging", label: "Piutang", desc: "Umur piutang per mitra", icon: Receipt },
  { href: "/sales", label: "Penjualan", desc: "Penjualan harian per wilayah", icon: ShoppingCart },
  { href: "/electricity", label: "Biaya Listrik", desc: "Biaya listrik vs pendapatan", icon: Zap },
  { href: "/delivery", label: "Pengiriman", desc: "Delivery order terbuka", icon: Truck },
];

export default async function BerandaPage() {
  const session = await auth();
  const [recentInvoices, wilayahPulse, aging, deliveries] = await Promise.all([
    getRecentInvoices(15),
    getTodayWilayahPulse(),
    getAgingReceivables(),
    getOpenDeliveries(),
  ]);

  const todayNetSales = wilayahPulse.reduce((sum, w) => sum + w.NetSales, 0);
  const todayInvoices = wilayahPulse.reduce((sum, w) => sum + w.InvoiceCount, 0);
  const totalOutstanding = aging.reduce((sum, r) => sum + r.Outstanding, 0);
  const openDeliveryOrders = new Set(deliveries.map((d) => d.DeliveryOrderID)).size;

  const name = session?.user?.name ?? session?.user?.username ?? "";

  return (
    <div className="flex flex-col gap-5">
      <GreetingHeader name={name} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Penjualan Hari Ini" value={formatRupiah(todayNetSales)} icon={Wallet} tone="positive" />
        <KpiCard label="Invoice Hari Ini" value={todayInvoices.toLocaleString("id-ID")} icon={ShoppingCart} />
        <KpiCard label="Piutang Outstanding" value={formatRupiah(totalOutstanding)} icon={Receipt} tone="warning" />
        <KpiCard label="Delivery Order Terbuka" value={openDeliveryOrders.toLocaleString("id-ID")} icon={Truck} />
      </div>

      <div>
        <h2 className="mb-2 font-display text-sm font-semibold text-muted-foreground">Pulsa Wilayah &mdash; Hari Ini</h2>
        <WilayahPulse wilayah={wilayahPulse} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
        <RecentActivityFeed invoices={recentInvoices} />

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
    </div>
  );
}
