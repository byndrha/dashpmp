"use server";

import { auth } from "@/lib/auth";
import { recordLokasi } from "@/lib/queries/akun-lokasi";

export async function recordLokasiAction(input: {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  await recordLokasi(Number(session.user.id), input.latitude, input.longitude, input.accuracy);
}
