import { Receipt, AlertTriangle, Flame, Wallet, HandCoins, Percent } from "lucide-react";
import { requireModuleAccess } from "@/lib/require-access";
import { getAgingReceivables } from "@/lib/queries/aging";
import { getWilayahList } from "@/lib/queries/wilayah";
import { getPiutangPeriodSummary } from "@/lib/queries/piutang-summary";
import { getTodayReceivablePayments } from "@/lib/queries/piutang-payments";
import { getCollectionPriority } from "@/lib/queries/collection-priority";
import { getBusinessDateISO } from "@/lib/business-date";
import { resolveFilter, type DashboardSearchParams } from "@/lib/date-range";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { AgingTable } from "@/components/dashboard/aging-table";
import { PiutangStatusPanel, type StatusBucket } from "@/components/dashboard/piutang-status-panel";
import { PiutangPaymentsPanel } from "@/components/dashboard/piutang-payments-panel";
import { CollectionPriorityTable } from "@/components/dashboard/collection-priority-table";
import { PiutangTabs } from "@/components/dashboard/piutang-tabs";
import { formatRupiah, formatPercentPoints } from "@/lib/format";
import type { PiutangStatus } from "@/lib/queries/aging";

export default async function AgingPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams & { piutangDate?: string }>;
}) {
  await requireModuleAccess("aging");
  const params = await searchParams;
  const wilayah = params.wilayah || undefined;
  const filter = resolveFilter(params);

  const todayISO = getBusinessDateISO();
  const paymentsDate = params.piutangDate && params.piutangDate <= todayISO ? params.piutangDate : todayISO;
  // paymentsDate is already a plain "YYYY-MM-DD" business-date string —
  // constructing it directly (not re-deriving via getBusinessDate(), which
  // re-applies the 14:00 WIB rollover against "now") keeps it exactly the
  // UTC-midnight Date getTodayReceivablePayments expects.
  const businessPaymentsDate = new Date(paymentsDate);

  const [rows, wilayahList, periodSummary, paymentsRows, priorityRows] = await Promise.all([
    getAgingReceivables(wilayah),
    getWilayahList(),
    getPiutangPeriodSummary(filter),
    getTodayReceivablePayments(businessPaymentsDate),
    getCollectionPriority(),
  ]);

  const totalOutstanding = rows.reduce((sum, r) => sum + r.Outstanding, 0);
  const totalOverdue = rows
    .filter((r) => r.AgingBucket !== "Belum Jatuh Tempo")
    .reduce((sum, r) => sum + r.Outstanding, 0);
  const totalCritical = rows.filter((r) => r.AgingBucket === ">90 Hari").reduce((sum, r) => sum + r.Outstanding, 0);

  const statusBuckets: StatusBucket[] = (["Sehat", "Perhatian", "Kritis"] as PiutangStatus[]).map((status) => {
    const matching = priorityRows.filter((r) => r.Status === status);
    return {
      status,
      count: matching.length,
      total: matching.reduce((sum, r) => sum + r.PiutangBerjalan, 0),
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Piutang</h1>
        <FilterBar wilayahList={wilayahList} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Total Piutang Outstanding" value={formatRupiah(totalOutstanding)} icon={Receipt} />
        <KpiCard label="Sudah Jatuh Tempo" value={formatRupiah(totalOverdue)} icon={AlertTriangle} tone="warning" />
        <KpiCard label=">90 Hari (Kritis)" value={formatRupiah(totalCritical)} icon={Flame} tone="negative" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Saldo Awal Periode" value={formatRupiah(periodSummary.SaldoAwalPeriode)} icon={Wallet} />
        <KpiCard
          label="Pembayaran Piutang Periode Ini"
          value={formatRupiah(periodSummary.TotalPembayaranPeriode)}
          icon={HandCoins}
          tone="positive"
        />
        <KpiCard
          label="Rasio Piutang / Omzet"
          value={formatPercentPoints(periodSummary.RatioPiutangOmzetPct)}
          icon={Percent}
          tone={periodSummary.RatioPiutangOmzetPct > 30 ? "negative" : "default"}
        />
      </div>

      <PiutangStatusPanel buckets={statusBuckets} />

      <PiutangTabs
        invoicePanel={<AgingTable rows={rows} />}
        pembayaranPanel={<PiutangPaymentsPanel rows={paymentsRows} businessDate={paymentsDate} todayISO={todayISO} />}
        prioritasPanel={<CollectionPriorityTable rows={priorityRows} />}
      />
    </div>
  );
}
