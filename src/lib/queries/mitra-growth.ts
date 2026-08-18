import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";
import { PARTNER_TYPE_CASE } from "@/lib/queries/aging";
import type { PartnerType } from "@/types/dashboard";

export interface MitraGrowthCell {
  total: number;
  newThisMonth: number;
  newLastMonth: number;
}

export interface MitraGrowthRow {
  wilayah: string;
  agen: MitraGrowthCell;
  outlet: MitraGrowthCell;
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

interface RawRow {
  Wilayah: string;
  PartnerType: PartnerType;
  Total: number;
  NewThisMonth: number;
  NewLastMonth: number;
}

// "Bulan ini" / "bulan lalu" here mean newly-joined mitra (JoinDate within
// that month) — mitra growth/acquisition, not a running cumulative total.
// `total` per cell IS the cumulative count (as of today), shown alongside
// the new-this-month/new-last-month pair so both readings are visible at
// once, per explicit request.
//
// Classification now reuses the app-wide PARTNER_TYPE_CASE (qty-based RPA
// threshold at Pengajuan approval, see mitra-pengajuan.ts) instead of a
// locally-defined name-prefix RPA rule — unified per explicit product
// decision (see spec §1). "Lainnya" mitra (blank Gender, not TakeAway) are
// excluded from this table, matching the 4 types this panel has always
// shown.
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
          ${PARTNER_TYPE_CASE} AS PartnerType,
          COUNT(*) AS Total,
          SUM(CASE WHEN bp.JoinDate >= @thisMonthStart THEN 1 ELSE 0 END) AS NewThisMonth,
          SUM(CASE WHEN bp.JoinDate >= @lastMonthStart AND bp.JoinDate < @thisMonthStart THEN 1 ELSE 0 END) AS NewLastMonth
      FROM BusinessPartner bp
      WHERE ISNULL(bp.IsDeleted, 0) = 0
      GROUP BY
          ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui'),
          ${PARTNER_TYPE_CASE}
    `);

  const rows = (result.recordset as RawRow[]).filter((r) => r.PartnerType !== "Lainnya");

  const byWilayah = new Map<string, MitraGrowthRow>();
  for (const r of rows) {
    let entry = byWilayah.get(r.Wilayah);
    if (!entry) {
      entry = {
        wilayah: r.Wilayah,
        agen: EMPTY_CELL,
        outlet: EMPTY_CELL,
        takeaway: EMPTY_CELL,
        rpa: EMPTY_CELL,
        total: EMPTY_CELL,
      };
      byWilayah.set(r.Wilayah, entry);
    }
    const cell: MitraGrowthCell = { total: r.Total, newThisMonth: r.NewThisMonth, newLastMonth: r.NewLastMonth };
    if (r.PartnerType === "Agen") entry.agen = cell;
    else if (r.PartnerType === "Outlet") entry.outlet = cell;
    else if (r.PartnerType === "TakeAway") entry.takeaway = cell;
    else entry.rpa = cell;
    entry.total = addCell(entry.total, cell);
  }

  return [...byWilayah.values()].sort((a, b) => a.wilayah.localeCompare(b.wilayah));
}
