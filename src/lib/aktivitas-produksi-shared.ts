// Pure, zero-dependency functions a "use client" component can import as
// VALUES safely — split out of aktivitas-produksi.ts (which imports
// @/lib/db, i.e. mssql/pg) for the same reason
// src/lib/stok-bahan-baku-shared.ts was split out of
// src/lib/queries/stok-bahan-baku.ts in Tahap 1: a client component
// value-importing anything from a @/lib/db-importing module fails to
// bundle (Turbopack tries to pull mssql/pg's Node-only deps into the
// browser). See that file's own comment for the fuller precedent.
export function hitungTotalDenda(pecahKemasanQty: number, esJatuhQty: number): number {
  return pecahKemasanQty * 1000 + esJatuhQty * 3000;
}

export function hitungKontribusiPerOrang(totalKantongEkivalen: number, jumlahHadir: number): number | null {
  return jumlahHadir > 0 ? totalKantongEkivalen / jumlahHadir : null;
}
