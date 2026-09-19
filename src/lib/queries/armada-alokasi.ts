// src/lib/queries/armada-alokasi.ts
import sql from "mssql";
import { AppError } from "@/lib/action-result";

// Mengalokasikan kantong 5KG yang dimuat Armada saat Selesai Muat, dari
// entri DashboardProduksiKualitas varian 5kg yang belum terpakai --
// TERBARU dulu, TIDAK ADA fallback ke pallet (5kg tidak pernah masuk
// pallet, aturan bisnis permanen). Pola sama persis dengan Sumber 1
// allocateTakeAwayStock (takeaway-alokasi.ts), termasuk cap TOP 200 +
// WITH (UPDLOCK, HOLDLOCK) yang menerapkan pelajaran insiden 2026-09-18
// (query FIFO tanpa batas pernah mengunci ribuan baris tabel produksi).
// Menulis jejak ke DashboardArmadaAlokasi untuk tiap entri Kualitas yang
// disentuh. Lihat spec docs/superpowers/specs/2026-09-19-armada-5kg-alokasi-dan-redesain-centang3-design.md
// Bagian 2.
export async function allocateArmadaStock5KG(transaction: sql.Transaction, jadwalId: number, qtyDibutuhkan: number): Promise<void> {
  let sisaDibutuhkan = qtyDibutuhkan;

  // Sisa per entri = Qty10KG (nama kolom historis, dipakai untuk qty kantong
  // apapun variannya -- lihat produksi-kualitas.ts) dikurangi yang sudah
  // dialokasikan ke TakeAway ATAU Armada lain, supaya kedua konsumen tidak
  // rebutan baris yang sama. Batch selalu 0 untuk 5kg (5kg tidak pernah
  // masuk pallet) tapi tetap disertakan supaya formula konsisten dengan
  // pola Sumber 1 TakeAway.
  const kualitasResult = await new sql.Request(transaction).query(`
    SELECT TOP 200 k.KualitasID, k.Qty10KG,
           k.Qty10KG
             - ISNULL((SELECT SUM(b.Qty10KG) FROM DashboardProduksiBatch b WITH (UPDLOCK, HOLDLOCK) WHERE b.KualitasID = k.KualitasID AND b.IsDeleted = 0), 0)
             - ISNULL((SELECT SUM(ta.Qty) FROM DashboardTakeAwayAlokasi ta WITH (UPDLOCK, HOLDLOCK) WHERE ta.KualitasID = k.KualitasID AND ta.SumberTipe = 'KUALITAS'), 0)
             - ISNULL((SELECT SUM(aa.Qty) FROM DashboardArmadaAlokasi aa WITH (UPDLOCK, HOLDLOCK) WHERE aa.KualitasID = k.KualitasID), 0)
             AS Sisa
    FROM DashboardProduksiKualitas k WITH (UPDLOCK, HOLDLOCK)
    WHERE k.Variant = '5kg' AND k.Qty10KG IS NOT NULL
    ORDER BY k.TanggalLabel DESC, k.Waktu DESC
  `);

  for (const row of kualitasResult.recordset as { KualitasID: number; Sisa: number }[]) {
    if (sisaDibutuhkan <= 0) break;
    const sisa = Math.max(0, row.Sisa);
    if (sisa <= 0) continue;
    const ambil = Math.min(sisa, sisaDibutuhkan);
    await new sql.Request(transaction)
      .input("jadwalId", sql.Int, jadwalId)
      .input("kualitasId", sql.Int, row.KualitasID)
      .input("qty", sql.Int, ambil).query(`
        INSERT INTO DashboardArmadaAlokasi (JadwalID, KualitasID, Qty)
        VALUES (@jadwalId, @kualitasId, @qty)
      `);
    sisaDibutuhkan -= ambil;
  }

  if (sisaDibutuhkan > 0) {
    throw new AppError("Stok 5kg tidak cukup untuk menyelesaikan Selesai Muat ini.");
  }
}
