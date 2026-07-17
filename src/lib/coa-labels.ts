import type { COAKategori } from "@/lib/queries/keuangan-detail";

// Kept separate from keuangan-detail.ts (which pulls in the mssql-based
// query functions) so client components can import this label map without
// bundling the DB driver into client JS.
export const COA_KATEGORI_LABEL: Record<COAKategori, string> = {
  Pendapatan: "Pendapatan",
  HPP: "HPP",
  BiayaTetap: "Biaya Tetap",
  BebanOperasional: "Beban Operasional",
  PenghasilanLainnya: "Penghasilan Lainnya",
  Adjustment: "Adjustment",
};
