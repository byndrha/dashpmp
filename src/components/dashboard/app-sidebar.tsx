"use client";

import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  LineChart,
  Receipt,
  ShoppingCart,
  ArrowLeftRight,
  Zap,
  Truck,
  ClipboardList,
  Users,
  Megaphone,
  Factory,
  FileSpreadsheet,
  Shield,
  TrendingUp,
  Boxes,
} from "lucide-react";
import type { ReactNode } from "react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import { MerekSidebar, NavKelompok, kelompokModul, urutkanModul, type ItemNav } from "@/components/dashboard/sidebar-nav";
import type { ModuleKey, PermissionMap } from "@/lib/permissions";
import type { PerusahaanSwitcherEntry } from "@/lib/queries/perusahaan";

// Urutan tampil di sidebar diatur URUTAN_MODUL (sidebar-nav.tsx), bukan urutan di sini.
const NAV_ITEMS: { href: string; label: string; icon: typeof LayoutGrid; exact?: boolean; moduleKey: ModuleKey }[] = [
  { href: "/mkesindo", label: "Beranda", icon: LayoutGrid, exact: true, moduleKey: "beranda" },
  { href: "/mkesindo/sales", label: "Penjualan", icon: ShoppingCart, moduleKey: "sales" },
  { href: "/mkesindo/pemesanan", label: "Pemesanan", icon: ClipboardList, moduleKey: "pemesanan" },
  { href: "/mkesindo/delivery", label: "Pengiriman", icon: Truck, moduleKey: "delivery" },
  { href: "/mkesindo/mitra", label: "Mitra", icon: Users, moduleKey: "mitra" },
  { href: "/mkesindo/pnl", label: "Keuangan", icon: LineChart, moduleKey: "pnl" },
  { href: "/mkesindo/aging", label: "Piutang", icon: Receipt, moduleKey: "aging" },
  { href: "/mkesindo/transaksi", label: "Transaksi", icon: ArrowLeftRight, moduleKey: "transaksi" },
  { href: "/mkesindo/electricity", label: "Kelistrikan", icon: Zap, moduleKey: "electricity" },
  { href: "/mkesindo/laporan", label: "Laporan", icon: FileSpreadsheet, moduleKey: "laporan" },
  { href: "/mkesindo/produksi", label: "Produksi", icon: Factory, moduleKey: "produksi" },
  { href: "/mkesindo/inventaris", label: "Inventaris", icon: Boxes, moduleKey: "inventaris" },
  { href: "/mkesindo/kinerja", label: "Kinerja", icon: TrendingUp, moduleKey: "kinerja" },
  { href: "/mkesindo/pemasaran", label: "Pemasaran", icon: Megaphone, moduleKey: "pemasaran" },
];

// Not part of NAV_ITEMS/the moduleKey permission map above — this route is
// authorized by role (requireSatpamRosterManager: isSuperAdmin or a wilayah
// manager RoleID), computed by the layout and passed in directly as
// canAccessKeamanan, so it's rendered as its own conditional item instead.
const KEAMANAN_ITEM = { href: "/mkesindo/keamanan", label: "Keamanan", icon: Shield };

export function AppSidebar({
  permissions,
  canSwitchPt,
  canAccessKeamanan,
  perusahaanList,
  kaki,
}: {
  // Kontrol akun/tampilan/notifikasi di dasar sidebar (KakiSidebar).
  kaki?: ReactNode;
  permissions: PermissionMap;
  canSwitchPt: boolean;
  canAccessKeamanan: boolean;
  perusahaanList: PerusahaanSwitcherEntry[];
}) {
  const pathname = usePathname();
  // canSwitchPt already covers isSuperAdmin (see (dashboard)/layout.tsx) —
  // a PMP Group-scoped account has no per-module permissions of its own
  // (permissions is always {} for it), so it needs the same full-nav
  // bypass isSuperAdmin gets, or it would land on a module page with no
  // way to navigate to any other one.
  const visibleItems = canSwitchPt
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => permissions[item.moduleKey]?.canView);

  const items: ItemNav[] = urutkanModul([
    ...visibleItems.map((item) => ({
      href: item.href,
      label: item.label,
      icon: item.icon,
      aktif: item.exact ? pathname === item.href : pathname.startsWith(item.href),
      kelompok: kelompokModul(item.label),
    })),
    ...(canAccessKeamanan
      ? [{ ...KEAMANAN_ITEM, aktif: pathname.startsWith(KEAMANAN_ITEM.href), kelompok: kelompokModul(KEAMANAN_ITEM.label) }]
      : []),
  ]);

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="gap-2">
        <MerekSidebar
          nama="PT Mitra Kelola Esindo"
          jenis="Es Kristal" lokasi="Ponorogo"
          current="mkesindo"
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
