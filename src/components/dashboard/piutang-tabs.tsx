"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// Purely client-side (no URL sync): each panel prop is one React element
// created once by the server page (each wrapped in its own <Suspense> there,
// see piutang-sections.tsx — panels stream in independently as their own
// query resolves, not all-at-once anymore), so switching tabs never
// recreates or refetches them. Round-tripping through router.push here (as
// an earlier version did) meant every tab click re-ran the whole page's
// data fetching AND reset scroll to the top, which is exactly what this
// avoids.
export function PiutangTabs({
  invoicePanel,
  invoiceLabel = "Invoice Outstanding",
  pembayaranPanel,
  pembayaranLabel = "Pembayaran",
  prioritasPanel,
  penagihanPanel,
}: {
  invoicePanel: React.ReactNode;
  // Es Balok's Piutang pages reuse this first tab slot for "Rincian per
  // Agen" instead of a genuine per-invoice table (see piutang-per-agen-table
  // vs es-balok-invoice-outstanding-table) — MKEsindo's own /aging page
  // never passes this, so it keeps the original label.
  invoiceLabel?: string;
  pembayaranPanel: React.ReactNode;
  // Es Balok's Pembayaran tab also lists Tarikan (savings withdrawals),
  // which has no MKEsindo equivalent — MKEsindo's own /aging page never
  // passes this, so it keeps the original "Pembayaran" label.
  pembayaranLabel?: string;
  prioritasPanel: React.ReactNode;
  // Tab ekstensi ByChat (hanya MKEsindo untuk saat ini); null = tab tidak ditampilkan.
  penagihanPanel?: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<string>("invoice");
  const TABS = [
    { value: "invoice", label: invoiceLabel },
    { value: "pembayaran", label: pembayaranLabel },
    { value: "prioritas", label: "Prioritas Pemulihan" },
    ...(penagihanPanel ? [{ value: "penagihan", label: "Penagihan ByChat" }] : []),
  ];

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
      {penagihanPanel && <TabsContent value="penagihan">{penagihanPanel}</TabsContent>}
    </Tabs>
  );
}
