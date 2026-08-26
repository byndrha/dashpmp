import type { Metadata } from "next";
import { requireMarketing } from "@/lib/require-access";
import { PengajuanForm } from "@/components/pemasaran-app/pengajuan-form";

export const metadata: Metadata = { title: "Pengajuan Baru" };

export default async function PengajuanBaruPage() {
  await requireMarketing();
  return <PengajuanForm />;
}
