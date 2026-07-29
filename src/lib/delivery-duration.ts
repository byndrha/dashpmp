// Estimated on-site delivery duration per stop, based on kantong qty.
// Three tiers, each block-based (rounded up to the next 5 kantong):
//   qty <= 5            -> 5 menit flat
//   5 < qty <= 40        -> 5 + 2.5 menit per 5-kantong block beyond the first
//                           (10 kantong = 7.5 menit, 15 kantong = 10 menit)
//   qty > 40             -> 22.5 menit (the value at exactly 40 kantong) plus
//                           10 menit per 5-kantong block beyond 40
export function estimateDeliveryMinutes(qtyKantong: number): number {
  if (qtyKantong <= 0) return 0;
  if (qtyKantong <= 5) return 5;
  if (qtyKantong <= 40) return 5 + 2.5 * Math.ceil((qtyKantong - 5) / 5);
  return 22.5 + 10 * Math.ceil((qtyKantong - 40) / 5);
}
