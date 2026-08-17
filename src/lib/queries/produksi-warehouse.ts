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
export async function getRiwayatProduksiForPosisi(posisiId: number, limit = 10): Promise<RiwayatProduksiRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("posisiId", sql.Int, posisiId)
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) b.BatchID, p.Kode, m.Nama AS MesinNama, b.TanggalProduksi,
             b.Qty10KG, b.SisaQty10KG, b.DicatatOlehAkunID,
             b.TanggalLabel, b.Shift, b.JamPanen
      FROM DashboardProduksiBatch b
      JOIN DashboardProduksiPalletPosisi p ON p.PosisiID = b.PosisiID
      JOIN DashboardProduksiMesin m ON m.MesinID = b.MesinID
      WHERE b.IsDeleted = 0 AND b.PosisiID = @posisiId
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
  mesinId: number;
  posisiId: number;
  qty10KG: number;
  tanggalLabel: string;
  shift: 1 | 2 | 3;
  jamPanen: string;
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

    // Insert speculatively — aman karena satu transaksi dengan pengecekan
    // kapasitas di bawah: kalau kapasitas terlampaui, rollback membuang
    // baris ini juga, jadi tidak ada batch "orphan" yang pernah terlihat di
    // luar fungsi ini.
    const insertResult = await new sql.Request(transaction)
      .input("mesinId", sql.Int, input.mesinId)
      .input("posisiId", sql.Int, input.posisiId)
      .input("qty10", sql.Int, input.qty10KG)
      .input("akunId", sql.Int, input.dicatatOlehAkunId)
      .input("tanggalLabel", sql.Date, input.tanggalLabel)
      .input("shift", sql.TinyInt, input.shift)
      .input("jamPanen", sql.VarChar(5), input.jamPanen)
      .query(`
        INSERT INTO DashboardProduksiBatch (MesinID, PosisiID, TanggalProduksi, Qty10KG, SisaQty10KG, DicatatOlehAkunID, TanggalLabel, Shift, JamPanen)
        OUTPUT INSERTED.BatchID
        VALUES (@mesinId, @posisiId, GETDATE(), @qty10, @qty10, @akunId, @tanggalLabel, @shift, @jamPanen)
      `);
    const batchId = insertResult.recordset[0].BatchID as number;

    // Kapasitas: total SisaQty10KG semua batch aktif di posisi ini (baris
    // yang baru di-insert di atas sudah ikut terhitung) tidak boleh melebihi
    // 120. WITH (UPDLOCK, HOLDLOCK) mengunci baris yang cocok sampai
    // transaksi ini commit/rollback -- menutup race dua operator submit ke
    // posisi yang sama secara bersamaan, pola yang sama seperti klaim
    // BatchIDAktif IS NULL yang digantikannya.
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

    await transaction.commit();
    return batchId;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
