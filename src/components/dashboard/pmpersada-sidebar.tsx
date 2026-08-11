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
import { PMPERSADA_MODULES } from "@/lib/pmpersada-modules";
import type { PerusahaanSwitcherEntry } from "@/lib/queries/perusahaan";

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
const NAV_ITEMS = Object.entries(PMPERSADA_MODULES).map(([slug, label]) => ({ slug, label, icon: MODULE_ICONS[slug] }));

export function PmpersadaSidebar({
  canSwitchPt,
  perusahaanList,
}: {
  canSwitchPt: boolean;
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
              <p className="font-display font-semibold leading-tight">PT Putra Maesa Persada</p>
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                Es Balok
              </Badge>
            </div>
          </div>
        </div>
        {canSwitchPt && (
          <div className="px-2 group-data-[collapsible=icon]:px-0">
            {/* Only an account with cross-PT authority sees this — see PTSwitcher. */}
            <PTSwitcher list={perusahaanList} current="pmpersada" />
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Modul</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link href="/pmpersada" onClick={closeOnMobile} />} isActive={pathname === "/pmpersada"} tooltip="Beranda">
                  <LayoutGrid className="shrink-0" />
                  <span>Beranda</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.slug}>
                  <SidebarMenuButton
                    render={<Link href={`/pmpersada/${item.slug}`} onClick={closeOnMobile} />}
                    isActive={pathname === `/pmpersada/${item.slug}`}
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
