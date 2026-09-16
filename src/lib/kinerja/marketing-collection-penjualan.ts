// src/lib/kinerja/marketing-collection-penjualan.ts
import { getPool } from "@/lib/db";
import { resolveAllMitraOwnership, type MitraOwnership } from "@/lib/kinerja/marketing-collection-attribution";
import { applyQtyStrategy } from "@/lib/kinerja/qty-strategy";
import { monthBoundary, getBusinessDate } from "@/lib/business-date";

const RATE_PER_KANTONG = 200;

export interface BulanPenjualan {
  /** ISO date, first of month, e.g. "2026-07-01". */
  bulanMulai: string;
  qtyNooBerjalan: number;
  qtyNooSebelumnya: number;
  deltaNoo: number;
  qtyExistingBerjalan: number;
  qtyExistingSebelumnya: number;
  deltaExisting: number;
  totalQty: number;
  nilaiRupiah: number;
}

export interface HistoriPenjualanKaryawan {
  akunId: string;
  bulanList: BulanPenjualan[];
}

interface QtyPerMitraBulan {
  BusinessPartnerID: string;
  BulanMulai: Date;
  QtyKantong: number;
}

async function getQtyKantongPerMitraPerBulan(): Promise<QtyPerMitraBulan[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT do_.BusinessPartnerID,
           DATEFROMPARTS(YEAR(do_.TransDate), MONTH(do_.TransDate), 1) AS BulanMulai,
           SUM(CASE WHEN dod.Name LIKE '%5 KG%' THEN dod.Delivered / 2.0 ELSE dod.Delivered END) AS QtyKantong
    FROM DeliveryOrder do_
    JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
    WHERE do_.IsDeleted = 0
    GROUP BY do_.BusinessPartnerID, DATEFROMPARTS(YEAR(do_.TransDate), MONTH(do_.TransDate), 1)
  `);
  return result.recordset as QtyPerMitraBulan[];
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7); // "YYYY-MM"
}

// The NOO/Existing tracking system for Marketing and Collection only began
// being recorded from July 2026 onward (explicit business decision,
// 2026-09-16) — data from before this month exists in the ERP but was
// never captured under this Pengajuan-based NOO/Existing rule, so it's
// excluded from every employee's table rather than producing a misleading
// mostly-zero history. This is specific to this jabatan/aspek's business
// rule, not a system-wide constant.
const FEATURE_START_MONTH_KEY = "2026-07";

function daysInMonthKey(mk: string): number {
  const [year, month] = mk.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Generates a continuous list of "YYYY-MM" keys from startKey through endKey, inclusive. */
function monthKeyRange(startKey: string, endKey: string): string[] {
  const [startYear, startMonth] = startKey.split("-").map(Number);
  const [endYear, endMonth] = endKey.split("-").map(Number);
  const keys: string[] = [];
  let y = startYear;
  let m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return keys;
}

/**
 * Builds the full monthly history table for every akun that owns at least
 * one mitra under this business rule. Call once per page load — all the
 * MSSQL/Postgres work happens inside this one function, not per-employee.
 */
export async function getHistoriPenjualanSemuaKaryawan(): Promise<Map<string, HistoriPenjualanKaryawan>> {
  const [ownerships, qtyPerMitraBulan] = await Promise.all([
    resolveAllMitraOwnership(),
    getQtyKantongPerMitraPerBulan(),
  ]);

  const ownershipByMitra = new Map<string, MitraOwnership>(ownerships.map((o) => [o.businessPartnerId, o]));

  // qtyByKey["akunId|YYYY-MM|noo"] / "...|existing" — built once by walking
  // every (mitra, bulan) qty row and attributing it via the ownership
  // resolved above.
  const qtyByKey = new Map<string, number>();
  // Current business month is always the fixed upper bound of every
  // employee's range, even if they have zero data in it — the table must
  // reach "today", not stop at the last month with data.
  const currentMonthKey = monthKey(monthBoundary(getBusinessDate()));

  for (const row of qtyPerMitraBulan) {
    const ownership = ownershipByMitra.get(row.BusinessPartnerID);
    if (!ownership) continue; // unattributed mitra — excluded, matches existing convention
    const rowMonthStart = new Date(Date.UTC(row.BulanMulai.getUTCFullYear(), row.BulanMulai.getUTCMonth(), 1));
    if (ownership.nooMonthStart && rowMonthStart.getTime() < ownership.nooMonthStart.getTime()) continue; // before mitra existed
    const isNooThisMonth =
      ownership.nooMonthStart != null && rowMonthStart.getTime() === ownership.nooMonthStart.getTime();
    const mk = monthKey(rowMonthStart);
    const key = `${ownership.ownerAkunId}|${mk}|${isNooThisMonth ? "noo" : "existing"}`;
    qtyByKey.set(key, (qtyByKey.get(key) ?? 0) + row.QtyKantong);
  }

  const akunIds = new Set(ownerships.map((o) => o.ownerAkunId));

  // Every employee's table spans the same fixed window — FEATURE_START_MONTH_KEY
  // through the current business month — rather than each employee's own
  // earliest data month (the NOO/Existing system itself only exists from
  // that fixed start onward, so an earlier per-employee start would just
  // surface pre-tracking data the business rule was never meant to cover).
  const sharedMonthKeys = monthKeyRange(FEATURE_START_MONTH_KEY, currentMonthKey);

  const result = new Map<string, HistoriPenjualanKaryawan>();
  for (const akunId of akunIds) {
    const bulanList: BulanPenjualan[] = [];
    for (let i = 0; i < sharedMonthKeys.length; i++) {
      const mk = sharedMonthKeys[i];
      const prevMk = i > 0 ? sharedMonthKeys[i - 1] : null;
      const rawNoo = qtyByKey.get(`${akunId}|${mk}|noo`) ?? 0;
      const rawExisting = qtyByKey.get(`${akunId}|${mk}|existing`) ?? 0;
      const rawNooPrev = prevMk ? qtyByKey.get(`${akunId}|${prevMk}|noo`) ?? 0 : 0;
      const rawExistingPrev = prevMk ? qtyByKey.get(`${akunId}|${prevMk}|existing`) ?? 0 : 0;

      const qtyNooBerjalan = applyQtyStrategy(rawNoo, "non_average", daysInMonthKey(mk));
      const qtyNooSebelumnya = prevMk ? applyQtyStrategy(rawNooPrev, "non_average", daysInMonthKey(prevMk)) : 0;
      const qtyExistingBerjalan = applyQtyStrategy(rawExisting, "average", daysInMonthKey(mk));
      const qtyExistingSebelumnya = prevMk ? applyQtyStrategy(rawExistingPrev, "average", daysInMonthKey(prevMk)) : 0;

      const deltaNoo = qtyNooBerjalan - qtyNooSebelumnya;
      const deltaExisting = qtyExistingBerjalan - qtyExistingSebelumnya;
      const totalQty = deltaNoo + deltaExisting;

      bulanList.push({
        bulanMulai: `${mk}-01`,
        qtyNooBerjalan,
        qtyNooSebelumnya,
        deltaNoo,
        qtyExistingBerjalan,
        qtyExistingSebelumnya,
        deltaExisting,
        totalQty,
        nilaiRupiah: totalQty * RATE_PER_KANTONG,
      });
    }
    result.set(akunId, { akunId, bulanList });
  }
  return result;
}
