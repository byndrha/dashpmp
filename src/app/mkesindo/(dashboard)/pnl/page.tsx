import type { Metadata } from "next";
import { Suspense } from "react";
import { requireModuleAccess, canAccessAllPT } from "@/lib/require-access";
import { ACCOUNTING_ROLE_IDS } from "@/lib/roles";
import { getBusinessDateISO } from "@/lib/business-date";
import { resolveFilter, type DashboardSearchParams } from "@/lib/date-range";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PnlKpiRow,
  PnlGLPostingHealthSection,
  PnlCashFlowSection,
  PnlCashFlowHarianSection,
  PnlCashFlowHarianHistorySection,
  PnlRincianSection,
  PnlCoaDetailSection,
  PnlBalanceSheetSection,
  PnlBepSection,
  PnlHppBersihSection,
} from "@/app/mkesindo/(dashboard)/pnl/pnl-sections";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Keuangan" };

function KpiRowSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-[104px] w-full rounded-lg" />
      ))}
    </div>
  );
}

function PanelSkeleton({ className = "h-64" }: { className?: string }) {
  return <Skeleton className={`${className} w-full rounded-lg`} />;
}

export default async function PnLPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const session = await requireModuleAccess("pnl");
  // Sama persis dengan requireGLBacklogAccess() yang menggerbangi
  // previewGLBacklogAction/postGLBacklogAction -- Manager ke atas (lewat
  // bolehGenerateKodeAmbilAlih, dipinjam dari fitur Kode Ambil-Alih) ATAU
  // role Accounting, ditambahkan atas permintaan user 2026-09-23.
  const bolehProsesGLBacklog =
    canAccessAllPT(session.user) || session.user.bolehGenerateKodeAmbilAlih || ACCOUNTING_ROLE_IDS.includes(session.user.roleId);
  const params = await searchParams;
  const filter = resolveFilter(params);
  const cfDate = params.cfDate ?? getBusinessDateISO();

  // Jendela tanggal HARUS sama persis dengan yang dipakai getGLPostingHealth
  // (todayISO, hari=30 default) di dalam PnlGLPostingHealthSection -- lihat
  // gl-posting-health.ts: endDate = todayISO + 1 hari (batas atas
  // eksklusif), startDate = endDate dikurangi `hari` hari. Direplikasi di
  // sini (bukan diimpor) karena getGLPostingHealth menghitungnya secara
  // internal dan tidak mengekspornya -- kalau logikanya berubah di sana,
  // ubah juga di sini.
  const todayISOUntukBackfill = getBusinessDateISO();
  const backfillEndDate = new Date(`${todayISOUntukBackfill}T00:00:00.000Z`);
  backfillEndDate.setUTCDate(backfillEndDate.getUTCDate() + 1);
  const backfillStartDate = new Date(backfillEndDate);
  backfillStartDate.setUTCDate(backfillStartDate.getUTCDate() - 30);
  const backfillStartISO = backfillStartDate.toISOString().slice(0, 10);
  const backfillEndISO = backfillEndDate.toISOString().slice(0, 10);

  const periodStart = new Date(filter.startDate);
  // filter.endDate is an exclusive boundary (start of the day *after* the
  // selected period) — the balance sheet's actual "as of" cutoff is the day
  // before that. Plain UTC arithmetic, not date-fns' subDays: filter.endDate
  // is a "YYYY-MM-DD" string, which parses as UTC midnight, and date-fns
  // reads local getters — unsafe on a host running behind UTC (see
  // monthBoundary()'s comment in business-date.ts for the same class of bug
  // this project has already hit elsewhere).
  const endDateUTC = new Date(filter.endDate);
  const balanceSheetCutoff = new Date(
    Date.UTC(endDateUTC.getUTCFullYear(), endDateUTC.getUTCMonth(), endDateUTC.getUTCDate() - 1)
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Keuangan</h1>
      <FilterBar />

      <Suspense fallback={<KpiRowSkeleton />}>
        <PnlKpiRow filter={filter} />
      </Suspense>

      <Suspense fallback={<PanelSkeleton className="h-40" />}>
        <PnlGLPostingHealthSection
          bolehProsesGLBacklog={bolehProsesGLBacklog}
          backfillStartISO={backfillStartISO}
          backfillEndISO={backfillEndISO}
          todayISO={todayISOUntukBackfill}
        />
      </Suspense>

      {/* Container query, not lg: — this page lives under the same
          @container/dashboard-main as Penjualan, so the split should react to
          actual content width (sidebar collapsed/expanded), not the raw
          viewport. Plain lg: here previously left the two cards stacked
          (Komposisi Biaya vs Laba rendering below Rincian P&L) whenever the
          content area was narrower than the viewport, e.g. with the sidebar
          expanded — same class of bug already fixed below for COA/Balance
          Sheet. col-span-3/2 of 5 gives the requested 60%/40% split, same
          ratio as the COA/Balance Sheet row below. */}
      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-5">
        <div className="flex flex-col gap-4 @4xl:col-span-3">
          <Suspense fallback={<PanelSkeleton />}>
            <PnlCashFlowSection filter={filter} balanceSheetCutoff={balanceSheetCutoff} />
          </Suspense>
          <Suspense fallback={<PanelSkeleton />}>
            <PnlCashFlowHarianSection cfDate={cfDate} />
          </Suspense>
          <Suspense fallback={<PanelSkeleton className="h-40" />}>
            <PnlCashFlowHarianHistorySection cfDate={cfDate} />
          </Suspense>
        </div>

        <div className="flex flex-col gap-4 @4xl:col-span-2">
          <Suspense
            fallback={
              <>
                <PanelSkeleton className="h-72" />
                <PanelSkeleton className="h-56" />
              </>
            }
          >
            <PnlRincianSection filter={filter} />
          </Suspense>
        </div>
      </div>

      {/* Same container-query fix as the row above. col-span-3/2 of 5 gives
          the requested ~60%/40% split. A border-r on the left column
          (instead of a standalone divider element) doubles as the separator
          line between the two side-by-side panels. */}
      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-5">
        <div className="@4xl:col-span-3 @4xl:border-r @4xl:border-border @4xl:pr-4">
          <h2 className="mb-2 font-display text-sm font-semibold text-muted-foreground">
            Detail per Akun (COA) &mdash; APBP vs Realisasi
          </h2>
          <Suspense fallback={<PanelSkeleton className="h-96" />}>
            <PnlCoaDetailSection filter={filter} periodStart={periodStart} />
          </Suspense>
        </div>
        <div className="@4xl:col-span-2">
          <h2 className="mb-2 font-display text-sm font-semibold text-muted-foreground">
            Detail Balance Sheet &mdash; per {formatDate(balanceSheetCutoff)}
          </h2>
          <Suspense fallback={<PanelSkeleton className="h-96" />}>
            <PnlBalanceSheetSection filter={filter} />
          </Suspense>
        </div>
      </div>

      <hr className="border-border" />

      <Suspense fallback={<PanelSkeleton className="h-56" />}>
        <PnlBepSection filter={filter} />
      </Suspense>

      <Suspense fallback={<PanelSkeleton className="h-64" />}>
        <PnlHppBersihSection />
      </Suspense>
    </div>
  );
}
