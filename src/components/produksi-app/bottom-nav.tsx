"use client";

import { Snowflake, ShieldCheck, Package, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProduksiTabKey } from "./produksi-tab-shell";

const TABS: { key: ProduksiTabKey; label: string; icon: typeof Snowflake }[] = [
  { key: "warehouse", label: "Stok Es", icon: Snowflake },
  { key: "kualitas", label: "Kualitas", icon: ShieldCheck },
  { key: "bahan-baku", label: "Bahan Baku", icon: Package },
  { key: "aktivitas-produksi", label: "Aktivitas", icon: Users },
];

export function ProduksiBottomNav({
  activeTab,
  onChange,
  locked = false,
}: {
  activeTab: ProduksiTabKey;
  onChange: (tab: ProduksiTabKey) => void;
  // Dikunci selama sesi Mulai Muat sedang berlangsung di tab Stok Es --
  // berpindah tab lain mid-alokasi cuma bikin bingung, bukan sesuatu yang
  // perlu dilakukan saat itu. Lihat WarehouseView.onPickingChange.
  locked?: boolean;
}) {
  return (
    <nav className="relative flex border-t border-border bg-background">
      {TABS.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            disabled={locked}
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
      {locked && <div className="pointer-events-none absolute inset-0 bg-black/60" />}
    </nav>
  );
}
