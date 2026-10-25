// Peta pintasan keyboard Builder Denah — satu sumber untuk penanganan tombol
// dan lembar contekan ("?"). Murni (tanpa React).

import type { TipeElemen } from "@/lib/produksi-denah";

export type Alat = "pilih" | "geser" | TipeElemen;

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
  m: "mesin",
  d: "derek",
  w: "dinding",
  p: "pintu",
  a: "area",
  t: "label",
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

export function cocokkanPintasan(ev: EventTombol): AksiPintasan | null {
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
  const langkah = ev.shiftKey ? 5 : 1;
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
      ["M", "Mesin"],
      ["D", "Derek (tarik garis A→B)"],
      ["W", "Dinding (tarik garis)"],
      ["P", "Pintu"],
      ["A", "Area"],
      ["T", "Label"],
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
      ["← ↑ → ↓", "Geser 1 grid (Shift = 5)"],
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
