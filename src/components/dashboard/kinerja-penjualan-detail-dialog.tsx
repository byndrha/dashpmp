// src/components/dashboard/kinerja-penjualan-detail-dialog.tsx
"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BulanPenjualan } from "@/lib/kinerja/marketing-collection-penjualan";

function formatBulan(bulanMulai: string): string {
  const d = new Date(bulanMulai + "T00:00:00Z");
  return d.toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
}

function formatSigned(n: number): string {
  if (n > 0) return `+${n.toLocaleString("id-ID")}`;
  if (n < 0) return n.toLocaleString("id-ID");
  return "0";
}

function formatRupiah(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}Rp${Math.abs(n).toLocaleString("id-ID")}`;
}

function formatRaw(n: number): string {
  return n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

export function KinerjaPenjualanDetailDialog({
  bulan,
  satuan,
  onOpenChange,
}: {
  bulan: BulanPenjualan | null;
  satuan: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={bulan !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rincian Perhitungan{bulan ? ` — ${formatBulan(bulan.bulanMulai)}` : ""}</DialogTitle>
        </DialogHeader>
        {bulan && (
          <div className="flex flex-col gap-4 text-sm">
            <div>
              <p className="font-medium">NOO (Total per bulan)</p>
              <p>
                Total bulan sebelumnya: {formatRaw(bulan.qtyNooSebelumnya)} {satuan}
              </p>
              <p>
                Total bulan berjalan: {formatRaw(bulan.qtyNooBerjalan)} {satuan}
              </p>
              <p>
                Selisih: {formatSigned(bulan.deltaNoo)} {satuan}
              </p>
            </div>
            <div>
              <p className="font-medium">Existing (Rata-rata per hari)</p>
              <p>
                Rata-rata bulan sebelumnya: {formatRaw(bulan.qtyExistingSebelumnya)} {satuan}/hari
              </p>
              <p>
                Rata-rata bulan berjalan: {formatRaw(bulan.qtyExistingBerjalan)} {satuan}/hari
              </p>
              <p>
                Selisih: {formatSigned(bulan.deltaExisting)} {satuan}/hari
              </p>
            </div>
            <div className="border-t pt-2">
              <p className="font-medium">
                Total: {formatSigned(bulan.totalQty)} {satuan}
              </p>
              <p className="font-medium">
                Nilai: {formatSigned(bulan.totalQty)} × Rp200 = {formatRupiah(bulan.nilaiRupiah)}
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
