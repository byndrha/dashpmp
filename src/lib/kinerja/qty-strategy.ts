// src/lib/kinerja/qty-strategy.ts
//
// Confirmed business definitions (2026-09-16):
// - "non_average" (NOO row): the raw total Kantong Es Terjual from NOO
//   mitra that month — no transformation.
// - "average" (Existing row): the raw total Kantong Es Terjual from
//   Existing mitra that month, divided by the number of calendar days in
//   that month — a daily average, NOT a per-mitra average. This exists as
//   a strategy layer (rather than being inlined at the call site) so a
//   future jabatan/aspek with a different averaging rule doesn't need to
//   touch this file's "non_average" behavior.
export type QtyStrategyKey = "non_average" | "average";

export function applyQtyStrategy(rawQty: number, strategy: QtyStrategyKey, daysInMonth: number): number {
  if (strategy === "average") return rawQty / daysInMonth;
  return rawQty;
}
