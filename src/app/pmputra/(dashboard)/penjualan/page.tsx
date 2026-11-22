// src/app/pmputra/penjualan/page.tsx
import type { Metadata } from "next";
import { requirePmputraKeuangan } from "@/lib/require-access";
import type { DashboardSearchParams } from "@/lib/date-range";
import { PenjualanEsBalokView } from "@/components/dashboard/penjualan-es-balok-view";
import { loadHariAction, loadBulanAction, loadTargetAction, saveTargetAction } from "./actions";

export const metadata: Metadata = { title: "Penjualan" };

export default async function PmputraPenjualanPage({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  await requirePmputraKeuangan();
  return (
    <PenjualanEsBalokView
      kode="pmputra"
      searchParams={await searchParams}
      actions={{
        loadHari: loadHariAction,
        loadBulan: loadBulanAction,
        loadTarget: loadTargetAction,
        saveTarget: saveTargetAction,
      }}
    />
  );
}
