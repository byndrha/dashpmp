"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WilayahDeliveryPanel } from "@/components/dashboard/wilayah-delivery-panel";
import { KartuTransaksiPanel } from "@/components/dashboard/kartu-transaksi-panel";
import { MitraDOPanel } from "@/components/dashboard/mitra-do-panel";
import type { SalesOrderCard } from "@/lib/queries/sales-cards";
import type { WilayahDeliverySummary } from "@/lib/queries/delivery";
import type { MitraDOMonthly } from "@/lib/queries/mitra-do";

export function TransaksiPanels({
  orders,
  wilayahDelivery,
  mitraDO,
  initialMarketingFilter,
}: {
  orders: SalesOrderCard[];
  wilayahDelivery: WilayahDeliverySummary[];
  mitraDO: MitraDOMonthly;
  // Seeded from Kinerja Marketing's "?marketing=" deep link (Pemasaran) —
  // clicking a Marketing there lands here pre-filtered, scrolled straight
  // to the DO-per-Mitra panel instead of the page top.
  initialMarketingFilter?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  // Lifted here (not local to MitraDOPanel) so clicking a Wilayah tile below
  // can drive it directly — this is the single shared "which region is the
  // DO-per-Mitra panel currently filtered to" state.
  const [mitraDOWilayah, setMitraDOWilayah] = useState("all");
  const [mitraDOMarketing, setMitraDOMarketing] = useState(initialMarketingFilter || "all");
  const mitraDORef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialMarketingFilter) mitraDORef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Only ever meant to fire once, off the value the page loaded with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleWilayahClick(wilayah: string) {
    setMitraDOWilayah(wilayah);
    mitraDORef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <Button variant="outline" size="sm" className="self-start" onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          {collapsed ? "Detail" : "Ringkas"}
        </Button>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <WilayahDeliveryPanel data={wilayahDelivery} collapsed={collapsed} onWilayahClick={handleWilayahClick} />
          <KartuTransaksiPanel orders={orders} collapsed={collapsed} />
        </div>
      </div>

      <div ref={mitraDORef}>
        <MitraDOPanel
          data={mitraDO}
          wilayahFilter={mitraDOWilayah}
          onWilayahFilterChange={setMitraDOWilayah}
          marketingFilter={mitraDOMarketing}
          onMarketingFilterChange={setMitraDOMarketing}
        />
      </div>
    </div>
  );
}
