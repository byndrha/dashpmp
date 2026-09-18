import { getPool, sql } from "@/lib/db";
import { getShiftWindow, getPreviousShift, getShiftLabel, getReportShift, type ShiftNumber } from "@/lib/report-shift";
import { getQtyRecapForShift, getAktivitasForShift } from "@/lib/queries/aktivitas-produksi";
import { getSnapshotStokEs, hitungTotalSisaStokEsLive } from "@/lib/queries/laporan-shift-stok-es-snapshot";
import { getHPPBersih } from "@/lib/queries/hpp-bersih";

// Chronological order within one TanggalUsaha, same as report-shift.ts's own
// getPreviousShift/getShiftWindow convention: Shift 2 -> 3 -> 1.
const SHIFT_ORDER: ShiftNumber[] = [2, 3, 1];

export interface KorelasiShiftRow {
  shift: ShiftNumber;
  shiftLabel: string;
  stokAwal: number;
  totalProduksi: number;
  totalDO: number;
  retur: number;
  kerusakan: number;
  wastePercent: number | null; // null when totalProduksi is 0 (ratio undefined)
  sisaProduksi: number;
  coldStorage: number;
  coldStorageFinal: boolean; // false = live figure (shift still running or no snapshot yet)
}

export interface KorelasiProduksiPenjualanData {
  tanggalUsaha: string;
  stokAwalPeriode: number;
  rows: KorelasiShiftRow[];
  // Opsi A untuk "Cost" (dikonfirmasi user 2026-09-19): rate HPP Bersih
  // (Rp/kantong) bulan berjalan tanggalUsaha, dari modul HPP Bersih yang
  // sudah ada (getHPPBersih) -- estimasi, bukan biaya riil shift ini,
  // karena HPP Bersih sendiri adalah rata-rata BULANAN seluruh perusahaan
  // (sewa, listrik, gaji, dll tidak bisa dipecah per-shift secara akurat).
  hppBersihRatePerKantong: number;
}

// Total kantong shipped (DeliveryOrderDetail.Delivered, not .Qty -- see
// sales-overview.ts's own comment on why .Qty inflates totals), 5KG-halved
// to a 10KG-equivalent kantong count using the same convention as
// JADWAL_KANTONG_EXPR in pengiriman-jadwal.ts. DeliveryOrder.TransDate is
// naive-WIB (see TransDate WIB/UTC boundary bug memory), so it's compared
// directly against getShiftWindow's own naive-WIB bounds -- no UTC
// conversion here, unlike the true-UTC JamSelesaiMuat columns elsewhere in
// this codebase.
async function getTotalDOForShift(tanggalUsaha: string, shift: ShiftNumber): Promise<number> {
  const pool = await getPool();
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const window = getShiftWindow(businessDate, shift, "work");
  const result = await pool
    .request()
    .input("start", sql.DateTime, window.start)
    .input("end", sql.DateTime, window.end).query(`
      SELECT ISNULL(SUM(CASE WHEN dod.Name LIKE '%5 KG%' THEN dod.Delivered / 2.0 ELSE dod.Delivered END), 0) AS Total
      FROM DeliveryOrderDetail dod
      JOIN DeliveryOrder do_ ON do_.DeliveryOrderID = dod.DeliveryOrderID
      WHERE do_.IsDeleted = 0 AND do_.TransDate >= @start AND do_.TransDate <= @end
    `);
  return (result.recordset[0] as { Total: number }).Total;
}

// Real customer returns (SalesReturn/SalesReturnDetail.Retur), same
// 5KG-halving and naive-WIB TransDate comparison as getTotalDOForShift above
// -- confirmed with user 2026-09-19 this is genuine logistics-side retur
// (barang balik dari rute), not the production-side "Ganti Return" quality
// category recorded in DashboardAktivitasProduksiShift.
async function getReturForShift(tanggalUsaha: string, shift: ShiftNumber): Promise<number> {
  const pool = await getPool();
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const window = getShiftWindow(businessDate, shift, "work");
  const result = await pool
    .request()
    .input("start", sql.DateTime, window.start)
    .input("end", sql.DateTime, window.end).query(`
      SELECT ISNULL(SUM(CASE WHEN srd.Name LIKE '%5 KG%' THEN srd.Retur / 2.0 ELSE srd.Retur END), 0) AS Total
      FROM SalesReturnDetail srd
      JOIN SalesReturn sr ON sr.SalesReturnID = srd.SalesReturnID
      WHERE sr.IsDeleted = 0 AND sr.TransDate >= @start AND sr.TransDate <= @end
    `);
  return (result.recordset[0] as { Total: number }).Total;
}

// Actual (not computed) remaining Cold Storage stock as of the END of a
// given shift -- same finalized-snapshot-with-live-fallback logic
// getLaporanShiftDetail already uses for its own stokAkhir, duplicated here
// rather than imported since that function returns a much larger object
// this module doesn't need.
async function getColdStorageForShift(
  tanggalUsaha: string,
  shift: ShiftNumber,
  isShiftBerjalan: boolean
): Promise<{ value: number; final: boolean }> {
  if (isShiftBerjalan) return { value: await hitungTotalSisaStokEsLive(), final: false };
  const snapshot = await getSnapshotStokEs(tanggalUsaha, shift);
  if (snapshot != null) return { value: snapshot, final: true };
  return { value: await hitungTotalSisaStokEsLive(), final: false };
}

// Feeds the "Korelasi Produksi-Penjualan" panel next to Peta Warehouse on
// /mkesindo/produksi -- confirmed design with user 2026-09-19. One
// TanggalUsaha period spans Shift 2 -> 3 -> 1 (report-shift.ts's own
// "work" chronological order), starting from the actual ColdStorage left
// over at the end of the PREVIOUS period's Shift 1.
//
// Each row's "Sisa Produksi" is a COMPUTED reconciliation figure (Stok Awal
// + Produksi - DO - Retur - Kerusakan), deliberately shown alongside the
// ACTUAL "ColdStorage" figure for the same shift so a mismatch is visible.
// The NEXT row's Stok Awal always comes from THIS row's actual ColdStorage,
// never from the computed Sisa Produksi -- so a discrepancy in one shift
// doesn't compound into the next one.
export async function getKorelasiProduksiPenjualan(tanggalUsaha: string): Promise<KorelasiProduksiPenjualanData> {
  const { shift: shiftBerjalan, businessDate: businessDateBerjalan } = getReportShift("work");
  const tanggalUsahaBerjalan = businessDateBerjalan.toISOString().slice(0, 10);

  const periodeAwal = getPreviousShift(tanggalUsaha, 2);
  const periodeAwalBerjalan = periodeAwal.tanggalUsaha === tanggalUsahaBerjalan && periodeAwal.shift === shiftBerjalan;
  const [{ value: stokAwalPeriode }, hppBersih] = await Promise.all([
    getColdStorageForShift(periodeAwal.tanggalUsaha, periodeAwal.shift, periodeAwalBerjalan),
    getHPPBersih(Number(tanggalUsaha.slice(0, 4))),
  ]);
  const hppBersihRatePerKantong = hppBersih.totalHPPBersih[Number(tanggalUsaha.slice(5, 7)) - 1] ?? 0;

  const rows: KorelasiShiftRow[] = [];
  let stokAwal = stokAwalPeriode;

  for (const shift of SHIFT_ORDER) {
    const isShiftBerjalan = tanggalUsaha === tanggalUsahaBerjalan && shift === shiftBerjalan;
    const [qtyRecap, aktivitas, totalDO, retur, coldStorage] = await Promise.all([
      getQtyRecapForShift(tanggalUsaha, shift),
      getAktivitasForShift(tanggalUsaha, shift),
      getTotalDOForShift(tanggalUsaha, shift),
      getReturForShift(tanggalUsaha, shift),
      getColdStorageForShift(tanggalUsaha, shift, isShiftBerjalan),
    ]);

    const totalProduksi = qtyRecap.totalKantongEkivalen;
    const kerusakan = aktivitas.pecahKemasanQty + aktivitas.esJatuhQty + aktivitas.sealerJebolQty;
    const wastePercent = totalProduksi > 0 ? (retur / totalProduksi) * 100 : null;
    const sisaProduksi = stokAwal + totalProduksi - totalDO - retur - kerusakan;

    rows.push({
      shift,
      shiftLabel: getShiftLabel(shift, "work"),
      stokAwal,
      totalProduksi,
      totalDO,
      retur,
      kerusakan,
      wastePercent,
      sisaProduksi,
      coldStorage: coldStorage.value,
      coldStorageFinal: coldStorage.final,
    });

    stokAwal = coldStorage.value;
  }

  return { tanggalUsaha, stokAwalPeriode, rows, hppBersihRatePerKantong };
}
