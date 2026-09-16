// src/app/grup/inventaris/page.tsx
import type { Metadata } from "next";
import { requireInventarisAccess } from "@/lib/require-access";
import { listVendor, listVendorPerusahaanLinks } from "@/lib/queries/inventaris-vendor";
import { getVendorRanking } from "@/lib/queries/inventaris-pengiriman";
import { InventarisVendorList } from "@/components/dashboard/inventaris-vendor-list";

export const metadata: Metadata = { title: "Inventaris" };

export default async function InventarisPage() {
  await requireInventarisAccess();
  const [vendorList, links] = await Promise.all([listVendor(), listVendorPerusahaanLinks()]);
  const rankings = await Promise.all(vendorList.map((v) => getVendorRanking(v.id)));
  const perusahaanNamesByVendorId = new Map<number, string[]>();
  for (const link of links) {
    const names = perusahaanNamesByVendorId.get(link.vendorId) ?? [];
    names.push(link.perusahaanNama);
    perusahaanNamesByVendorId.set(link.vendorId, names);
  }
  const vendorWithRanking = vendorList.map((v, i) => ({
    ...v,
    ranking: rankings[i],
    perusahaanNames: perusahaanNamesByVendorId.get(v.id) ?? [],
  }));

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
