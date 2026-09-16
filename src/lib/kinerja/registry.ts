// src/lib/kinerja/registry.ts
//
// Jabatan/aspek other than Marketing and Collection / Penjualan register
// their own calculator here later — this file is the ONLY place a new
// jabatan's business rule needs to be wired in, nothing else in this
// plan's Task 5 page needs to change.
import { getHistoriPenjualanSemuaKaryawan, type HistoriPenjualanKaryawan } from "@/lib/kinerja/marketing-collection-penjualan";

export interface AspekKinerjaCalculator {
  hitungHistoriSemuaKaryawan(): Promise<Map<string, HistoriPenjualanKaryawan>>;
}

const registry = new Map<string, AspekKinerjaCalculator>();
registry.set("marketing_collection:penjualan", {
  hitungHistoriSemuaKaryawan: getHistoriPenjualanSemuaKaryawan,
});

export function getCalculator(jabatanKode: string, aspekKode: string): AspekKinerjaCalculator | null {
  return registry.get(`${jabatanKode}:${aspekKode}`) ?? null;
}
