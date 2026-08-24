import { requireDriver } from "@/lib/require-access";
import { PengajuanForm } from "@/components/driver-app/pengajuan-form";

export default async function DriverPengajuanBaruPage() {
  await requireDriver();
  return <PengajuanForm />;
}
