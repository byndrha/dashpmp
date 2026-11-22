// src/app/pmpersada/(dashboard)/penjualan/page.tsx
import type { Metadata } from "next";
import { requirePmpersadaKeuangan } from "@/lib/require-access";
import type { DashboardSearchParams } from "@/lib/date-range";
import { PenjualanEsBalokView } from "@/components/dashboard/penjualan-es-balok-view";
import { loadHariAction, loadBulanAction, loadTargetAction, saveTargetAction } from "./actions";

export const metadata: Metadata = { title: "Penjualan" };

export default async function PmpersadaPenjualanPage({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  await requirePmpersadaKeuangan();
  return (
    <PenjualanEsBalokView
      kode="pmpersada"
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
