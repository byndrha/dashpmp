import { randomInt } from "node:crypto";

// Fungsi murni untuk tautan publik kartu piutang (mudah diuji tanpa DB).

const ALFABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; // tanpa I, O, l agar tak ambigu
export const PANJANG_TOKEN = 10; // 58^10 ~ 4e17 kemungkinan: tak dapat ditebak
export const MASA_BERLAKU_HARI = 30;
// Tautan lama dipakai ulang selama sisa masa berlakunya masih panjang; kalau
// hampir habis dibuatkan yang baru (yang lama tetap sah sampai kedaluwarsa).
export const SISA_MIN_PAKAI_ULANG_HARI = 7;

export function buatToken(): string {
  let t = "";
  for (let i = 0; i < PANJANG_TOKEN; i++) t += ALFABET[randomInt(ALFABET.length)];
  return t;
}

export function formatTokenValid(t: unknown): t is string {
  return typeof t === "string" && /^[0-9A-Za-z]{10}$/.test(t);
}

export function urlTautan(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/kartu/${token}`;
}

export function bolehPakaiUlang(kedaluwarsa: Date, dicabut: boolean, sekarang: Date): boolean {
  if (dicabut) return false;
  const sisaHari = (kedaluwarsa.getTime() - sekarang.getTime()) / 86400000;
  return sisaHari >= SISA_MIN_PAKAI_ULANG_HARI;
}

export function hitungKedaluwarsa(sekarang: Date): Date {
  return new Date(sekarang.getTime() + MASA_BERLAKU_HARI * 86400000);
}
