import { createLucideIcon, type IconNode } from "lucide-react";

// Ikon "tangan menyerahkan barang" (es diserahkan ke mitra). Lucide tidak
// punya ikon tangan + barang: hand-coins/hand-helping = tangan memberi tapi
// isinya koin/kosong, hand-platter = nampan saji, package-open = bongkar
// muatan (bukan penyerahan). Jadi digabung: tangan dari hand-coins (lucide
// 1.24, ISC) diperkecil 80% ke pojok kiri bawah + barang di atas telapak +
// panah keluar ke kanan (tanpa panah, tangan menengadah terbaca "menerima").

// Tangan hand-coins, diskalakan 0,8 berporos di (2,22) — kiri bawah tetap;
// non-scaling-stroke supaya garisnya tetap setebal garis barang & panah.
const SKALA_TANGAN = "matrix(0.8 0 0 0.8 0.4 4.4)";
const TANGAN: IconNode = [
  ["path", { d: "M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17", transform: SKALA_TANGAN, vectorEffect: "non-scaling-stroke", key: "tangan-atas" }],
  [
    "path",
    {
      d: "m7 21 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9",
      transform: SKALA_TANGAN,
      vectorEffect: "non-scaling-stroke",
      key: "tangan-bawah",
    },
  ],
  ["path", { d: "m2 16 6 6", transform: SKALA_TANGAN, vectorEffect: "non-scaling-stroke", key: "lengan" }],
];
const PANAH: IconNode = [
  ["path", { d: "M16 6.5h6", key: "panah-batang" }],
  ["path", { d: "m19 3.5 3 3-3 3", key: "panah-kepala" }],
];

// Es Kristal: kemasan bulat tabung.
export const SerahEsKristal = createLucideIcon("serah-es-kristal", [
  ...TANGAN,
  ["ellipse", { cx: "10", cy: "3.5", rx: "4", ry: "1.5", key: "tabung-atas" }],
  ["path", { d: "M6 3.5v6a4 1.5 0 0 0 8 0v-6", key: "tabung-badan" }],
  ...PANAH,
]);

// Es Balok: balok/kotak — disiapkan untuk modul Es Balok.
export const SerahEsBalok = createLucideIcon("serah-es-balok", [
  ...TANGAN,
  ["path", { d: "M6 4.5 10 3l4 1.5v4.5l-4 1.5-4-1.5z", key: "balok" }],
  ["path", { d: "m6 4.5 4 1.5 4-1.5", key: "balok-tutup" }],
  ["path", { d: "M10 6v4.5", key: "balok-rusuk" }],
  ...PANAH,
]);
