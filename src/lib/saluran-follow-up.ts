// Saluran follow-up penawaran ke mitra ("melalui apa"). Dipakai server
// (validasi) dan client (dropdown) — sengaja terpisah dari modul query agar
// client tidak ikut mengimpor koneksi DB.
export const SALURAN_FOLLOW_UP = ["Chat", "Telepon", "Kunjungan"] as const;
export type ContactType = (typeof SALURAN_FOLLOW_UP)[number];
