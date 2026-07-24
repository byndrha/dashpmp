import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";
import { getCollectionPriority } from "@/lib/queries/collection-priority";

const TOP_N = 10;

export interface TopMitraPiutangRow {
  BusinessPartnerID: string;
  CustomerName: string;
  NominalPiutang: number;
  // Days since the oldest still-unpaid invoice's DueDate — null when
  // somehow no overdue invoice exists despite PiutangBerjalan > 0.
  OutstandingDay: number | null;
  // Piutang ÷ Omzet (total SalesPayment received) — null when Omzet is 0
  // (division by zero), not the same as 0%.
  RasioPiutangPct: number | null;
  // DO qty per elapsed day this business month — same definition as the
  // "Rata-rata" figure on Transaksi's "Transaksi DO per Mitra" panel.
  AvgDOPerHari: number;
  DOTerakhir: string | Date | null;
  TerakhirPembayaran: string | Date | null;
}

// Top 10 mitra by outstanding piutang (getCollectionPriority() already
// returns rows ORDER BY PiutangBerjalan DESC), enriched with DO-side metrics
// scoped to just those 10 BusinessPartnerIDs — cheaper than computing DO
// stats for every mitra when only the top 10 are ever shown.
export async function getTopMitraPiutang(): Promise<TopMitraPiutangRow[]> {
  const priority = await getCollectionPriority();
  const top = priority.slice(0, TOP_N);
  if (top.length === 0) return [];

  const pool = await getPool();
  const businessToday = getBusinessDate();
  const monthStart = monthBoundary(businessToday);
  const daysElapsed = businessToday.getUTCDate();

  const request = pool.request().input("monthStart", sql.Date, monthStart);
  const idParams = top.map((r, i) => {
    const name = `id${i}`;
    request.input(name, sql.VarChar(16), r.BusinessPartnerID);
    return `@${name}`;
  });

  const doResult = await request.query(`
    SELECT do_.BusinessPartnerID,
           SUM(CASE WHEN do_.TransDate >= @monthStart THEN dod.Delivered ELSE 0 END) AS MonthQty,
           MAX(do_.TransDate) AS DOTerakhir
    FROM DeliveryOrder do_
    JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
    WHERE do_.IsDeleted = 0
      AND do_.BusinessPartnerID IN (${idParams.join(", ")})
    GROUP BY do_.BusinessPartnerID
  `);

  const doByPartner = new Map(
    (doResult.recordset as { BusinessPartnerID: string; MonthQty: number; DOTerakhir: string | Date | null }[]).map(
      (r) => [r.BusinessPartnerID, r]
    )
  );

  return top.map((r) => {
    const doRow = doByPartner.get(r.BusinessPartnerID);
    return {
      BusinessPartnerID: r.BusinessPartnerID,
      CustomerName: r.CustomerName,
      NominalPiutang: r.PiutangBerjalan,
      OutstandingDay: r.MaxDaysOverdue,
      RasioPiutangPct: r.Omzet ? (r.PiutangBerjalan / r.Omzet) * 100 : null,
      AvgDOPerHari: doRow && daysElapsed ? doRow.MonthQty / daysElapsed : 0,
      DOTerakhir: doRow?.DOTerakhir ?? null,
      TerakhirPembayaran: r.TerakhirBayar,
    };
  });
}
