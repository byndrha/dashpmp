import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireMarketing } from "@/lib/require-access";
import { getMitraDetailAction, getMitraKonteksPemasaranAction } from "@/app/mkesindo/pemasaran-app/actions";
import { MitraEditForm } from "@/components/pemasaran-app/mitra-edit-form";

export const metadata: Metadata = { title: "Ubah Mitra" };

export default async function MitraEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMarketing();
  const { id } = await params;
  const [result, konteks] = await Promise.all([getMitraDetailAction(id), getMitraKonteksPemasaranAction(id)]);
  if (!result.success || !result.data) notFound();
  // Konteks wajib termuat: tanpa itu Penanggung Jawab/kompetitor akan
  // tersimpan kosong menimpa data lama. NIK sengaja tidak diteruskan ke form.
  if (!konteks.success) throw new Error(konteks.error);
  return (
    <MitraEditForm
      mitra={result.data}
      namaPenanggungJawab={konteks.data.identitas.namaPenanggungJawab}
      kompetitorOpsi={konteks.data.kompetitorOpsi}
      kompetitorDipilih={konteks.data.kompetitorDipilih.map((k) => k.id)}
    />
  );
}
