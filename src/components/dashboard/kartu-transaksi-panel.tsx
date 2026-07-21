import { SalesTransactionCards } from "@/components/dashboard/sales-transaction-cards";
import type { SalesOrderCard } from "@/lib/queries/sales-cards";

// Ringkas/Detail is controlled by TransaksiPanels (the shared toggle above
// this and WilayahDeliveryPanel), not owned here.
export function KartuTransaksiPanel({ orders, collapsed }: { orders: SalesOrderCard[]; collapsed: boolean }) {
  return (
    <div className="@container sticky top-14 z-30 rounded-lg border bg-card p-3 shadow-md">
      <h2 className="font-display text-sm font-semibold text-muted-foreground">Kartu Transaksi</h2>
      {!collapsed && (
        <div className="mt-2">
          <SalesTransactionCards orders={orders} />
        </div>
      )}
    </div>
  );
}
