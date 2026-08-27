// Client-safe Stok Bahan Baku constants, split out of
// src/lib/queries/stok-bahan-baku.ts so "use client" components (e.g.
// LaporanStokBahanBaku) don't pull in that module's `@/lib/db` import
// (mssql + its Node-only deps like net/tls/dns/fs/dgram) into the client
// bundle. Mirrors the same split already used for produksi-shift.ts vs
// produksi-warehouse.ts, and vehicle-check-types.ts vs vehicle-check.ts.
export type JenisBarang = "Plastik10KG" | "Plastik5KG" | "IkatKabel";

export const JENIS_BARANG_LIST: JenisBarang[] = ["Plastik10KG", "Plastik5KG", "IkatKabel"];

export const JENIS_BARANG_LABEL: Record<JenisBarang, string> = {
  Plastik10KG: "Kantong Plastik 10 KG",
  Plastik5KG: "Kantong Plastik 5 KG",
  IkatKabel: "Ikat Kabel",
};

// 1 unit = 100 lembar/pcs for every JenisBarang — "Bundle" for plastik,
// "Pack" for ikat kabel (same ceil(qty/100) math either way, see toBundle).
export const JENIS_BARANG_UNIT_BUNDLE: Record<JenisBarang, string> = {
  Plastik10KG: "Bundle",
  Plastik5KG: "Bundle",
  IkatKabel: "Pack",
};

// ceil(lembar/100), display-only — never stored. 0 lembar = 0 bundle, 100
// lembar tepat = 1 bundle, 101 = 2.
export function toBundle(lembar: number): number {
  return lembar <= 0 ? 0 : Math.ceil(lembar / 100);
}
