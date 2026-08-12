import type { TahapPembekuan } from "@/lib/queries/produksi-bak-pmpersada";

export const TAHAP_LABEL: Record<TahapPembekuan, string> = {
  BARU: "Isi Air (0%)",
  MULAI: "Mulai Beku",
  KRISTAL: "Kristalisasi",
  SIAP: "Siap Panen",
  JADI: "Matang (100%)",
  BABONAN: "Babonan",
  MAINTENANCE: "Maintenance",
};

// Kelas warna badge per tahap — dipetakan manual (bukan dari draf HTML
// mentah) supaya konsisten dengan token warna Tailwind/shadcn yang sudah
// dipakai di seluruh codebase ini (bg-*/text-*/border-* semantic tokens,
// bukan warna hex custom seperti draf).
export const TAHAP_BADGE_CLASS: Record<TahapPembekuan, string> = {
  BARU: "bg-destructive/15 text-destructive border-destructive/30",
  MULAI: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  KRISTAL: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30",
  SIAP: "bg-cyan-500/15 text-cyan-600 border-cyan-500/30",
  JADI: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  BABONAN: "bg-purple-500/15 text-purple-600 border-purple-500/30",
  MAINTENANCE: "bg-muted text-muted-foreground border-border",
};

export function formatUsia(usiaJam: number): string {
  const h = Math.floor(usiaJam);
  const m = Math.round((usiaJam - h) * 60);
  return `${h} Jam ${m} Mnt`;
}
