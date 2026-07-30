import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";
import { PARTNER_TYPE_CASE } from "@/lib/queries/aging";
import type { PartnerType } from "@/types/dashboard";
import type { PiutangStatus } from "@/lib/queries/aging";

export interface CollectionPriorityRow {
  BusinessPartnerID: string;
  CustomerName: string;
  PartnerType: PartnerType;
  Wilayah: string;
  Kecamatan: string | null;
  PiutangAwal: number;
  PiutangBerjalan: number;
  // Days since the oldest still-unpaid invoice's DueDate — same figure
  // Status buckets off, exposed directly for panels that need the raw
  // number (e.g. Beranda's Top 10 Mitra Piutang "Outstanding Day").
  MaxDaysOverdue: number | null;
  TargetAmount: number | null;
  // mssql returns a DATETIME column as a real Date instance, which survives
  // Server->Client Component serialization as a Date (not auto-stringified)
  // — this is only a string right after a plain JSON round-trip (e.g. a
  // server action's return value), never straight off this query's
  // recordset.
  TargetDate: string | Date | null;
  TargetNote: string | null;
  AvgQtyPerOrderDay: number | null;
  TerakhirPesan: string | null;
  TerakhirBayar: string | null;
  Omzet: number;
  Status: PiutangStatus;
  Tren: "Naik" | "Turun" | "Stabil";
  Rotasi: number | null;
  IsTarget: boolean;
}

export async function getCollectionPriority(): Promise<CollectionPriorityRow[]> {
  const pool = await getPool();
  // Built with monthBoundary()'s plain UTC arithmetic, not date-fns'
  // startOfMonth/subMonths on a raw `new Date()` — those construct *local*
  // midnight, and once sent to SQL Server as a `DATE` parameter (which mssql
  // serializes via UTC components), a host running in a positive-UTC-offset
  // timezone silently shifts the boundary back one calendar day. Same bug
  // already found and fixed in sales-overview.ts / revenue-target.ts.
  const businessToday = getBusinessDate();
  const thisMonthStart = monthBoundary(businessToday);
  const lastMonthStart = monthBoundary(businessToday, -1);

  // A genuinely heavy report query even after optimization (multi-CTE
  // aggregation over vCustomerStatement/SalesOrder/SalesPayment, ~35-40s
  // measured against real production data) — routinely bumps into the
  // pool's global 40s requestTimeout (db.ts). Overridden here rather than
  // raising the global default, so every OTHER (fast) query in the app
  // keeps failing fast on a genuine hang instead of waiting 90s too.
  // ConnectionPool.request(conf) DOES accept a per-request
  // {requestTimeout} override at runtime (confirmed in the installed
  // mssql package's own source/JSDoc) — the @types/mssql version bundled
  // here just hasn't caught up to declare it, hence the cast. .call(pool, …)
  // — not a bare invocation — since request() relies on `this` internally.
  const requestWithTimeout = pool.request as unknown as (conf?: { requestTimeout?: number }) => sql.Request;
  const result = await requestWithTimeout
    .call(pool, { requestTimeout: 90000 })
    .input("periodStart", sql.Date, thisMonthStart)
    .input("thisMonthStart", sql.Date, thisMonthStart)
    .input("lastMonthStart", sql.Date, lastMonthStart)
    .query(`
    -- vCustomerStatement is expensive to scan (~6-7s alone, confirmed via
    -- isolated timing). The original version scanned it TWICE (once
    -- unfiltered for the current balance, once filtered by TransDate for
    -- the period-start balance) — combined with OrderStats/PaymentStats
    -- below, that regularly exceeded this app's 40s DB request timeout.
    -- Folding both balances into one conditional-SUM pass as a CTE was NOT
    -- enough on its own (confirmed by timing: isolated pieces summed to
    -- ~13s, but the full combined query still took ~40s) — SQL Server
    -- doesn't guarantee a CTE referenced from two different downstream CTEs
    -- gets materialized only once, so the scan could still effectively
    -- happen twice once inlined into the bigger query. A real #temp table
    -- forces a single, genuine materialization instead.
    SELECT SalesInvoiceID,
           SUM(Netto) AS Netto, SUM(Deposit) AS Deposit, SUM(Paid) AS Paid, SUM(OtherPayment) AS OtherPayment,
           SUM(CASE WHEN TransDate < @periodStart THEN Netto ELSE 0 END) AS NettoAwal,
           SUM(CASE WHEN TransDate < @periodStart THEN Deposit ELSE 0 END) AS DepositAwal,
           SUM(CASE WHEN TransDate < @periodStart THEN Paid ELSE 0 END) AS PaidAwal,
           SUM(CASE WHEN TransDate < @periodStart THEN OtherPayment ELSE 0 END) AS OtherPaymentAwal
    INTO #StatementAgg
    FROM vCustomerStatement
    GROUP BY SalesInvoiceID;

    WITH InvoiceBalance AS (
        SELECT si.SalesInvoiceID, si.BusinessPartnerID, si.DueDate,
               (sa.Netto - sa.Paid - sa.Deposit - sa.OtherPayment) AS Outstanding
        FROM #StatementAgg sa
        JOIN SalesInvoice si ON si.SalesInvoiceID = sa.SalesInvoiceID
        WHERE si.IsDeleted = 0
    ),
    InvoiceBalanceAsOfPeriodStart AS (
        SELECT si.SalesInvoiceID, si.BusinessPartnerID,
               (sa.NettoAwal - sa.PaidAwal - sa.DepositAwal - sa.OtherPaymentAwal) AS Outstanding
        FROM #StatementAgg sa
        JOIN SalesInvoice si ON si.SalesInvoiceID = sa.SalesInvoiceID
        WHERE si.IsDeleted = 0
    ),
    MitraBalance AS (
        SELECT BusinessPartnerID,
               SUM(CASE WHEN Outstanding > 0 THEN Outstanding ELSE 0 END) AS PiutangBerjalan,
               MAX(CASE WHEN Outstanding > 0 THEN DATEDIFF(DAY, DueDate, GETDATE()) END) AS MaxDaysOverdue
        FROM InvoiceBalance
        GROUP BY BusinessPartnerID
    ),
    MitraBalanceAwal AS (
        SELECT BusinessPartnerID,
               SUM(CASE WHEN Outstanding > 0 THEN Outstanding ELSE 0 END) AS PiutangAwal
        FROM InvoiceBalanceAsOfPeriodStart
        GROUP BY BusinessPartnerID
    ),
    OrderStats AS (
        SELECT so.BusinessPartnerID,
               SUM(sod.Qty) / NULLIF(COUNT(DISTINCT CAST(so.TransDate AS DATE)), 0) AS AvgQtyPerOrderDay,
               MAX(so.TransDate) AS TerakhirPesan
        FROM SalesOrder so
        JOIN SalesOrderDetail sod ON sod.SalesOrderID = so.SalesOrderID
        WHERE so.IsDeleted = 0
        GROUP BY so.BusinessPartnerID
    ),
    PaymentStats AS (
        SELECT BusinessPartnerID,
               SUM(Amount) AS Omzet,
               MAX(TransDate) AS TerakhirBayar,
               SUM(CASE WHEN TransDate >= @thisMonthStart THEN Amount ELSE 0 END) AS BayarBulanIni,
               SUM(CASE WHEN TransDate >= @lastMonthStart AND TransDate < @thisMonthStart THEN Amount ELSE 0 END) AS BayarBulanLalu
        FROM SalesPayment
        WHERE IsDeleted = 0
        GROUP BY BusinessPartnerID
    )
    SELECT
        bp.BusinessPartnerID,
        bp.Name AS CustomerName,
        ${PARTNER_TYPE_CASE} AS PartnerType,
        ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
        bp.NPWPAddress AS Kecamatan,
        ISNULL(ba.PiutangAwal, 0) AS PiutangAwal,
        mb.PiutangBerjalan,
        mb.MaxDaysOverdue,
        ct.TargetAmount,
        ct.TargetDate,
        ct.Note AS TargetNote,
        os.AvgQtyPerOrderDay,
        os.TerakhirPesan,
        ps.TerakhirBayar,
        ISNULL(ps.Omzet, 0) AS Omzet,
        CASE
            WHEN mb.MaxDaysOverdue IS NULL OR mb.MaxDaysOverdue <= 30 THEN 'Sehat'
            WHEN mb.MaxDaysOverdue <= 60 THEN 'Perhatian'
            ELSE 'Kritis'
        END AS Status,
        CASE
            WHEN ISNULL(ps.BayarBulanIni, 0) > ISNULL(ps.BayarBulanLalu, 0) THEN 'Naik'
            WHEN ISNULL(ps.BayarBulanIni, 0) < ISNULL(ps.BayarBulanLalu, 0) THEN 'Turun'
            ELSE 'Stabil'
        END AS Tren,
        CASE
            WHEN os.TerakhirPesan IS NOT NULL AND ps.TerakhirBayar IS NOT NULL
            THEN DATEDIFF(DAY, ps.TerakhirBayar, os.TerakhirPesan)
        END AS Rotasi,
        CASE WHEN ct.BusinessPartnerID IS NOT NULL THEN 1 ELSE 0 END AS IsTarget
    FROM MitraBalance mb
    JOIN BusinessPartner bp ON bp.BusinessPartnerID = mb.BusinessPartnerID
    LEFT JOIN MitraBalanceAwal ba ON ba.BusinessPartnerID = mb.BusinessPartnerID
    LEFT JOIN OrderStats os ON os.BusinessPartnerID = mb.BusinessPartnerID
    LEFT JOIN PaymentStats ps ON ps.BusinessPartnerID = mb.BusinessPartnerID
    LEFT JOIN DashboardCollectionTarget ct ON ct.BusinessPartnerID = mb.BusinessPartnerID
    WHERE mb.PiutangBerjalan > 0
    ORDER BY mb.PiutangBerjalan DESC;

    DROP TABLE #StatementAgg;
  `);

  return result.recordset.map((r) => ({ ...r, IsTarget: Boolean(r.IsTarget) }));
}

export async function setCollectionTarget(input: {
  businessPartnerId: string;
  targetDate: string | null;
  targetAmount: number | null;
  note: string | null;
  userId: string;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("businessPartnerId", sql.VarChar(16), input.businessPartnerId)
    .input("targetDate", sql.DateTime, input.targetDate)
    .input("targetAmount", sql.Decimal(23, 4), input.targetAmount)
    .input("note", sql.VarChar(256), input.note)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE DashboardCollectionTarget AS target
      USING (SELECT @businessPartnerId AS BusinessPartnerID) AS src
      ON target.BusinessPartnerID = src.BusinessPartnerID
      WHEN MATCHED THEN
        UPDATE SET TargetDate = @targetDate, TargetAmount = @targetAmount, Note = @note, UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (BusinessPartnerID, TargetDate, TargetAmount, Note, CreatedByUserID)
        VALUES (@businessPartnerId, @targetDate, @targetAmount, @note, @userId);
    `);
}

// Upserts ONLY the Note column — unlike setCollectionTarget() above, this
// never touches TargetDate/TargetAmount, so a quick note added from
// Beranda's Top 10 panel can't silently wipe out a target already set from
// the Aging module's "Target Pelunasan" dialog on the same mitra.
export async function setMitraNote(businessPartnerId: string, note: string | null, userId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("businessPartnerId", sql.VarChar(16), businessPartnerId)
    .input("note", sql.VarChar(256), note)
    .input("userId", sql.VarChar(16), userId).query(`
      MERGE DashboardCollectionTarget AS target
      USING (SELECT @businessPartnerId AS BusinessPartnerID) AS src
      ON target.BusinessPartnerID = src.BusinessPartnerID
      WHEN MATCHED THEN
        UPDATE SET Note = @note, UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (BusinessPartnerID, Note, CreatedByUserID)
        VALUES (@businessPartnerId, @note, @userId);
    `);
}

export async function removeCollectionTarget(businessPartnerId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("businessPartnerId", sql.VarChar(16), businessPartnerId)
    .query(`DELETE FROM DashboardCollectionTarget WHERE BusinessPartnerID = @businessPartnerId`);
}
