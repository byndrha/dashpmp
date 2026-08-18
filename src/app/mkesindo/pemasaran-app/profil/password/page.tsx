import { requireMarketing } from "@/lib/require-access";
import { UbahPasswordForm } from "@/components/pemasaran-app/ubah-password-form";

export default async function UbahPasswordPage() {
  await requireMarketing();
  return <UbahPasswordForm />;
}
