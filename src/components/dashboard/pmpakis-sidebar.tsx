"use client";

import { usePathname } from "next/navigation";
import { LayoutGrid, LineChart, Receipt, ShoppingCart, ArrowLeftRight, Zap, Truck, ClipboardList, Users, Megaphone, Snowflake } from "lucide-react";
import type { ReactNode } from "react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import { MerekSidebar, NavKelompok, kelompokModul, urutkanModul, type ItemNav } from "@/components/dashboard/sidebar-nav";
import { PMPAKIS_MODULES } from "@/lib/pmpakis-modules";
import type { PerusahaanSwitcherEntry } from "@/lib/queries/perusahaan";

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
const NAV_ITEMS = Object.entries(PMPAKIS_MODULES).map(([slug, label]) => ({ slug, label, icon: MODULE_ICONS[slug] }));

export function PmpakisSidebar({
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
    { href: "/pmpakis", label: "Beranda", icon: LayoutGrid, aktif: pathname === "/pmpakis", kelompok: "Utama" },
    ...NAV_ITEMS.map((item) => {
      const href = `/pmpakis/${item.slug}`;
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
          nama="PT Panen Mutiara Pakis"
          jenis="Es Balok"
          current="pmpakis"
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
