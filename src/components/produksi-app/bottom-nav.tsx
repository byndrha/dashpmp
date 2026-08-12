"use client";

import { ClipboardList, Snowflake } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProduksiTabKey } from "./produksi-tab-shell";

const TABS: { key: ProduksiTabKey; label: string; icon: typeof ClipboardList }[] = [
  { key: "kartu-pengiriman", label: "Pengiriman", icon: ClipboardList },
  { key: "warehouse", label: "Stok Es", icon: Snowflake },
];

export function ProduksiBottomNav({
  activeTab,
  onChange,
}: {
  activeTab: ProduksiTabKey;
  onChange: (tab: ProduksiTabKey) => void;
}) {
  return (
    <nav className="flex border-t border-border bg-background">
      {TABS.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <tab.icon className="size-5" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
