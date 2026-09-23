// src/app/pmpersada/(dashboard)/piutang/page.tsx
import { getPiutangSummary } from "@/lib/queries/penjualan-piutang";
import { requirePmpersadaKeuangan } from "@/lib/require-access";
import { PiutangSummaryPanel } from "@/components/dashboard/piutang-summary-panel";

export default async function PmpersadaPiutangPage() {
  await requirePmpersadaKeuangan();
  const data = await getPiutangSummary("pmpersada");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Piutang</h1>
        <p className="text-sm text-muted-foreground">PT Putra Maesa Persada — Es Balok</p>
      </div>
      <PiutangSummaryPanel data={data} />
    </div>
  );
}
