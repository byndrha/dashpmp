"use client";

import { ClipboardList, Map, History, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DriverTabKey } from "./driver-tab-shell";

const TABS: { key: DriverTabKey; label: string; icon: typeof ClipboardList }[] = [
  { key: "tugas", label: "Tugas", icon: ClipboardList },
  { key: "peta", label: "Peta", icon: Map },
  { key: "riwayat", label: "Riwayat", icon: History },
  { key: "profil", label: "Profil", icon: User },
];

// Plain buttons, not <Link> — switching tabs is now a client-side state
// change inside DriverTabShell (all 4 tabs stay mounted once visited), not
// a Next.js route navigation. A real navigation would force a fresh
// Server Component render/data fetch every time, which is exactly the
// "terasa lambat" (feels slow) complaint this shell exists to fix.
//
// Not `fixed` — a normal flex sibling in DriverTabShell's h-dvh column, so
// its height is naturally reserved from the flex-1 content area above it.
// A `fixed` nav (the previous layout.tsx's approach, paired with a
// hardcoded `pb-16` on the content) takes zero space in flex sizing, so
// flex-1 content silently extends full-height behind it — a floating map
// control positioned relative to the map's own (now full-height) bottom
// edge can end up physically overlapping and stealing clicks from the nav,
// even though it visually looks fine on top of the nav's opaque background.
export function DriverBottomNav({ activeTab, onChange }: { activeTab: DriverTabKey; onChange: (tab: DriverTabKey) => void }) {
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
