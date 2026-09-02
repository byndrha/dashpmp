import type { Metadata } from "next";
import { requireSatpam } from "@/lib/require-access";
import { TamuMasukClient } from "@/components/satpam-app/tamu-masuk-client";

export const metadata: Metadata = { title: "Tamu Baru" };

export default async function TamuMasukPage() {
  await requireSatpam();
  return <TamuMasukClient />;
}
