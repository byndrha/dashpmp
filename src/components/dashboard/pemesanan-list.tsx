"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { formatDateWib, formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SalesOrderListRow } from "@/lib/queries/pemesanan";
import type { ArmadaRow } from "@/lib/queries/armada";
import type { DriverOption } from "@/lib/queries/delivery";
import { UbahPemesananDialog, type UbahPemesananTarget } from "@/components/dashboard/ubah-pemesanan-dialog";
import {
  UbahTanggalPemesananDialog,
  type UbahTanggalPemesananTarget,
} from "@/components/dashboard/ubah-tanggal-pemesanan-dialog";
import { SalesReturnDetailDialog } from "@/components/dashboard/sales-return-detail-dialog";
import { PemesananAksi, type PemesananAksiHandlers } from "@/components/dashboard/pemesanan-aksi";
import { PemesananPapan, TahapBadge, infoPengiriman, labelRetur, tahapPesanan, tanggalISO } from "@/components/dashboard/pemesanan-papan";
import { SiPreviewDialog, type SiPreviewTarget } from "@/components/dashboard/si-preview-dialog";
import { useTampilanPemesanan } from "@/components/dashboard/pemesanan-tampilan";

// Kolom bersama kepala tabel & baris (layar lebar); di HP tiap baris jadi
// kartu bertumpuk. Tahap memakai lencana yang sama dengan kolom Papan.
const KOLOM_DAFTAR =
  "md:grid md:grid-cols-[minmax(0,2.2fr)_150px_minmax(0,1fr)_minmax(0,1.6fr)_130px_auto] md:items-center md:gap-4";

function KepalaDaftar() {
  return (
    <div
      className={cn(
        "hidden border-b bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
        KOLOM_DAFTAR
      )}
    >
      <span>Pesanan</span>
      <span>Tahap</span>
      <span>Qty</span>
      <span>Pengiriman</span>
      <span className="text-right">Nominal</span>
      <span className="w-[4.5rem]" />
    </div>
  );
}

function PemesananRow({ row, terlambat, aksi }: { row: SalesOrderListRow; terlambat: boolean; aksi: PemesananAksiHandlers }) {
  const kirim = infoPengiriman(row);
  return (
    <div className={cn("flex flex-col gap-2 px-3 py-2.5 text-sm hover:bg-muted/30", KOLOM_DAFTAR)}>
      {/* Pesanan */}
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2 md:block">
          <p className="truncate font-medium" title={row.CustomerName}>
            {row.CustomerName}
          </p>
          <p className="shrink-0 font-display text-sm font-semibold tabular-nums md:hidden">{formatRupiah(row.Amount)}</p>
        </div>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span>{row.VoucherNo}</span>
          <span>&middot;</span>
          <span>{formatDateWib(row.TransDate)}</span>
          {terlambat && (
            <span
              className="rounded bg-destructive/15 px-1.5 py-px text-[10px] font-medium text-destructive"
              title="Usang: tanggal pesanan sudah lewat, tetapi belum dikirim"
            >
              Usang
            </span>
          )}
          <span>&middot;</span>
          <span>{row.Wilayah}</span>
        </p>
      </div>

      {/* Tahap */}
      <div className="flex flex-wrap items-center gap-1">
        <TahapBadge row={row} />
        {row.SalesReturnId && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium",
              row.InvoiceToken ? "bg-warning/15 text-warning" : "bg-destructive/15 text-destructive"
            )}
            title={row.InvoiceToken ? "Sebagian barang dikembalikan; sisanya tetap ditagih" : "Semua barang dikembalikan; tidak ada tagihan"}
          >
            {labelRetur(row)}
          </span>
        )}
      </div>

      {/* Qty */}
      <div className="flex flex-wrap gap-1">
        {row.Qty10KG > 0 && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            10KG <span className="font-semibold text-foreground">{row.Qty10KG.toLocaleString("id-ID")}</span>
          </span>
        )}
        {row.Qty5KG > 0 && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            5KG <span className="font-semibold text-foreground">{row.Qty5KG.toLocaleString("id-ID")}</span>
          </span>
        )}
        {row.Qty10KG === 0 && row.Qty5KG === 0 && <span className="text-xs text-muted-foreground">-</span>}
      </div>

      {/* Pengiriman — dari jadwal Papan Pengiriman dashboard, atau dari DO
          itu sendiri bila DO dibuat tanpa jadwal (lihat infoPengiriman). */}
      <div className="min-w-0 text-xs text-muted-foreground" title={kirim?.judul ?? undefined}>
        {kirim ? (
          <>
            <p className="flex min-w-0 items-center gap-1">
              <Truck className="size-3 shrink-0" />
              <span className="truncate">{kirim.utama}</span>
            </p>
            {kirim.waktu && <p className="tabular-nums">{kirim.waktu}</p>}
          </>
        ) : (
          <span>Belum ada pengiriman</span>
        )}
      </div>

      {/* Nominal (layar lebar; di HP sudah tampil di samping nama) */}
      <p className="hidden text-right font-display text-sm font-semibold tabular-nums md:block">{formatRupiah(row.Amount)}</p>

      <div className="flex justify-end border-t pt-1.5 md:border-0 md:pt-0">
        <PemesananAksi row={row} {...aksi} />
      </div>
    </div>
  );
}

export function PemesananList({
  rows,
  armadaList,
  drivers,
  todayISO,
}: {
  rows: SalesOrderListRow[];
  armadaList: ArmadaRow[];
  drivers: DriverOption[];
  todayISO: string;
}) {
  const router = useRouter();
  const tampilan = useTampilanPemesanan();
  const [editingTarget, setEditingTarget] = useState<UbahPemesananTarget | null>(null);
  const [editingTransDateTarget, setEditingTransDateTarget] = useState<UbahTanggalPemesananTarget | null>(null);
  const [openSalesReturnId, setOpenSalesReturnId] = useState<string | null>(null);
  const [siPreview, setSiPreview] = useState<SiPreviewTarget | null>(null);

  function aksiFor(r: SalesOrderListRow): PemesananAksiHandlers {
    return {
      onEdit: () =>
        setEditingTarget({
          salesOrderId: r.SalesOrderID,
          customerName: r.CustomerName,
          wilayah: r.Wilayah,
          qty: r.Qty,
          qty10KG: r.Qty10KG,
          qty5KG: r.Qty5KG,
        }),
      onEditTransDate: () =>
        setEditingTransDateTarget({
          salesOrderId: r.SalesOrderID,
          customerName: r.CustomerName,
          voucherNo: r.VoucherNo,
          transDate: r.TransDate,
        }),
      onOpenSr: () => setOpenSalesReturnId(r.SalesReturnId),
      onOpenSi: () => r.InvoiceToken && setSiPreview({ token: r.InvoiceToken, customerName: r.CustomerName, voucherNo: r.VoucherNo }),
      onDeleted: () => router.refresh(),
    };
  }

  return (
    <>
      {tampilan === "papan" ? (
        <PemesananPapan rows={rows} todayISO={todayISO} aksiFor={aksiFor} />
      ) : (
        <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
          <KepalaDaftar />
          {rows.map((r) => {
            const t = tahapPesanan(r);
            return (
              <PemesananRow
                key={r.SalesOrderID}
                row={r}
                terlambat={(t === "belum" || t === "dijadwalkan") && tanggalISO(r.TransDate) < todayISO}
                aksi={aksiFor(r)}
              />
            );
          })}
          {rows.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada Sales Order pada rentang ini.</p>
          )}
        </div>
      )}

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
      <SalesReturnDetailDialog
        salesReturnId={openSalesReturnId}
        onOpenChange={(open) => !open && setOpenSalesReturnId(null)}
      />
      <SiPreviewDialog target={siPreview} onOpenChange={(open) => !open && setSiPreview(null)} />
    </>
  );
}
