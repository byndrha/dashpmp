"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { KinerjaMarketingSubTab } from "@/components/pemasaran-app/kinerja-marketing-sub-tab";
import { PengajuanSubTab } from "@/components/pemasaran-app/pengajuan-sub-tab";

type SubTabKey = "kinerja" | "pengajuan";

const SUB_TABS: { key: SubTabKey; label: string }[] = [
  { key: "kinerja", label: "Kinerja Marketing" },
  { key: "pengajuan", label: "Pengajuan" },
];

export function PemasaranTab() {
  const [activeSubTab, setActiveSubTab] = useState<SubTabKey>("kinerja");
  const [visited, setVisited] = useState<Set<SubTabKey>>(() => new Set(["kinerja"]));

  function handleChange(tab: SubTabKey) {
    setActiveSubTab(tab);
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex overflow-x-auto border-b border-border bg-background">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => handleChange(tab.key)}
            className={cn(
              "shrink-0 whitespace-nowrap px-4 py-2.5 text-sm font-medium",
              activeSubTab === tab.key
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {visited.has("kinerja") && <div className={cn(activeSubTab !== "kinerja" && "hidden")}><KinerjaMarketingSubTab /></div>}
        {visited.has("pengajuan") && <div className={cn(activeSubTab !== "pengajuan" && "hidden")}><PengajuanSubTab /></div>}
      </div>
    </div>
  );
}
