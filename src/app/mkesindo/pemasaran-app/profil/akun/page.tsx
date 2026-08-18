import { requireMarketing } from "@/lib/require-access";
import { getUserById } from "@/lib/queries/akun";
import { notFound } from "next/navigation";
import { PengaturanAkunForm } from "@/components/pemasaran-app/pengaturan-akun-form";

export default async function PengaturanAkunPage() {
  const session = await requireMarketing();
  const profile = await getUserById(Number(session.user.id));
  if (!profile) notFound();
  return <PengaturanAkunForm profile={profile} />;
}
