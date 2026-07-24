"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SalesTransactionCards } from "@/components/dashboard/sales-transaction-cards";
import type { SalesOrderCard } from "@/lib/queries/sales-cards";

// Ringkas/Detail is controlled by TransaksiPanels (the shared toggle above
// this and WilayahDeliveryPanel), not owned here.
export function KartuTransaksiPanel({ orders, collapsed }: { orders: SalesOrderCard[]; collapsed: boolean }) {
  const [search, setSearch] = useState("");

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => o.CustomerName.toLowerCase().includes(q));
  }, [orders, search]);

  return (
    <div className="@container sticky top-14 z-30 rounded-lg border bg-card p-3 shadow-md">
      <h2 className="font-display text-sm font-semibold text-muted-foreground">Kartu Transaksi</h2>
      {!collapsed && (
        <div className="mt-2 flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari mitra..."
              className="h-8 pl-8 text-xs"
            />
          </div>
          <SalesTransactionCards orders={filteredOrders} />
        </div>
      )}
    </div>
  );
}
