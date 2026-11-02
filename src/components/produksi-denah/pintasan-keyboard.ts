// Peta pintasan keyboard Builder Denah — satu sumber untuk penanganan tombol
// dan lembar contekan ("?"). Murni (tanpa React).

import type { TipeElemen } from "@/lib/produksi-denah";

/** "ukur" = alat Ukur sementara (tidak mengubah dokumen). */
export type Alat = "pilih" | "geser" | "ukur" | TipeElemen;

export type AksiPintasan =
  | { jenis: "alat"; alat: Alat }
  | { jenis: "undo" }
  | { jenis: "redo" }
  | { jenis: "simpan" }
  | { jenis: "hapus" }
  | { jenis: "duplikat" }
  | { jenis: "salin" }
  | { jenis: "potong" }
  | { jenis: "tempel" }
  | { jenis: "pilihSemua" }
  | { jenis: "putar" }
  | { jenis: "kunci" }
  | { jenis: "depan" }
  | { jenis: "belakang" }
  | { jenis: "geser"; dx: number; dy: number }
  | { jenis: "batal" }
  | { jenis: "pas" }
  | { jenis: "fokusSeleksi" }
  | { jenis: "zoomMasuk" }
  | { jenis: "zoomKeluar" }
  | { jenis: "contekan" };

/** Huruf alat (tanpa modifier). */
export const TOMBOL_ALAT: Record<string, Alat> = {
  v: "pilih",
  h: "geser",
  b: "bak",
  e: "mesin",
  d: "derek",
  w: "dinding",
  p: "pintu",
  a: "area",
  k: "label",
  o: "beton",
  t: "tangki",
  m: "ukur",
  j: "jalur",
};

export const HURUF_ALAT: Record<Alat, string> = Object.fromEntries(
  Object.entries(TOMBOL_ALAT).map(([k, v]) => [v, k.toUpperCase()])
) as Record<Alat, string>;

export interface EventTombol {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * @param langkahM langkah geser tombol panah (meter) — builder mengisi
 *   kanvas.langkahSnapM; Shift = ×10.
 */
export function cocokkanPintasan(ev: EventTombol, langkahM = 1): AksiPintasan | null {
  const mod = ev.ctrlKey || ev.metaKey;
  const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
  if (mod) {
    if (k === "z") return ev.shiftKey ? { jenis: "redo" } : { jenis: "undo" };
    if (k === "y") return { jenis: "redo" };
    if (k === "s") return { jenis: "simpan" };
    if (k === "d") return { jenis: "duplikat" };
    if (k === "c") return { jenis: "salin" };
    if (k === "x") return { jenis: "potong" };
    if (k === "v") return { jenis: "tempel" };
    if (k === "a") return { jenis: "pilihSemua" };
    if (k === "=" || k === "+") return { jenis: "zoomMasuk" };
    if (k === "-") return { jenis: "zoomKeluar" };
    if (k === "0") return { jenis: "pas" };
    return null;
  }
  if (ev.altKey) return null;
  // Dibulatkan ke 1 mm agar 0,1 × 10 tidak menjadi 1,0000000000000002.
  const langkah = Math.round(langkahM * (ev.shiftKey ? 10 : 1) * 1000) / 1000;
  switch (k) {
    case "ArrowLeft":
      return { jenis: "geser", dx: -langkah, dy: 0 };
    case "ArrowRight":
      return { jenis: "geser", dx: langkah, dy: 0 };
    case "ArrowUp":
      return { jenis: "geser", dx: 0, dy: -langkah };
    case "ArrowDown":
      return { jenis: "geser", dx: 0, dy: langkah };
    case "Delete":
    case "Backspace":
      return { jenis: "hapus" };
    case "Escape":
      return { jenis: "batal" };
    case "?":
      return { jenis: "contekan" };
    case "/":
      return ev.shiftKey ? { jenis: "contekan" } : null;
    case "r":
      return { jenis: "putar" };
    case "l":
      return { jenis: "kunci" };
    case "]":
      return { jenis: "depan" };
    case "[":
      return { jenis: "belakang" };
    case "0":
      return { jenis: "pas" };
    case "f":
      return { jenis: "fokusSeleksi" };
    case "=":
    case "+":
      return { jenis: "zoomMasuk" };
    case "-":
      return { jenis: "zoomKeluar" };
  }
  if (ev.shiftKey) return null;
  const alat = TOMBOL_ALAT[k];
  return alat ? { jenis: "alat", alat } : null;
}

/** Daftar untuk lembar contekan. */
export const DAFTAR_PINTASAN: { grup: string; isi: [string, string][] }[] = [
  {
    grup: "Alat",
    isi: [
      ["V", "Pilih"],
      ["H / tahan Spasi", "Geser kanvas"],
      ["B", "Bak"],
      ["E", "Mesin"],
      ["D", "Derek (tarik garis A→B)"],
      ["W", "Dinding (tarik garis)"],
      ["P", "Pintu"],
      ["A", "Area"],
      ["K", "Label"],
      ["O", "Beton (pondasi, plinth, saluran)"],
      ["T", "Tangki"],
      ["M", "Ukur jarak & sudut (sementara)"],
      ["J", "Jalur pipa/kabel (klik titik; dobel klik/Enter selesai, Backspace hapus titik)"],
      ["Shift saat menaruh", "Alat tetap aktif"],
    ],
  },
  {
    grup: "Seleksi & manipulasi",
    isi: [
      ["Klik / Shift+klik", "Pilih / tambah-kurangi seleksi"],
      ["Tarik di ruang kosong", "Kotak seleksi"],
      ["Klik kolom bak terpilih", "Pilih kolom (Shift = rentang, Ctrl = satu-satu)"],
      ["Alt saat menarik", "Tanpa snap grid & garis bantu"],
      ["← ↑ → ↓", "Geser 1 langkah snap (Shift = ×10)"],
      ["R", "Putar 90°"],
      ["Ctrl+D", "Duplikat"],
      ["Ctrl+C / Ctrl+X / Ctrl+V", "Salin / potong / tempel"],
      ["Ctrl+A", "Pilih semua"],
      ["Delete / Backspace", "Hapus"],
      ["L", "Kunci / buka kunci"],
      ["] / [", "Ke depan / ke belakang"],
      ["Esc", "Batalkan alat / kosongkan seleksi"],
    ],
  },
  {
    grup: "Tampilan & berkas",
    isi: [
      ["Scroll / cubit", "Zoom di sekitar kursor"],
      ["+ / −", "Perbesar / perkecil"],
      ["0", "Pas ke layar"],
      ["F", "Fokus ke seleksi"],
      ["Ctrl+Z", "Urungkan"],
      ["Ctrl+Y / Ctrl+Shift+Z", "Ulangi"],
      ["Ctrl+S", "Simpan"],
      ["?", "Lembar pintasan ini"],
    ],
  },
];
