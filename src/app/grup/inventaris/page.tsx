// src/app/grup/inventaris/page.tsx
import type { Metadata } from "next";
import { requireInventarisAccess } from "@/lib/require-access";
import { listVendor } from "@/lib/queries/inventaris-vendor";
import { getVendorRanking } from "@/lib/queries/inventaris-pengiriman";
import { InventarisVendorList } from "@/components/dashboard/inventaris-vendor-list";

export const metadata: Metadata = { title: "Inventaris" };

export default async function InventarisPage() {
  await requireInventarisAccess();
  const vendorList = await listVendor();
  const rankings = await Promise.all(vendorList.map((v) => getVendorRanking(v.id)));
  const vendorWithRanking = vendorList.map((v, i) => ({ ...v, ranking: rankings[i] }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Inventaris</h1>
      <p className="text-sm text-muted-foreground">
        Direktori vendor lintas-perusahaan — produk, lokasi, PIC, dan peringkat berdasarkan histori pengiriman.
      </p>
      <InventarisVendorList vendorList={vendorWithRanking} />
    </div>
  );
}
