import { Receipt, AlertTriangle, Flame } from "lucide-react";
import { getAgingReceivables } from "@/lib/queries/aging";
import { getBranches } from "@/lib/queries/branches";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { AgingTable } from "@/components/dashboard/aging-table";
import { formatRupiah } from "@/lib/format";

export default async function AgingPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const params = await searchParams;
  const branchId = params.branch || undefined;

  const [rows, branches] = await Promise.all([getAgingReceivables(branchId), getBranches()]);

  const totalOutstanding = rows.reduce((sum, r) => sum + r.Outstanding, 0);
  const totalOverdue = rows
    .filter((r) => r.AgingBucket !== "Belum Jatuh Tempo")
    .reduce((sum, r) => sum + r.Outstanding, 0);
  const totalCritical = rows.filter((r) => r.AgingBucket === ">90 Hari").reduce((sum, r) => sum + r.Outstanding, 0);

  return (
    <div className="flex flex-col gap-4">
      <FilterBar branches={branches} showDateRange={false} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Total Piutang Outstanding" value={formatRupiah(totalOutstanding)} icon={Receipt} />
        <KpiCard label="Sudah Jatuh Tempo" value={formatRupiah(totalOverdue)} icon={AlertTriangle} tone="warning" />
        <KpiCard label=">90 Hari (Kritis)" value={formatRupiah(totalCritical)} icon={Flame} tone="negative" />
      </div>

      <AgingTable rows={rows} />
    </div>
  );
}
