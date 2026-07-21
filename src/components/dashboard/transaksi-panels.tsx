"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WilayahDeliveryPanel } from "@/components/dashboard/wilayah-delivery-panel";
import { KartuTransaksiPanel } from "@/components/dashboard/kartu-transaksi-panel";
import type { SalesOrderCard } from "@/lib/queries/sales-cards";
import type { WilayahDeliverySummary } from "@/lib/queries/delivery";

export function TransaksiPanels({
  orders,
  wilayahDelivery,
}: {
  orders: SalesOrderCard[];
  wilayahDelivery: WilayahDeliverySummary[];
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <Button variant="outline" size="sm" className="self-start" onClick={() => setCollapsed((v) => !v)}>
        {collapsed ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        {collapsed ? "Detail" : "Ringkas"}
      </Button>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <WilayahDeliveryPanel data={wilayahDelivery} collapsed={collapsed} />
        <KartuTransaksiPanel orders={orders} collapsed={collapsed} />
      </div>
    </div>
  );
}
