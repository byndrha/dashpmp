"use client";

import { usePathname } from "next/navigation";
import { LayoutGrid, LineChart, Receipt, ShoppingCart, ArrowLeftRight, Zap, Truck, ClipboardList, Users, Megaphone, Snowflake } from "lucide-react";
import type { ReactNode } from "react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import { MerekSidebar, NavKelompok, kelompokModul, urutkanModul, type ItemNav } from "@/components/dashboard/sidebar-nav";
import { PMPUTRA_MODULES } from "@/lib/pmputra-modules";
import type { PerusahaanSwitcherEntry } from "@/lib/queries/perusahaan";

// Mirrors AppSidebar's module list (same labels/icons as the Es Kristal
// dashboard) as a placeholder shell — none of these query FINAC_ES_PO/
// FINAC_LOGISTIC_PO yet, see docs/superpowers/specs/
// 2026-07-30-postgres-directory-multi-company.md for why that's deferred.
const MODULE_ICONS: Record<string, typeof LineChart> = {
  keuangan: LineChart,
  produksi: Snowflake,
  piutang: Receipt,
  penjualan: ShoppingCart,
  transaksi: ArrowLeftRight,
  listrik: Zap,
  pengiriman: Truck,
  pemesanan: ClipboardList,
  mitra: Users,
  pemasaran: Megaphone,
};
const NAV_ITEMS = Object.entries(PMPUTRA_MODULES).map(([slug, label]) => ({ slug, label, icon: MODULE_ICONS[slug] }));

export function PmputraSidebar({
  canSwitchPt,
  perusahaanList,
  kaki,
}: {
  // Kontrol akun/tampilan/notifikasi di dasar sidebar (KakiSidebar).
  kaki?: ReactNode;
  canSwitchPt: boolean;
  perusahaanList: PerusahaanSwitcherEntry[];
}) {
  const pathname = usePathname();
  // Beranda + modul, urutan & kelompok dari URUTAN_MODUL (sidebar-nav.tsx).
  const items: ItemNav[] = urutkanModul([
    { href: "/pmputra", label: "Beranda", icon: LayoutGrid, aktif: pathname === "/pmputra", kelompok: "Utama" },
    ...NAV_ITEMS.map((item) => {
      const href = `/pmputra/${item.slug}`;
      return {
        href,
        label: item.label,
        icon: item.icon,
        aktif: pathname === href || pathname.startsWith(`${href}/`),
        kelompok: kelompokModul(item.label),
      };
    }),
  ]);

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="gap-2">
        <MerekSidebar
          nama="PT Prima Maesa Putra"
          jenis="Es Balok" lokasi="Ponorogo"
          current="pmputra"
          bolehPindah={canSwitchPt}
          perusahaanList={perusahaanList}
        />
      </SidebarHeader>
      <SidebarContent>
        <NavKelompok items={items} />
      </SidebarContent>
      {kaki && <SidebarFooter>{kaki}</SidebarFooter>}
    </Sidebar>
  );
}
