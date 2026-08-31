import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import type { KantongVariant } from "@/lib/queries/sales-order";

export interface TakeAwayMuatanPendingRow {
  takeAwayMuatanId: number;
  salesOrderId: string;
  customerName: string;
  variant: KantongVariant;
  qtyDipesan: number;
  jamMulaiMuat: Date | null;
}

export interface TakeAwayMuatanSelesaiRow {
  takeAwayMuatanId: number;
  salesOrderId: string;
  customerName: string;
  variant: KantongVariant;
  qtyDimuat: number;
  jamSelesaiMuat: Date;
}

// Called from createTakeAwayPemesanan (takeaway.ts) right after the
// SalesOrder itself is created — one Draft row per TakeAway order,
// JamMulaiMuat/JamSelesaiMuat/QtyDimuat all NULL until produksi-app acts
// on it. See docs/superpowers/specs/2026-08-31-takeaway-alur-muat-produksi-design.md.
export async function createTakeAwayMuatanDraft(
  salesOrderId: string,
  variant: KantongVariant,
  qtyDipesan: number
): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("soId", sql.VarChar(16), salesOrderId)
    .input("variant", sql.VarChar(8), variant)
    .input("qty", sql.Int, qtyDipesan)
    .query(`INSERT INTO DashboardTakeAwayMuatan (SalesOrderID, Variant, QtyDipesan) VALUES (@soId, @variant, @qty)`);
}

// Menunggu diproses ("Draft") + sedang dimuat (JamMulaiMuat sudah diisi,
// JamSelesaiMuat belum) digabung satu daftar — sama seperti
// getAllDraftJadwalForProduksi (produksi-muatan.ts) menampilkan Draft apa
// pun status JamMulaiMuat-nya. Oldest-first: ini antrian walk-in, bukan
// jadwal jauh ke depan seperti Jadwal bertruk, jadi first-come-first-served.
// LEFT JOIN (bukan INNER) supaya baris tetap tampil walau BusinessPartner-nya
// pernah dihapus setelah order dibuat.
export async function getTakeAwayMuatanPending(): Promise<TakeAwayMuatanPendingRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT tam.TakeAwayMuatanID, tam.SalesOrderID, ISNULL(bp.Name, 'Tidak diketahui') AS CustomerName,
           tam.Variant, tam.QtyDipesan, tam.JamMulaiMuat
    FROM DashboardTakeAwayMuatan tam
    LEFT JOIN SalesOrder so ON so.SalesOrderID = tam.SalesOrderID
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    WHERE tam.IsDeleted = 0 AND tam.JamSelesaiMuat IS NULL
    ORDER BY tam.CreatedDate ASC
  `);
  return (
    result.recordset as {
      TakeAwayMuatanID: number;
      SalesOrderID: string;
      CustomerName: string;
      Variant: KantongVariant;
      QtyDipesan: number;
      JamMulaiMuat: Date | null;
    }[]
  ).map((r) => ({
    takeAwayMuatanId: r.TakeAwayMuatanID,
    salesOrderId: r.SalesOrderID,
    customerName: r.CustomerName,
    variant: r.Variant,
    qtyDipesan: r.QtyDipesan,
    jamMulaiMuat: r.JamMulaiMuat,
  }));
}

// Sudah Selesai Muat — 50 terbaru, sekadar agar operator melihat apa yang
// baru saja diselesaikan tanpa pindah tab (pola sama seperti
// fetchRecentSelesaiMuatJadwalForProduksi di produksi-muatan.ts).
export async function getTakeAwayMuatanSelesaiRecent(): Promise<TakeAwayMuatanSelesaiRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP (50) tam.TakeAwayMuatanID, tam.SalesOrderID, ISNULL(bp.Name, 'Tidak diketahui') AS CustomerName,
           tam.Variant, tam.QtyDimuat, tam.JamSelesaiMuat
    FROM DashboardTakeAwayMuatan tam
    LEFT JOIN SalesOrder so ON so.SalesOrderID = tam.SalesOrderID
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    WHERE tam.IsDeleted = 0 AND tam.JamSelesaiMuat IS NOT NULL
    ORDER BY tam.JamSelesaiMuat DESC
  `);
  return (
    result.recordset as {
      TakeAwayMuatanID: number;
      SalesOrderID: string;
      CustomerName: string;
      Variant: KantongVariant;
      QtyDimuat: number;
      JamSelesaiMuat: Date;
    }[]
  ).map((r) => ({
    takeAwayMuatanId: r.TakeAwayMuatanID,
    salesOrderId: r.SalesOrderID,
    customerName: r.CustomerName,
    variant: r.Variant,
    qtyDimuat: r.QtyDimuat,
    jamSelesaiMuat: r.JamSelesaiMuat,
  }));
}

// Atomic claim — the guard is the WHERE clause itself (JamMulaiMuat IS
// NULL), not a separate SELECT-then-UPDATE, so two concurrent taps on the
// same card can't both succeed. Mirrors startMuat()'s own
// UPDATE ... WHERE Status = 'Draft' pattern in pengiriman-jadwal.ts.
export async function takeAwayMulaiMuat(takeAwayMuatanId: number): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, takeAwayMuatanId)
    .query(
      `UPDATE DashboardTakeAwayMuatan SET JamMulaiMuat = GETDATE() WHERE TakeAwayMuatanID = @id AND IsDeleted = 0 AND JamMulaiMuat IS NULL`
    );
  if (result.rowsAffected[0] === 0) {
    throw new AppError("Order TakeAway ini sudah tidak tersedia atau sudah dimulai.");
  }
}

// Dipanggil dari deletePemesanan (pemesanan.ts, Task 4) saat SO TakeAway
// dibatalkan sebelum Mulai Muat — mencegah baris ini terus muncul di daftar
// menunggu produksi-app padahal SO-nya sudah dihapus. Aman dipanggil untuk
// SO non-TakeAway juga: tidak ada baris yang cocok, tidak melakukan apa-apa.
export async function softDeleteTakeAwayMuatanForSalesOrder(salesOrderId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("soId", sql.VarChar(16), salesOrderId)
    .query(`UPDATE DashboardTakeAwayMuatan SET IsDeleted = 1 WHERE SalesOrderID = @soId`);
}
