"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, LineChart, Receipt, ShoppingCart, ArrowLeftRight, Zap, Truck, ClipboardList, Users, Megaphone } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { PTSwitcher } from "@/components/dashboard/pt-switcher";
import { PMPUTRA_MODULES } from "@/lib/pmputra-modules";
import type { PerusahaanSwitcherEntry } from "@/lib/queries/perusahaan";

// Mirrors AppSidebar's module list (same labels/icons as the Es Kristal
// dashboard) as a placeholder shell — none of these query FINAC_ES_PO/
// FINAC_LOGISTIC_PO yet, see docs/superpowers/specs/
// 2026-07-30-postgres-directory-multi-company.md for why that's deferred.
const MODULE_ICONS: Record<string, typeof LineChart> = {
  keuangan: LineChart,
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
  isSuperAdmin,
  perusahaanList,
}: {
  isSuperAdmin: boolean;
  perusahaanList: PerusahaanSwitcherEntry[];
}) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

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
              <p className="font-display font-semibold leading-tight">PT Prima Maesa Putra</p>
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                Es Balok
              </Badge>
            </div>
            <p className="text-[11px] leading-tight text-muted-foreground">Ponorogo</p>
          </div>
        </div>
        {isSuperAdmin && (
          <div className="px-2 group-data-[collapsible=icon]:px-0">
            {/* Only a bridged superadmin sees this — see PTSwitcher. */}
            <PTSwitcher list={perusahaanList} current="pmputra" />
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Modul</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link href="/pmputra" onClick={closeOnMobile} />} isActive={pathname === "/pmputra"} tooltip="Beranda">
                  <LayoutGrid className="shrink-0" />
                  <span>Beranda</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.slug}>
                  <SidebarMenuButton
                    render={<Link href={`/pmputra/${item.slug}`} onClick={closeOnMobile} />}
                    isActive={pathname === `/pmputra/${item.slug}`}
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
