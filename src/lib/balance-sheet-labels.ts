import type { BalanceSheetKategori } from "@/lib/queries/balance-sheet";

// Kept separate from balance-sheet.ts (which pulls in the mssql-based query
// function) so client components can import this label map without
// bundling the DB driver into client JS — same reasoning as coa-labels.ts.
export const BALANCE_SHEET_KATEGORI_LABEL: Record<BalanceSheetKategori, string> = {
  AsetLancar: "Aset Lancar",
  AsetTetap: "Aset Tetap",
  Liabilitas: "Liabilitas",
  Ekuitas: "Ekuitas",
};
