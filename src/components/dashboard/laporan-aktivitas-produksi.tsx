"use client";

import { formatDate } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AktivitasShiftInfo } from "@/lib/queries/aktivitas-produksi";
import { hitungTotalDenda } from "@/lib/aktivitas-produksi-shared";

export function LaporanAktivitasProduksi({
  riwayat,
  namaMap,
}: {
  riwayat: AktivitasShiftInfo[];
  namaMap: Record<number, string>;
}) {
  return (
    <div className="rounded-lg border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tanggal Usaha</TableHead>
            <TableHead>Shift</TableHead>
            <TableHead>Staf Operasional</TableHead>
            <TableHead className="text-right">Stok Es Sebelumnya</TableHead>
            <TableHead className="text-right">Pecah Kemasan</TableHead>
            <TableHead className="text-right">Es Jatuh</TableHead>
            <TableHead className="text-right">Ganti Return</TableHead>
            <TableHead className="text-right">Sealer Jebol</TableHead>
            <TableHead className="text-right">Total Denda</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {riwayat.map((r) => (
            <TableRow key={`${r.tanggalUsaha}-${r.shift}`}>
              <TableCell>{formatDate(r.tanggalUsaha)}</TableCell>
              <TableCell>{r.shiftLabel}</TableCell>
              <TableCell>{r.stafOperasionalAkunId ? (namaMap[r.stafOperasionalAkunId] ?? "?") : "Belum diisi"}</TableCell>
              <TableCell className="text-right tabular-nums">{r.stokEsSebelumnya10KG.toLocaleString("id-ID")}</TableCell>
              <TableCell className="text-right tabular-nums">{r.pecahKemasanQty}</TableCell>
              <TableCell className="text-right tabular-nums">{r.esJatuhQty}</TableCell>
              <TableCell className="text-right tabular-nums">{r.gantiReturnQty}</TableCell>
              <TableCell className="text-right tabular-nums">{r.sealerJebolQty}</TableCell>
              <TableCell className="text-right tabular-nums">
                Rp{hitungTotalDenda(r.pecahKemasanQty, r.esJatuhQty).toLocaleString("id-ID")}
              </TableCell>
            </TableRow>
          ))}
          {riwayat.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                Belum ada data.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
