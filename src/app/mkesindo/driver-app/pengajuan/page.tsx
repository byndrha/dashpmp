import type { Metadata } from "next";
import { requireDriver } from "@/lib/require-access";
import { PengajuanList } from "@/components/driver-app/pengajuan-list";

export const metadata: Metadata = { title: "Pengajuan" };

export default async function DriverPengajuanPage() {
  await requireDriver();
  return <PengajuanList />;
}
