// src/lib/queries/takeaway-alokasi.ts
import sql from "mssql";
import { AppError } from "@/lib/action-result";
import type { KantongVariant } from "@/lib/queries/sales-order";

// Mengurangi stok yang tepat untuk satu TakeAwayMuatan saat Selesai Muat --
// urutan sumber: (1) DashboardProduksiKualitas varian SAMA yang belum
// dipallet, TERBARU dulu; (2) khusus varian 10kg kalau masih kurang,
// DashboardProduksiBatch (pallet), TERTUA dulu -- 5kg tidak pernah sampai
// ke sumber ini karena pallet tidak pernah berisi 5kg. Menulis jejak ke
// DashboardTakeAwayAlokasi untuk tiap sumber yang disentuh. Lihat spec
// docs/superpowers/specs/2026-09-19-varian-kualitas-takeaway-fifo-checkmark-tim-design.md
// Bagian 3.
export async function allocateTakeAwayStock(
  transaction: sql.Transaction,
  takeAwayMuatanId: number,
  variant: KantongVariant,
  qtyDibutuhkan: number
): Promise<void> {
  let sisaDibutuhkan = qtyDibutuhkan;

  // Sumber 1: Kualitas varian sama, belum dipallet, terbaru dulu.
  // WITH (UPDLOCK, HOLDLOCK) mengunci baris yang dibaca sampai transaksi
  // ini commit/rollback -- dua TakeAway konkuren tidak bisa berebut sisa
  // yang sama, pola sama seperti lock di createBatch (produksi-warehouse.ts).
  // TOP N membatasi jumlah baris yang di-UPDLOCK dan jumlah round-trip
  // INSERT sekuensial di loop bawah -- tanpa batas ini, qty besar bisa
  // mengunci ribuan baris selama beberapa menit (insiden 2026-09-18, lihat
  // ledger SDD).
  const kualitasResult = await new sql.Request(transaction).input("variant", sql.VarChar(8), variant).query(`
    SELECT TOP 50 k.KualitasID, k.Qty10KG,
           k.Qty10KG
             - ISNULL((SELECT SUM(b.Qty10KG) FROM DashboardProduksiBatch b WITH (UPDLOCK, HOLDLOCK) WHERE b.KualitasID = k.KualitasID AND b.IsDeleted = 0), 0)
             - ISNULL((SELECT SUM(ta.Qty) FROM DashboardTakeAwayAlokasi ta WITH (UPDLOCK, HOLDLOCK) WHERE ta.KualitasID = k.KualitasID AND ta.SumberTipe = 'KUALITAS'), 0)
             AS Sisa
    FROM DashboardProduksiKualitas k WITH (UPDLOCK, HOLDLOCK)
    WHERE k.Variant = @variant AND k.Qty10KG IS NOT NULL
    ORDER BY k.TanggalLabel DESC, k.Waktu DESC
  `);

  for (const row of kualitasResult.recordset as { KualitasID: number; Sisa: number }[]) {
    if (sisaDibutuhkan <= 0) break;
    const sisa = Math.max(0, row.Sisa);
    if (sisa <= 0) continue;
    const ambil = Math.min(sisa, sisaDibutuhkan);
    await new sql.Request(transaction)
      .input("takeAwayMuatanId", sql.Int, takeAwayMuatanId)
      .input("kualitasId", sql.Int, row.KualitasID)
      .input("qty", sql.Int, ambil).query(`
        INSERT INTO DashboardTakeAwayAlokasi (TakeAwayMuatanID, SumberTipe, KualitasID, Qty)
        VALUES (@takeAwayMuatanId, 'KUALITAS', @kualitasId, @qty)
      `);
    sisaDibutuhkan -= ambil;
  }

  // Sumber 2: HANYA varian 10kg, kalau masih kurang -- Pallet, tertua dulu.
  if (sisaDibutuhkan > 0 && variant === "10kg") {
    // TOP N membatasi jumlah baris yang di-UPDLOCK dan jumlah round-trip
    // UPDATE+INSERT sekuensial di loop bawah -- sama seperti alasan TOP 50
    // di Sumber 1 (insiden 2026-09-18, lihat ledger SDD); Cold Storage
    // hanya punya ~42 slot pallet fisik jadi 100 sudah lebih dari cukup.
    const batchResult = await new sql.Request(transaction).query(`
      SELECT TOP 100 BatchID, SisaQty10KG
      FROM DashboardProduksiBatch WITH (UPDLOCK, HOLDLOCK)
      WHERE IsDeleted = 0 AND SisaQty10KG > 0
      ORDER BY TanggalLabel ASC, JamPanen ASC
    `);

    for (const row of batchResult.recordset as { BatchID: number; SisaQty10KG: number }[]) {
      if (sisaDibutuhkan <= 0) break;
      const ambil = Math.min(row.SisaQty10KG, sisaDibutuhkan);
      const claim = await new sql.Request(transaction)
        .input("batchId", sql.Int, row.BatchID)
        .input("qty", sql.Int, ambil).query(`
          UPDATE DashboardProduksiBatch
          SET SisaQty10KG = SisaQty10KG - @qty, ModifiedDate = GETDATE()
          OUTPUT INSERTED.SisaQty10KG
          WHERE BatchID = @batchId AND SisaQty10KG >= @qty
        `);
      if (claim.recordset.length === 0) continue; // batch keburu diambil transaksi lain, coba batch berikutnya
      await new sql.Request(transaction)
        .input("takeAwayMuatanId", sql.Int, takeAwayMuatanId)
        .input("batchId", sql.Int, row.BatchID)
        .input("qty", sql.Int, ambil).query(`
          INSERT INTO DashboardTakeAwayAlokasi (TakeAwayMuatanID, SumberTipe, BatchID, Qty)
          VALUES (@takeAwayMuatanId, 'BATCH', @batchId, @qty)
        `);
      sisaDibutuhkan -= ambil;
    }
  }

  if (sisaDibutuhkan > 0) {
    throw new AppError("Stok tidak cukup untuk menyelesaikan TakeAway ini.");
  }
}
