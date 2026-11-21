import type { Metadata } from "next";
import { requirePmputra } from "@/lib/require-access";
import { BuilderHalaman } from "@/components/produksi-denah/builder-halaman";

export const metadata: Metadata = { title: "Builder Denah Produksi" };

export default async function PmputraBuilderDenahPage() {
  const session = await requirePmputra();
  return <BuilderHalaman kode="pmputra" namaPerusahaan="PT Prima Maesa Putra" user={session.user} />;
}
