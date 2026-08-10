// Estimated on-site delivery duration per stop, based on kantong qty.
// Piecewise-linear interpolation between known reference points, then a
// flat 1-menit/kantong slope beyond 40 (5 menit per 5-kantong block).
// Rounded to 1 decimal to avoid binary-float artifacts from the /5 steps
// (unlike the old /2 steps, 1/5 has no exact binary representation).
export function estimateDeliveryMinutes(qtyKantong: number): number {
  const q = qtyKantong;
  let result: number;
  if (q <= 0) result = 0;
  else if (q <= 5) result = q / 5;
  else if (q <= 10) result = 1 + (2 * (q - 5)) / 5;
  else if (q <= 15) result = 3 + (2 * (q - 10)) / 5;
  else if (q <= 20) result = 5 + (2 * (q - 15)) / 5;
  else if (q <= 25) result = 7 + (3 * (q - 20)) / 5;
  else if (q <= 30) result = 10 + (3 * (q - 25)) / 5;
  else if (q <= 35) result = 13 + (3 * (q - 30)) / 5;
  else if (q <= 40) result = 16 + (4 * (q - 35)) / 5;
  else result = q - 20;
  return Math.round(result * 10) / 10;
}

// Fixed time per stop for the driver to fill delivery-confirmation data in
// driver-app (proof photos, confirm-received/retur) — happens on-site,
// after bongkar, before the truck can move to the next stop. Kept as its
// own constant (not folded into estimateDeliveryMinutes) so the two
// components can still be shown separately and tuned independently.
export const CONFIRMATION_MINUTES_PER_STOP = 3;
