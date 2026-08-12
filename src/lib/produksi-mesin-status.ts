// Client-safe StatusMesin constant, split out of
// src/lib/queries/produksi-mesin.ts so "use client" components (e.g.
// PanelMesin, TambahProduksiDialog) don't pull in that module's `@/lib/db`
// import (mssql + its Node-only deps like dgram) into the client bundle.
// Mirrors the same split already used for produksi-shift.ts.
export type StatusMesin = "AKTIF" | "MAINTENANCE" | "RUSAK";

export const STATUS_MESIN_LABEL: Record<StatusMesin, string> = {
  AKTIF: "Aktif",
  MAINTENANCE: "Maintenance",
  RUSAK: "Rusak",
};
