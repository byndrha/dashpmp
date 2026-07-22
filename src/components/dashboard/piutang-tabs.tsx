"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const TABS = [
  { value: "invoice", label: "Invoice Outstanding" },
  { value: "pembayaran", label: "Pembayaran" },
  { value: "prioritas", label: "Prioritas Pemulihan" },
] as const;

// Purely client-side (no URL sync): every panel's data is already fetched
// upfront by the server page in one shot, so switching tabs has nothing to
// wait on — round-tripping through router.push here (as an earlier version
// did) meant every tab click re-ran the whole page's data fetching AND
// reset scroll to the top, which is exactly what this avoids.
export function PiutangTabs({
  invoicePanel,
  pembayaranPanel,
  prioritasPanel,
}: {
  invoicePanel: React.ReactNode;
  pembayaranPanel: React.ReactNode;
  prioritasPanel: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<string>("invoice");

  return (
    <Tabs value={activeTab} onValueChange={(v) => typeof v === "string" && setActiveTab(v)}>
      {/* w-full + overflow-x-auto (overriding TabsList's default w-fit)
          keeps a horizontally-scrollable tab strip contained to its own
          bounds on narrow screens, instead of the 3 labels forcing the
          whole page wider and producing a page-level horizontal scrollbar. */}
      <TabsList className="no-scrollbar w-full justify-start overflow-x-auto">
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="shrink-0">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="invoice">{invoicePanel}</TabsContent>
      <TabsContent value="pembayaran">{pembayaranPanel}</TabsContent>
      <TabsContent value="prioritas">{prioritasPanel}</TabsContent>
    </Tabs>
  );
}
