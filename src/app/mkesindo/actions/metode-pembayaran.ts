"use server";

import { listActiveMetodePembayaran, type Konteks, type MetodePembayaranRow } from "@/lib/queries/metode-pembayaran";

// Read-only, no auth gate beyond what's already implicit — this only exposes
// which payment channels exist for a company/context, not any sensitive data.
// Shared by driver-app, kasir, and the public invoice page (Tasks 9-11), which
// live under different route groups, so this can't live inside any one of
// their own actions.ts files.
export async function getActiveMetodePembayaranAction(perusahaanId: number, konteks: Konteks): Promise<MetodePembayaranRow[]> {
  return listActiveMetodePembayaran(perusahaanId, konteks);
}
