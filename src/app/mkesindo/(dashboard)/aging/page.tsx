import type { Metadata } from "next";
import { Suspense } from "react";
import { requireModuleAccess } from "@/lib/require-access";
import { getWilayahList } from "@/lib/queries/wilayah";
import { getMkesindoPerusahaanId } from "@/lib/queries/perusahaan";
import { getBusinessDateISO } from "@/lib/business-date";
import { resolveFilter, type DashboardSearchParams } from "@/lib/date-range";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { PiutangTabs } from "@/components/dashboard/piutang-tabs";
import {
  PiutangKpiRowPeriode,
  PiutangKpiRowAging,
  PiutangInvoiceTablePanel,
  PiutangStatusSection,
  PiutangPrioritasPanel,
  PiutangPembayaranPanel,
} from "@/components/dashboard/piutang-sections";

export const metadata: Metadata = { title: "Piutang" };

// 3 boks berdampingan -- dipakai sebagai fallback Suspense untuk setiap
// baris KPI, meniru bentuk KpiCard (Card + judul + angka besar) supaya
// tidak ada "lompatan" tinggi begitu kontennya siap.
function KpiRowSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[104px] w-full rounded-lg" />
      ))}
    </div>
  );
}

function PanelSkeleton() {
  return <Skeleton className="h-32 w-full rounded-lg" />;
}

function TableSkeleton() {
  return <Skeleton className="h-96 w-full rounded-lg" />;
}

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

  // Hanya 2 query ringan yang masih diambil di depan (dibutuhkan FilterBar
  // dan AgingTable segera) -- setiap query berat lainnya (getAgingReceivables,
  // getCollectionPriority, getTodayReceivablePayments) dipindah ke masing-
  // masing seksi async-nya sendiri di piutang-sections.tsx, dirender lewat
  // <Suspense> terpisah di bawah supaya halaman tidak menunggu SEMUA data
  // sekaligus sebelum menampilkan apa pun (lihat komentar di
  // piutang-sections.tsx soal urutan boks Periode vs Aging).
  const [wilayahList, perusahaanId] = await Promise.all([getWilayahList(), getMkesindoPerusahaanId()]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Piutang</h1>
        <FilterBar wilayahList={wilayahList} />
      </div>

      {/* Boks "Periode" (Saldo Awal/Pembayaran/Rasio) ditaruh PALING ATAS --
          hanya bergantung pada getPiutangPeriodSummary, query agregat ringan
          tanpa join per-invoice, jadi ini yang paling cepat tampil.
          Boks "Aging" (Total Outstanding/Overdue/Kritis) di bawahnya berbagi
          query yang sama (getAgingReceivables, di-cache()) dengan tabel
          Invoice Outstanding di tab pertama -- keduanya baru bisa tampil
          begitu query terberat itu selesai, jadi sengaja ditaruh setelah
          boks Periode, bukan lagi di atas seperti sebelumnya. */}
      <Suspense fallback={<KpiRowSkeleton />}>
        <PiutangKpiRowPeriode filter={filter} />
      </Suspense>

      <Suspense fallback={<KpiRowSkeleton />}>
        <PiutangKpiRowAging wilayah={wilayah} />
      </Suspense>

      <Suspense fallback={<PanelSkeleton />}>
        <PiutangStatusSection />
      </Suspense>

      <PiutangTabs
        invoicePanel={
          <Suspense fallback={<TableSkeleton />}>
            <PiutangInvoiceTablePanel wilayah={wilayah} perusahaanId={perusahaanId} />
          </Suspense>
        }
        pembayaranPanel={
          <Suspense fallback={<TableSkeleton />}>
            <PiutangPembayaranPanel businessPaymentsDate={businessPaymentsDate} paymentsDate={paymentsDate} todayISO={todayISO} />
          </Suspense>
        }
        prioritasPanel={
          <Suspense fallback={<TableSkeleton />}>
            <PiutangPrioritasPanel />
          </Suspense>
        }
      />
    </div>
  );
}
