// Format angka & ukuran Builder Denah (format Indonesia: koma desimal, titik ribuan).
// MURNI — tanpa React, diuji oleh src/lib/__tests__/produksi-denah-builder.test.ts.

const FORMAT_METER = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FORMAT_CM = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const FORMAT_ANGKA = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

/** Tanda minus tipografis; nol hasil pembulatan tidak diberi tanda. */
function bertanda(n: number, fmt: Intl.NumberFormat, desimal: number): string {
  const k = 10 ** desimal;
  const bulat = Math.round(Math.abs(n) * k) / k;
  return (n < 0 && bulat > 0 ? "−" : "") + fmt.format(bulat);
}

/** 12.5 → "12,50 m". */
export function formatMeter(m: number): string {
  return `${bertanda(m, FORMAT_METER, 2)} m`;
}

/** Meter → sentimeter, maks. 1 desimal: 0.885 → "88,5 cm". */
export function formatCm(m: number): string {
  return `${bertanda(m * 100, FORMAT_CM, 1)} cm`;
}

/** Angka biasa maks. 2 desimal (tanpa satuan): 1234.5 → "1.234,5". */
export function formatAngka(n: number): string {
  return bertanda(n, FORMAT_ANGKA, 2);
}

const LANGKAH_SKALA = [1, 2, 5, 10, 20, 50] as const;
/** Panjang maksimum skala batang di layar (piksel). */
export const SKALA_BATANG_MAKS_PX = 120;

/**
 * Panjang skala batang (meter): angka terbesar dari {1,2,5,10,20,50} yang
 * panjangnya di layar ≤ 120 px. Minimal 1 m.
 */
export function panjangSkalaBatang(pxPerMeter: number): number {
  let hasil: number = LANGKAH_SKALA[0];
  for (const m of LANGKAH_SKALA) if (m * pxPerMeter <= SKALA_BATANG_MAKS_PX) hasil = m;
  return hasil;
}

/**
 * Hasil alat Ukur: jarak (meter) dan sudut (derajat, 0–<360) berlawanan
 * jarum jam dari arah kanan kanvas (sumbu y kanvas mengarah ke bawah).
 */
export function ukurGaris(a: { x: number; y: number }, b: { x: number; y: number }): { jarak: number; sudut: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const jarak = Math.hypot(dx, dy);
  if (jarak === 0) return { jarak: 0, sudut: 0 };
  const sudut = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return { jarak, sudut: sudut < 0 ? sudut + 360 : sudut === 0 ? 0 : sudut };
}

const FORMAT_SUDUT = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

/** "12,35 m · 53,1°" — label alat Ukur. */
export function formatUkur(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const { jarak, sudut } = ukurGaris(a, b);
  const s = Math.round(sudut * 10) / 10;
  return `${formatMeter(jarak)} · ${FORMAT_SUDUT.format(s >= 360 ? 0 : s)}°`;
}
