import type { Metadata } from "next";
import { requirePmpakis } from "@/lib/require-access";
import { ProduksiHalaman } from "@/components/produksi-denah/produksi-halaman";

// Rute statis ini mengalahkan placeholder [modul] untuk "produksi".
export const metadata: Metadata = { title: "Produksi" };

export default async function PmpakisProduksiPage() {
  const session = await requirePmpakis();
  return <ProduksiHalaman kode="pmpakis" namaPerusahaan="PT Panen Mutiara Pakis" user={session.user} />;
}
