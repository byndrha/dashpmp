"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportRowsToXlsx, type XlsxColumn } from "@/lib/export-xlsx";

// `rows` = data yang sudah ada di klien. `ambilRows` = data diambil saat
// tombol diklik (mis. lewat server action) — untuk ekspor yang datanya
// terlalu berat untuk dimuat setiap halaman dibuka.
export function ExportXlsxButton({
  filename,
  sheetName,
  columns,
  rows,
  ambilRows,
  label = "Export .xlsx",
  disabled,
}: {
  filename: string;
  sheetName: string;
  columns: XlsxColumn[];
  rows?: Record<string, unknown>[];
  ambilRows?: () => Promise<Record<string, unknown>[]>;
  label?: string;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);

  async function handleExport() {
    setPending(true);
    try {
      const data = ambilRows ? await ambilRows() : (rows ?? []);
      if (data.length === 0) {
        toast.info("Tidak ada data untuk diekspor.");
        return;
      }
      await exportRowsToXlsx({ filename, sheetName, columns, rows: data });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat file .xlsx.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || pending || (!ambilRows && (rows?.length ?? 0) === 0)}
      onClick={handleExport}
    >
      <FileSpreadsheet className="size-3.5" />
      {pending ? "Membuat..." : label}
    </Button>
  );
}
