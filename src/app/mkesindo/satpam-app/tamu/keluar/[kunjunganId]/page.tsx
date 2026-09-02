import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSatpam } from "@/lib/require-access";
import { getTamuByIdAction } from "@/app/mkesindo/satpam-app/actions";
import { TamuKeluarClient } from "@/components/satpam-app/tamu-keluar-client";

export const metadata: Metadata = { title: "Konfirmasi Tamu Keluar" };

export default async function TamuKeluarPage({ params }: { params: Promise<{ kunjunganId: string }> }) {
  await requireSatpam();
  const { kunjunganId: kunjunganIdParam } = await params;
  const kunjunganId = Number(kunjunganIdParam);
  if (!Number.isInteger(kunjunganId)) notFound();

  const result = await getTamuByIdAction(kunjunganId);
  const tamu = result.success ? result.data : null;
  if (!tamu || tamu.waktuKeluar) notFound();

  return <TamuKeluarClient tamu={tamu} />;
}
