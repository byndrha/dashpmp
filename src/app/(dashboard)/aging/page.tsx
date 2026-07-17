import { Receipt, AlertTriangle, Flame } from "lucide-react";
import { getAgingReceivables } from "@/lib/queries/aging";
import { getWilayahList } from "@/lib/queries/wilayah";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { AgingTable } from "@/components/dashboard/aging-table";
import { formatRupiah } from "@/lib/format";

export default async function AgingPage({
  searchParams,
}: {
  searchParams: Promise<{ wilayah?: string }>;
}) {
  const params = await searchParams;
  const wilayah = params.wilayah || undefined;

  const [rows, wilayahList] = await Promise.all([getAgingReceivables(wilayah), getWilayahList()]);

  const totalOutstanding = rows.reduce((sum, r) => sum + r.Outstanding, 0);
  const totalOverdue = rows
    .filter((r) => r.AgingBucket !== "Belum Jatuh Tempo")
    .reduce((sum, r) => sum + r.Outstanding, 0);
  const totalCritical = rows.filter((r) => r.AgingBucket === ">90 Hari").reduce((sum, r) => sum + r.Outstanding, 0);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Piutang</h1>
      <FilterBar wilayahList={wilayahList} showDateRange={false} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Total Piutang Outstanding" value={formatRupiah(totalOutstanding)} icon={Receipt} />
        <KpiCard label="Sudah Jatuh Tempo" value={formatRupiah(totalOverdue)} icon={AlertTriangle} tone="warning" />
        <KpiCard label=">90 Hari (Kritis)" value={formatRupiah(totalCritical)} icon={Flame} tone="negative" />
      </div>

      <AgingTable rows={rows} />
    </div>
  );
}
