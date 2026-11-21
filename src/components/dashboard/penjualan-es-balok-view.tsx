// Isi halaman Penjualan Es Balok, dipakai bersama oleh /pmputra/penjualan,
// /pmpersada/penjualan, dan /pmpakis/penjualan. Susunannya mengikuti halaman
// Penjualan Es Kristal (/mkesindo/sales): ringkasan hari/bulan/tahun, target
// pendapatan, tren harian (+tahun lalu), tren bulanan (+tahun lalu).
import { FilterBar } from "@/components/dashboard/filter-bar";
import { RevenueTargetPanel } from "@/components/dashboard/revenue-target-panel";
import { PenjualanBalokHariPanel } from "@/components/dashboard/penjualan-balok-hari-panel";
import { PenjualanBalokBulanPanel } from "@/components/dashboard/penjualan-balok-bulan-panel";
import { PenjualanBalokYtdPanel } from "@/components/dashboard/penjualan-balok-ytd-panel";
import { PenjualanBalokTrenChart } from "@/components/charts/penjualan-balok-tren-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveFilter, shiftFilterYears, type DashboardSearchParams } from "@/lib/date-range";
import type { ActionResult } from "@/lib/action-result";
import type { RevenueTarget } from "@/lib/queries/revenue-target";
import {
  getTodayWib,
  getPenjualanBalokHari,
  getPenjualanBalokBulan,
  getPenjualanBalokYtd,
  getTrenHarianBalok,
  getTrenBulananBalok,
  getWilayahListBalok,
  getTargetBalok,
  type PenjualanBalokHari,
  type PenjualanBalokBulan,
} from "@/lib/queries/penjualan-es-balok";

export interface PenjualanEsBalokActions {
  loadHari: (dateISO: string) => Promise<PenjualanBalokHari>;
  loadBulan: (monthISO: string) => Promise<PenjualanBalokBulan>;
  loadTarget: (monthISO: string) => Promise<RevenueTarget>;
  saveTarget: (input: { year: number; month: number; targetNominal: number; targetQty: number }) => Promise<ActionResult<void>>;
}

export async function PenjualanEsBalokView({
  kode,
  namaPt,
  searchParams,
  actions,
}: {
  kode: string;
  namaPt: string;
  searchParams: DashboardSearchParams;
  actions: PenjualanEsBalokActions;
}) {
  const today = getTodayWib();
  const todayISO = today.toISOString().slice(0, 10);
  // Rentang bawaan = bulan berjalan penuh; hari yang belum terjadi dipotong
  // supaya grafik tidak menggambar 0 untuk hari depan (garis seolah anjlok).
  const besokISO = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);
  const rawFilter = resolveFilter(searchParams);
  const filter =
    rawFilter.endDate > besokISO && rawFilter.startDate < besokISO ? { ...rawFilter, endDate: besokISO } : rawFilter;
  const filterTahunLalu = shiftFilterYears(filter, 1);

  const [hari, bulan, ytd, target, trenHarian, trenHarianLalu, trenBulanan, trenBulananLalu, wilayahList] =
    await Promise.all([
      getPenjualanBalokHari(kode, todayISO),
      getPenjualanBalokBulan(kode, todayISO.slice(0, 7) + "-01"),
      getPenjualanBalokYtd(kode),
      getTargetBalok(kode, today.getUTCFullYear(), today.getUTCMonth() + 1),
      getTrenHarianBalok(kode, filter),
      getTrenHarianBalok(kode, filterTahunLalu),
      getTrenBulananBalok(kode, 0, filter.wilayah),
      getTrenBulananBalok(kode, 1, filter.wilayah),
      getWilayahListBalok(kode),
    ]);

  const wilayahNote = filter.wilayah ? ` Wilayah: ${filter.wilayah}.` : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold">Penjualan</h1>
          <p className="text-sm text-muted-foreground">{namaPt} — Es Balok</p>
        </div>
        <FilterBar wilayahList={wilayahList} />
      </div>

      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3">
        <PenjualanBalokHariPanel initialData={hari} todayISO={todayISO} loadDay={actions.loadHari} />
        <PenjualanBalokBulanPanel initialData={bulan} todayISO={todayISO} loadMonth={actions.loadBulan} />
        <PenjualanBalokYtdPanel ytd={ytd} />
      </div>

      <RevenueTargetPanel
        target={target}
        businessTodayISO={todayISO}
        loadMonth={actions.loadTarget}
        saveTarget={actions.saveTarget}
        unitLabel="balok"
      />

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Tren Penjualan Harian</CardTitle>
          <CardDescription>
            Nominal penjualan (batang) serta balok kecil &amp; besar terjual (garis) — arahkan kursor ke titik untuk
            detail jumlah pesanan.{wilayahNote}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PenjualanBalokTrenChart data={trenHarian} mode="harian" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Tren Penjualan Harian &mdash; Tahun Lalu</CardTitle>
          <CardDescription>Periode yang sama dengan filter di atas, digeser satu tahun ke belakang.</CardDescription>
        </CardHeader>
        <CardContent>
          <PenjualanBalokTrenChart data={trenHarianLalu} mode="harian" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Tren Penjualan Bulanan</CardTitle>
          <CardDescription>
            12 bulan terakhir. Tooltip juga menampilkan Pendapatan GL (angka pembukuan) sebagai pembanding.
            {wilayahNote}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PenjualanBalokTrenChart data={trenBulanan} mode="bulanan" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Tren Penjualan Bulanan &mdash; Tahun Lalu</CardTitle>
          <CardDescription>12 bulan yang sama, digeser satu tahun ke belakang.</CardDescription>
        </CardHeader>
        <CardContent>
          <PenjualanBalokTrenChart data={trenBulananLalu} mode="bulanan" />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Nominal dihitung dari pesanan yang terealisasi (balok terealisasi dikurangi retur, dikali harga, termasuk
        ongkos logistik). Angkanya bisa sedikit berbeda dari Pendapatan GL di modul Keuangan.
      </p>
    </div>
  );
}
