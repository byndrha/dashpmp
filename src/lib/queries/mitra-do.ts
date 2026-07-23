import { getPool, sql } from "@/lib/db";
import { getBusinessDateISO } from "@/lib/business-date";
import { PARTNER_TYPE_CASE } from "@/lib/queries/aging";
import { getMitraList, getPriceLevelOptions } from "@/lib/queries/mitra";
import type { PartnerType, DateRangeFilter } from "@/types/dashboard";

export interface MitraDORow {
  BusinessPartnerID: string;
  Name: string;
  PartnerType: PartnerType;
  Wilayah: string;
  Kecamatan: string | null;
  HargaJual: number | null;
  TargetHarian: number | null;
  // Capacity scaled to the filtered period's length (daysInRange), not
  // always a calendar month — the label "Target Bulanan" in the UI stays
  // as-is since the default filter range still is a calendar month, but the
  // underlying value now tracks whatever range is actually selected.
  TargetBulanan: number | null;
  DailyQty: number[];
  TotalQty: number;
  PctAchievement: number | null;
  HasTransaksi: boolean;
  // Used for the "Mitra Terbaru" sort mode — when this mitra joined,
  // ISO date string or null (older ERP-imported rows can lack it).
  JoinDate: string | null;
}

export interface MitraDOMonthly {
  daysInRange: number;
  // "YYYY-MM-DD" business-date string for DailyQty[0] — every other index's
  // calendar date is rangeStartISO + i days. Lets the panel compute real
  // dates (not just a 1..N day-of-month number) without re-deriving the
  // filter here.
  rangeStartISO: string;
  todayISO: string;
  active: MitraDORow[];
  inactive: MitraDORow[];
}

interface RawDailyRow {
  BusinessPartnerID: string;
  Name: string;
  PartnerType: PartnerType;
  Wilayah: string;
  Kecamatan: string | null;
  PriceLevel: number | null;
  Capacity: number | null;
  JoinDate: string | null;
  TransDate: string;
  QtyKantong: number;
}

// "Kantong" here always means the 10KG-equivalent unit that mitra
// Capacity/target is expressed in: a 5KG bag counts as half a kantong. This
// is a business rule specific to this DO-vs-target panel — other sales
// panels (sales-cards.ts, sales-overview.ts) count 5KG/10KG as separate,
// un-normalized unit counts instead.
const KANTONG_QTY_EXPR = `SUM(CASE WHEN dod.Name LIKE '%5 KG%' THEN dod.Delivered / 2.0 ELSE dod.Delivered END)`;

// Generalized from a hardcoded "bulan berjalan" to whatever date range the
// page's FilterBar resolves to (defaults to the current business month —
// see resolveFilter() — so existing default behavior is unchanged, but an
// applied filter now actually scopes this panel's day columns too).
export async function getMitraDOMonthly(filter: DateRangeFilter): Promise<MitraDOMonthly> {
  const pool = await getPool();
  const rangeStart = new Date(filter.startDate);
  const rangeEnd = new Date(filter.endDate);
  const daysInRange = Math.max(1, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 86400000));
  const todayISO = getBusinessDateISO();

  const [dailyResult, priceLevels, allMitra] = await Promise.all([
    pool
      .request()
      .input("rangeStart", sql.Date, rangeStart)
      .input("rangeEnd", sql.Date, rangeEnd)
      .query(`
        SELECT
            bp.BusinessPartnerID,
            bp.Name,
            ${PARTNER_TYPE_CASE} AS PartnerType,
            ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
            bp.NPWPAddress AS Kecamatan,
            bp.PriceLevel,
            bp.Capacity,
            bp.JoinDate,
            CAST(do_.TransDate AS DATE) AS TransDate,
            ${KANTONG_QTY_EXPR} AS QtyKantong
        FROM DeliveryOrder do_
        JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
        JOIN BusinessPartner bp ON bp.BusinessPartnerID = do_.BusinessPartnerID
        WHERE do_.IsDeleted = 0
          AND do_.TransDate >= @rangeStart AND do_.TransDate < @rangeEnd
        GROUP BY bp.BusinessPartnerID, bp.Name, bp.NPWPName, bp.NPWPAddress, bp.SalesmanID, bp.Gender,
                 bp.PriceLevel, bp.Capacity, bp.JoinDate, CAST(do_.TransDate AS DATE)
      `),
    getPriceLevelOptions(),
    getMitraList(),
  ]);

  const priceByLevel = new Map(priceLevels.map((p) => [p.Level, p.Price]));
  const rows = dailyResult.recordset as RawDailyRow[];

  const byPartner = new Map<string, MitraDORow>();
  for (const row of rows) {
    let entry = byPartner.get(row.BusinessPartnerID);
    if (!entry) {
      entry = {
        BusinessPartnerID: row.BusinessPartnerID,
        Name: row.Name,
        PartnerType: row.PartnerType,
        Wilayah: row.Wilayah,
        Kecamatan: row.Kecamatan,
        HargaJual: row.PriceLevel != null ? priceByLevel.get(row.PriceLevel) ?? null : null,
        TargetHarian: row.Capacity,
        TargetBulanan: row.Capacity != null ? row.Capacity * daysInRange : null,
        DailyQty: new Array(daysInRange).fill(0),
        TotalQty: 0,
        PctAchievement: null,
        HasTransaksi: true,
        JoinDate: row.JoinDate,
      };
      byPartner.set(row.BusinessPartnerID, entry);
    }
    // TransDate comes back as a UTC-midnight DATE (see business-date.ts) —
    // diff in whole days against rangeStart (also UTC-midnight) gives the
    // column index directly, regardless of where in the range it starts.
    const dayIndex = Math.round((new Date(row.TransDate).getTime() - rangeStart.getTime()) / 86400000);
    if (dayIndex >= 0 && dayIndex < daysInRange) {
      entry.DailyQty[dayIndex] += row.QtyKantong;
    }
  }

  const active = [...byPartner.values()]
    .map((entry) => {
      const totalQty = entry.DailyQty.reduce((sum, q) => sum + q, 0);
      return {
        ...entry,
        TotalQty: totalQty,
        PctAchievement: entry.TargetBulanan ? (totalQty / entry.TargetBulanan) * 100 : null,
      };
    })
    .sort((a, b) => b.TotalQty - a.TotalQty);

  const activeIds = new Set(active.map((m) => m.BusinessPartnerID));
  const inactive: MitraDORow[] = allMitra
    .filter((m) => !activeIds.has(m.BusinessPartnerID))
    .map((m) => ({
      BusinessPartnerID: m.BusinessPartnerID,
      Name: m.Name,
      PartnerType: m.PartnerType,
      Wilayah: m.Wilayah ?? "Tidak Diketahui",
      Kecamatan: m.Kecamatan,
      HargaJual: m.PriceLevel != null ? priceByLevel.get(m.PriceLevel) ?? null : null,
      TargetHarian: m.Capacity,
      TargetBulanan: m.Capacity != null ? m.Capacity * daysInRange : null,
      DailyQty: new Array(daysInRange).fill(0),
      TotalQty: 0,
      PctAchievement: null,
      HasTransaksi: false,
      JoinDate: m.JoinDate,
    }))
    .sort((a, b) => a.Name.localeCompare(b.Name));

  return { daysInRange, rangeStartISO: filter.startDate, todayISO, active, inactive };
}
