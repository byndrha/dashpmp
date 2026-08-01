"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatRupiah, formatKemasanQty } from "@/lib/format";
import type { SalesOrderListRow, SalesOrderStatus } from "@/lib/queries/pemesanan";
import type { ArmadaRow } from "@/lib/queries/armada";
import type { DriverOption } from "@/lib/queries/delivery";
import { UbahPemesananDialog, type UbahPemesananTarget } from "@/components/dashboard/ubah-pemesanan-dialog";
import {
  UbahTanggalPemesananDialog,
  type UbahTanggalPemesananTarget,
} from "@/components/dashboard/ubah-tanggal-pemesanan-dialog";
import { deletePemesananAction } from "@/app/(dashboard)/pemesanan/actions";

const STATUS_VARIANT: Record<SalesOrderStatus, "outline" | "secondary" | "default"> = {
  "Belum Dijadwalkan": "outline",
  Draft: "secondary",
  Terbit: "default",
};

// Row-per-order, 2 lines each (name+status, then the rest as a wrapping
// meta line) instead of a 9-column table — a wide flat table either forces
// horizontal scrolling on normal screens or gets so cramped it's unreadable,
// while a fully-stacked "one field per line" card would make the list very
// tall for no benefit (nothing here needs its own line).
function PemesananRow({
  row,
  onEdit,
  onEditTransDate,
  onDeleted,
}: {
  row: SalesOrderListRow;
  onEdit: () => void;
  onEditTransDate: () => void;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const canModify = row.Status !== "Terbit";

  function handleDelete() {
    if (!confirm(`Hapus pesanan ${row.CustomerName} (${row.VoucherNo})?`)) return;
    startTransition(async () => {
      try {
        await deletePemesananAction(row.SalesOrderID);
        onDeleted();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Gagal menghapus pesanan.");
      }
    });
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{row.CustomerName}</p>
          <Badge variant={STATUS_VARIANT[row.Status]} className="shrink-0 text-[10px]">
            {row.Status}
          </Badge>
        </div>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span>{row.VoucherNo}</span>
          <span>&middot;</span>
          <span>{row.Wilayah}</span>
          <span>&middot;</span>
          <span>{formatDate(row.TransDate)}</span>
          {row.DueDate && (
            <>
              <span>&middot;</span>
              <span>Jatuh tempo {formatDate(row.DueDate)}</span>
            </>
          )}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-medium tabular-nums">{formatRupiah(row.Amount)}</p>
        <p className="text-xs tabular-nums text-muted-foreground">{formatKemasanQty(row.Qty10KG, row.Qty5KG)}</p>
      </div>
      {canModify ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" className="size-7" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" disabled={pending} onClick={handleDelete}>
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        </div>
      ) : (
        // Scheduling (Ubah Pemesanan) and delete are gone once Terbit — this
        // is the one thing staff can still fix on a shipped order: a wrong
        // TransDate (see UbahTanggalPemesananDialog's own comment).
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" className="size-7" onClick={onEditTransDate} title="Ubah tanggal pemesanan">
            <CalendarClock className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function PemesananList({
  rows,
  armadaList,
  drivers,
}: {
  rows: SalesOrderListRow[];
  armadaList: ArmadaRow[];
  drivers: DriverOption[];
}) {
  const router = useRouter();
  const [editingTarget, setEditingTarget] = useState<UbahPemesananTarget | null>(null);
  const [editingTransDateTarget, setEditingTransDateTarget] = useState<UbahTanggalPemesananTarget | null>(null);

  return (
    <>
      <div className="flex flex-col divide-y rounded-lg border">
        {rows.map((r) => (
          <PemesananRow
            key={r.SalesOrderID}
            row={r}
            onEdit={() =>
              setEditingTarget({
                salesOrderId: r.SalesOrderID,
                customerName: r.CustomerName,
                wilayah: r.Wilayah,
                qty: r.Qty,
                qty10KG: r.Qty10KG,
                qty5KG: r.Qty5KG,
              })
            }
            onEditTransDate={() =>
              setEditingTransDateTarget({
                salesOrderId: r.SalesOrderID,
                customerName: r.CustomerName,
                voucherNo: r.VoucherNo,
                transDate: r.TransDate,
              })
            }
            onDeleted={() => router.refresh()}
          />
        ))}
        {rows.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada Sales Order pada rentang ini.</p>
        )}
      </div>

      <UbahPemesananDialog
        target={editingTarget}
        onOpenChange={(open) => !open && setEditingTarget(null)}
        armadaList={armadaList}
        drivers={drivers}
      />
      <UbahTanggalPemesananDialog
        target={editingTransDateTarget}
        onOpenChange={(open) => !open && setEditingTransDateTarget(null)}
      />
    </>
  );
}
