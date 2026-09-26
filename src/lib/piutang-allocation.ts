// src/lib/piutang-allocation.ts
// Client-safe (no `sql`/db imports) so both the payment dialog (client) and
// the server-side write path can share the exact same allocation math --
// the dialog's live preview must never drift from what actually gets
// inserted.
import type { SumberAgen } from "@/lib/queries/mitra-es-balok";

export interface AllocationItem {
  sumber: SumberAgen;
  jumlah: number;
}

// Splits a payment across "utama"/"logistik" proportionally to each
// source's own outstanding Hutang (never using one source's Tabungan
// surplus to offset the other's Hutang -- different PT, different COA,
// different rekening, per user decision 2026-09-26). Overpayment beyond
// the combined Hutang is routed entirely to "logistik" (the last source),
// also per that same decision.
export function computeProportionalAllocation(hutangUtama: number, hutangLogistik: number, jumlah: number): AllocationItem[] {
  const total = hutangUtama + hutangLogistik;

  if (total <= 0) {
    return [{ sumber: "logistik", jumlah }];
  }

  if (jumlah <= total) {
    const allocUtama = Math.round(jumlah * (hutangUtama / total));
    const allocLogistik = jumlah - allocUtama; // avoids rounding drift vs a second independent round()
    const plan: AllocationItem[] = [];
    if (allocUtama > 0) plan.push({ sumber: "utama", jumlah: allocUtama });
    if (allocLogistik > 0) plan.push({ sumber: "logistik", jumlah: allocLogistik });
    return plan;
  }

  const excess = jumlah - total;
  const plan: AllocationItem[] = [];
  if (hutangUtama > 0) plan.push({ sumber: "utama", jumlah: hutangUtama });
  plan.push({ sumber: "logistik", jumlah: hutangLogistik + excess });
  return plan;
}
