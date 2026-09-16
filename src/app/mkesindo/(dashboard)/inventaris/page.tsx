// src/app/mkesindo/(dashboard)/inventaris/page.tsx
import type { Metadata } from "next";
import { requireModuleAccess } from "@/lib/require-access";
import { listVendor, listVendorPerusahaanLinks } from "@/lib/queries/inventaris-vendor";
import { getVendorRanking } from "@/lib/queries/inventaris-pengiriman";
import { InventarisVendorList } from "@/components/dashboard/inventaris-vendor-list";

export const metadata: Metadata = { title: "Inventaris" };

// MKEsindo-scoped view of the shared cross-PT vendor directory (see
// /grup/inventaris for the full lintas-perusahaan version) — gated by the
// standard MKEsindo per-role ModuleKey system (requireModuleAccess), a
// deliberate separate access path from the cross-PT can_akses_inventaris
// flag /grup/inventaris uses (confirmed with user 2026-09-16: this page's
// access should be assignable per-role like every other MKEsindo module,
// independent of who has the cross-PT flag).
export default async function MkesindoInventarisPage() {
  await requireModuleAccess("inventaris");

  const [vendorList, links] = await Promise.all([listVendor(), listVendorPerusahaanLinks()]);
  const mkesindoVendorIds = new Set(
    links.filter((l) => l.perusahaanKode === "mkesindo").map((l) => l.vendorId)
  );
  const vendorListMkesindo = vendorList.filter((v) => mkesindoVendorIds.has(v.id));

  const rankings = await Promise.all(vendorListMkesindo.map((v) => getVendorRanking(v.id, undefined)));
  const perusahaanNamesByVendorId = new Map<number, string[]>();
  for (const link of links) {
    const names = perusahaanNamesByVendorId.get(link.vendorId) ?? [];
    names.push(link.perusahaanNama);
    perusahaanNamesByVendorId.set(link.vendorId, names);
  }
  const vendorWithRanking = vendorListMkesindo.map((v, i) => ({
    ...v,
    ranking: rankings[i],
    perusahaanNames: perusahaanNamesByVendorId.get(v.id) ?? [],
  }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Inventaris</h1>
      <p className="text-sm text-muted-foreground">
        Vendor yang terdaftar/terhubung ke PT Mitra Kelola Esindo. Lihat direktori lengkap lintas-perusahaan di menu
        Grup &gt; Inventaris.
      </p>
      <InventarisVendorList vendorList={vendorWithRanking} />
    </div>
  );
}
