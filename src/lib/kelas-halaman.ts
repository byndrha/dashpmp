// Modul biasa (bukan "use client") supaya bisa dibaca layout server.
// Kelas untuk <main data-slot="halaman"> di tiap layout: beri ruang di kiri
// judul pertama halaman (<h1> terlihat, atau elemen data-awal-halaman) untuk
// TombolHalaman; halaman tanpa keduanya diberi ruang di atas. Di HP,
// dashboard ber-lonceng (data-bel) butuh ruang untuk dua tombol. Elemen
// bertanda data-tanpa-ruang (mis. peta Mitra) justru berada DI BELAKANG
// tombol — tanpa ruang apa pun, tombol diletakkan di dalam pojoknya.
export const KELAS_HALAMAN =
  "relative [--ruang-tombol:2.75rem] max-md:data-bel:[--ruang-tombol:5.25rem] [&_[data-awal-halaman]]:pl-(--ruang-tombol) [&:not(:has([data-awal-halaman]))_h1:not(.sr-only)]:pl-(--ruang-tombol) [&:not(:has([data-awal-halaman],[data-tanpa-ruang],h1:not(.sr-only)))]:pt-14";
