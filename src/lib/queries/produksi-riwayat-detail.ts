import { getPool, sql } from "@/lib/db";
import { getPreviousShift, getReportShift, type ShiftNumber } from "@/lib/report-shift";
import { getTotalDOForShift, getReturForShift, getColdStorageForShift } from "@/lib/queries/produksi-korelasi-penjualan";
import type { KantongVariant } from "@/lib/queries/sales-order";

// Urutan kronologis shift dalam satu TanggalUsaha, sama seperti seluruh
// modul produksi lain (Jadwal Tim, Korelasi Produksi-Penjualan): Shift 2
// mulai duluan, lalu 3, lalu 1. Dipakai untuk mengurutkan grup tanggal+shift
// dari yang PALING BARU ke lama (kebalikan SHIFT_ORDER).
const SHIFT_CHRONO_RANK: Record<ShiftNumber, number> = { 2: 0, 3: 1, 1: 2 };

export interface RiwayatAlokasiPallet {
  batchId: number;
  posisiKode: string;
  qty10KG: number;
  sisaQty10KG: number;
}

// Satu baris "Hasil Panen & Cek Kualitas" (DashboardProduksiKualitas) --
// qty10KG adalah plafon/total hasil panen yang DICEK pada satu momen, BUKAN
// otomatis sama dengan yang sudah masuk pallet: alokasiPallet berisi
// pecahan (bisa lebih dari satu pallet) yang sudah ditempatkan lewat Tambah
// Produksi, dan sisaBelumDialokasikan = qty10KG - SUM(alokasiPallet) adalah
// stok yang sudah lolos cek kualitas tapi BELUM dimasukkan ke pallet mana
// pun. Sesuai permintaan user 2026-09-19: "berapa stok yang masuk ke
// pallet ..., berapa stok sisa yang belum dimasukkan".
export interface RiwayatKualitasEntry {
  kualitasId: number;
  waktu: string;
  mesinNama: string;
  cekKejernihan: boolean;
  cekUkuranBentuk: boolean;
  qty10KG: number | null;
  variant: KantongVariant;
  diameterDalamMm: number | null;
  catatan: string | null;
  fotoPath: string | null;
  fotoBeratKemasanPath: string | null;
  dicatatOlehAkunId: number;
  dicatatOlehNama: string;
  createdDate: string;
  alokasiPallet: RiwayatAlokasiPallet[];
  sisaBelumDialokasikan: number | null;
}

// Statistik header satu grup (Tanggal, Shift) -- stokAwal/terkirim/retur/
// sisaStokAkhir memakai fungsi Korelasi Produksi-Penjualan yang SAMA persis
// (satu sumber kebenaran), sedangkan totalProduksi/masukPallet dihitung
// langsung dari entries grup ini sendiri (tidak perlu query tambahan):
// totalProduksi = SUM(Qty10KG hasil cek kualitas), masukPallet = SUM
// alokasi pallet aktual -- bisa lebih kecil dari totalProduksi kalau ada
// stok yang belum ditempatkan (lihat sisaBelumDialokasikan per entri).
// Sesuai permintaan user 2026-09-19.
export interface RiwayatHeaderStats {
  stokAwal: number;
  totalProduksi: number;
  totalProduksi5KG: number;
  totalProduksiGabungan: number;
  masukPallet: number;
  terkirim: number;
  sisaStokAkhir: number;
  sisaStokAkhirFinal: boolean;
  retur: number;
}

export interface RiwayatShiftGroup {
  tanggalUsaha: string;
  shift: ShiftNumber;
  timId: number | null;
  timNama: string | null;
  entries: RiwayatKualitasEntry[];
  stats: RiwayatHeaderStats;
}

// Riwayat Produksi versi detail -- menggantikan tampilan flat per-batch lama
// (getRiwayatProduksi di produksi-warehouse.ts, TETAP dipakai apa adanya
// oleh riwayat-posisi-list-desktop.tsx/tambah-produksi-dialog.tsx untuk
// keperluan lain, sengaja tidak disentuh) dengan grup per (Tanggal, Shift),
// masing-masing berisi SEMUA entri Hasil Panen & Cek Kualitas hari/shift itu
// lengkap dengan alokasi pallet-nya, info Tim yang bertugas (dari Jadwal Tim
// Produksi), dan siapa yang menginput. Dibatasi per JUMLAH HARI (bukan flat
// row count) supaya tiap grup tanggal+shift yang tampil selalu utuh, tidak
// terpotong di tengah. Sesuai permintaan user 2026-09-19.
export async function getRiwayatProduksiDetail(jumlahHari = 10): Promise<RiwayatShiftGroup[]> {
  const pool = await getPool();

  const minTanggalResult = await pool.request().input("jumlahHari", sql.Int, jumlahHari).query(`
    SELECT MIN(TanggalLabel) AS MinTanggal FROM (
      SELECT DISTINCT TOP (@jumlahHari) TanggalLabel
      FROM DashboardProduksiKualitas
      ORDER BY TanggalLabel DESC
    ) t
  `);
  const minTanggal = (minTanggalResult.recordset[0] as { MinTanggal: Date | null }).MinTanggal;
  if (!minTanggal) return [];

  const [kualitasResult, jadwalResult] = await Promise.all([
    pool.request().input("minTanggal", sql.Date, minTanggal).query(`
      SELECT k.KualitasID, k.TanggalLabel, k.Waktu, k.Shift, m.Nama AS MesinNama,
             k.CekKejernihan, k.CekUkuranBentuk, k.Qty10KG, k.Variant, k.DiameterDalamMm, k.Catatan,
             k.FotoPath, k.FotoBeratKemasanPath, k.CreatedByUserID, k.CreatedDate
      FROM DashboardProduksiKualitas k
      LEFT JOIN DashboardProduksiMesin m ON m.MesinID = k.MesinID
      WHERE k.TanggalLabel >= @minTanggal
      ORDER BY k.TanggalLabel DESC, k.Waktu DESC
    `),
    pool.request().input("minTanggal", sql.Date, minTanggal).query(`
      SELECT j.TanggalUsaha, j.Shift, j.TimID, t.Nama AS TimNama
      FROM DashboardJadwalTimProduksi j
      JOIN DashboardTimProduksi t ON t.TimID = j.TimID
      WHERE j.TanggalUsaha >= @minTanggal
    `),
  ]);

  type KualitasRecordsetRow = {
    KualitasID: number;
    TanggalLabel: Date;
    Waktu: string;
    Shift: ShiftNumber;
    MesinNama: string | null;
    CekKejernihan: boolean;
    CekUkuranBentuk: boolean;
    Qty10KG: number | null;
    Variant: KantongVariant;
    DiameterDalamMm: number | null;
    Catatan: string | null;
    FotoPath: string | null;
    FotoBeratKemasanPath: string | null;
    CreatedByUserID: string;
    CreatedDate: Date;
  };
  const kualitasRows = kualitasResult.recordset as KualitasRecordsetRow[];
  const kualitasIds = kualitasRows.map((r) => r.KualitasID);

  const alokasiByKualitasId = new Map<number, RiwayatAlokasiPallet[]>();
  if (kualitasIds.length > 0) {
    const batchResult = await pool.request().query(`
      SELECT b.KualitasID, b.BatchID, p.Kode, b.Qty10KG, b.SisaQty10KG
      FROM DashboardProduksiBatch b
      JOIN DashboardProduksiPalletPosisi p ON p.PosisiID = b.PosisiID
      WHERE b.IsDeleted = 0 AND b.KualitasID IN (${kualitasIds.join(",")})
      ORDER BY p.Kode
    `);
    for (const r of batchResult.recordset as { KualitasID: number; BatchID: number; Kode: string; Qty10KG: number; SisaQty10KG: number }[]) {
      const list = alokasiByKualitasId.get(r.KualitasID) ?? [];
      list.push({ batchId: r.BatchID, posisiKode: r.Kode, qty10KG: r.Qty10KG, sisaQty10KG: r.SisaQty10KG });
      alokasiByKualitasId.set(r.KualitasID, list);
    }
  }

  const takeAwayByKualitasId = new Map<number, number>();
  if (kualitasIds.length > 0) {
    const takeAwayResult = await pool.request().query(`
      SELECT KualitasID, SUM(Qty) AS TotalQty
      FROM DashboardTakeAwayAlokasi
      WHERE SumberTipe = 'KUALITAS' AND KualitasID IN (${kualitasIds.join(",")})
      GROUP BY KualitasID
    `);
    for (const r of takeAwayResult.recordset as { KualitasID: number; TotalQty: number }[]) {
      takeAwayByKualitasId.set(r.KualitasID, r.TotalQty);
    }
  }

  const armadaByKualitasId = new Map<number, number>();
  if (kualitasIds.length > 0) {
    const armadaResult = await pool.request().query(`
      SELECT KualitasID, SUM(Qty) AS TotalQty
      FROM DashboardArmadaAlokasi
      WHERE KualitasID IN (${kualitasIds.join(",")})
      GROUP BY KualitasID
    `);
    for (const r of armadaResult.recordset as { KualitasID: number; TotalQty: number }[]) {
      armadaByKualitasId.set(r.KualitasID, r.TotalQty);
    }
  }

  const timByTanggalShift = new Map<string, { timId: number; timNama: string }>();
  for (const r of jadwalResult.recordset as { TanggalUsaha: Date; Shift: ShiftNumber; TimID: number; TimNama: string }[]) {
    timByTanggalShift.set(`${r.TanggalUsaha.toISOString().slice(0, 10)}|${r.Shift}`, { timId: r.TimID, timNama: r.TimNama });
  }

  const groupByKey = new Map<string, Omit<RiwayatShiftGroup, "stats">>();
  for (const r of kualitasRows) {
    const tanggalUsaha = r.TanggalLabel.toISOString().slice(0, 10);
    const key = `${tanggalUsaha}|${r.Shift}`;
    let group = groupByKey.get(key);
    if (!group) {
      const tim = timByTanggalShift.get(key);
      group = { tanggalUsaha, shift: r.Shift, timId: tim?.timId ?? null, timNama: tim?.timNama ?? null, entries: [] };
      groupByKey.set(key, group);
    }
    const alokasiPallet = alokasiByKualitasId.get(r.KualitasID) ?? [];
    const totalTeralokasi =
      alokasiPallet.reduce((sum, a) => sum + a.qty10KG, 0) +
      (takeAwayByKualitasId.get(r.KualitasID) ?? 0) +
      (armadaByKualitasId.get(r.KualitasID) ?? 0);
    group.entries.push({
      kualitasId: r.KualitasID,
      waktu: r.Waktu,
      mesinNama: r.MesinNama ?? "-",
      cekKejernihan: r.CekKejernihan,
      cekUkuranBentuk: r.CekUkuranBentuk,
      qty10KG: r.Qty10KG,
      variant: r.Variant,
      diameterDalamMm: r.DiameterDalamMm,
      catatan: r.Catatan,
      fotoPath: r.FotoPath,
      fotoBeratKemasanPath: r.FotoBeratKemasanPath,
      dicatatOlehAkunId: Number(r.CreatedByUserID),
      dicatatOlehNama: "", // diisi actions.ts setelah getAkunNamaMap (lintas DB: Postgres akun, bukan MSSQL)
      createdDate: r.CreatedDate.toISOString(),
      alokasiPallet,
      sisaBelumDialokasikan: r.Qty10KG == null ? null : Math.max(0, r.Qty10KG - totalTeralokasi),
    });
  }

  // Stok Awal/Terkirim/Retur/Sisa Stok Akhir dihitung per grup lewat fungsi
  // Korelasi Produksi-Penjualan yang sama, dijalankan paralel antar grup --
  // aman terhadap SQL Server walau jumlahnya banyak (jumlahHari x ~3 shift)
  // karena getPool()'s connection pool sendiri sudah dibatasi max:10 (lihat
  // lib/db.ts, sama seperti pertimbangan getKorelasiRingkasanBulan).
  const { shift: shiftBerjalan, businessDate: businessDateBerjalan } = getReportShift("work");
  const tanggalUsahaBerjalan = businessDateBerjalan.toISOString().slice(0, 10);

  const groupsWithStats = await Promise.all(
    [...groupByKey.values()].map(async (group) => {
      const prev = getPreviousShift(group.tanggalUsaha, group.shift);
      const isShiftBerjalan = group.tanggalUsaha === tanggalUsahaBerjalan && group.shift === shiftBerjalan;
      const isPrevShiftBerjalan = prev.tanggalUsaha === tanggalUsahaBerjalan && prev.shift === shiftBerjalan;
      const [stokAwal, terkirim, retur, sisaStokAkhir] = await Promise.all([
        getColdStorageForShift(prev.tanggalUsaha, prev.shift, isPrevShiftBerjalan),
        getTotalDOForShift(group.tanggalUsaha, group.shift),
        getReturForShift(group.tanggalUsaha, group.shift),
        getColdStorageForShift(group.tanggalUsaha, group.shift, isShiftBerjalan),
      ]);
      const totalProduksi = group.entries
        .filter((e) => e.variant === "10kg")
        .reduce((sum, e) => sum + (e.qty10KG ?? 0), 0);
      const totalProduksi5KG = group.entries
        .filter((e) => e.variant === "5kg")
        .reduce((sum, e) => sum + (e.qty10KG ?? 0), 0);
      const totalProduksiGabungan = totalProduksi + totalProduksi5KG / 2;
      const masukPallet = group.entries.reduce((sum, e) => sum + e.alokasiPallet.reduce((s, a) => s + a.qty10KG, 0), 0);
      const stats: RiwayatHeaderStats = {
        stokAwal: stokAwal.value,
        totalProduksi,
        totalProduksi5KG,
        totalProduksiGabungan,
        masukPallet,
        terkirim,
        sisaStokAkhir: sisaStokAkhir.value,
        sisaStokAkhirFinal: sisaStokAkhir.final,
        retur,
      };
      return { ...group, stats };
    })
  );

  return groupsWithStats.sort((a, b) => {
    if (a.tanggalUsaha !== b.tanggalUsaha) return a.tanggalUsaha < b.tanggalUsaha ? 1 : -1;
    return SHIFT_CHRONO_RANK[b.shift] - SHIFT_CHRONO_RANK[a.shift];
  });
}
