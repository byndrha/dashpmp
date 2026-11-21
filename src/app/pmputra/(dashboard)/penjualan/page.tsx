// src/app/pmputra/penjualan/page.tsx
import type { Metadata } from "next";
import { requirePmputra } from "@/lib/require-access";
import type { DashboardSearchParams } from "@/lib/date-range";
import { PenjualanEsBalokView } from "@/components/dashboard/penjualan-es-balok-view";
import { loadHariAction, loadBulanAction, loadTargetAction, saveTargetAction } from "./actions";

export const metadata: Metadata = { title: "Penjualan" };

export default async function PmputraPenjualanPage({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  await requirePmputra();
  return (
    <PenjualanEsBalokView
      kode="pmputra"
      namaPt="PT Prima Maesa Putra"
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
