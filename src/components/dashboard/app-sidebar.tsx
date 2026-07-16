"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LineChart,
  Receipt,
  ShoppingCart,
  Zap,
  Truck,
  Snowflake,
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

const NAV_ITEMS = [
  { href: "/pnl", label: "P&L & BEP", icon: LineChart },
  { href: "/aging", label: "Aging Piutang", icon: Receipt },
  { href: "/sales", label: "Penjualan", icon: ShoppingCart },
  { href: "/electricity", label: "Biaya Listrik", icon: Zap },
  { href: "/delivery", label: "Pengiriman", icon: Truck },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Snowflake className="size-5 text-primary shrink-0" />
          <span className="font-semibold truncate group-data-[collapsible=icon]:hidden">
            PMP Ponorogo
          </span>
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
                    isActive={pathname.startsWith(item.href)}
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
