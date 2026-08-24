import { requireDriver } from "@/lib/require-access";
import { PengajuanList } from "@/components/driver-app/pengajuan-list";

export default async function DriverPengajuanPage() {
  await requireDriver();
  return <PengajuanList />;
}
