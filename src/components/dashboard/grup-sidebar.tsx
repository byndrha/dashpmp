"use client";

import { usePathname } from "next/navigation";
import { LayoutGrid, ShieldCheck, Building2, Package } from "lucide-react";
import type { ReactNode } from "react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import { MerekSidebar, NavKelompok, type ItemNav } from "@/components/dashboard/sidebar-nav";
import type { PerusahaanSwitcherEntry } from "@/lib/queries/perusahaan";

// PMP Group (holding) — the one place Akun/Perusahaan administration
// lives, reachable by a real Direktur account or by today's MSSQL
// superadmin bridging in (see requireGrupAccess in require-access.ts).
// "Akun Direktori" was removed from this nav — the page it linked to
// (/grup/akun/direktori) was never built, and Next.js's automatic Link
// prefetch for it (always in viewport) 404'd on every load, which
// corrupted the client router enough to break other router.push() calls
// on this page (confirmed live: every PTSwitcher navigation attempt was
// silently swallowed by a repeating failed refetch of that dead route).
// Deliberately not the per-PT AppSidebar: administration is holding-level,
// not something that belongs inside PT Mitra Kelola Esindo's own sidebar.
export function GrupSidebar({
  canSwitchPt,
  canAccessInventaris,
  perusahaanList,
  kaki,
}: {
  // Kontrol akun/tampilan/notifikasi di dasar sidebar (KakiSidebar).
  kaki?: ReactNode;
  canSwitchPt: boolean;
  canAccessInventaris: boolean;
  perusahaanList: PerusahaanSwitcherEntry[];
}) {
  const pathname = usePathname();
  // Inventaris lintas PT (requireInventarisAccess): Direktur/superadmin
  // selalu, akun lain butuh flag can_akses_inventaris (diatur di /grup/akun).
  const items: ItemNav[] = [
    { href: "/grup", label: "Ringkasan", icon: LayoutGrid, aktif: pathname === "/grup", kelompok: "Grup" },
    ...(canAccessInventaris
      ? [{ href: "/grup/inventaris", label: "Inventaris", icon: Package, aktif: pathname.startsWith("/grup/inventaris"), kelompok: "Grup" }]
      : []),
    {
      href: "/grup/akun",
      label: "Akun",
      icon: ShieldCheck,
      aktif: pathname === "/grup/akun" || pathname.startsWith("/grup/akun/peran"),
      kelompok: "Administrasi",
    },
    { href: "/grup/perusahaan", label: "Perusahaan", icon: Building2, aktif: pathname.startsWith("/grup/perusahaan"), kelompok: "Administrasi" },
  ];

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="gap-2">
        <MerekSidebar
          nama="PMP Group"
          jenis="Holding"
          current="grup"
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
