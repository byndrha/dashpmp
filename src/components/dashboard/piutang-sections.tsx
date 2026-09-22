import { cache } from "react";
import { Receipt, AlertTriangle, Flame, Wallet, HandCoins, Percent } from "lucide-react";
import { getAgingReceivables, type PiutangStatus } from "@/lib/queries/aging";
import { getPiutangPeriodSummary } from "@/lib/queries/piutang-summary";
import { getTodayReceivablePayments } from "@/lib/queries/piutang-payments";
import { getCollectionPriority } from "@/lib/queries/collection-priority";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { AgingTable } from "@/components/dashboard/aging-table";
import { PiutangStatusPanel, type StatusBucket } from "@/components/dashboard/piutang-status-panel";
import { PiutangPaymentsPanel } from "@/components/dashboard/piutang-payments-panel";
import { CollectionPriorityTable } from "@/components/dashboard/collection-priority-table";
import { formatRupiah, formatPercentPoints } from "@/lib/format";
import type { DateRangeFilter } from "@/types/dashboard";

// Setiap seksi di bawah adalah async Server Component-nya sendiri, dirender
// lewat <Suspense> terpisah di page.tsx -- supaya boks "Periode" (query
// ringan, getPiutangPeriodSummary) bisa langsung tampil begitu siap, tanpa
// menunggu boks "Outstanding" dan tabel Invoice yang keduanya bergantung
// pada getAgingReceivables() (query terberat di halaman ini -- lihat
// komentarnya sendiri soal scan ~221k baris vCustomerStatement).
//
// getAgingReceivables/getCollectionPriority dibungkus cache() dari `react`
// supaya dipanggil dari 2 seksi berbeda (boks KPI + tab detail yang sama)
// tetap hanya menjalankan SATU query per request -- bukan query dobel.
// React men-dedupe otomatis berdasarkan argumen yang identik, dalam satu
// request yang sama.
const getAgingReceivablesCached = cache(getAgingReceivables);
const getCollectionPriorityCached = cache(getCollectionPriority);

export async function PiutangKpiRowPeriode({ filter }: { filter: DateRangeFilter }) {
  const periodSummary = await getPiutangPeriodSummary(filter);
  return (
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
  );
}

export async function PiutangKpiRowAging({ wilayah }: { wilayah?: string }) {
  const rows = await getAgingReceivablesCached(wilayah);
  const totalOutstanding = rows.reduce((sum, r) => sum + r.Outstanding, 0);
  const totalOverdue = rows
    .filter((r) => r.AgingBucket !== "Belum Jatuh Tempo")
    .reduce((sum, r) => sum + r.Outstanding, 0);
  const totalCritical = rows.filter((r) => r.AgingBucket === ">90 Hari").reduce((sum, r) => sum + r.Outstanding, 0);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <KpiCard label="Total Piutang Outstanding" value={formatRupiah(totalOutstanding)} icon={Receipt} />
      <KpiCard label="Sudah Jatuh Tempo" value={formatRupiah(totalOverdue)} icon={AlertTriangle} tone="warning" />
      <KpiCard label=">90 Hari (Kritis)" value={formatRupiah(totalCritical)} icon={Flame} tone="negative" />
    </div>
  );
}

export async function PiutangInvoiceTablePanel({ wilayah, perusahaanId }: { wilayah?: string; perusahaanId: number }) {
  const rows = await getAgingReceivablesCached(wilayah);
  return <AgingTable rows={rows} perusahaanId={perusahaanId} />;
}

export async function PiutangStatusSection() {
  const priorityRows = await getCollectionPriorityCached();
  const statusBuckets: StatusBucket[] = (["Sehat", "Perhatian", "Kritis"] as PiutangStatus[]).map((status) => {
    const matching = priorityRows.filter((r) => r.Status === status);
    return {
      status,
      count: matching.length,
      total: matching.reduce((sum, r) => sum + r.PiutangBerjalan, 0),
    };
  });
  return <PiutangStatusPanel buckets={statusBuckets} />;
}

export async function PiutangPrioritasPanel() {
  const priorityRows = await getCollectionPriorityCached();
  return <CollectionPriorityTable rows={priorityRows} />;
}

export async function PiutangPembayaranPanel({
  businessPaymentsDate,
  paymentsDate,
  todayISO,
}: {
  businessPaymentsDate: Date;
  paymentsDate: string;
  todayISO: string;
}) {
  const paymentsRows = await getTodayReceivablePayments(businessPaymentsDate);
  return <PiutangPaymentsPanel rows={paymentsRows} businessDate={paymentsDate} todayISO={todayISO} />;
}
