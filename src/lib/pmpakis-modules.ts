// Single source of truth for the /pmpakis module-shell labels, shared by
// the sidebar nav and the [modul] placeholder page. Identical shape to
// pmpersada-modules.ts -- PMPakis gets the same 10-module shell PMPersada
// has (skeleton only per user request, to be adjusted together later).
export const PMPAKIS_MODULES: Record<string, string> = {
  keuangan: "Keuangan",
  produksi: "Produksi",
  piutang: "Piutang",
  penjualan: "Penjualan",
  transaksi: "Transaksi",
  listrik: "Biaya Listrik",
  pengiriman: "Pengiriman",
  pemesanan: "Pemesanan",
  mitra: "Mitra",
  pemasaran: "Pemasaran",
};
