// 13 titik patroli tetap -- dipisah dari src/lib/queries/satpam-patroli.ts
// (yang mengimpor getPool/sql dan karenanya server-only) supaya komponen
// client (patroli-panel.tsx) bisa memakai daftar ini tanpa menyeret modul
// mssql/tedious/pg -- dan modul inti Node yang mereka perlukan (net, tls,
// dns, dgram, fs) -- ke dalam bundle browser. Mirip pola satpam-shift.ts:
// konstanta domain murni, aman dipakai client maupun server.
export interface PatroliTitikGroup {
  label: string;
  titik: string[];
}

// Pengelompokan murni tampilan (checklist yang lebih mudah dipindai saat
// berjalan) -- PATROLI_TITIK_LIST di bawah diturunkan dari sini lewat
// flatMap supaya urutan+isi 13 titik tetap satu sumber kebenaran, tidak ada
// risiko drift antara daftar pengelompokan dan daftar datar yang dipakai
// validasi server (selesaiPatroliSesiAction).
export const PATROLI_TITIK_GROUPS: PatroliTitikGroup[] = [
  {
    label: "Produksi Es Balok",
    titik: ["Area Produksi Es Balok-A", "Area Produksi Es Balok-B", "Area Produksi Es Balok-C"],
  },
  {
    label: "Produksi Es Kristal",
    titik: ["Area Produksi Es Kristal-A", "Area Produksi Es Kristal-B", "Area Produksi Es Kristal-C"],
  },
  {
    label: "Operasional",
    titik: ["Area Cuci Armada Es Kristal", "Gudang", "Distribusi"],
  },
  {
    label: "Fasilitas & Keamanan",
    titik: [
      "Ruang Trafo Kelistrikan",
      "Tempat Parkir Kendaraan Karyawan",
      "Area Parkir Armada Operasional",
      "Area Luar Kantor",
    ],
  },
];

export const PATROLI_TITIK_LIST: string[] = PATROLI_TITIK_GROUPS.flatMap((g) => g.titik);
