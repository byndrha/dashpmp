import type { Metadata } from "next";
import { requirePmpersada } from "@/lib/require-access";
import { ProduksiHalaman } from "@/components/produksi-denah/produksi-halaman";

// Rute statis ini mengalahkan placeholder [modul] untuk "produksi".
export const metadata: Metadata = { title: "Produksi" };

export default async function PmpersadaProduksiPage() {
  const session = await requirePmpersada();
  return <ProduksiHalaman kode="pmpersada" namaPerusahaan="PT Putra Maesa Persada" user={session.user} />;
}
