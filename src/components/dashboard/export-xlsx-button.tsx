"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportRowsToXlsx, type XlsxColumn } from "@/lib/export-xlsx";

export function ExportXlsxButton({
  filename,
  sheetName,
  columns,
  rows,
  disabled,
}: {
  filename: string;
  sheetName: string;
  columns: XlsxColumn[];
  rows: Record<string, unknown>[];
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);

  async function handleExport() {
    setPending(true);
    try {
      await exportRowsToXlsx({ filename, sheetName, columns, rows });
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
      disabled={disabled || pending || rows.length === 0}
      onClick={handleExport}
    >
      <FileSpreadsheet className="size-3.5" />
      {pending ? "Membuat..." : "Export .xlsx"}
    </Button>
  );
}
