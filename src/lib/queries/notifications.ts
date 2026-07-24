import { getPool, sql } from "@/lib/db";
import { canView, type ModuleKey, type PermissionMap } from "@/lib/permissions";

export type NotificationType = "PengajuanMitraBaru" | "SOBaru" | "SITerbayar";

export interface NewNotificationInput {
  type: NotificationType;
  targetModuleKey: ModuleKey;
  title: string;
  message: string;
  linkUrl: string;
  sourceType: NotificationType;
  sourceId: string;
}

// Shape published on the event bus and streamed over SSE — same fields as
// NotificationRow minus IsRead, since a freshly-inserted notification is by
// definition unread for everyone.
export interface NotificationEvent {
  NotificationID: number;
  Type: NotificationType;
  TargetModuleKey: ModuleKey;
  Title: string;
  Message: string;
  LinkUrl: string;
  CreatedAt: string;
}

export interface NotificationRow extends NotificationEvent {
  IsRead: boolean;
}

// SQL Server's number for a UNIQUE CONSTRAINT/INDEX violation — the
// UQ_DashboardNotification_Source dedup guard raises this when a scan tick
// re-examines a (SourceType, SourceID) pair it already turned into a
// notification (e.g. a timestamp tie at a scan-window boundary). Expected,
// not exceptional: swallow it rather than let it surface as a scan failure.
const SQL_UNIQUE_VIOLATION_NUMBERS = new Set([2627, 2601]);

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "number" in err &&
    SQL_UNIQUE_VIOLATION_NUMBERS.has((err as { number: number }).number)
  );
}

// Inserts a new notification row, returning the created event (for
// publishing on the event bus) or null if this (sourceType, sourceId) pair
// was already recorded — a no-op, not an error.
export async function insertNotification(input: NewNotificationInput): Promise<NotificationEvent | null> {
  const pool = await getPool();
  try {
    const result = await pool
      .request()
      .input("type", sql.VarChar(32), input.type)
      .input("targetModuleKey", sql.VarChar(32), input.targetModuleKey)
      .input("title", sql.VarChar(200), input.title)
      .input("message", sql.VarChar(400), input.message)
      .input("linkUrl", sql.VarChar(200), input.linkUrl)
      .input("sourceType", sql.VarChar(32), input.sourceType)
      .input("sourceId", sql.VarChar(64), input.sourceId).query(`
        INSERT INTO DashboardNotification (Type, TargetModuleKey, Title, Message, LinkUrl, SourceType, SourceID)
        OUTPUT inserted.NotificationID, inserted.CreatedAt
        VALUES (@type, @targetModuleKey, @title, @message, @linkUrl, @sourceType, @sourceId)
      `);
    const row = result.recordset[0] as { NotificationID: number; CreatedAt: Date };
    return {
      NotificationID: row.NotificationID,
      Type: input.type,
      TargetModuleKey: input.targetModuleKey,
      Title: input.title,
      Message: input.message,
      LinkUrl: input.linkUrl,
      CreatedAt: row.CreatedAt.toISOString(),
    };
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function getScanState(sourceType: NotificationType): Promise<Date> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("sourceType", sql.VarChar(32), sourceType)
    .query(`SELECT LastScannedAt FROM DashboardNotificationScanState WHERE SourceType = @sourceType`);
  const row = result.recordset[0] as { LastScannedAt: Date } | undefined;
  if (!row) throw new Error(`No scan state seeded for source type ${sourceType} — run the Task 0 migration.`);
  return row.LastScannedAt;
}

export async function advanceScanState(sourceType: NotificationType, to: Date): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("sourceType", sql.VarChar(32), sourceType)
    .input("to", sql.DateTime, to)
    .query(`UPDATE DashboardNotificationScanState SET LastScannedAt = @to WHERE SourceType = @sourceType`);
}

export async function scanPengajuanMitraBaru(since: Date, until: Date): Promise<NewNotificationInput[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("since", sql.DateTime, since)
    .input("until", sql.DateTime, until).query(`
      SELECT PengajuanID, NamaCalon
      FROM DashboardMitraPengajuan
      WHERE CreatedAt > @since AND CreatedAt <= @until
    `);
  return (result.recordset as { PengajuanID: number; NamaCalon: string }[]).map((row) => ({
    type: "PengajuanMitraBaru",
    targetModuleKey: "pemasaran",
    title: "Pengajuan Mitra Baru",
    message: row.NamaCalon,
    linkUrl: "/pemasaran",
    sourceType: "PengajuanMitraBaru",
    sourceId: String(row.PengajuanID),
  }));
}

export async function scanSOBaru(since: Date, until: Date): Promise<NewNotificationInput[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("since", sql.DateTime, since)
    .input("until", sql.DateTime, until).query(`
      SELECT so.SalesOrderID, so.VoucherNo, bp.Name
      FROM SalesOrder so
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
      WHERE so.IsDeleted = 0 AND so.TransDate > @since AND so.TransDate <= @until
    `);
  return (result.recordset as { SalesOrderID: string; VoucherNo: string; Name: string | null }[]).map((row) => ({
    type: "SOBaru",
    targetModuleKey: "transaksi",
    title: "SO Baru",
    message: `${row.Name ?? "Tanpa Nama"} · ${row.VoucherNo}`,
    linkUrl: "/transaksi",
    sourceType: "SOBaru",
    sourceId: row.SalesOrderID,
  }));
}

export async function scanSITerbayar(since: Date, until: Date): Promise<NewNotificationInput[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("since", sql.DateTime, since)
    .input("until", sql.DateTime, until).query(`
      SELECT sp.SalesPaymentID, sp.VoucherNo AS SPVoucherNo, si.SalesInvoiceID, si.VoucherNo AS SIVoucherNo, bp.Name
      FROM SalesPayment sp
      JOIN SalesPaymentDetail spd ON spd.SalesPaymentID = sp.SalesPaymentID AND spd.IsDeleted = 0
      JOIN SalesInvoice si ON si.SalesInvoiceID = spd.SalesInvoiceID AND si.IsDeleted = 0
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
      WHERE sp.IsDeleted = 0 AND sp.TransDate > @since AND sp.TransDate <= @until
        AND si.Netto > 0 AND si.Paid >= si.Netto
    `);
  return (
    result.recordset as {
      SalesPaymentID: string;
      SPVoucherNo: string;
      SalesInvoiceID: string;
      SIVoucherNo: string;
      Name: string | null;
    }[]
  ).map((row) => ({
    type: "SITerbayar",
    targetModuleKey: "transaksi",
    title: "SI Terbayar",
    message: `${row.Name ?? "Tanpa Nama"} · ${row.SIVoucherNo} lunas via ${row.SPVoucherNo}`,
    linkUrl: "/transaksi",
    sourceType: "SITerbayar",
    sourceId: `${row.SalesPaymentID}:${row.SalesInvoiceID}`,
  }));
}

// permissions filtering happens here (in JS, on the already-fetched rows)
// rather than in the SQL WHERE clause — PermissionMap is a JWT-derived
// object with no DB-side representation to join against, the same reason
// canView() is applied in JS everywhere else it's used in this codebase.
export async function getNotificationsForUser(userId: number, permissions: PermissionMap): Promise<NotificationRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("userId", sql.Int, userId).query(`
      SELECT n.NotificationID, n.Type, n.TargetModuleKey, n.Title, n.Message, n.LinkUrl, n.CreatedAt,
             CASE WHEN r.UserID IS NOT NULL THEN 1 ELSE 0 END AS IsRead
      FROM DashboardNotification n
      LEFT JOIN DashboardNotificationRead r ON r.NotificationID = n.NotificationID AND r.UserID = @userId
      WHERE n.CreatedAt > DATEADD(DAY, -30, GETDATE())
      ORDER BY n.CreatedAt DESC
    `);
  return (
    result.recordset as {
      NotificationID: number;
      Type: NotificationType;
      TargetModuleKey: ModuleKey;
      Title: string;
      Message: string;
      LinkUrl: string;
      CreatedAt: Date;
      IsRead: number;
    }[]
  )
    .filter((row) => canView(permissions, row.TargetModuleKey))
    .map((row) => ({
      NotificationID: row.NotificationID,
      Type: row.Type,
      TargetModuleKey: row.TargetModuleKey,
      Title: row.Title,
      Message: row.Message,
      LinkUrl: row.LinkUrl,
      CreatedAt: row.CreatedAt.toISOString(),
      IsRead: row.IsRead === 1,
    }));
}

export async function markNotificationRead(notificationId: number, userId: number): Promise<void> {
  const pool = await getPool();
  try {
    await pool
      .request()
      .input("notificationId", sql.Int, notificationId)
      .input("userId", sql.Int, userId)
      .query(`INSERT INTO DashboardNotificationRead (NotificationID, UserID) VALUES (@notificationId, @userId)`);
  } catch (err) {
    // Already marked read (PK violation on a repeat click) — a no-op, not
    // an error, same dedup discipline as insertNotification above.
    if (!isUniqueViolation(err)) throw err;
  }
}
