// src/app/pmputra/piutang/page.tsx
import { getPiutangSummary } from "@/lib/queries/penjualan-piutang";
import { requirePmputra } from "@/lib/require-access";
import { PiutangSummaryPanel } from "@/components/dashboard/piutang-summary-panel";

export default async function PmputraPiutangPage() {
  await requirePmputra();
  const data = await getPiutangSummary("pmputra");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Piutang</h1>
        <p className="text-sm text-muted-foreground">PT Prima Maesa Putra — Es Balok</p>
      </div>
      <PiutangSummaryPanel data={data} />
    </div>
  );
}
