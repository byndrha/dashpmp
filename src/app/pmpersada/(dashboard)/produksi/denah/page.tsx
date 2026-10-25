import type { Metadata } from "next";
import { requirePmpersada } from "@/lib/require-access";
import { BuilderHalaman } from "@/components/produksi-denah/builder-halaman";

export const metadata: Metadata = { title: "Builder Denah Produksi" };

export default async function PmpersadaBuilderDenahPage() {
  const session = await requirePmpersada();
  return <BuilderHalaman kode="pmpersada" namaPerusahaan="PT Putra Maesa Persada" user={session.user} />;
}
