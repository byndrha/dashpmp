// 13 titik patroli tetap -- dipisah dari src/lib/queries/satpam-patroli.ts
// (yang mengimpor getPool/sql dan karenanya server-only) supaya komponen
// client (patroli-panel.tsx) bisa memakai daftar ini tanpa menyeret modul
// mssql/tedious/pg -- dan modul inti Node yang mereka perlukan (net, tls,
// dns, dgram, fs) -- ke dalam bundle browser. Mirip pola satpam-shift.ts:
// konstanta domain murni, aman dipakai client maupun server.
export const PATROLI_TITIK_LIST: string[] = [
  "Area Produksi Es Balok-A",
  "Area Produksi Es Balok-B",
  "Area Produksi Es Balok-C",
  "Area Produksi Es Kristal-A",
  "Area Produksi Es Kristal-B",
  "Area Produksi Es Kristal-C",
  "Area Cuci Armada Es Kristal",
  "Gudang",
  "Distribusi",
  "Ruang Trafo Kelistrikan",
  "Tempat Parkir Kendaraan Karyawan",
  "Area Parkir Armada Operasional",
  "Area Luar Kantor",
];
