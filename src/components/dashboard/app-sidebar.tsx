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
  Users,
  Megaphone,
  ShieldCheck,
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
} from "@/components/ui/sidebar";
import { PTSwitcher } from "@/components/dashboard/pt-switcher";
import { Badge } from "@/components/ui/badge";
import type { ModuleKey, PermissionMap } from "@/lib/permissions";

const NAV_ITEMS: { href: string; label: string; icon: typeof LayoutGrid; exact?: boolean; moduleKey: ModuleKey }[] = [
  { href: "/", label: "Beranda", icon: LayoutGrid, exact: true, moduleKey: "beranda" },
  { href: "/pnl", label: "Keuangan", icon: LineChart, moduleKey: "pnl" },
  { href: "/aging", label: "Piutang", icon: Receipt, moduleKey: "aging" },
  { href: "/sales", label: "Penjualan", icon: ShoppingCart, moduleKey: "sales" },
  { href: "/transaksi", label: "Transaksi", icon: ArrowLeftRight, moduleKey: "transaksi" },
  { href: "/electricity", label: "Biaya Listrik", icon: Zap, moduleKey: "electricity" },
  { href: "/delivery", label: "Pengiriman", icon: Truck, moduleKey: "delivery" },
  { href: "/mitra", label: "Mitra", icon: Users, moduleKey: "mitra" },
  { href: "/pemasaran", label: "Pemasaran", icon: Megaphone, moduleKey: "pemasaran" },
];

export function AppSidebar({
  permissions,
  isSuperAdmin,
}: {
  permissions: PermissionMap;
  isSuperAdmin: boolean;
}) {
  const pathname = usePathname();
  const visibleItems = isSuperAdmin
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => permissions[item.moduleKey]?.canView);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-2">
        <div className="flex items-center gap-2 px-2 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand asset, no next/image usage elsewhere in this codebase */}
          <img
            src="/brand/logo-pmp-group.png"
            alt="PMP Group"
            className="h-7 w-auto shrink-0 dark:brightness-0 dark:invert"
          />
          <div className="flex min-w-0 items-center gap-1.5 truncate group-data-[collapsible=icon]:hidden">
            <p className="font-display font-semibold leading-tight">PMP Group</p>
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
              Ponorogo
            </Badge>
          </div>
        </div>
        <div className="px-2 group-data-[collapsible=icon]:px-0">
          <PTSwitcher />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Modul</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link href={item.href} />}
                    isActive={item.exact ? pathname === item.href : pathname.startsWith(item.href)}
                    tooltip={item.label}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isSuperAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administrasi</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link href="/akun" />}
                    isActive={pathname.startsWith("/akun")}
                    tooltip="Akun"
                  >
                    <ShieldCheck />
                    <span>Akun</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
