import type { Metadata } from "next";
import { requirePmputra } from "@/lib/require-access";
import { getPesananBalokHari } from "@/lib/queries/pemesanan-es-balok";
import { getTodayWib } from "@/lib/queries/penjualan-es-balok";
import { PemesananEsBalokView } from "@/components/dashboard/pemesanan-es-balok-view";

export const metadata: Metadata = { title: "Pemesanan" };

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

export default async function PmputraPemesananPage({ searchParams }: { searchParams: Promise<{ tanggal?: string }> }) {
  await requirePmputra();
  const { tanggal } = await searchParams;
  const todayISO = getTodayWib().toISOString().slice(0, 10);
  const tanggalISO = tanggal && POLA_TANGGAL.test(tanggal) ? tanggal : todayISO;
  const rows = await getPesananBalokHari("pmputra", tanggalISO);
  return <PemesananEsBalokView kode="pmputra" rows={rows} tanggalISO={tanggalISO} todayISO={todayISO} />;
}
