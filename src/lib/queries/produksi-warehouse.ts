import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import { KAPASITAS_PALLET_10KG } from "@/lib/produksi-warehouse-constants";

// Re-exported for existing server-side consumers importing it from here --
// client components must import from @/lib/produksi-warehouse-constants
// directly instead (this module pulls in @/lib/db -> mssql/tedious, which
// cannot be bundled into the browser).
export { KAPASITAS_PALLET_10KG };

export interface PalletPosisiRow {
  PosisiID: number;
  Kode: string;
  JumlahBatchAktif: number;
  TotalSisaQty10KG: number;
  // Batch aktif TERTUA di posisi ini (berdasarkan TanggalLabel+JamPanen) —
  // dipakai warehouse-cell.tsx untuk warna panduan FIFO. null kalau posisi
  // kosong (JumlahBatchAktif = 0).
  TanggalLabelTertua: Date | null;
  JamPanenTertua: string | null;
}

// Filtered to Kode LIKE '[SUT]%' -- only the new 42-slot Ice Stock denah
// (codes S1A..U3D). The old 12 rows (Kode '1A'..'3D') are deliberately left
// in the table (never deleted, see plan's Global Constraints) so historical
// DashboardProduksiBatch rows recorded against them still resolve through
// getRiwayatProduksi()'s JOIN -- they're just never returned by this
// function, so the UI never shows them as available slots.
//
// One row per position, aggregated over every active batch (SisaQty10KG >
// 0) referencing it via PosisiID -- BatchIDAktif no longer exists (Task 0
// dropped it), occupancy/capacity is always derived here, never stored.
export async function getWarehouseMap(): Promise<PalletPosisiRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT p.PosisiID, p.Kode,
           ISNULL(agg.JumlahBatchAktif, 0) AS JumlahBatchAktif,
           ISNULL(agg.TotalSisaQty10KG, 0) AS TotalSisaQty10KG,
           oldest.TanggalLabel AS TanggalLabelTertua,
           oldest.JamPanen AS JamPanenTertua
    FROM DashboardProduksiPalletPosisi p
    OUTER APPLY (
      SELECT COUNT(*) AS JumlahBatchAktif, SUM(b.SisaQty10KG) AS TotalSisaQty10KG
      FROM DashboardProduksiBatch b
      WHERE b.PosisiID = p.PosisiID AND b.IsDeleted = 0 AND b.SisaQty10KG > 0
    ) agg
    OUTER APPLY (
      SELECT TOP 1 b2.TanggalLabel, b2.JamPanen
      FROM DashboardProduksiBatch b2
      WHERE b2.PosisiID = p.PosisiID AND b2.IsDeleted = 0 AND b2.SisaQty10KG > 0
      ORDER BY b2.TanggalLabel ASC, b2.JamPanen ASC
    ) oldest
    WHERE p.Kode LIKE '[SUT]%'
    ORDER BY p.Kode
  `);
  return result.recordset;
}

export interface RiwayatProduksiRow {
  BatchID: number;
  Kode: string;
  MesinNama: string;
  TanggalProduksi: Date;
  Qty10KG: number;
  SisaQty10KG: number;
  DicatatOlehAkunID: number;
  TanggalLabel: Date;
  Shift: 1 | 2 | 3;
  JamPanen: string;
}

export async function getRiwayatProduksi(limit = 50): Promise<RiwayatProduksiRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) b.BatchID, p.Kode, m.Nama AS MesinNama, b.TanggalProduksi,
             b.Qty10KG, b.SisaQty10KG, b.DicatatOlehAkunID,
             b.TanggalLabel, b.Shift, b.JamPanen
      FROM DashboardProduksiBatch b
      JOIN DashboardProduksiPalletPosisi p ON p.PosisiID = b.PosisiID
      JOIN DashboardProduksiMesin m ON m.MesinID = b.MesinID
      WHERE b.IsDeleted = 0
      ORDER BY b.TanggalProduksi DESC
    `);
  return result.recordset;
}

// Riwayat scoped to one Pallete (PosisiID) — shown at the top of
// TambahProduksiDialog / the detail popup so the operator can see every
// batch (active or already-consumed) ever recorded at this exact slot,
// including ones stacked alongside a currently-active batch.
// `windowEnd` scopes the result to the 24 hours ending at that moment
// (never touches/deletes any row — purely a display filter) for the
// desktop "Riwayat & Kelola Stok Pallete Ini" panel's prev/next period
// navigation. Omitted entirely, it falls back to the original top-N
// most-recent behavior the mobile RiwayatPosisiList still relies on.
export async function getRiwayatProduksiForPosisi(
  posisiId: number,
  options?: { limit?: number; windowEnd?: Date }
): Promise<RiwayatProduksiRow[]> {
  const pool = await getPool();
  const request = pool.request().input("posisiId", sql.Int, posisiId);
  let topClause = "";
  let windowClause = "";
  if (options?.windowEnd) {
    const windowStart = new Date(options.windowEnd.getTime() - 24 * 3600000);
    request.input("windowStart", sql.DateTime, windowStart).input("windowEnd", sql.DateTime, options.windowEnd);
    windowClause = "AND b.TanggalProduksi >= @windowStart AND b.TanggalProduksi < @windowEnd";
  } else {
    request.input("limit", sql.Int, options?.limit ?? 10);
    topClause = "TOP (@limit)";
  }
  const result = await request.query(`
      SELECT ${topClause} b.BatchID, p.Kode, m.Nama AS MesinNama, b.TanggalProduksi,
             b.Qty10KG, b.SisaQty10KG, b.DicatatOlehAkunID,
             b.TanggalLabel, b.Shift, b.JamPanen
      FROM DashboardProduksiBatch b
      JOIN DashboardProduksiPalletPosisi p ON p.PosisiID = b.PosisiID
      JOIN DashboardProduksiMesin m ON m.MesinID = b.MesinID
      WHERE b.IsDeleted = 0 AND b.PosisiID = @posisiId ${windowClause}
      ORDER BY b.TanggalProduksi DESC
    `);
  return result.recordset;
}

// Satu baris per batch aktif (SisaQty10KG > 0) di SELURUH warehouse, diurut
// FIFO (tertua dulu) -- dipakai AlokasiScreen ("Isi Muatan") untuk
// menampilkan pilihan pallet per-batch, bukan per-posisi, supaya benar saat
// satu posisi punya >1 batch menumpuk.
export interface BatchAktifRow {
  BatchID: number;
  PosisiID: number;
  Kode: string;
  SisaQty10KG: number;
  TanggalLabel: Date;
  JamPanen: string;
}

export async function getBatchAktifForAlokasi(): Promise<BatchAktifRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT b.BatchID, b.PosisiID, p.Kode, b.SisaQty10KG, b.TanggalLabel, b.JamPanen
    FROM DashboardProduksiBatch b
    JOIN DashboardProduksiPalletPosisi p ON p.PosisiID = b.PosisiID
    WHERE b.IsDeleted = 0 AND b.SisaQty10KG > 0 AND p.Kode LIKE '[SUT]%'
    ORDER BY b.TanggalLabel ASC, b.JamPanen ASC
  `);
  return result.recordset;
}

export interface CreateBatchInput {
  // Replaces the old mesinId/tanggalLabel/shift/jamPanen fields — Tambah
  // Produksi no longer asks for these directly (explicit request): the
  // selected Kualitas record's own MesinID/TanggalLabel/Shift/Waktu are
  // copied onto the batch row instead, so a stock entry always traces back
  // to exactly when/who/which-machine its production quality check
  // happened. Every existing consumer of DashboardProduksiBatch's
  // TanggalLabel/Shift/MesinID/JamPanen columns keeps working unchanged —
  // only how they're populated at insert time changed.
  kualitasId: number;
  posisiId: number;
  qty10KG: number;
  dicatatOlehAkunId: number;
}

// Satu posisi pallet sekarang bisa menampung banyak batch sekaligus, dibatasi
// kapasitas gabungan KAPASITAS_PALLET_10KG (120) kantong 10kg -- bukan lagi
// "satu batch sampai habis". Dipanggil baik untuk posisi kosong maupun yang
// sudah terisi (selama kapasitas masih ada).
export async function createBatch(input: CreateBatchInput): Promise<number> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    // Kunci baris posisi (selalu ada -- 42 posisi tetap) sebagai titik
    // serialisasi SEBELUM insert/cek kapasitas. Menutup race deadlock yang
    // reviewer temukan: mengunci baris batch (kardinalitas berubah-ubah,
    // termasuk kosong) alih-alih baris posisi yang stabil membuat dua
    // transaksi konkuren ke posisi yang sama bisa saling menunggu satu sama
    // lain secara melingkar (circular wait -> SQL Server membatalkan salah
    // satu dengan error 1205 mentah). Mengunci baris posisi dulu membuat
    // keduanya cukup antre berurutan (blocking wait biasa), bukan deadlock --
    // dan tetap benar untuk posisi yang sedang kosong (baris posisi tetap ada
    // meski batch-nya nol).
    await new sql.Request(transaction)
      .input("posisiId", sql.Int, input.posisiId)
      .query(`SELECT PosisiID FROM DashboardProduksiPalletPosisi WITH (UPDLOCK, HOLDLOCK) WHERE PosisiID = @posisiId`);

    // The Kualitas record backs MesinID/TanggalLabel/Shift/JamPanen for
    // this batch — a plain read (no lock needed, Kualitas rows aren't
    // concurrently mutated in a way that matters here).
    const kualitasResult = await new sql.Request(transaction)
      .input("kualitasId", sql.Int, input.kualitasId)
      .query(`SELECT MesinID, TanggalLabel, Shift, Waktu, Qty10KG FROM DashboardProduksiKualitas WHERE KualitasID = @kualitasId`);
    const kualitas = kualitasResult.recordset[0] as
      | { MesinID: number; TanggalLabel: Date; Shift: number; Waktu: string; Qty10KG: number | null }
      | undefined;
    if (!kualitas) throw new AppError("Pemeriksaan Kualitas yang dipilih tidak ditemukan.");

    // Insert speculatively — aman karena satu transaksi dengan pengecekan
    // kapasitas di bawah: kalau kapasitas terlampaui, rollback membuang
    // baris ini juga, jadi tidak ada batch "orphan" yang pernah terlihat di
    // luar fungsi ini.
    const insertResult = await new sql.Request(transaction)
      .input("mesinId", sql.Int, kualitas.MesinID)
      .input("posisiId", sql.Int, input.posisiId)
      .input("qty10", sql.Int, input.qty10KG)
      .input("akunId", sql.Int, input.dicatatOlehAkunId)
      .input("tanggalLabel", sql.Date, kualitas.TanggalLabel)
      .input("shift", sql.TinyInt, kualitas.Shift)
      .input("jamPanen", sql.VarChar(5), kualitas.Waktu)
      .input("kualitasId", sql.Int, input.kualitasId)
      .query(`
        INSERT INTO DashboardProduksiBatch (MesinID, PosisiID, TanggalProduksi, Qty10KG, SisaQty10KG, DicatatOlehAkunID, TanggalLabel, Shift, JamPanen, KualitasID)
        OUTPUT INSERTED.BatchID
        VALUES (@mesinId, @posisiId, GETDATE(), @qty10, @qty10, @akunId, @tanggalLabel, @shift, @jamPanen, @kualitasId)
      `);
    const batchId = insertResult.recordset[0].BatchID as number;

    // Kapasitas: total SisaQty10KG semua batch aktif di posisi ini (baris
    // yang baru di-insert di atas sudah ikut terhitung) tidak boleh melebihi
    // 120.
    //
    // Tidak perlu WITH (UPDLOCK, HOLDLOCK) di sini -- klaim baris posisi di
    // atas sudah menyerialisasi semua createBatch konkuren ke posisi yang
    // sama (satu per satu), jadi INSERT spekulatif di atas selalu terlihat
    // oleh SELECT ini sendiri tanpa race. Sempat memakai hint ini, tapi
    // DashboardProduksiBatch tidak punya index pada PosisiID -- HOLDLOCK
    // tanpa index pendukung membuat SQL Server mengunci seluruh clustered
    // index (bukan cuma baris posisi ini), yang justru membuka deadlock
    // baru antar OPERATOR BERBEDA yang submit ke POSISI BERBEDA secara
    // bersamaan (ditemukan saat final review). Penulis lain ke SisaQty10KG
    // (klaim produksiSelesaiMuat) hanya pernah MENGURANGI nilainya, jadi
    // baca tanpa lock di sini paling buruk melihat total yang stale-TINGGI
    // (bukan stale-rendah) -- itu membuat pengecekan >120 lebih konservatif,
    // tidak pernah kurang ketat, jadi batas 120 tetap tidak bisa terlanggar.
    const capacityCheck = await new sql.Request(transaction)
      .input("posisiId", sql.Int, input.posisiId)
      .query(`
        SELECT ISNULL(SUM(SisaQty10KG), 0) AS TotalSisa
        FROM DashboardProduksiBatch
        WHERE PosisiID = @posisiId AND IsDeleted = 0 AND SisaQty10KG > 0
      `);
    const totalSisa = capacityCheck.recordset[0].TotalSisa as number;
    if (totalSisa > KAPASITAS_PALLET_10KG) {
      const sebelumnya = totalSisa - input.qty10KG;
      throw new AppError(
        `Kapasitas pallet ini penuh -- sudah terisi ${sebelumnya}/${KAPASITAS_PALLET_10KG} kantong 10kg, sisa ruang hanya ${KAPASITAS_PALLET_10KG - sebelumnya}.`
      );
    }

    // Plafon stok: total Qty10KG yang sudah dialokasikan ke pallete manapun
    // di bawah Kualitas ini (baris yang baru diinsert di atas sudah ikut
    // terhitung) tidak boleh melebihi Qty10KG milik Kualitas itu sendiri.
    // Qty10KG null (baris Kualitas lama, sebelum field ini ada) berarti
    // tidak ada plafon -- dilewati sepenuhnya, sama seperti sebelum
    // pengecekan ini ada.
    //
    // WITH (UPDLOCK, HOLDLOCK) di sini WAJIB -- beda dengan capacityCheck di
    // atas. Kunci baris posisi di awal fungsi hanya menyerialisasi
    // createBatch konkuren yang menyasar POSISI yang sama; dua panggilan
    // konkuren untuk KualitasID yang sama tapi posisi yang BERBEDA mengambil
    // lock pada baris posisi yang berbeda pula, jadi tidak saling
    // menyerialisasi. Tanpa lock eksplisit di sini, di bawah RCSI
    // (READ_COMMITTED_SNAPSHOT) kedua transaksi bisa membaca snapshot
    // sebelum insert satu sama lain, sama-sama menghitung totalTeralokasi di
    // bawah plafon, dan sama-sama commit -- melebihi Qty10KG berdua.
    // Mengunci baris Kualitas dulu membuat keduanya antre berurutan
    // (blocking wait biasa, bukan deadlock, karena tidak ada dependensi
    // lock melingkar dengan lock posisi di atas), sehingga SELECT SUM di
    // bawah selalu melihat INSERT spekulatif transaksi sebelumnya yang
    // sudah commit sebelum menghitung.
    await new sql.Request(transaction)
      .input("kualitasId", sql.Int, input.kualitasId)
      .query(`SELECT KualitasID FROM DashboardProduksiKualitas WITH (UPDLOCK, HOLDLOCK) WHERE KualitasID = @kualitasId`);

    if (kualitas.Qty10KG != null) {
      const alokasiCheck = await new sql.Request(transaction)
        .input("kualitasId", sql.Int, input.kualitasId)
        .query(`
          SELECT ISNULL(SUM(Qty10KG), 0) AS TotalTeralokasi
          FROM DashboardProduksiBatch
          WHERE KualitasID = @kualitasId AND IsDeleted = 0
        `);
      const totalTeralokasi = alokasiCheck.recordset[0].TotalTeralokasi as number;
      if (totalTeralokasi > kualitas.Qty10KG) {
        const sebelumnya = totalTeralokasi - input.qty10KG;
        throw new AppError(
          `Melebihi qty produksi tercatat pada pemeriksaan ini (tercatat ${kualitas.Qty10KG} kantong, sudah dialokasikan ${sebelumnya}, sisa ${Math.max(0, kualitas.Qty10KG - sebelumnya)}).`
        );
      }
    }

    await transaction.commit();
    return batchId;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

export interface UpdateBatchQtyInput {
  batchId: number;
  qty10KG: number;
}

// Koreksi jumlah kantong pada satu input stok yang sudah tercatat --
// dipakai untuk memperbaiki salah input, bukan alur normal (alur normal
// selalu lewat createBatch). Tidak bisa diubah ke bawah jumlah yang sudah
// terpakai (Qty10KG asli dikurangi SisaQty10KG saat ini), supaya
// SisaQty10KG tidak pernah jadi negatif dan riwayat pengiriman yang sudah
// memakainya tetap konsisten. Mengunci baris posisi lalu (kalau ada) baris
// Kualitas sebelum menghitung ulang kapasitas pallet/plafon, urutan yang
// sama persis dengan createBatch, supaya tidak ada risiko deadlock antara
// dua fungsi yang mengunci tabel yang sama.
export async function updateBatchQty(input: UpdateBatchQtyInput): Promise<void> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const batchResult = await new sql.Request(transaction)
      .input("batchId", sql.Int, input.batchId)
      .query(
        `SELECT BatchID, PosisiID, KualitasID, Qty10KG, SisaQty10KG, IsDeleted FROM DashboardProduksiBatch WHERE BatchID = @batchId`
      );
    const batch = batchResult.recordset[0] as
      | { BatchID: number; PosisiID: number; KualitasID: number | null; Qty10KG: number; SisaQty10KG: number; IsDeleted: boolean }
      | undefined;
    if (!batch || batch.IsDeleted) throw new AppError("Input stok ini tidak ditemukan.");

    const terpakai = batch.Qty10KG - batch.SisaQty10KG;
    if (input.qty10KG < terpakai) {
      throw new AppError(`Tidak bisa diubah ke bawah jumlah yang sudah terpakai (${terpakai} kantong).`);
    }

    await new sql.Request(transaction)
      .input("posisiId", sql.Int, batch.PosisiID)
      .query(`SELECT PosisiID FROM DashboardProduksiPalletPosisi WITH (UPDLOCK, HOLDLOCK) WHERE PosisiID = @posisiId`);

    const sisaBaru = batch.SisaQty10KG + (input.qty10KG - batch.Qty10KG);
    await new sql.Request(transaction)
      .input("batchId", sql.Int, input.batchId)
      .input("qty10", sql.Int, input.qty10KG)
      .input("sisa", sql.Int, sisaBaru)
      .query(
        `UPDATE DashboardProduksiBatch SET Qty10KG = @qty10, SisaQty10KG = @sisa, ModifiedDate = GETDATE() WHERE BatchID = @batchId`
      );

    const capacityCheck = await new sql.Request(transaction)
      .input("posisiId", sql.Int, batch.PosisiID)
      .query(`
        SELECT ISNULL(SUM(SisaQty10KG), 0) AS TotalSisa
        FROM DashboardProduksiBatch
        WHERE PosisiID = @posisiId AND IsDeleted = 0 AND SisaQty10KG > 0
      `);
    const totalSisa = capacityCheck.recordset[0].TotalSisa as number;
    if (totalSisa > KAPASITAS_PALLET_10KG) {
      throw new AppError(`Kapasitas pallet ini penuh -- total jadi ${totalSisa}/${KAPASITAS_PALLET_10KG} kantong 10kg.`);
    }

    if (batch.KualitasID != null) {
      await new sql.Request(transaction)
        .input("kualitasId", sql.Int, batch.KualitasID)
        .query(`SELECT KualitasID FROM DashboardProduksiKualitas WITH (UPDLOCK, HOLDLOCK) WHERE KualitasID = @kualitasId`);

      const kualitasResult = await new sql.Request(transaction)
        .input("kualitasId", sql.Int, batch.KualitasID)
        .query(`SELECT Qty10KG FROM DashboardProduksiKualitas WHERE KualitasID = @kualitasId`);
      const kualitasQty = (kualitasResult.recordset[0] as { Qty10KG: number | null } | undefined)?.Qty10KG ?? null;

      if (kualitasQty != null) {
        const alokasiCheck = await new sql.Request(transaction)
          .input("kualitasId", sql.Int, batch.KualitasID)
          .query(`
            SELECT ISNULL(SUM(Qty10KG), 0) AS TotalTeralokasi
            FROM DashboardProduksiBatch
            WHERE KualitasID = @kualitasId AND IsDeleted = 0
          `);
        const totalTeralokasi = alokasiCheck.recordset[0].TotalTeralokasi as number;
        if (totalTeralokasi > kualitasQty) {
          throw new AppError(
            `Melebihi qty produksi tercatat pada pemeriksaan ini (tercatat ${kualitasQty} kantong, total teralokasi jadi ${totalTeralokasi}).`
          );
        }
      }
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// Hapus (soft-delete) satu input stok yang salah catat -- hanya untuk yang
// belum ada sama sekali yang terpakai (SisaQty10KG masih persis sama
// dengan Qty10KG aslinya). Kondisi ini ditaruh langsung di klausa WHERE
// (bukan baca-lalu-putuskan terpisah) supaya atomik terhadap
// produksiSelesaiMuat yang mungkin mengurangi SisaQty10KG di saat
// bersamaan -- pola yang sama seperti UPDATE...WHERE SisaQty10KG >=
// @qty10 yang sudah dipakai di produksi-muatan.ts.
export async function deleteBatch(batchId: number): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("batchId", sql.Int, batchId)
    .query(`
      UPDATE DashboardProduksiBatch
      SET IsDeleted = 1, ModifiedDate = GETDATE()
      OUTPUT INSERTED.BatchID
      WHERE BatchID = @batchId AND IsDeleted = 0 AND SisaQty10KG = Qty10KG
    `);
  if (result.recordset.length === 0) {
    const check = await pool
      .request()
      .input("batchId", sql.Int, batchId)
      .query(`SELECT IsDeleted, Qty10KG, SisaQty10KG FROM DashboardProduksiBatch WHERE BatchID = @batchId`);
    const row = check.recordset[0] as { IsDeleted: boolean; Qty10KG: number; SisaQty10KG: number } | undefined;
    if (!row || row.IsDeleted) throw new AppError("Input stok ini tidak ditemukan.");
    const terpakai = row.Qty10KG - row.SisaQty10KG;
    throw new AppError(`Tidak bisa dihapus, sudah ada ${terpakai} kantong yang terpakai.`);
  }
}
