"use client";

import { LayoutDashboard, Users, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PemasaranAppTabKey } from "./pemasaran-app-tab-shell";

const TABS: { key: PemasaranAppTabKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "beranda", label: "Beranda", icon: LayoutDashboard },
  { key: "mitra", label: "Mitra", icon: Users },
  { key: "pemasaran", label: "Pemasaran", icon: TrendingUp },
];

export function PemasaranAppBottomNav({
  activeTab,
  onChange,
}: {
  activeTab: PemasaranAppTabKey;
  onChange: (tab: PemasaranAppTabKey) => void;
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
