"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const TABS = [
  { value: "pesanan", label: "Pesanan" },
  { value: "kembali", label: "Pesanan Kembali" },
] as const;

// Same purely-client-side pattern as PiutangTabs (no URL sync) — both
// panels are Server Components streamed in via their own <Suspense>
// boundary (see page.tsx), so both start fetching in parallel on first
// load regardless of which tab is active, and switching tabs afterward is
// instant with nothing left to wait on.
export function PemesananTabs({
  pesananPanel,
  kembaliPanel,
}: {
  pesananPanel: React.ReactNode;
  kembaliPanel: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<string>("pesanan");

  return (
    <Tabs value={activeTab} onValueChange={(v) => typeof v === "string" && setActiveTab(v)}>
      <TabsList className="no-scrollbar w-full justify-start overflow-x-auto">
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="shrink-0">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="pesanan">{pesananPanel}</TabsContent>
      <TabsContent value="kembali">{kembaliPanel}</TabsContent>
    </Tabs>
  );
}
