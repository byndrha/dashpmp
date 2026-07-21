"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SalesTransactionCards } from "@/components/dashboard/sales-transaction-cards";
import type { SalesOrderCard } from "@/lib/queries/sales-cards";

export function KartuTransaksiPanel({ orders }: { orders: SalesOrderCard[] }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="sticky top-14 z-30 bg-background pt-2 pb-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-muted-foreground">Kartu Transaksi</h2>
        <Button variant="outline" size="sm" onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          {collapsed ? "Tampilkan" : "Sembunyikan"}
        </Button>
      </div>
      {!collapsed && (
        <div className="mt-2 rounded-lg border bg-card p-3">
          <SalesTransactionCards orders={orders} />
        </div>
      )}
    </div>
  );
}
