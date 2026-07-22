"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const TABS = [
  { value: "invoice", label: "Invoice Outstanding" },
  { value: "pembayaran", label: "Pembayaran" },
  { value: "prioritas", label: "Prioritas Pemulihan" },
] as const;

export function PiutangTabs({
  invoicePanel,
  pembayaranPanel,
  prioritasPanel,
}: {
  invoicePanel: React.ReactNode;
  pembayaranPanel: React.ReactNode;
  prioritasPanel: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "invoice";

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Tabs value={activeTab} onValueChange={(v) => typeof v === "string" && handleChange(v)}>
      <TabsList>
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
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
