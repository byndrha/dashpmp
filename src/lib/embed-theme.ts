import { useSyncExternalStore } from "react";

// Tema halaman iframe ByChat. ByChat mengirim `theme` pada pesan appContext
// (dan mengirim ulang saat pengguna mengganti tema), jadi nilainya disimpan di
// store kecil ini dan dipakai Providers sebagai forcedTheme untuk /embed.
// Sengaja TIDAK lewat setTheme next-themes supaya preferensi tema dashpmp
// pengguna (localStorage) tidak tertimpa.
export type EmbedTema = "dark" | "light";

let tema: EmbedTema | null = null;
const pendengar = new Set<() => void>();

function awal(): EmbedTema {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function setEmbedTema(t: EmbedTema) {
  if (tema === t) return;
  tema = t;
  pendengar.forEach((f) => f());
}

function subscribe(f: () => void) {
  pendengar.add(f);
  return () => pendengar.delete(f);
}

export function useEmbedTema(): EmbedTema {
  return useSyncExternalStore(subscribe, () => tema ?? awal(), () => "dark");
}

// Ambil `theme` dari pesan appContext ByChat (string JSON atau objek). Pesan
// lain, bentuk tak dikenal, atau nilai tema di luar dark/light → null.
export function temaDariPesan(raw: unknown): EmbedTema | null {
  let d: unknown = raw;
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      return null;
    }
  }
  if (!d || typeof d !== "object") return null;
  const m = d as { event?: unknown; data?: unknown };
  if (m.event !== "appContext" || !m.data || typeof m.data !== "object") return null;
  const t = (m.data as { theme?: unknown }).theme;
  return t === "dark" || t === "light" ? t : null;
}
