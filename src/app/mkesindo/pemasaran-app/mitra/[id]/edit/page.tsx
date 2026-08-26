import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireMarketing } from "@/lib/require-access";
import { getMitraDetailAction } from "@/app/mkesindo/pemasaran-app/actions";
import { MitraEditForm } from "@/components/pemasaran-app/mitra-edit-form";

export const metadata: Metadata = { title: "Ubah Mitra" };

export default async function MitraEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMarketing();
  const { id } = await params;
  const result = await getMitraDetailAction(id);
  if (!result.success || !result.data) notFound();
  return <MitraEditForm mitra={result.data} />;
}
