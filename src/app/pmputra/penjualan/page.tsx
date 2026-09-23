// src/app/pmputra/penjualan/page.tsx
import { getPenjualanTrend } from "@/lib/queries/penjualan-piutang";
import { requirePmputra } from "@/lib/require-access";
import { PenjualanTrendPanel } from "@/components/dashboard/penjualan-trend-panel";

export default async function PmputraPenjualanPage() {
  await requirePmputra();
  const data = await getPenjualanTrend("pmputra");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Penjualan</h1>
        <p className="text-sm text-muted-foreground">PT Prima Maesa Putra — Es Balok</p>
      </div>
      <PenjualanTrendPanel data={data} />
    </div>
  );
}
