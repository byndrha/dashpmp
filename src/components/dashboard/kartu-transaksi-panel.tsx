"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SalesTransactionCards } from "@/components/dashboard/sales-transaction-cards";
import { ExportXlsxButton } from "@/components/dashboard/export-xlsx-button";
import type { XlsxColumn } from "@/lib/export-xlsx";
import type { SalesOrderCard } from "@/lib/queries/sales-cards";

const EXPORT_COLUMNS: XlsxColumn[] = [
  { header: "No Voucher", key: "voucherNo", type: "text", width: 20 },
  { header: "Tanggal", key: "transDate", type: "text", width: 12 },
  { header: "Mitra", key: "customerName", width: 26 },
  { header: "Tipe", key: "partnerType", width: 12 },
  { header: "Wilayah", key: "wilayah", width: 16 },
  { header: "Kecamatan", key: "kecamatan", width: 16 },
  { header: "Qty 10KG", key: "qty10kg", type: "number", width: 10 },
  { header: "Qty 5KG", key: "qty5kg", type: "number", width: 10 },
];

// Ringkas/Detail is controlled by TransaksiPanels (the shared toggle above
// this and WilayahDeliveryPanel), not owned here.
export function KartuTransaksiPanel({ orders, collapsed }: { orders: SalesOrderCard[]; collapsed: boolean }) {
  const [search, setSearch] = useState("");

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => o.CustomerName.toLowerCase().includes(q));
  }, [orders, search]);

  const exportRows = useMemo(
    () =>
      filteredOrders.map((o) => ({
        voucherNo: o.VoucherNo,
        transDate: o.TransDate,
        customerName: o.CustomerName,
        partnerType: o.PartnerType,
        wilayah: o.Wilayah,
        kecamatan: o.Kecamatan ?? "",
        qty10kg: o.Qty10KG,
        qty5kg: o.Qty5KG,
      })),
    [filteredOrders]
  );

  return (
    <div className="@container sticky top-14 z-30 rounded-lg border bg-card p-3 shadow-md">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-muted-foreground">Kartu Transaksi</h2>
        <ExportXlsxButton
          filename="kartu-transaksi"
          sheetName="Kartu Transaksi"
          columns={EXPORT_COLUMNS}
          rows={exportRows}
        />
      </div>
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
