"use client";

import Link from "next/link";
import { Check, ChevronsUpDown, Building2, ExternalLink, LayoutGrid } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PT_ROUTES } from "@/lib/pt-routes";
import type { PerusahaanSwitcherEntry } from "@/lib/queries/perusahaan";

export type PtSwitcherLocation = "mkesindo" | "pmputra" | "grup";

// Only ever rendered for superadmins (each call site gates on
// session.user.isSuperAdmin before mounting this) — every other account
// is confined to its own PT's route tree by the accountScope checks in
// requirePmputra()/(dashboard)/layout.tsx/requireGrupAccess(), so there's
// no non-superadmin audience for this component at all.
//
// "AktifPenuh" entries navigate to that PT's route tree via PT_ROUTES.
// "StandaloneHTML" entries open their StandaloneUrl in a new tab, same as
// the old hardcoded STATIC_REPORTS list did. "Draft" entries are never in
// `list` — listPerusahaanForSwitcher() already excludes them.
export function PTSwitcher({ list, current }: { list: PerusahaanSwitcherEntry[]; current: PtSwitcherLocation }) {
  const aktif = list.filter((p) => p.Status === "AktifPenuh");
  const standalone = list.filter((p) => p.Status === "StandaloneHTML");
  const active = aktif.find((p) => p.Kode === current);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2 py-1.5 text-left text-xs hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center">
        <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium group-data-[collapsible=icon]:hidden">
          {current === "grup" ? "PMP Group" : (active?.Nama ?? "Pilih PT")}
        </span>
        <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem render={<Link href="/grup" />} className="justify-between text-xs">
          <span className="flex items-center gap-2">
            <LayoutGrid className="size-3.5 text-muted-foreground" />
            PMP Group
          </span>
          {current === "grup" && <Check className="size-3.5 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {aktif.map((entity) => (
          <DropdownMenuItem
            key={entity.PerusahaanID}
            render={<Link href={(entity.Kode && PT_ROUTES[entity.Kode]) ?? "#"} />}
            className="justify-between text-xs"
          >
            {entity.Nama}
            {entity.Kode === current && <Check className="size-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
        {standalone.length > 0 && <DropdownMenuSeparator />}
        {standalone.map((entity) => (
          <DropdownMenuItem
            key={entity.PerusahaanID}
            className="justify-between text-xs"
            onClick={() => entity.StandaloneUrl && window.open(entity.StandaloneUrl, "_blank", "noopener,noreferrer")}
          >
            {entity.Nama}
            <ExternalLink className="size-3.5 text-muted-foreground" />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
