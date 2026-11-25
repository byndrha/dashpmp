"use client";

// Tombol "Export .xlsx" modul Pemesanan (pengganti ekspor panel Kartu
// Transaksi lama). Mengekspor PERSIS pesanan yang sedang tampil — termasuk
// saringan pencarian — lewat penyimpanan kecil yang diisi PemesananList
// (daftar dimuat di balik Suspense, terpisah dari bilah atas tempat tombol
// ini berada).
import { useEffect, useSyncExternalStore } from "react";
import { ExportXlsxButton } from "@/components/dashboard/export-xlsx-button";
import { TAHAP, tahapPesanan } from "@/components/dashboard/pemesanan-papan";
import type { XlsxColumn } from "@/lib/export-xlsx";
import type { SalesOrderListRow } from "@/lib/queries/pemesanan";

let barisTerkini: SalesOrderListRow[] = [];
const pendengar = new Set<() => void>();
const KOSONG: SalesOrderListRow[] = [];

function langganan(cb: () => void) {
  pendengar.add(cb);
  return () => pendengar.delete(cb);
}

// Dipanggil PemesananList setiap baris yang tampil berubah.
export function useTerbitkanBarisPemesanan(rows: SalesOrderListRow[]) {
  useEffect(() => {
    barisTerkini = rows;
    pendengar.forEach((cb) => cb());
  }, [rows]);
}

const KOLOM: XlsxColumn[] = [
  { header: "No SO", key: "so", type: "text", width: 22 },
  { header: "Tanggal", key: "tanggal", type: "text", width: 12 },
  { header: "Mitra", key: "mitra", width: 26 },
  { header: "Wilayah", key: "wilayah", width: 14 },
  { header: "Qty 10KG", key: "qty10", type: "number", width: 10 },
  { header: "Qty 5KG", key: "qty5", type: "number", width: 9 },
  { header: "Nominal", key: "nominal", type: "number", numFmt: "#,##0", width: 13 },
  { header: "Tahap", key: "tahap", width: 16 },
  { header: "No DO", key: "do", type: "text", width: 22 },
  { header: "No SI", key: "si", type: "text", width: 22 },
  { header: "Status SI", key: "statusSi", width: 12 },
  { header: "No SR", key: "sr", type: "text", width: 22 },
  { header: "Qty Retur", key: "retur", type: "number", width: 10 },
  { header: "Armada · Driver", key: "armada", width: 22 },
];

const tanggal = (v: string | Date) => new Date(v).toISOString().slice(0, 10);

export function EksporPemesanan() {
  const rows = useSyncExternalStore(
    langganan,
    () => barisTerkini,
    () => KOSONG
  );
  return (
    <ExportXlsxButton
      filename={`pemesanan_${new Date().toISOString().slice(0, 10)}`}
      sheetName="Pemesanan"
      columns={KOLOM}
      rows={rows.map((r) => ({
        so: r.VoucherNo,
        tanggal: tanggal(r.TransDate),
        mitra: r.CustomerName,
        wilayah: r.Wilayah,
        qty10: r.Qty10KG,
        qty5: r.Qty5KG,
        nominal: r.Amount,
        tahap: TAHAP.find((t) => t.key === tahapPesanan(r))?.label ?? "",
        do: r.DoVoucherNo ?? "",
        si: r.SiVoucherNo ?? "",
        statusSi: r.SiLunas == null ? "" : r.SiLunas ? "Lunas" : "Belum lunas",
        sr: r.SrVoucherNo ?? "",
        retur: r.ReturQty,
        armada: [r.ArmadaName ?? r.DoVehicleNo, r.DriverName ?? r.DoSalesmanName].filter(Boolean).join(" · "),
      }))}
    />
  );
}
