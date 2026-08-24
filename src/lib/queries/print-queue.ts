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
// stops) prints in the same order the stops were created. CreatedAt is a
// DATETIME (~3.33ms resolution) set via GETDATE() per-INSERT, so rows from a
// tight-loop batch insert can land on the identical rounded timestamp;
// PrintQueueID (IDENTITY, monotonic with insert order) breaks the tie so the
// creation-order guarantee is exact, not merely probable.
export async function getPendingPrintQueue(): Promise<PendingPrintJob[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT PrintQueueID, SalesInvoiceID, JadwalID
    FROM DashboardPrintQueue
    WHERE Status = 'Pending'
    ORDER BY CreatedAt, PrintQueueID
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

// Atomically claims one pending job before printing — the row lock this
// UPDATE takes (held until commit, unlike a plain SELECT's shared lock)
// prevents two concurrent pollers (e.g. two open browser tabs) from both
// printing the same job before either marks it done. Returns false if
// another caller already claimed it (or it's no longer Pending).
export async function claimPrintQueueJob(printQueueId: number): Promise<boolean> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, printQueueId)
    .query(`UPDATE DashboardPrintQueue SET Status = 'Printing' WHERE PrintQueueID = @id AND Status = 'Pending'`);
  return result.rowsAffected[0] > 0;
}

// Called after a failed print attempt (fetch-data or send failure). Also
// un-claims the row (reverts 'Printing' -> 'Pending') in the same statement
// so the next poll tick — by this poller or another one — can retry it,
// unless the caller escalates it to 'Error' after this returns failCount >= 3.
export async function incrementPrintQueueFailCount(printQueueId: number): Promise<{ failCount: number }> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, printQueueId)
    .query(
      `UPDATE DashboardPrintQueue SET FailCount = FailCount + 1, Status = 'Pending' OUTPUT INSERTED.FailCount WHERE PrintQueueID = @id`
    );
  const row = result.recordset[0] as { FailCount: number } | undefined;
  return { failCount: row?.FailCount ?? 0 };
}

// Reverts a claimed-but-not-yet-marked-done job back to 'Pending' when the
// DB write that marks it 'Dicetak' fails right after a successful physical
// print. Needed because claimPrintQueueJob already moves the row out of
// 'Pending' before the print is attempted (see Finding 1 above) — without
// this, a markPrintQueueDone failure would leave the row stuck at
// 'Printing' forever, since getPendingPrintQueue only ever looks at
// Status = 'Pending'. Re-exposes the same "reprint on the next tick"
// behavior the poller's pre-claim code already accepted as a rare edge
// case for this specific failure (the print already physically happened).
export async function revertPrintQueueJobToPending(printQueueId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, printQueueId)
    .query(`UPDATE DashboardPrintQueue SET Status = 'Pending' WHERE PrintQueueID = @id AND Status = 'Printing'`);
}

// Terminal state for a job that has failed 3 times — excluded from
// getPendingPrintQueue's WHERE Status = 'Pending' automatically, so it no
// longer blocks the FIFO queue. No automatic retry; requires manual
// intervention (fix the underlying data/printer issue, then reset the row).
export async function markPrintQueueError(printQueueId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, printQueueId)
    .query(`UPDATE DashboardPrintQueue SET Status = 'Error' WHERE PrintQueueID = @id`);
}

// The manual "Cetak" icon's entry point — looks up the stop's own
// SalesInvoiceID/JadwalID server-side rather than trusting a client-supplied
// SalesInvoiceID, then enqueues exactly like the automatic path (IsManual=1
// is the only difference), so there is one drain code path, not two.
//
// Self-healing fallback: DashboardPengirimanJadwalDetail.SalesInvoiceID can
// be null even when a real SalesInvoice already exists for this stop's
// DeliveryOrderID — confirmed live 2026-08-24 (MKE/SO/003550/2026-08/003/001
// / MKE/DO/003504/.../MKE/SI/003498/...): any Jadwal that went through
// selesaiMuat()'s merged-external-DO branch BEFORE that branch was fixed to
// link/create a SalesInvoice never had this column written at all, even
// though a SalesInvoice was later created for it elsewhere (confirmStopDelivery,
// or the desktop ERP directly). Rather than surface a misleading "belum
// terbit" for a stop that genuinely already has an invoice, fall back to
// looking it up by DeliveryOrderID (same quote-wrapping quirk documented in
// invoice-public.ts/thermal-receipt.ts/pengiriman-jadwal.ts) and self-heal
// the link before enqueueing.
export async function enqueueManualReprint(jadwalDetailId: number): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, jadwalDetailId)
    .query(
      `SELECT SalesInvoiceID, DeliveryOrderID, JadwalID FROM DashboardPengirimanJadwalDetail WHERE JadwalDetailID = @id AND IsDeleted = 0`
    );
  const row = result.recordset[0] as
    | { SalesInvoiceID: string | null; DeliveryOrderID: string | null; JadwalID: number }
    | undefined;
  if (!row) throw new AppError("Tujuan ini tidak ditemukan.");

  let salesInvoiceId = row.SalesInvoiceID ? row.SalesInvoiceID.replace(/'/g, "").trim() : null;

  if (!salesInvoiceId && row.DeliveryOrderID) {
    const existingSiResult = await pool
      .request()
      .input("doId", sql.VarChar(16), row.DeliveryOrderID)
      .query(
        `SELECT SalesInvoiceID FROM SalesInvoice WHERE REPLACE(DeliveryOrderID, '''', '') = @doId AND IsDeleted = 0`
      );
    const existing = (existingSiResult.recordset[0] as { SalesInvoiceID: string } | undefined)?.SalesInvoiceID;
    if (existing) {
      salesInvoiceId = existing;
      await pool
        .request()
        .input("detailId", sql.Int, jadwalDetailId)
        .input("siId", sql.VarChar(16), existing)
        .query(`UPDATE DashboardPengirimanJadwalDetail SET SalesInvoiceID = @siId WHERE JadwalDetailID = @detailId`);
    }
  }

  if (!salesInvoiceId) throw new AppError("SI untuk tujuan ini belum terbit — jalankan Selesai Muat terlebih dahulu.");
  await enqueuePrintJob(pool, salesInvoiceId, row.JadwalID, true);
}
