"use client";

import { LayoutGrid, History, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProduksiAppTabKey } from "./produksi-app-tab-shell";

const TABS: { key: ProduksiAppTabKey; label: string; icon: typeof LayoutGrid }[] = [
  { key: "denah", label: "Denah", icon: LayoutGrid },
  { key: "riwayat", label: "Riwayat", icon: History },
  { key: "profil", label: "Profil", icon: User },
];

export function ProduksiAppBottomNav({ activeTab, onChange }: { activeTab: ProduksiAppTabKey; onChange: (tab: ProduksiAppTabKey) => void }) {
  return (
    <nav className="flex border-t border-border bg-background">
      {TABS.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-primary" : "text-muted-foreground")}
          >
            <tab.icon className="size-5" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
