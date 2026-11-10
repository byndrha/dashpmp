// Warna & label keadaan rek Produksi Es Balok — Operasional. Dipakai aplikasi
// HP operator (/{kode}/produksi-app) dan layar admin (/{kode}/produksi).
// Kelas Tailwind lengkap (bukan dirakit) supaya ikut terpindai; setiap entri
// punya varian terang dan gelap.
//
// Palet tahap (urutan = pil gradasi di LegendaCan): Isian = merah tua,
// Solidifikasi = oranye, Kristalisasi = hijau, Siap = teal, Matang = biru tua,
// Jaga (Babonan) = cokelat keabuan ◆; pecah = oranye muda ✕, rusak = abu ✕,
// kosong = garis putus. Kunci kode tetap air/mulai/kristal/siap/jadi.
import type { JenisCan, KeadaanCan, KeadaanUtama, Tahap } from "@/lib/produksi-operasional";

export interface WarnaKeadaan {
  latar: string;
  teks: string;
  label: string;
}

export const WARNA_TAHAP: Record<Tahap, WarnaKeadaan> = {
  air: {
    latar: "bg-red-100 border-red-400 dark:bg-red-950/70 dark:border-red-700",
    teks: "text-red-900 dark:text-red-100",
    label: "Isian",
  },
  mulai: {
    latar: "bg-orange-200 border-orange-500 dark:bg-orange-900/70 dark:border-orange-600",
    teks: "text-orange-950 dark:text-orange-50",
    label: "Solidifikasi",
  },
  kristal: {
    latar: "bg-green-200 border-green-600 dark:bg-green-900/70 dark:border-green-600",
    teks: "text-green-950 dark:text-green-50",
    label: "Kristalisasi",
  },
  siap: {
    latar: "bg-teal-200 border-teal-500 dark:bg-teal-900/70 dark:border-teal-500",
    teks: "text-teal-950 dark:text-teal-50",
    label: "Siap",
  },
  jadi: {
    latar: "bg-indigo-800 border-indigo-900 dark:bg-indigo-800 dark:border-indigo-600",
    teks: "text-white dark:text-white",
    label: "Matang",
  },
};

export const WARNA_KEADAAN: Record<Exclude<KeadaanUtama, "berisi">, WarnaKeadaan> = {
  babonan: {
    latar: "bg-stone-300 border-stone-500 dark:bg-stone-700/80 dark:border-stone-500",
    teks: "text-stone-900 dark:text-stone-50",
    label: "Babonan",
  },
  maintenance: {
    latar: "bg-slate-100 border-slate-500 border-dashed dark:bg-slate-900 dark:border-slate-500",
    teks: "text-slate-900 dark:text-slate-100",
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

// ── Warna per can (grid & strip can) ───────────────────────────────────────

export interface WarnaCan {
  /** Kelas sel (latar + garis). */
  sel: string;
  /** Kelas warna simbol/teks di dalam sel. */
  teks: string;
  /** Simbol di dalam sel ("" = tanpa simbol). */
  simbol: string;
  label: string;
}

/**
 * Warna sel can. Kunci tahap dipakai untuk can produksi (warna menurut
 * kematangan isiannya); kunci "produksi" hanya cadangan bila tahap tak ada.
 */
export const WARNA_CAN: Record<JenisCan | Tahap, WarnaCan> = {
  air: { sel: "bg-[#9b1c1f] border-[#7d1417] dark:bg-[#b32428] dark:border-[#d4585b]", teks: "text-white", simbol: "", label: "Isian" },
  mulai: { sel: "bg-[#f7941d] border-[#d97a06] dark:bg-[#f7941d] dark:border-[#fbb45a]", teks: "text-orange-950", simbol: "", label: "Solidifikasi" },
  kristal: {
    sel: "bg-[#1b7a3e] border-[#135c2d] dark:bg-[#1f8f48] dark:border-[#4fb877]",
    teks: "text-white",
    simbol: "",
    label: "Kristalisasi",
  },
  siap: { sel: "bg-[#14a89a] border-[#0e8478] dark:bg-[#14a89a] dark:border-[#52cfc3]", teks: "text-white", simbol: "", label: "Siap" },
  jadi: { sel: "bg-[#2a3590] border-[#1d2670] dark:bg-[#3a47b5] dark:border-[#7f8be0]", teks: "text-white", simbol: "", label: "Matang" },
  produksi: { sel: "bg-[#9b1c1f] border-[#7d1417] dark:bg-[#b32428] dark:border-[#d4585b]", teks: "text-white", simbol: "", label: "Produksi" },
  babonan: {
    sel: "bg-[#9c8a7c] border-[#7d6c5f] dark:bg-[#9c8a7c] dark:border-[#c2b3a6]",
    teks: "text-white",
    simbol: "◆",
    label: "Babonan",
  },
  pecah: {
    sel: "bg-orange-200 border-orange-500 dark:bg-orange-950 dark:border-orange-500",
    teks: "text-orange-700 dark:text-orange-300",
    simbol: "✕",
    label: "Pecah",
  },
  rusak: {
    sel: "bg-zinc-400 border-zinc-500 dark:bg-zinc-600 dark:border-zinc-500",
    teks: "text-zinc-800 dark:text-zinc-200",
    simbol: "✕",
    label: "Rusak",
  },
  kosong: {
    sel: "bg-transparent border-dashed border-zinc-400 dark:border-zinc-500",
    teks: "text-muted-foreground",
    simbol: "",
    label: "Kosong",
  },
};

/** Warna satu can: can produksi menurut tahap isiannya, lainnya menurut jenis. */
export function warnaCan(c: Pick<KeadaanCan, "jenis" | "tahap">): WarnaCan {
  if (c.jenis === "produksi") return WARNA_CAN[c.tahap ?? "produksi"];
  return WARNA_CAN[c.jenis];
}

// Warna isi SVG (overlay status di peta denah admin). Kelas bg-* di atas
// tidak berlaku untuk `fill`, jadi peta memakai nilai CSS langsung; dipilih
// nada tengah yang terbaca di tema terang maupun gelap (overlay semi-transparan).
const ISI_TAHAP: Record<Tahap, string> = {
  air: "#b32428", // Isian
  mulai: "#f7941d", // Solidifikasi
  kristal: "#1f8f48", // Kristalisasi
  siap: "#14a89a", // Siap
  jadi: "#3a47b5", // Matang
};
const ISI_KEADAAN: Record<Exclude<KeadaanUtama, "berisi">, string> = {
  babonan: "#9c8a7c", // Jaga (Babonan)
  maintenance: "#64748b", // slate-500
  nonaktif: "var(--muted-foreground)",
  kosong: "var(--muted)",
};

/** Warna isi SVG rek di peta: pasangan warnaRek(). */
export function isiPetaRek(utama: KeadaanUtama, tahap: Tahap | null): string {
  if (utama === "berisi") return ISI_TAHAP[tahap ?? "air"];
  return ISI_KEADAAN[utama];
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

/** Usia ringkas untuk baris rapat: "45m" / "32j" / "3h". */
export function formatUsiaRingkas(menit: number): string {
  if (menit < 60) return `${Math.max(0, menit)}m`;
  const j = Math.floor(menit / 60);
  if (j >= 72) return `${Math.floor(j / 24)}h`;
  return `${j}j`;
}

export function singkatVarian(v: "kecil" | "besar"): string {
  return v === "kecil" ? "BK" : "BB";
}
