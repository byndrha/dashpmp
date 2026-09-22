import { getPool, sql } from "@/lib/db";

export interface MarketingVisitLogEntry {
  LogID: number;
  BusinessPartnerID: string;
  LogDate: string;
  HasilKunjungan: string | null;
  CreatedByUserID: string;
  CreatedAt: string;
  ModifiedAt: string | null;
  FotoTampakDepanPath: string | null;
  FotoPenagihanPath: string | null;
  Latitude: number | null;
  Longitude: number | null;
  IsTerverifikasi: boolean;
  // Diisi via GETDATE() (server MSSQL, UTC asli) — render dengan
  // formatDate/formatTime biasa, JANGAN formatDateWib/formatTimeWib
  // (lihat Review Focus plan ini).
  VerifiedAt: string | null;
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
      SELECT LogID, BusinessPartnerID, LogDate, HasilKunjungan, CreatedByUserID, CreatedAt, ModifiedAt,
             FotoTampakDepanPath, FotoPenagihanPath, Latitude, Longitude, IsTerverifikasi, VerifiedAt
      FROM DashboardMarketingVisitLog
      WHERE BusinessPartnerID = @businessPartnerId AND LogDate = @logDate
    `);
  const row = (result.recordset as (Omit<MarketingVisitLogEntry, "LogDate" | "VerifiedAt" | "IsTerverifikasi"> & {
    LogDate: Date;
    VerifiedAt: Date | null;
    IsTerverifikasi: boolean;
  })[])[0];
  if (!row) return null;
  return {
    ...row,
    LogDate: row.LogDate.toISOString().slice(0, 10),
    VerifiedAt: row.VerifiedAt ? row.VerifiedAt.toISOString() : null,
  };
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

// Ditulis HANYA oleh alur "Tambah Kunjungan" (GPS+foto+konfirmasi) — beda
// dari saveMarketingVisitLog di atas (jalur teks manual lama, MERGE-nya
// sengaja tidak menyentuh kolom di bawah ini sama sekali, lihat Global
// Constraints plan ini). Kalau tanggal ini sudah punya baris (misal ada
// catatan manual sebelumnya), upsert yang sama menimpa HasilKunjungan dan
// menambahkan foto+GPS+status terverifikasi ke baris itu.
export async function saveVerifiedKunjungan(input: {
  businessPartnerId: string;
  dateISO: string;
  hasilKunjungan: string;
  fotoTampakDepanPath: string;
  fotoPenagihanPath: string;
  latitude: number;
  longitude: number;
  userId: string;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("businessPartnerId", sql.VarChar(16), input.businessPartnerId)
    .input("logDate", sql.Date, new Date(input.dateISO))
    .input("hasilKunjungan", sql.NVarChar(500), input.hasilKunjungan)
    .input("fotoDepan", sql.VarChar(512), input.fotoTampakDepanPath)
    .input("fotoPenagihan", sql.VarChar(512), input.fotoPenagihanPath)
    .input("lat", sql.Decimal(10, 7), input.latitude)
    .input("lng", sql.Decimal(10, 7), input.longitude)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE DashboardMarketingVisitLog AS target
      USING (SELECT @businessPartnerId AS BusinessPartnerID, @logDate AS LogDate) AS src
      ON target.BusinessPartnerID = src.BusinessPartnerID AND target.LogDate = src.LogDate
      WHEN MATCHED THEN
        UPDATE SET
          HasilKunjungan = @hasilKunjungan,
          FotoTampakDepanPath = @fotoDepan,
          FotoPenagihanPath = @fotoPenagihan,
          Latitude = @lat,
          Longitude = @lng,
          IsTerverifikasi = 1,
          VerifiedAt = GETDATE(),
          ModifiedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (BusinessPartnerID, LogDate, HasilKunjungan, FotoTampakDepanPath, FotoPenagihanPath, Latitude, Longitude, IsTerverifikasi, VerifiedAt, CreatedByUserID)
        VALUES (@businessPartnerId, @logDate, @hasilKunjungan, @fotoDepan, @fotoPenagihan, @lat, @lng, 1, GETDATE(), @userId);
    `);
}

// Semua entri (baik terverifikasi maupun catatan manual) untuk satu mitra,
// terbaru dulu — dipakai dialog "Riwayat Kunjungan" (Task 8). Baris dengan
// HasilKunjungan kosong (upsert lama yang pernah menyimpan textarea
// kosong) dikecualikan, KECUALI baris itu sudah terverifikasi
// (IsTerverifikasi = 1) — kalau tidak, mengosongkan teks lewat jalur manual
// lama (saveMarketingVisitLog, yang sengaja tidak menyentuh
// IsTerverifikasi/foto/GPS) akan membuat entri itu hilang dari Riwayat
// Kunjungan walau foto+GPS+status terverifikasi masih utuh di DB (final
// review Finding 1). ISNULL(...) menjaga perbandingan blank-nya tetap aman
// dari NULL (LTRIM(RTRIM(NULL)) <> '' bernilai NULL/falsy di SQL Server,
// yang tanpa ISNULL bisa ikut mengecualikan baris terverifikasi dengan
// HasilKunjungan NULL, bukan cuma string kosong).
export async function getVisitLogHistoryForMitra(businessPartnerId: string): Promise<MarketingVisitLogEntry[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessPartnerId", sql.VarChar(16), businessPartnerId)
    .query(`
      SELECT LogID, BusinessPartnerID, LogDate, HasilKunjungan, CreatedByUserID, CreatedAt, ModifiedAt,
             FotoTampakDepanPath, FotoPenagihanPath, Latitude, Longitude, IsTerverifikasi, VerifiedAt
      FROM DashboardMarketingVisitLog
      WHERE BusinessPartnerID = @businessPartnerId
        AND (LTRIM(RTRIM(ISNULL(HasilKunjungan, ''))) <> '' OR IsTerverifikasi = 1)
      ORDER BY LogDate DESC
    `);
  return (result.recordset as (Omit<MarketingVisitLogEntry, "LogDate" | "VerifiedAt" | "IsTerverifikasi"> & {
    LogDate: Date;
    VerifiedAt: Date | null;
    IsTerverifikasi: boolean;
  })[]).map((row) => ({
    ...row,
    LogDate: row.LogDate.toISOString().slice(0, 10),
    VerifiedAt: row.VerifiedAt ? row.VerifiedAt.toISOString() : null,
  }));
}

// Cuplikan HasilKunjungan TERBARU per mitra (baik terverifikasi maupun
// manual) untuk sekumpulan mitra sekaligus — satu query untuk seluruh
// panel Piutang Tertinggi, bukan N query per baris.
export async function getLatestVisitLogSnippets(
  businessPartnerIds: string[]
): Promise<Map<string, { hasilKunjungan: string; logDate: string }>> {
  if (businessPartnerIds.length === 0) return new Map();
  const pool = await getPool();
  const request = pool.request();
  const idParams = businessPartnerIds.map((id, i) => {
    const name = `id${i}`;
    request.input(name, sql.VarChar(16), id);
    return `@${name}`;
  });
  // Same NULL-safe "blank OR verified" gate as getVisitLogHistoryForMitra —
  // a verified-but-blank row must still count as this mitra's latest entry,
  // not be skipped in favor of an older row that happens to have text
  // (final review Finding 1).
  const result = await request.query(`
    SELECT v.BusinessPartnerID, v.HasilKunjungan, v.LogDate
    FROM DashboardMarketingVisitLog v
    INNER JOIN (
      SELECT BusinessPartnerID, MAX(LogDate) AS MaxLogDate
      FROM DashboardMarketingVisitLog
      WHERE BusinessPartnerID IN (${idParams.join(", ")})
        AND (LTRIM(RTRIM(ISNULL(HasilKunjungan, ''))) <> '' OR IsTerverifikasi = 1)
      GROUP BY BusinessPartnerID
    ) latest ON latest.BusinessPartnerID = v.BusinessPartnerID AND latest.MaxLogDate = v.LogDate
  `);
  const map = new Map<string, { hasilKunjungan: string; logDate: string }>();
  for (const r of result.recordset as { BusinessPartnerID: string; HasilKunjungan: string | null; LogDate: Date }[]) {
    map.set(r.BusinessPartnerID, { hasilKunjungan: r.HasilKunjungan ?? "", logDate: r.LogDate.toISOString().slice(0, 10) });
  }
  return map;
}
