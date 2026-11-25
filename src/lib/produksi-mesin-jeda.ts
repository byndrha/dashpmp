// Modul biasa (dipakai server & client): daftar penyebab Catatan Jeda Mesin.
export const PENYEBAB_JEDA = ["SENGAJA_MATI", "PERBAIKAN", "KENDALA", "PERAWATAN", "LAINNYA"] as const;
export type PenyebabJeda = (typeof PENYEBAB_JEDA)[number];

export const PENYEBAB_JEDA_LABEL: Record<PenyebabJeda, string> = {
  SENGAJA_MATI: "Mesin sengaja dimatikan",
  PERBAIKAN: "Perbaikan mesin",
  KENDALA: "Kendala mesin",
  PERAWATAN: "Pembersihan / perawatan",
  LAINNYA: "Aktivitas lain",
};

// Label pendek untuk pil di linimasa.
export const PENYEBAB_JEDA_SINGKAT: Record<PenyebabJeda, string> = {
  SENGAJA_MATI: "Dimatikan",
  PERBAIKAN: "Perbaikan",
  KENDALA: "Kendala",
  PERAWATAN: "Perawatan",
  LAINNYA: "Lainnya",
};

export function isPenyebabJeda(v: string): v is PenyebabJeda {
  return (PENYEBAB_JEDA as readonly string[]).includes(v);
}

// Catatan jeda untuk tampilan. Waktu = "YYYY-MM-DDTHH:mm" naive-WIB (nilai
// jam dinding WIB apa adanya, tanpa zona) — sama dengan basis menit
// linimasa (menitAbsolut) dan langsung cocok untuk <input type="datetime-local">.
export interface JedaMesinRow {
  jedaId: number;
  mesinId: number;
  waktuMulai: string;
  waktuSelesai: string;
  penyebab: PenyebabJeda;
  keterangan: string | null;
  dicatatOlehAkunId: number;
}
