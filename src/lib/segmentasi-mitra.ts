// src/lib/segmentasi-mitra.ts
// Client-safe home for the Segmentasi type/options. Kept out of
// mitra-es-balok.ts (which imports `sql` from "@/lib/db" and drags
// mssql/tedious into any Client Component that imports a runtime value
// from it) so form/list/detail components can import this without
// bundling server-only DB code.

export type Segmentasi = "agen" | "manufaktur" | "pesisir";

export const SEGMENTASI_OPTIONS: { value: Segmentasi; label: string }[] = [
  { value: "agen", label: "Agen" },
  { value: "manufaktur", label: "Manufaktur" },
  { value: "pesisir", label: "Pesisir (Nelayan)" },
];
