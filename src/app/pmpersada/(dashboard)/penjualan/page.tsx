// src/app/pmpersada/(dashboard)/penjualan/page.tsx
import { getPenjualanTrend } from "@/lib/queries/penjualan-piutang";
import { requirePmpersadaKeuangan } from "@/lib/require-access";
import { PenjualanTrendPanel } from "@/components/dashboard/penjualan-trend-panel";

export default async function PmpersadaPenjualanPage() {
  await requirePmpersadaKeuangan();
  const data = await getPenjualanTrend("pmpersada");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Penjualan</h1>
        <p className="text-sm text-muted-foreground">PT Putra Maesa Persada — Es Balok</p>
      </div>
      <PenjualanTrendPanel data={data} />
    </div>
  );
}
