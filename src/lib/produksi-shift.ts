// Client-safe Shift constant, split out of
// src/lib/queries/produksi-warehouse.ts so "use client" components (e.g.
// ProduksiBaruForm) don't pull in that module's `@/lib/db` import (mssql +
// its Node-only deps like dgram) into the client bundle. Mirrors the same
// split already used for vehicle-check-types.ts vs vehicle-check.ts.
export const SHIFT_LABEL: Record<1 | 2 | 3, string> = {
  1: "Shift 1 (07:00)",
  2: "Shift 2 (15:00)",
  3: "Shift 3 (23:00)",
};
