// src/lib/kinerja/qty-strategy.ts
//
// "QTY Average" / "QTY non Average" formulas have not been finalized by
// the business yet (per the spec's "Asumsi Belum Terverifikasi"). This
// module exists so that whichever formula is decided later can be dropped
// in here WITHOUT changing the table structure or any query above it.
export type QtyStrategyKey = "non_average" | "average";

// Tahap 1: passthrough for both strategies — raw quantity, unmodified.
export function applyQtyStrategy(rawQty: number, _strategy: QtyStrategyKey): number {
  return rawQty;
}
