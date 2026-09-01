"use client";

import { ClipboardCheck, Footprints, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SatpamTabKey } from "./satpam-tab-shell";

const TABS: { key: SatpamTabKey; label: string; icon: typeof ClipboardCheck }[] = [
  { key: "inspeksi", label: "Inspeksi", icon: ClipboardCheck },
  { key: "patroli", label: "Patroli", icon: Footprints },
  { key: "tamu", label: "Tamu", icon: UserPlus },
];

// Plain buttons, not <Link> — tab switching is a client-side state change
// inside SatpamTabShell (all 3 tabs stay mounted once visited), not a
// Next.js route navigation.
//
// Not `fixed` — a normal flex sibling in SatpamTabShell's h-dvh column, so
// its height is naturally reserved from the flex-1 content area above it.
// See this plan's Global Constraints for why a `fixed` nav is unsafe here.
export function SatpamBottomNav({ activeTab, onChange }: { activeTab: SatpamTabKey; onChange: (tab: SatpamTabKey) => void }) {
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
