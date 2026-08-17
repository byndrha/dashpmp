// Kapasitas gabungan per posisi pallet, dalam kantong 10kg (SUM SisaQty10KG
// semua batch aktif di posisi itu). Dipisah dari src/lib/queries/produksi-warehouse.ts
// (yang meng-import @/lib/db -> mssql/tedious) supaya komponen client bisa
// mengimpornya sebagai value tanpa menyeret seluruh chain mssql ke bundle
// browser -- itulah yang terjadi sebelum file ini ada (ditemukan lewat
// verifikasi browser: tab Stok Es blank karena error "Module not found:
// Can't resolve 'dgram'").
export const KAPASITAS_PALLET_10KG = 120;
