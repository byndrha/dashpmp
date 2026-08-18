import { requireMarketing } from "@/lib/require-access";
import { PengajuanForm } from "@/components/pemasaran-app/pengajuan-form";

export default async function PengajuanBaruPage() {
  await requireMarketing();
  return <PengajuanForm />;
}
