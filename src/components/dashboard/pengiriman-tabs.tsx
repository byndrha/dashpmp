"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const TABS = [
  { value: "papan", label: "Papan Pengiriman" },
  { value: "terbuka", label: "Pengiriman Terbuka" },
] as const;

// Same pattern as piutang-tabs.tsx: pure client-side tab state, no URL
// param, no navigation on switch — both panels' data is already fetched
// upfront by the server page.
export function PengirimanTabs({
  terbukaPanel,
  papanPanel,
}: {
  terbukaPanel: React.ReactNode;
  papanPanel: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<string>("papan");

  return (
    <Tabs value={activeTab} onValueChange={(v) => typeof v === "string" && setActiveTab(v)}>
      <TabsList className="no-scrollbar w-full justify-start overflow-x-auto">
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="shrink-0">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="papan">{papanPanel}</TabsContent>
      <TabsContent value="terbuka">{terbukaPanel}</TabsContent>
    </Tabs>
  );
}
