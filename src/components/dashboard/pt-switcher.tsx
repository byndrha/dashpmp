"use client";

import { Check, ChevronsUpDown, Building2, ExternalLink } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ENTITIES = [{ id: "mkesindo", name: "PT Mitra Kelola Esindo" }];

// Standalone static report, not part of this app's module/permission
// system — opened in a new tab rather than switched into, since it doesn't
// change what data the rest of the dashboard is showing.
const STATIC_REPORTS = [{ id: "prima-maesa-putra", name: "PT Prima Maesa Putra (Ponorogo)", href: "/static/prima-maesa-putra" }];

export function PTSwitcher() {
  const active = ENTITIES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2 py-1.5 text-left text-xs hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center">
        <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium group-data-[collapsible=icon]:hidden">
          {active.name}
        </span>
        <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {ENTITIES.map((entity) => (
          <DropdownMenuItem key={entity.id} className="justify-between text-xs">
            {entity.name}
            {entity.id === active.id && <Check className="size-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {STATIC_REPORTS.map((report) => (
          <DropdownMenuItem
            key={report.id}
            className="justify-between text-xs"
            onClick={() => window.open(report.href, "_blank", "noopener,noreferrer")}
          >
            {report.name}
            <ExternalLink className="size-3.5 text-muted-foreground" />
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem disabled className="text-xs text-muted-foreground">
          + Tambah PT lain (segera)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
