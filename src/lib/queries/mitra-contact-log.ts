import { getPool, sql } from "@/lib/db";

export type ContactType = "Chat" | "Telepon";

export interface MitraContactLogEntry {
  LogID: number;
  BusinessPartnerID: string;
  LogDate: string;
  ContactType: ContactType;
  HasilPenawaran: string | null;
  AngkaPemesanan: number | null;
  AlasanTidakSesuai: string | null;
  CreatedByUserID: string;
  CreatedAt: string;
  ModifiedAt: string | null;
}

// Fetched lazily, one mitra+date at a time (both channels together, since
// they're cheap to fetch as a pair and the popover UI shows whichever the
// user clicked) — deliberately NOT bundled into MitraDOPanel's initial load,
// which would mean one row per mitra per visible date, easily thousands of
// rows nobody asked to see yet.
export async function getMitraContactLogForDate(
  businessPartnerId: string,
  dateISO: string
): Promise<MitraContactLogEntry[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessPartnerId", sql.VarChar(16), businessPartnerId)
    .input("logDate", sql.Date, new Date(dateISO))
    .query(`
      SELECT LogID, BusinessPartnerID, LogDate, ContactType, HasilPenawaran,
             AngkaPemesanan, AlasanTidakSesuai, CreatedByUserID, CreatedAt, ModifiedAt
      FROM DashboardMitraContactLog
      WHERE BusinessPartnerID = @businessPartnerId AND LogDate = @logDate
    `);
  return (result.recordset as (Omit<MitraContactLogEntry, "LogDate"> & { LogDate: Date })[]).map((r) => ({
    ...r,
    LogDate: r.LogDate.toISOString().slice(0, 10),
  }));
}

export interface MitraContactLogSummaryEntry {
  BusinessPartnerID: string;
  LogDate: string;
  ContactType: ContactType;
  AngkaPemesanan: number;
}

// Lightweight batch read for MitraDOPanel's always-visible "angka | %"
// readout under each DayChip's icons — unlike getMitraContactLogForDate this
// covers the WHOLE visible date range in one call, but only the 4 columns
// actually needed for that readout (no HasilPenawaran/AlasanTidakSesuai
// text, and AngkaPemesanan IS NULL rows are dropped since there's nothing to
// show for those). Still cheap even at scale: one row per mitra per date per
// channel that was actually filled in, not one per mitra per date that
// merely exists.
export async function getMitraContactLogSummaryForRange(
  startDateISO: string,
  endDateISO: string
): Promise<MitraContactLogSummaryEntry[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("startDate", sql.Date, new Date(startDateISO))
    .input("endDate", sql.Date, new Date(endDateISO)).query(`
      SELECT BusinessPartnerID, LogDate, ContactType, AngkaPemesanan
      FROM DashboardMitraContactLog
      WHERE LogDate >= @startDate AND LogDate < @endDate AND AngkaPemesanan IS NOT NULL
    `);
  return (
    result.recordset as (Omit<MitraContactLogSummaryEntry, "LogDate"> & { LogDate: Date })[]
  ).map((r) => ({ ...r, LogDate: r.LogDate.toISOString().slice(0, 10) }));
}

// Upsert on the (BusinessPartnerID, LogDate, ContactType) unique key — one
// note per channel per day, edited in place rather than accumulating an
// unbounded history, matching the "log the current situation for this date"
// intent (not a running chat transcript).
export async function saveMitraContactLog(input: {
  businessPartnerId: string;
  dateISO: string;
  contactType: ContactType;
  hasilPenawaran: string | null;
  angkaPemesanan: number | null;
  alasanTidakSesuai: string | null;
  userId: string;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("businessPartnerId", sql.VarChar(16), input.businessPartnerId)
    .input("logDate", sql.Date, new Date(input.dateISO))
    .input("contactType", sql.VarChar(10), input.contactType)
    .input("hasilPenawaran", sql.NVarChar(500), input.hasilPenawaran)
    .input("angkaPemesanan", sql.Decimal(18, 2), input.angkaPemesanan)
    .input("alasanTidakSesuai", sql.NVarChar(500), input.alasanTidakSesuai)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE DashboardMitraContactLog AS target
      USING (SELECT @businessPartnerId AS BusinessPartnerID, @logDate AS LogDate, @contactType AS ContactType) AS src
      ON target.BusinessPartnerID = src.BusinessPartnerID AND target.LogDate = src.LogDate AND target.ContactType = src.ContactType
      WHEN MATCHED THEN
        UPDATE SET HasilPenawaran = @hasilPenawaran, AngkaPemesanan = @angkaPemesanan,
                   AlasanTidakSesuai = @alasanTidakSesuai, ModifiedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (BusinessPartnerID, LogDate, ContactType, HasilPenawaran, AngkaPemesanan, AlasanTidakSesuai, CreatedByUserID)
        VALUES (@businessPartnerId, @logDate, @contactType, @hasilPenawaran, @angkaPemesanan, @alasanTidakSesuai, @userId);
    `);
}
