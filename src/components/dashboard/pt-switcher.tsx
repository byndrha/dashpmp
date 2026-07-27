"use client";

import { Check, ChevronsUpDown, Building2, ExternalLink } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PerusahaanSwitcherEntry } from "@/lib/queries/perusahaan";

// "AktifPenuh" entries are switchable in principle, but only one exists
// today (PT Mitra Kelola Esindo) and this dashboard has no live
// multi-tenant database switching yet — selecting a different AktifPenuh
// entry, once a second one exists, does nothing until that separate,
// larger project is built. "StandaloneHTML" entries behave exactly like
// the previous hardcoded STATIC_REPORTS list: open a new tab, don't change
// what this dashboard is showing. "Draft" entries are never in `list` —
// listPerusahaanForSwitcher() already excludes them.
export function PTSwitcher({ list }: { list: PerusahaanSwitcherEntry[] }) {
  const aktif = list.filter((p) => p.Status === "AktifPenuh");
  const standalone = list.filter((p) => p.Status === "StandaloneHTML");
  const active = aktif[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2 py-1.5 text-left text-xs hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center">
        <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium group-data-[collapsible=icon]:hidden">
          {active?.Nama ?? "Pilih PT"}
        </span>
        <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {aktif.map((entity) => (
          <DropdownMenuItem key={entity.PerusahaanID} className="justify-between text-xs">
            {entity.Nama}
            {entity.PerusahaanID === active?.PerusahaanID && <Check className="size-3.5 text-primary" />}
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
