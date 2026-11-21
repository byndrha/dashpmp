// src/app/pmpakis/(dashboard)/penjualan/page.tsx
import type { Metadata } from "next";
import { requirePmpakisKeuangan } from "@/lib/require-access";
import type { DashboardSearchParams } from "@/lib/date-range";
import { PenjualanEsBalokView } from "@/components/dashboard/penjualan-es-balok-view";
import { loadHariAction, loadBulanAction, loadTargetAction, saveTargetAction } from "./actions";

export const metadata: Metadata = { title: "Penjualan" };

export default async function PmpakisPenjualanPage({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  await requirePmpakisKeuangan();
  return (
    <PenjualanEsBalokView
      kode="pmpakis"
      namaPt="PT Panen Mutiara Pakis"
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
