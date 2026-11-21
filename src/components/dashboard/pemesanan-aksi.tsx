"use client";

// Tombol aksi satu Sales Order — dipakai bersama oleh tampilan Daftar
// (pemesanan-list.tsx) dan Papan (pemesanan-papan.tsx) supaya aturan
// "boleh ubah/hapus hanya sebelum Terbit" cukup ditulis sekali.
import { useState, useTransition } from "react";
import { Pencil, Trash2, CalendarClock, FileText, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateWib, formatKemasanQty, formatRupiah } from "@/lib/format";
import type { SalesOrderListRow } from "@/lib/queries/pemesanan";
import { deletePemesananAction } from "@/app/mkesindo/(dashboard)/pemesanan/actions";

export interface PemesananAksiHandlers {
  onEdit: () => void;
  onEditTransDate: () => void;
  onOpenSr: () => void;
  onOpenSi: () => void;
  onDeleted: () => void;
}

export function PemesananAksi({ row, onEdit, onEditTransDate, onOpenSr, onOpenSi, onDeleted }: { row: SalesOrderListRow } & PemesananAksiHandlers) {
  const [pending, startTransition] = useTransition();
  const [konfirmasiHapus, setKonfirmasiHapus] = useState(false);
  const canModify = row.Status !== "Terbit";

  // Dipanggil dari tombol "Hapus" di popup konfirmasi (bukan confirm()
  // bawaan peramban). Popup tetap terbuka sampai hapus selesai/gagal.
  function handleDelete() {
    startTransition(async () => {
      const result = await deletePemesananAction(row.SalesOrderID);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setKonfirmasiHapus(false);
      toast.success(`Pesanan ${row.CustomerName} dihapus.`);
      onDeleted();
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      {row.InvoiceToken && (
        <Button variant="ghost" size="icon" className="size-7" title="Lihat SI" onClick={onOpenSi}>
          <FileText className="size-3.5" />
        </Button>
      )}
      {row.SalesReturnId && (
        <Button variant="ghost" size="icon" className="size-7" title="Lihat SR" onClick={onOpenSr}>
          <Undo2 className="size-3.5" />
        </Button>
      )}
      {canModify ? (
        <>
          <Button variant="ghost" size="icon" className="size-7" title="Ubah pemesanan" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" title="Hapus" disabled={pending} onClick={() => setKonfirmasiHapus(true)}>
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        </>
      ) : (
        // Penjadwalan (Ubah Pemesanan) dan hapus tidak tersedia setelah
        // Terbit — satu-satunya yang masih bisa diperbaiki pada pesanan yang
        // sudah dikirim: TransDate yang salah (lihat UbahTanggalPemesananDialog).
        <Button variant="ghost" size="icon" className="size-7" onClick={onEditTransDate} title="Ubah tanggal pemesanan">
          <CalendarClock className="size-3.5" />
        </Button>
      )}
      <Dialog open={konfirmasiHapus} onOpenChange={(o) => !pending && setKonfirmasiHapus(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Hapus pesanan ini?</DialogTitle>
            <DialogDescription>
              Sales Order ini akan dihapus dan dikeluarkan dari jadwal pengirimannya. Tindakan ini tidak bisa
              dibatalkan dari dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/30 p-3 text-xs">
            <p className="font-medium text-foreground">{row.CustomerName}</p>
            <p className="text-muted-foreground">
              {row.VoucherNo} · {formatDateWib(row.TransDate)}
            </p>
            <p className="text-muted-foreground">
              {formatKemasanQty(row.Qty10KG, row.Qty5KG)} · {formatRupiah(row.Amount)}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setKonfirmasiHapus(false)}>
              Batal
            </Button>
            <Button variant="destructive" disabled={pending} onClick={handleDelete}>
              <Trash2 className="size-3.5" />
              {pending ? "Menghapus..." : "Hapus"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
