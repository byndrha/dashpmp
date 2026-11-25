import { createLucideIcon } from "lucide-react";

// Penunjuk arah mata angin bergaya kompas: bingkai bulat + jarum (bentuk
// navigation-2 lucide, diperkecil agar muat di dalam bingkai). Jarum
// menunjuk ke ATAS (utara); pemanggil memutar seluruh ikon sesuai arah —
// bingkainya simetris, jadi hanya jarum yang tampak berputar.
export const Kompas = createLucideIcon("kompas", [
  ["circle", { cx: "12", cy: "12", r: "10", key: "bingkai" }],
  ["polygon", { points: "12 5.5 16 16.5 12 14 8 16.5", key: "jarum" }],
]);
