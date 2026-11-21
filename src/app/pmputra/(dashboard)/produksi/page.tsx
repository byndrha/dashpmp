import type { Metadata } from "next";
import { requirePmputra } from "@/lib/require-access";
import { ProduksiHalaman } from "@/components/produksi-denah/produksi-halaman";

// Rute statis ini mengalahkan placeholder [modul] untuk "produksi".
export const metadata: Metadata = { title: "Produksi" };

export default async function PmputraProduksiPage() {
  const session = await requirePmputra();
  return <ProduksiHalaman kode="pmputra" namaPerusahaan="PT Prima Maesa Putra" user={session.user} />;
}
