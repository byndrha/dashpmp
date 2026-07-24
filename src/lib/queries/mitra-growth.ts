import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";

export type MitraGrowthType = "Agen" | "Retail" | "TakeAway" | "RPA";

export interface MitraGrowthCell {
  total: number;
  newThisMonth: number;
  newLastMonth: number;
}

export interface MitraGrowthRow {
  wilayah: string;
  agen: MitraGrowthCell;
  retail: MitraGrowthCell;
  takeaway: MitraGrowthCell;
  rpa: MitraGrowthCell;
  total: MitraGrowthCell;
}

const EMPTY_CELL: MitraGrowthCell = { total: 0, newThisMonth: 0, newLastMonth: 0 };

function addCell(a: MitraGrowthCell, b: MitraGrowthCell): MitraGrowthCell {
  return {
    total: a.total + b.total,
    newThisMonth: a.newThisMonth + b.newThisMonth,
    newLastMonth: a.newLastMonth + b.newLastMonth,
  };
}

// Classification here is deliberately local to this panel, NOT the shared
// PARTNER_TYPE_CASE in aging.ts. "RPA" (mitra whose Name starts with "RPA")
// is a new business-development category requested specifically for this
// Mitra-growth panel — folding it into the app-wide PartnerType would
// silently reclassify those mitra's badge/type everywhere else (Aging,
// Sales, Mitra list badges, Pengajuan auto-SO rules), which was explicitly
// out of scope. Mitra that fall into none of the 4 requested types (blank
// Gender, not TakeAway, not RPA-named — "Lainnya" in the shared CASE) are
// excluded from this table entirely, matching the 4 types asked for.
const GROWTH_TYPE_CASE = `
  CASE
    WHEN bp.Name LIKE 'RPA%' THEN 'RPA'
    WHEN bp.SalesmanID = '0127' THEN 'TakeAway'
    WHEN bp.Gender = 'Female' THEN 'Retail'
    WHEN bp.Gender = 'Male' THEN 'Agen'
    ELSE NULL
  END
`;

interface RawRow {
  Wilayah: string;
  PartnerType: MitraGrowthType | null;
  Total: number;
  NewThisMonth: number;
  NewLastMonth: number;
}

// "Bulan ini" / "bulan lalu" here mean newly-joined mitra (JoinDate within
// that month) — mitra growth/acquisition, not a running cumulative total.
// `total` per cell IS the cumulative count (as of today), shown alongside
// the new-this-month/new-last-month pair so both readings are visible at
// once, per explicit request.
export async function getMitraGrowthByWilayah(): Promise<MitraGrowthRow[]> {
  const pool = await getPool();
  const businessToday = getBusinessDate();
  const thisMonthStart = monthBoundary(businessToday);
  const lastMonthStart = monthBoundary(businessToday, -1);

  const result = await pool
    .request()
    .input("thisMonthStart", sql.Date, thisMonthStart)
    .input("lastMonthStart", sql.Date, lastMonthStart)
    .query(`
      SELECT
          ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          ${GROWTH_TYPE_CASE} AS PartnerType,
          COUNT(*) AS Total,
          SUM(CASE WHEN bp.JoinDate >= @thisMonthStart THEN 1 ELSE 0 END) AS NewThisMonth,
          SUM(CASE WHEN bp.JoinDate >= @lastMonthStart AND bp.JoinDate < @thisMonthStart THEN 1 ELSE 0 END) AS NewLastMonth
      FROM BusinessPartner bp
      WHERE ISNULL(bp.IsDeleted, 0) = 0
      GROUP BY
          ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui'),
          ${GROWTH_TYPE_CASE}
    `);

  const rows = (result.recordset as RawRow[]).filter(
    (r): r is RawRow & { PartnerType: MitraGrowthType } => r.PartnerType != null
  );

  const byWilayah = new Map<string, MitraGrowthRow>();
  for (const r of rows) {
    let entry = byWilayah.get(r.Wilayah);
    if (!entry) {
      entry = {
        wilayah: r.Wilayah,
        agen: EMPTY_CELL,
        retail: EMPTY_CELL,
        takeaway: EMPTY_CELL,
        rpa: EMPTY_CELL,
        total: EMPTY_CELL,
      };
      byWilayah.set(r.Wilayah, entry);
    }
    const cell: MitraGrowthCell = { total: r.Total, newThisMonth: r.NewThisMonth, newLastMonth: r.NewLastMonth };
    if (r.PartnerType === "Agen") entry.agen = cell;
    else if (r.PartnerType === "Retail") entry.retail = cell;
    else if (r.PartnerType === "TakeAway") entry.takeaway = cell;
    else entry.rpa = cell;
    entry.total = addCell(entry.total, cell);
  }

  return [...byWilayah.values()].sort((a, b) => a.wilayah.localeCompare(b.wilayah));
}
