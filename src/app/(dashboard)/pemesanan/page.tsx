import { requireModuleAccess } from "@/lib/require-access";
import { getSalesOrderList } from "@/lib/queries/pemesanan";
import { getMitraList, getPriceLevelOptions } from "@/lib/queries/mitra";
import { getArmadaList } from "@/lib/queries/armada";
import { getDriverOptions } from "@/lib/queries/delivery";
import { getWilayahList } from "@/lib/queries/wilayah";
import { resolveFilter, type DashboardSearchParams } from "@/lib/date-range";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { PemesananFormDialog } from "@/components/dashboard/pemesanan-form-dialog";
import { PemesananList } from "@/components/dashboard/pemesanan-list";

export default async function PemesananPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  await requireModuleAccess("pemesanan");
  const params = await searchParams;
  const filter = resolveFilter(params);

  const [rows, mitraList, armadaList, drivers, priceLevels10kg, priceLevels5kg, wilayahList] = await Promise.all([
    getSalesOrderList({ from: filter.startDate, to: filter.endDate, wilayah: filter.wilayah }),
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

      <div className="flex justify-end">
        <PemesananFormDialog
          mitraList={mitraList}
          armadaList={armadaList}
          drivers={drivers}
          priceLevels10kg={priceLevels10kg}
          priceLevels5kg={priceLevels5kg}
        />
      </div>

      <PemesananList rows={rows} />
    </div>
  );
}
