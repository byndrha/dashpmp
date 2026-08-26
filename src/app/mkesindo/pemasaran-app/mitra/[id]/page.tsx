import type { Metadata } from "next";
import { requireMarketing } from "@/lib/require-access";
import { getMitraDetailAction } from "@/app/mkesindo/pemasaran-app/actions";
import { MitraDetail } from "@/components/pemasaran-app/mitra-detail";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Detail Mitra" };

export default async function MitraDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMarketing();
  const { id } = await params;
  const result = await getMitraDetailAction(id);
  if (!result.success || !result.data) notFound();
  return <MitraDetail mitra={result.data} />;
}
