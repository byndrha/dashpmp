import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSatpam } from "@/lib/require-access";
import { PatroliFotoClient } from "@/components/satpam-app/patroli-foto-client";

export const metadata: Metadata = { title: "Foto Patroli" };

export default async function PatroliFotoPage({
  params,
  searchParams,
}: {
  params: Promise<{ sesiId: string }>;
  searchParams: Promise<{ titik?: string }>;
}) {
  await requireSatpam();
  const { sesiId: sesiIdParam } = await params;
  const { titik } = await searchParams;
  const sesiId = Number(sesiIdParam);
  if (!Number.isInteger(sesiId)) notFound();

  return <PatroliFotoClient sesiId={sesiId} titikPatroli={titik ?? null} />;
}
