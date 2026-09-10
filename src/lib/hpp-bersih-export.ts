import ExcelJS from "exceljs";
import { triggerXlsxDownload } from "@/lib/export-xlsx";
import type { HPPBersihData } from "@/lib/queries/hpp-bersih";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// 1-indexed column number -> Excel letter (only ever called with 1-14 here,
// but written generically rather than hardcoding a 14-entry lookup table).
function colLetter(n: number): string {
  let s = "";
  let num = n;
  while (num > 0) {
    const rem = (num - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}

const RUPIAH_FMT = '"Rp" #,##0';
const QTY_FMT = "#,##0";
const MONTH_START_COL = 3; // column C — A/B hold Kode Akun / Nama Akun

function writeAccountHeaderRow(sheet: ExcelJS.Worksheet, row: number): void {
  sheet.getCell(row, 1).value = "Kode Akun";
  sheet.getCell(row, 2).value = "Nama Akun";
  MONTH_LABELS.forEach((label, i) => {
    sheet.getCell(row, MONTH_START_COL + i).value = label;
  });
  const headerRow = sheet.getRow(row);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  });
}

// Builds the HPP Bersih workbook with LIVE Excel formulas (not pre-computed
// values) so the ratio and HPP Bersih cells can be audited/recalculated
// directly in Excel — mirrors the on-screen formula exactly:
// HPP Bersih = SUM(Nominal Akun COA / Total Kantong Penjualan) per bulan.
export async function exportHppBersihToXlsx(data: HPPBersihData, unitLabel: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Dashboard PMP Group";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(`HPP Bersih ${data.year}`.slice(0, 31));
  sheet.getColumn(1).width = 12;
  sheet.getColumn(2).width = 28;
  for (let i = 0; i < 12; i++) sheet.getColumn(MONTH_START_COL + i).width = 13;

  const n = data.accounts.length;

  // --- Block 1: Nominal per Akun COA ---
  const nominalTitleRow = 1;
  sheet.getCell(nominalTitleRow, 1).value = "Nominal per Akun COA (Rp)";
  sheet.getCell(nominalTitleRow, 1).font = { bold: true };

  const nominalHeaderRow = nominalTitleRow + 1;
  writeAccountHeaderRow(sheet, nominalHeaderRow);

  const nominalFirstRow = nominalHeaderRow + 1;
  data.accounts.forEach((acc, r) => {
    const row = nominalFirstRow + r;
    sheet.getCell(row, 1).value = acc.AccountNo;
    sheet.getCell(row, 2).value = acc.AccountName;
    acc.MonthlyNominal.forEach((nominal, i) => {
      const cell = sheet.getCell(row, MONTH_START_COL + i);
      cell.value = nominal;
      cell.numFmt = RUPIAH_FMT;
    });
  });
  const nominalLastRow = nominalFirstRow + n - 1;

  // --- Block 2: Total Kantong Penjualan (the shared divisor) ---
  const totalKantongRow = nominalLastRow + 2;
  sheet.getCell(totalKantongRow, 1).value = `Total ${unitLabel} Penjualan`;
  sheet.getCell(totalKantongRow, 1).font = { bold: true };
  sheet.mergeCells(totalKantongRow, 1, totalKantongRow, 2);
  data.totalKantongPenjualan.forEach((qty, i) => {
    const cell = sheet.getCell(totalKantongRow, MONTH_START_COL + i);
    cell.value = qty;
    cell.numFmt = QTY_FMT;
    cell.font = { bold: true };
  });

  // --- Block 3: Rasio HPP per Kantong — live formula = Nominal / Total Kantong ---
  const ratioTitleRow = totalKantongRow + 2;
  sheet.getCell(ratioTitleRow, 1).value = `Rasio HPP per ${unitLabel} (Nominal ÷ Total ${unitLabel} Penjualan)`;
  sheet.getCell(ratioTitleRow, 1).font = { bold: true };

  const ratioHeaderRow = ratioTitleRow + 1;
  writeAccountHeaderRow(sheet, ratioHeaderRow);

  const ratioFirstRow = ratioHeaderRow + 1;
  data.accounts.forEach((acc, r) => {
    const nominalRow = nominalFirstRow + r;
    const row = ratioFirstRow + r;
    sheet.getCell(row, 1).value = acc.AccountNo;
    sheet.getCell(row, 2).value = acc.AccountName;
    for (let i = 0; i < 12; i++) {
      const col = MONTH_START_COL + i;
      const letter = colLetter(col);
      const cell = sheet.getCell(row, col);
      // Mirrors getHPPBersih()'s own `totalKantongPenjualan[i] ? nominal / total : 0` guard.
      // `result` is supplied too so the value shows correctly even in viewers
      // that don't recalculate formulas on open — Excel itself recomputes anyway.
      cell.value = {
        formula: `IF(${letter}${totalKantongRow}=0,0,${letter}${nominalRow}/${letter}${totalKantongRow})`,
        result: acc.MonthlyRatio[i],
      };
      cell.numFmt = RUPIAH_FMT;
    }
  });
  const ratioLastRow = ratioFirstRow + n - 1;

  // --- Block 4: HPP Bersih = SUM of the ratio rows for that month ---
  const hppRow = ratioLastRow + 2;
  sheet.getCell(hppRow, 1).value = "HPP Bersih";
  sheet.getCell(hppRow, 1).font = { bold: true };
  sheet.mergeCells(hppRow, 1, hppRow, 2);
  for (let i = 0; i < 12; i++) {
    const col = MONTH_START_COL + i;
    const letter = colLetter(col);
    const cell = sheet.getCell(hppRow, col);
    cell.value = { formula: `SUM(${letter}${ratioFirstRow}:${letter}${ratioLastRow})`, result: data.totalHPPBersih[i] };
    cell.numFmt = RUPIAH_FMT;
    cell.font = { bold: true };
    cell.border = { top: { style: "thin" } };
  }

  await triggerXlsxDownload(workbook, `hpp-bersih-${data.year}`);
}
