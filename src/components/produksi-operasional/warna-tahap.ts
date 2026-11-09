// Warna & label keadaan rek Produksi Es Balok — Operasional. Dipakai aplikasi
// HP operator (/{kode}/produksi-app) dan layar admin (/{kode}/produksi).
// Kelas Tailwind lengkap (bukan dirakit) supaya ikut terpindai; setiap entri
// punya varian terang dan gelap.
import type { KeadaanUtama, Tahap } from "@/lib/produksi-operasional";

export interface WarnaKeadaan {
  latar: string;
  teks: string;
  label: string;
}

export const WARNA_TAHAP: Record<Tahap, WarnaKeadaan> = {
  air: {
    latar: "bg-sky-100 border-sky-300 dark:bg-sky-950/60 dark:border-sky-800",
    teks: "text-sky-900 dark:text-sky-100",
    label: "Air baru",
  },
  mulai: {
    latar: "bg-cyan-200 border-cyan-400 dark:bg-cyan-900/70 dark:border-cyan-700",
    teks: "text-cyan-950 dark:text-cyan-50",
    label: "Mulai",
  },
  kristal: {
    latar: "bg-indigo-200 border-indigo-400 dark:bg-indigo-900/70 dark:border-indigo-700",
    teks: "text-indigo-950 dark:text-indigo-50",
    label: "Kristal",
  },
  siap: {
    latar: "bg-emerald-300 border-emerald-500 dark:bg-emerald-800 dark:border-emerald-600",
    teks: "text-emerald-950 dark:text-emerald-50",
    label: "Siap",
  },
  jadi: {
    latar: "bg-green-600 border-green-700 dark:bg-green-600 dark:border-green-500",
    teks: "text-white dark:text-white",
    label: "Jadi",
  },
};

export const WARNA_KEADAAN: Record<Exclude<KeadaanUtama, "berisi">, WarnaKeadaan> = {
  babonan: {
    latar: "bg-amber-200 border-amber-400 dark:bg-amber-900/70 dark:border-amber-700",
    teks: "text-amber-950 dark:text-amber-50",
    label: "Babonan",
  },
  maintenance: {
    latar: "bg-orange-100 border-orange-400 border-dashed dark:bg-orange-950/60 dark:border-orange-700",
    teks: "text-orange-900 dark:text-orange-100",
    label: "Maintenance",
  },
  nonaktif: {
    latar: "bg-zinc-200 border-zinc-300 dark:bg-zinc-800 dark:border-zinc-700",
    teks: "text-zinc-500 dark:text-zinc-400",
    label: "Nonaktif",
  },
  kosong: {
    latar: "bg-background border-border",
    teks: "text-muted-foreground",
    label: "Kosong",
  },
};

/** Warna kartu rek: tahap isian tertua kalau berisi, selain itu warna keadaan. */
export function warnaRek(utama: KeadaanUtama, tahap: Tahap | null): WarnaKeadaan {
  if (utama === "berisi") return WARNA_TAHAP[tahap ?? "air"];
  return WARNA_KEADAAN[utama];
}

/** Rentang persen per tahap, untuk legenda. */
export const RENTANG_TAHAP: Record<Tahap, string> = {
  air: "0%",
  mulai: "1–49%",
  kristal: "50–74%",
  siap: "75–99%",
  jadi: "100%",
};

// ── Format tampilan (WIB) ──────────────────────────────────────────────────

const FORMAT_JAM = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false });
const FORMAT_TGL_JAM = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "08:10" (WIB). */
export function jamWib(iso: string): string {
  return FORMAT_JAM.format(new Date(iso)).replace(".", ":");
}

/** "9 Nov 08:10" (WIB). */
export function tanggalJamWib(iso: string): string {
  return FORMAT_TGL_JAM.format(new Date(iso)).replace(".", ":");
}

/** "3j 20m" / "45m". */
export function formatUsia(menit: number): string {
  if (menit < 60) return `${Math.max(0, menit)}m`;
  const j = Math.floor(menit / 60);
  if (j >= 48) return `${Math.floor(j / 24)}h ${j % 24}j`;
  return `${j}j ${menit % 60}m`;
}

export function singkatVarian(v: "kecil" | "besar"): string {
  return v === "kecil" ? "BK" : "BB";
}
