import type { Metadata } from "next";
import { requireMarketing } from "@/lib/require-access";
import { getMitraDetailAction, getMitraKonteksPemasaranAction } from "@/app/mkesindo/pemasaran-app/actions";
import { MitraDetail } from "@/components/pemasaran-app/mitra-detail";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Detail Mitra" };

export default async function MitraDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMarketing();
  const { id } = await params;
  const [result, konteks] = await Promise.all([getMitraDetailAction(id), getMitraKonteksPemasaranAction(id)]);
  if (!result.success || !result.data) notFound();
  // NIK hanya ada di `konteks` bila sesi boleh melihat (dicek di server,
  // getIdentitasMitra tidak men-SELECT kolom sensitif tanpa izin).
  return <MitraDetail mitra={result.data} konteks={konteks.success ? konteks.data : null} />;
}
