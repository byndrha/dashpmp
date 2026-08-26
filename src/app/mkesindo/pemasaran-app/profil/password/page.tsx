import type { Metadata } from "next";
import { requireMarketing } from "@/lib/require-access";
import { UbahPasswordForm } from "@/components/pemasaran-app/ubah-password-form";

export const metadata: Metadata = { title: "Ubah Password" };

export default async function UbahPasswordPage() {
  await requireMarketing();
  return <UbahPasswordForm />;
}
