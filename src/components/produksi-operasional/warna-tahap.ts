// Warna & label keadaan rek Produksi Es Balok — Operasional. Dipakai aplikasi
// HP operator (/{kode}/produksi-app) dan layar admin (/{kode}/produksi).
// Kelas Tailwind lengkap (bukan dirakit) supaya ikut terpindai; setiap entri
// punya varian terang dan gelap.
//
// Palet tegas (spec slot can §4): air = merah, mulai = amber, kristal = ungu,
// siap = biru muda, jadi = hijau, Babonan = oranye ◆, pecah = oranye ✕,
// rusak = abu ✕, kosong = garis putus.
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
    label: "Air baru",
  },
  mulai: {
    latar: "bg-amber-200 border-amber-500 dark:bg-amber-900/70 dark:border-amber-600",
    teks: "text-amber-950 dark:text-amber-50",
    label: "Mulai",
  },
  kristal: {
    latar: "bg-violet-200 border-violet-500 dark:bg-violet-900/70 dark:border-violet-600",
    teks: "text-violet-950 dark:text-violet-50",
    label: "Kristal",
  },
  siap: {
    latar: "bg-sky-200 border-sky-500 dark:bg-sky-900/70 dark:border-sky-500",
    teks: "text-sky-950 dark:text-sky-50",
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
    latar: "bg-orange-200 border-orange-500 dark:bg-orange-900/70 dark:border-orange-600",
    teks: "text-orange-950 dark:text-orange-50",
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
  air: { sel: "bg-red-500 border-red-600 dark:bg-red-500 dark:border-red-400", teks: "text-white", simbol: "", label: "Air" },
  mulai: { sel: "bg-amber-400 border-amber-500 dark:bg-amber-400 dark:border-amber-300", teks: "text-amber-950", simbol: "", label: "Mulai" },
  kristal: {
    sel: "bg-violet-500 border-violet-600 dark:bg-violet-500 dark:border-violet-400",
    teks: "text-white",
    simbol: "",
    label: "Kristal",
  },
  siap: { sel: "bg-sky-400 border-sky-500 dark:bg-sky-400 dark:border-sky-300", teks: "text-sky-950", simbol: "", label: "Siap" },
  jadi: { sel: "bg-green-600 border-green-700 dark:bg-green-500 dark:border-green-400", teks: "text-white", simbol: "", label: "Jadi" },
  produksi: { sel: "bg-red-500 border-red-600 dark:bg-red-500 dark:border-red-400", teks: "text-white", simbol: "", label: "Produksi" },
  babonan: {
    sel: "bg-orange-500 border-orange-600 dark:bg-orange-500 dark:border-orange-400",
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
  air: "#ef4444", // red-500
  mulai: "#f59e0b", // amber-500
  kristal: "#8b5cf6", // violet-500
  siap: "#38bdf8", // sky-400
  jadi: "#16a34a", // green-600
};
const ISI_KEADAAN: Record<Exclude<KeadaanUtama, "berisi">, string> = {
  babonan: "#f97316", // orange-500
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
