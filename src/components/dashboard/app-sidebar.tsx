"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  LineChart,
  Receipt,
  ShoppingCart,
  Zap,
  Truck,
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
import { IceMark } from "@/components/dashboard/ice-mark";
import { PTSwitcher } from "@/components/dashboard/pt-switcher";
import { Badge } from "@/components/ui/badge";

const NAV_ITEMS = [
  { href: "/", label: "Beranda", icon: LayoutGrid, exact: true },
  { href: "/pnl", label: "Keuangan", icon: LineChart },
  { href: "/aging", label: "Piutang", icon: Receipt },
  { href: "/sales", label: "Penjualan", icon: ShoppingCart },
  { href: "/electricity", label: "Biaya Listrik", icon: Zap },
  { href: "/delivery", label: "Pengiriman", icon: Truck },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-2">
        <div className="flex items-center gap-2 px-2 py-2">
          <IceMark className="size-6 text-primary shrink-0" />
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
              {NAV_ITEMS.map((item) => (
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
      </SidebarContent>
    </Sidebar>
  );
}
