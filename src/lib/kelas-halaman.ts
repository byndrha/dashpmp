// Modul biasa (bukan "use client") supaya bisa dibaca layout server.
// Kelas untuk <main data-slot="halaman"> di tiap layout: beri ruang di kiri
// judul pertama halaman (<h1> terlihat, atau elemen data-awal-halaman) untuk
// TombolHalaman; halaman tanpa keduanya diberi ruang di atas. Di HP,
// dashboard ber-lonceng (data-bel) butuh ruang untuk dua tombol. Elemen
// bertanda data-tanpa-ruang (mis. peta Mitra) justru berada DI BELAKANG
// tombol — tanpa ruang apa pun, tombol diletakkan di dalam pojoknya.
//
// Baris kepala halaman (judul + filter) MENEMPEL di atas saat halaman
// digulir: TombolHalaman menandai baris itu dengan data-kepala-halaman
// (dicari otomatis dari judul, lihat cariBarisKepala di sidebar-kaki.tsx),
// dan menambah data-menempel selama baris benar-benar tertempel. Latar
// buram dibuat lewat ::before yang melebar ke tepi <main> (-inset-x-4),
// jadi isi halaman yang lewat di bawahnya tertutup. Peta Leaflet diberi
// isolate supaya z-index panel petanya (400+) tidak menembus kepala ini.
// Judul bertanda data-tanpa-menempel tidak punya baris kepala menempel —
// hanya tombol sidebar yang menempel (mis. halaman Produksi Es Kristal).
// Sudut atas latar ikut membulat (= rounded-2xl lembaran SidebarInset di
// md+) supaya tidak menutupi lengkungan sudut lembaran.
const KELAS_KEPALA_MENEMPEL =
  "[&_[data-kepala-halaman]]:sticky [&_[data-kepala-halaman]]:top-3 [&_[data-kepala-halaman]]:z-20 [&_[data-kepala-halaman]]:before:pointer-events-none [&_[data-kepala-halaman]]:before:absolute [&_[data-kepala-halaman]]:before:-inset-x-4 [&_[data-kepala-halaman]]:before:-top-4 [&_[data-kepala-halaman]]:before:-bottom-3 [&_[data-kepala-halaman]]:before:-z-10 [&_[data-kepala-halaman]]:before:bg-background [&_[data-kepala-halaman]]:before:transition-[box-shadow,border-color] [&_[data-kepala-halaman]]:before:duration-200 [&_[data-kepala-halaman]]:before:border-b [&_[data-kepala-halaman]]:before:border-transparent [&_[data-kepala-halaman]]:before:content-[''] [&_[data-kepala-halaman][data-menempel]]:before:border-border/70 [&_[data-kepala-halaman][data-menempel]]:before:shadow-[0_6px_16px_-10px_rgb(0_0_0/0.25)] md:[&_[data-kepala-halaman]]:before:rounded-t-2xl [&_.leaflet-container]:isolate";

export const KELAS_HALAMAN =
  KELAS_KEPALA_MENEMPEL +
  " relative [--ruang-tombol:2.75rem] max-md:data-bel:[--ruang-tombol:5.25rem] [&_[data-awal-halaman]]:pl-(--ruang-tombol) [&:not(:has([data-awal-halaman]))_h1:not(.sr-only)]:pl-(--ruang-tombol) [&:not(:has([data-awal-halaman],[data-tanpa-ruang],h1:not(.sr-only)))]:pt-14";
