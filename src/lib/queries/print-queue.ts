import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";

// Widened type so this can be called from inside selesaiMuat()'s own
// sql.Transaction (Task 4) as well as standalone — same PoolOrTransaction
// pattern already established in pengiriman-jadwal.ts for its own
// transaction-spanning helpers.
type PoolOrTransaction = sql.ConnectionPool | sql.Transaction;

// Never enqueued for a stop that hit selesaiMuat()'s merged-external-DO
// `continue` branch — that branch creates no new SalesInvoice, so callers
// simply never invoke this for it (see Task 4).
export async function enqueuePrintJob(
  pool: PoolOrTransaction,
  salesInvoiceId: string,
  jadwalId: number,
  isManual: boolean
): Promise<void> {
  await pool
    .request()
    .input("salesInvoiceId", sql.VarChar(16), salesInvoiceId)
    .input("jadwalId", sql.Int, jadwalId)
    .input("isManual", sql.Bit, isManual)
    .query(
      `INSERT INTO DashboardPrintQueue (SalesInvoiceID, JadwalID, IsManual) VALUES (@salesInvoiceId, @jadwalId, @isManual)`
    );
}

export interface PendingPrintJob {
  printQueueId: number;
  salesInvoiceId: string;
  jadwalId: number;
}

// Oldest first — a batch enqueued together (one Selesai Muat with several
// stops) prints in the same order the stops were created.
export async function getPendingPrintQueue(): Promise<PendingPrintJob[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT PrintQueueID, SalesInvoiceID, JadwalID
    FROM DashboardPrintQueue
    WHERE Status = 'Pending'
    ORDER BY CreatedAt
  `);
  return (result.recordset as { PrintQueueID: number; SalesInvoiceID: string; JadwalID: number }[]).map((r) => ({
    printQueueId: r.PrintQueueID,
    salesInvoiceId: r.SalesInvoiceID,
    jadwalId: r.JadwalID,
  }));
}

export async function markPrintQueueDone(printQueueId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, printQueueId)
    .query(`UPDATE DashboardPrintQueue SET Status = 'Dicetak', PrintedAt = GETDATE() WHERE PrintQueueID = @id`);
}

// The manual "Cetak" icon's entry point — looks up the stop's own
// SalesInvoiceID/JadwalID server-side rather than trusting a client-supplied
// SalesInvoiceID, then enqueues exactly like the automatic path (IsManual=1
// is the only difference), so there is one drain code path, not two.
export async function enqueueManualReprint(jadwalDetailId: number): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, jadwalDetailId)
    .query(
      `SELECT SalesInvoiceID, JadwalID FROM DashboardPengirimanJadwalDetail WHERE JadwalDetailID = @id AND IsDeleted = 0`
    );
  const row = result.recordset[0] as { SalesInvoiceID: string | null; JadwalID: number } | undefined;
  if (!row) throw new AppError("Tujuan ini tidak ditemukan.");
  if (!row.SalesInvoiceID) throw new AppError("SI untuk tujuan ini belum terbit — jalankan Selesai Muat terlebih dahulu.");
  await enqueuePrintJob(pool, row.SalesInvoiceID.replace(/'/g, "").trim(), row.JadwalID, true);
}
