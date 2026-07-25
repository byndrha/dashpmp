import ExcelJS from "exceljs";

export interface XlsxColumn {
  header: string;
  key: string;
  width?: number;
  // "text" avoids Excel's auto-number/date coercion on things like voucher
  // numbers or phone-shaped strings; "number" gets right-aligned + thousand
  // separators via a format string, not just a raw numFmt guess.
  type?: "text" | "number";
  numFmt?: string;
}

// Shared by every "Export .xlsx" button in the dashboard — takes whatever
// rows a panel already has in memory (already filtered/sorted client-side,
// so the export matches exactly what's on screen) and triggers a browser
// download. No server round-trip: the data is already here.
export async function exportRowsToXlsx({
  filename,
  sheetName,
  columns,
  rows,
}: {
  filename: string;
  sheetName: string;
  columns: XlsxColumn[];
  rows: Record<string, unknown>[];
}): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Dashboard PMP Group";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName.slice(0, 31)); // Excel sheet-name limit
  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? Math.max(c.header.length + 2, 10),
    style: c.type === "number" ? { numFmt: c.numFmt ?? "#,##0.##" } : undefined,
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  });

  for (const row of rows) sheet.addRow(row);

  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
