import { getPool, sql } from "@/lib/db";

export interface MarketingVisitLogEntry {
  LogID: number;
  BusinessPartnerID: string;
  LogDate: string;
  HasilKunjungan: string | null;
  CreatedByUserID: string;
  CreatedAt: string;
  ModifiedAt: string | null;
}

// Same lazy, one-mitra-one-date shape as mitra-contact-log.ts's Transaksi
// counterpart, but for a Marketing's own visit notes rather than a
// order-negotiation log — fetched only when the icon under a mitra's date
// cell in Kinerja Marketing is actually clicked.
export async function getMarketingVisitLogForDate(
  businessPartnerId: string,
  dateISO: string
): Promise<MarketingVisitLogEntry | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessPartnerId", sql.VarChar(16), businessPartnerId)
    .input("logDate", sql.Date, new Date(dateISO))
    .query(`
      SELECT LogID, BusinessPartnerID, LogDate, HasilKunjungan, CreatedByUserID, CreatedAt, ModifiedAt
      FROM DashboardMarketingVisitLog
      WHERE BusinessPartnerID = @businessPartnerId AND LogDate = @logDate
    `);
  const row = (result.recordset as (Omit<MarketingVisitLogEntry, "LogDate"> & { LogDate: Date })[])[0];
  if (!row) return null;
  return { ...row, LogDate: row.LogDate.toISOString().slice(0, 10) };
}

// Upsert on (BusinessPartnerID, LogDate) — one visit note per mitra per day,
// edited in place rather than an unbounded history.
export async function saveMarketingVisitLog(input: {
  businessPartnerId: string;
  dateISO: string;
  hasilKunjungan: string | null;
  userId: string;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("businessPartnerId", sql.VarChar(16), input.businessPartnerId)
    .input("logDate", sql.Date, new Date(input.dateISO))
    .input("hasilKunjungan", sql.NVarChar(500), input.hasilKunjungan)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE DashboardMarketingVisitLog AS target
      USING (SELECT @businessPartnerId AS BusinessPartnerID, @logDate AS LogDate) AS src
      ON target.BusinessPartnerID = src.BusinessPartnerID AND target.LogDate = src.LogDate
      WHEN MATCHED THEN
        UPDATE SET HasilKunjungan = @hasilKunjungan, ModifiedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (BusinessPartnerID, LogDate, HasilKunjungan, CreatedByUserID)
        VALUES (@businessPartnerId, @logDate, @hasilKunjungan, @userId);
    `);
}
