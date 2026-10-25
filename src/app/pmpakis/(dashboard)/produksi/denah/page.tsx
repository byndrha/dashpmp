import type { Metadata } from "next";
import { requirePmpakis } from "@/lib/require-access";
import { BuilderHalaman } from "@/components/produksi-denah/builder-halaman";

export const metadata: Metadata = { title: "Builder Denah Produksi" };

export default async function PmpakisBuilderDenahPage() {
  const session = await requirePmpakis();
  return <BuilderHalaman kode="pmpakis" namaPerusahaan="PT Panen Mutiara Pakis" user={session.user} />;
}
