import type { Metadata } from "next";
import { Building2, Wallet, Receipt, ShoppingCart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { getSalesForDay } from "@/lib/queries/sales-overview";
import { getPiutangStatusOverview } from "@/lib/queries/aging";
import { getBusinessDate } from "@/lib/business-date";
import { formatRupiah } from "@/lib/format";

export const metadata: Metadata = { title: "Ringkasan Perusahaan" };

export default async function GrupPage() {
  // Reuses the same lightweight KPI queries Beranda already computes —
  // just today's numbers, no drill-down into the full MKEsindo module set
  // from here (deliberately out of scope this pass, see spec doc).
  const [salesToday, piutang] = await Promise.all([
    getSalesForDay(getBusinessDate()),
    getPiutangStatusOverview(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Ringkasan Perusahaan</h1>
        <p className="text-sm text-muted-foreground">Ringkasan hari ini di seluruh perusahaan PMP Group.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-primary" />
              <CardTitle>PT Mitra Kelola Esindo</CardTitle>
            </div>
            <CardDescription>Es Kristal — Ponorogo</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiCard label="Penjualan Hari Ini" value={formatRupiah(salesToday.NetSales)} icon={ShoppingCart} tone="positive" />
            <KpiCard label="Pengiriman Hari Ini" value={String(salesToday.DOCount)} hint="DO" icon={Wallet} />
            <KpiCard label="Piutang Outstanding" value={formatRupiah(piutang.totalOutstanding)} icon={Receipt} tone="warning" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground" />
              <CardTitle>PT Prima Maesa Putra</CardTitle>
            </div>
            <CardDescription>Es Balok</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Belum ada data — integrasi database belum dihubungkan.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
