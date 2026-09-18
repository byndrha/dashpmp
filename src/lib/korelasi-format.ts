import type { KorelasiProduksiPenjualanData } from "@/lib/queries/produksi-korelasi-penjualan";

// Dipisah dari korelasi-produksi-penjualan-panel.tsx supaya bisa dipakai
// juga oleh getKorelasiRingkasanBulan (server, produksi-korelasi-penjualan.ts)
// DAN jadwal-tim-bulanan.tsx (client, ringkasan per kotak tanggal) tanpa
// menarik masuk "@/lib/db" (mssql) ke bundle client -- file ini sengaja
// hanya berisi fungsi murni + tipe, tidak ada import server-only.

export interface KorelasiRingkasan {
  totalProduksi: number;
  totalDO: number;
  sisaStok: number;
  totalRetur: number;
  penjualanPercent: number | null;
  returPercent: number | null;
  costEstimasi: number;
}

// Formula PERSIS sama dengan yang dipakai korelasi-produksi-penjualan-panel.tsx
// (kotak ringkasan di panel Korelasi Produksi-Penjualan) -- lihat komentar di
// sana untuk penjelasan tiap rumus (Sisa Stok = rekonsiliasi, Indeks Retur =
// Produksi/Retur x100% BUKAN kebalikannya, Cost = Opsi A rate HPP Bersih).
export function computeKorelasiRingkasan(data: KorelasiProduksiPenjualanData): KorelasiRingkasan {
  const totalProduksi = data.rows.reduce((sum, r) => sum + r.totalProduksi, 0);
  const totalDO = data.rows.reduce((sum, r) => sum + r.totalDO, 0);
  const totalRetur = data.rows.reduce((sum, r) => sum + r.retur, 0);
  const totalKerusakan = data.rows.reduce((sum, r) => sum + r.kerusakan, 0);
  const sisaStok = data.stokAwalPeriode + totalProduksi - totalDO - totalRetur - totalKerusakan;
  const penjualanPercent = totalProduksi > 0 ? (totalDO / totalProduksi) * 100 : null;
  const returPercent = totalRetur > 0 ? (totalProduksi / totalRetur) * 100 : null;
  const costEstimasi = data.hppBersihRatePerKantong * totalProduksi;
  return { totalProduksi, totalDO, sisaStok, totalRetur, penjualanPercent, returPercent, costEstimasi };
}

export function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

export function formatWaste(value: number | null): string {
  if (value == null) return "-";
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
}
