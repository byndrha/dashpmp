import type { Metadata } from "next";
import { Suspense } from "react";
import { requireModuleAccess } from "@/lib/require-access";
import { getWilayahList } from "@/lib/queries/wilayah";
import { getMkesindoPerusahaanId } from "@/lib/queries/perusahaan";
import { getBusinessDateISO } from "@/lib/business-date";
import { resolveFilter, type DashboardSearchParams } from "@/lib/date-range";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { PenagihanByChatPanel } from "@/components/dashboard/penagihan-bychat-panel";
import { PiutangTabs } from "@/components/dashboard/piutang-tabs";
import {
  PiutangRingkasanEsKristal,
  PiutangTrenEsKristal,
  PiutangInvoiceTablePanel,
  PiutangPrioritasPanel,
  PiutangPembayaranPanel,
} from "@/components/dashboard/piutang-sections";

export const metadata: Metadata = { title: "Piutang" };

// Bentuk sama dengan RingkasanPiutang (kartu posisi + alur, lalu umur)
// supaya tidak ada "lompatan" tinggi begitu kontennya siap.
function RingkasanSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-[150px] w-full rounded-xl" />
        <Skeleton className="h-[150px] w-full rounded-xl lg:col-span-2" />
      </div>
      <Skeleton className="h-[220px] w-full rounded-xl" />
    </div>
  );
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

      {/* Ringkasan (posisi, pergerakan periode, umur & status) — satu
          Suspense karena posisi/umur dan pergerakan sama-sama dibutuhkan.
          Tren bulanan menyusul sendiri (query agregat ringan). */}
      <Suspense fallback={<RingkasanSkeleton />}>
        <PiutangRingkasanEsKristal filter={filter} wilayah={wilayah} />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-[260px] w-full rounded-xl" />}>
        <PiutangTrenEsKristal bulanBerjalan={todayISO.slice(0, 7)} />
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
        penagihanPanel={<PenagihanByChatPanel />}
      />
    </div>
  );
}
