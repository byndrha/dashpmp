import type { Metadata } from "next";
import { requireDriver } from "@/lib/require-access";
import { PengajuanForm } from "@/components/driver-app/pengajuan-form";

export const metadata: Metadata = { title: "Pengajuan Baru" };

export default async function DriverPengajuanBaruPage() {
  await requireDriver();
  return <PengajuanForm />;
}
