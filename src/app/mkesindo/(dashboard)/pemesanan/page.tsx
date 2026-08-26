import type { Metadata } from "next";
import { Suspense } from "react";
import { requireModuleAccess } from "@/lib/require-access";
import { getBusinessDateISO } from "@/lib/business-date";
import { getSalesOrderList, type SalesOrderListFilter } from "@/lib/queries/pemesanan";
import { getMitraList, getPriceLevelOptions } from "@/lib/queries/mitra";
import { getArmadaList, type ArmadaRow } from "@/lib/queries/armada";
import { getDriverOptions, type DriverOption } from "@/lib/queries/delivery";
import { getWilayahList } from "@/lib/queries/wilayah";
import { resolveFilter, type DashboardSearchParams } from "@/lib/date-range";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { PemesananDocFilter } from "@/components/dashboard/pemesanan-doc-filter";
import { PemesananFormDialog } from "@/components/dashboard/pemesanan-form-dialog";
import { PemesananList } from "@/components/dashboard/pemesanan-list";

function docFilterValue(value: string | undefined): "yes" | "no" | undefined {
  return value === "yes" || value === "no" ? value : undefined;
}

// Isolates the slow part (getSalesOrderList — the SalesInvoice/SalesReturn
// lookups it depends on take several seconds even warm, see
// getInvoiceIdMaps's own comment) behind its own Suspense boundary, so a
// filter change only ever blanks out the list below — FilterBar,
// PemesananDocFilter, and "Buat Pemesanan" all stay mounted and interactive
// the whole time, instead of the entire page (including the filter
// controls themselves) disappearing behind the shared dashboard skeleton on
// every filter change.
async function PemesananListSection({
  filter,
  armadaList,
  drivers,
}: {
  filter: SalesOrderListFilter;
  armadaList: ArmadaRow[];
  drivers: DriverOption[];
}) {
  const rows = await getSalesOrderList(filter);
  return <PemesananList rows={rows} armadaList={armadaList} drivers={drivers} />;
}

// Same visual language as piutang-payments-panel.tsx's isPending bar
// (animate-indeterminate is defined once in globals.css specifically for
// "a slow server round-trip with no fixed progress fraction to show") —
// here it's a Suspense fallback instead of a useTransition isPending flag,
// since the slow part is a Server Component fetch, not a client-triggered
// transition this page's own code controls.
function PemesananListLoadingBar() {
  return (
    <div className="relative flex flex-col divide-y overflow-hidden rounded-lg border">
      <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-primary/15">
        <div className="h-full w-1/3 animate-indeterminate rounded-full bg-primary" />
      </div>
      <p className="py-8 text-center text-sm text-muted-foreground">Memuat data...</p>
    </div>
  );
}

export const metadata: Metadata = { title: "Pemesanan" };

export default async function PemesananPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  await requireModuleAccess("pemesanan");
  const params = await searchParams;
  const filter = resolveFilter(params);
  const todayISO = getBusinessDateISO();
  const soListFilter: SalesOrderListFilter = {
    from: filter.startDate,
    to: filter.endDate,
    wilayah: filter.wilayah,
    hasDO: docFilterValue(params.hasDO),
    hasSoInvoice: docFilterValue(params.hasSoInvoice),
    hasDoInvoice: docFilterValue(params.hasDoInvoice),
  };

  const [mitraList, armadaList, drivers, priceLevels10kg, priceLevels5kg, wilayahList] = await Promise.all([
    getMitraList(),
    getArmadaList(),
    getDriverOptions(),
    getPriceLevelOptions("Es Tube Jual"),
    getPriceLevelOptions("Es Tube Jual 5 KG"),
    getWilayahList(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Pemesanan</h1>
        <FilterBar wilayahList={wilayahList} />
      </div>

      <PemesananDocFilter />

      <div className="flex justify-end">
        <PemesananFormDialog
          mitraList={mitraList}
          armadaList={armadaList}
          drivers={drivers}
          priceLevels10kg={priceLevels10kg}
          priceLevels5kg={priceLevels5kg}
          todayISO={todayISO}
        />
      </div>

      <Suspense fallback={<PemesananListLoadingBar />}>
        <PemesananListSection filter={soListFilter} armadaList={armadaList} drivers={drivers} />
      </Suspense>
    </div>
  );
}
