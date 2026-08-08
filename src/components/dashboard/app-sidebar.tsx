"use client";

import Link from "next/link";
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
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { PTSwitcher } from "@/components/dashboard/pt-switcher";
import { Badge } from "@/components/ui/badge";
import type { ModuleKey, PermissionMap } from "@/lib/permissions";
import type { PerusahaanSwitcherEntry } from "@/lib/queries/perusahaan";

const NAV_ITEMS: { href: string; label: string; icon: typeof LayoutGrid; exact?: boolean; moduleKey: ModuleKey }[] = [
  { href: "/", label: "Beranda", icon: LayoutGrid, exact: true, moduleKey: "beranda" },
  { href: "/pnl", label: "Keuangan", icon: LineChart, moduleKey: "pnl" },
  { href: "/aging", label: "Piutang", icon: Receipt, moduleKey: "aging" },
  { href: "/sales", label: "Penjualan", icon: ShoppingCart, moduleKey: "sales" },
  { href: "/transaksi", label: "Transaksi", icon: ArrowLeftRight, moduleKey: "transaksi" },
  { href: "/electricity", label: "Biaya Listrik", icon: Zap, moduleKey: "electricity" },
  { href: "/delivery", label: "Pengiriman", icon: Truck, moduleKey: "delivery" },
  { href: "/pemesanan", label: "Pemesanan", icon: ClipboardList, moduleKey: "pemesanan" },
  { href: "/mitra", label: "Mitra", icon: Users, moduleKey: "mitra" },
  { href: "/pemasaran", label: "Pemasaran", icon: Megaphone, moduleKey: "pemasaran" },
];

export function AppSidebar({
  permissions,
  isSuperAdmin,
  perusahaanList,
}: {
  permissions: PermissionMap;
  isSuperAdmin: boolean;
  perusahaanList: PerusahaanSwitcherEntry[];
}) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const visibleItems = isSuperAdmin
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => permissions[item.moduleKey]?.canView);

  // On mobile the sidebar renders as an overlay Sheet — picking a module
  // should feel like navigating to a new screen, not leave the sheet
  // hanging open on top of it.
  function closeOnMobile() {
    if (isMobile) setOpenMobile(false);
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-2">
        <div className="flex items-center gap-2 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand asset, no next/image usage elsewhere in this codebase */}
          <img
            src="/brand/logo-pmp-group.png"
            alt="PMP Group"
            className="h-7 w-auto max-w-none shrink-0 dark:brightness-0 dark:invert"
          />
          <div className="flex min-w-0 flex-col gap-0.5 truncate group-data-[collapsible=icon]:hidden">
            <div className="flex items-center gap-1.5">
              <p className="font-display font-semibold leading-tight">PT Mitra Kelola Esindo</p>
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                Es Kristal
              </Badge>
            </div>
            <p className="text-[11px] leading-tight text-muted-foreground">Ponorogo</p>
          </div>
        </div>
        {isSuperAdmin && (
          <div className="px-2 group-data-[collapsible=icon]:px-0">
            {/* Cross-PT navigation is superadmin-only — every other account
                is confined to its own PT's route tree by the accountScope
                checks in requirePmputra()/(dashboard)/layout.tsx/
                requireGrupAccess(), so this is never rendered for them. */}
            <PTSwitcher list={perusahaanList} current="mkesindo" />
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Modul</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link href={item.href} onClick={closeOnMobile} />}
                    isActive={item.exact ? pathname === item.href : pathname.startsWith(item.href)}
                    tooltip={item.label}
                  >
                    <item.icon className="shrink-0" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
