"use client";

import { useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateWib, formatRupiah } from "@/lib/format";
import type { SalesReturnListRow } from "@/lib/queries/pemesanan";
import { SalesReturnDetailDialog } from "@/components/dashboard/sales-return-detail-dialog";

// "Pesanan Kembali" tab on /mkesindo/pemesanan — every MKE/SR/ transaction
// in the page's current date/wilayah filter. Row shape mirrors
// PemesananList's own 2-line layout (name+meta, amount on the right, a
// single icon action) for visual consistency between the two tabs.
function PesananKembaliRow({ row, onOpen }: { row: SalesReturnListRow; onOpen: () => void }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{row.CustomerName}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span>{row.VoucherNo}</span>
          <span>&middot;</span>
          <span>{row.Wilayah}</span>
          <span>&middot;</span>
          <span>{formatDateWib(row.TransDate)}</span>
          {row.DeliveryOrderVoucherNo && (
            <>
              <span>&middot;</span>
              <span>DO {row.DeliveryOrderVoucherNo}</span>
            </>
          )}
        </p>
      </div>
      <p className="shrink-0 font-medium tabular-nums">{formatRupiah(row.Amount)}</p>
      <Button variant="ghost" size="icon" className="size-7 shrink-0" title="Lihat SR" onClick={onOpen}>
        <Undo2 className="size-3.5" />
      </Button>
    </div>
  );
}

export function PesananKembaliList({ rows }: { rows: SalesReturnListRow[] }) {
  const [openSalesReturnId, setOpenSalesReturnId] = useState<string | null>(null);

  return (
    <>
      <div className="flex flex-col divide-y rounded-lg border">
        {rows.map((r) => (
          <PesananKembaliRow key={r.SalesReturnID} row={r} onOpen={() => setOpenSalesReturnId(r.SalesReturnID)} />
        ))}
        {rows.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada Pesanan Kembali pada rentang ini.</p>
        )}
      </div>

      <SalesReturnDetailDialog
        salesReturnId={openSalesReturnId}
        onOpenChange={(open) => !open && setOpenSalesReturnId(null)}
      />
    </>
  );
}
