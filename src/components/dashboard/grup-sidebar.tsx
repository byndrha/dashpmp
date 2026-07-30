"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, ShieldCheck, Building2, Network } from "lucide-react";
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

// PMP Group (holding) — the one place Akun/Perusahaan/Akun Direktori
// administration lives, reachable by a real Direktur account or by today's
// MSSQL superadmin bridging in (see requireGrupAccess in require-access.ts).
// Deliberately not the per-PT AppSidebar: administration is holding-level,
// not something that belongs inside PT Mitra Kelola Esindo's own sidebar.
export function GrupSidebar() {
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
          <div className="flex min-w-0 items-center gap-1.5 truncate group-data-[collapsible=icon]:hidden">
            <p className="font-display font-semibold leading-tight">PMP Group</p>
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
              Holding
            </Badge>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Grup</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link href="/grup" onClick={closeOnMobile} />} isActive={pathname === "/grup"} tooltip="Ringkasan">
                  <LayoutGrid className="shrink-0" />
                  <span>Ringkasan</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Administrasi</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/grup/akun" onClick={closeOnMobile} />}
                  isActive={pathname === "/grup/akun" || pathname.startsWith("/grup/akun/peran")}
                  tooltip="Akun"
                >
                  <ShieldCheck className="shrink-0" />
                  <span>Akun</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/grup/perusahaan" onClick={closeOnMobile} />}
                  isActive={pathname.startsWith("/grup/perusahaan")}
                  tooltip="Perusahaan"
                >
                  <Building2 className="shrink-0" />
                  <span>Perusahaan</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/grup/akun/direktori" onClick={closeOnMobile} />}
                  isActive={pathname.startsWith("/grup/akun/direktori")}
                  tooltip="Akun Direktori"
                >
                  <Network className="shrink-0" />
                  <span>Akun Direktori</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
