// src/lib/kinerja/marketing-collection-penjualan.ts
import { getPool } from "@/lib/db";
import { resolveAllMitraOwnership, type MitraOwnership } from "@/lib/kinerja/marketing-collection-attribution";
import { applyQtyStrategy } from "@/lib/kinerja/qty-strategy";
import { monthBoundary, getBusinessDate } from "@/lib/business-date";
import { listAkun } from "@/lib/queries/akun";

const RATE_PER_KANTONG = 200;

// Pseudo-owner id for mitra whose real owner has resigned (akun.nonaktif_sejak
// set) — never collides with a real akun.id, which is always a plain numeric
// string. Exported so page.tsx can label this bucket distinctly from both a
// real employee and a genuinely-orphaned (hard-deleted) akunId.
export const TANPA_MARKETING_ID = "tanpa_marketing";

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

interface QtyPerMitraHari {
  BusinessPartnerID: string;
  Tanggal: Date;
  QtyKantong: number;
}

// Day-granularity (not month) because the NOO window is a rolling 30 days
// from approval, not "the calendar month of approval" — a single month's
// quantity for one mitra can be split between the NOO and Existing buckets
// when the window closes mid-month (confirmed with user 2026-09-16, see
// NOO_WINDOW_DAYS below). Tanggal is TransDate's own naive-WIB business-date
// label (unchanged, day-truncated) — same convention used in mitra-do.ts.
async function getQtyKantongPerMitraPerHari(): Promise<QtyPerMitraHari[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT do_.BusinessPartnerID,
           CAST(do_.TransDate AS DATE) AS Tanggal,
           SUM(CASE WHEN dod.Name LIKE '%5 KG%' THEN dod.Delivered / 2.0 ELSE dod.Delivered END) AS QtyKantong
    FROM DeliveryOrder do_
    JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
    WHERE do_.IsDeleted = 0
    GROUP BY do_.BusinessPartnerID, CAST(do_.TransDate AS DATE)
  `);
  return result.recordset as QtyPerMitraHari[];
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

// A mitra counts as NOO for exactly 30 days starting the WIB business-date
// their Pengajuan was approved (MitraOwnership.nooStartDate) — confirmed
// with user 2026-09-16 via a worked example (approved 20 Sep -> NOO through
// 20 Oct inclusive, Existing from 21 Oct onward). This window can straddle
// a calendar-month boundary, so a mitra can contribute to NOO totals in TWO
// separate months before becoming permanently Existing.
const NOO_WINDOW_DAYS = 30;

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
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
  const [ownerships, qtyPerMitraHari, allAkun] = await Promise.all([
    resolveAllMitraOwnership(),
    getQtyKantongPerMitraPerHari(),
    listAkun(),
  ]);

  const ownershipByMitra = new Map<string, MitraOwnership>(ownerships.map((o) => [o.businessPartnerId, o]));

  // akun.nonaktif_sejak ("resigned since") is a plain "YYYY-MM-DD" date —
  // parsed as a UTC-midnight Date so it compares directly against rowDate
  // (also UTC-midnight-labeled) with no timezone-shift risk. Confirmed with
  // user 2026-09-16: the resign day itself already counts as "no longer
  // theirs" (a day is redirected to Tanpa Marketing when
  // rowDate >= resignDate), matching "nonaktif SEJAK tanggal X" literally.
  const resignDateByAkunId = new Map<string, Date>();
  for (const akun of allAkun) {
    if (akun.nonaktifSejak) {
      const [y, m, d] = akun.nonaktifSejak.split("-").map(Number);
      resignDateByAkunId.set(String(akun.id), new Date(Date.UTC(y, m - 1, d)));
    }
  }
  let anyRedirectedToTanpaMarketing = false;

  // qtyByKey["akunId|YYYY-MM|noo"] / "...|existing" — built once by walking
  // every (mitra, hari) qty row, deciding NOO-vs-Existing at DAY
  // granularity (a row's own day compared against that mitra's 30-day NOO
  // window), then bucketing the result into the row's own calendar month.
  const qtyByKey = new Map<string, number>();
  // Current business month is always the fixed upper bound of every
  // employee's range, even if they have zero data in it — the table must
  // reach "today", not stop at the last month with data.
  const currentMonthKey = monthKey(monthBoundary(getBusinessDate()));

  for (const row of qtyPerMitraHari) {
    const ownership = ownershipByMitra.get(row.BusinessPartnerID);
    if (!ownership) continue; // unattributed mitra — excluded, matches existing convention
    const rowDate = new Date(Date.UTC(row.Tanggal.getUTCFullYear(), row.Tanggal.getUTCMonth(), row.Tanggal.getUTCDate()));
    if (ownership.nooStartDate && rowDate.getTime() < ownership.nooStartDate.getTime()) continue; // before mitra existed
    const nooWindowEnd = ownership.nooStartDate ? addDays(ownership.nooStartDate, NOO_WINDOW_DAYS) : null;
    const isNoo = nooWindowEnd != null && rowDate.getTime() <= nooWindowEnd.getTime();

    // A resigned owner's days from their resign date onward stop counting
    // toward them (NOO or Existing alike) and flow into the shared Tanpa
    // Marketing bucket instead — checked AFTER the NOO/Existing status is
    // determined so a mitra still mid-NOO-window at the resign date keeps
    // that status once redirected (Tanpa Marketing gets its own NOO/Existing
    // split too, computed identically, just under a pseudo-owner id).
    const resignDate = resignDateByAkunId.get(ownership.ownerAkunId);
    const effectiveOwnerId =
      resignDate && rowDate.getTime() >= resignDate.getTime() ? TANPA_MARKETING_ID : ownership.ownerAkunId;
    if (effectiveOwnerId === TANPA_MARKETING_ID) anyRedirectedToTanpaMarketing = true;

    const mk = monthKey(rowDate);
    const key = `${effectiveOwnerId}|${mk}|${isNoo ? "noo" : "existing"}`;
    qtyByKey.set(key, (qtyByKey.get(key) ?? 0) + row.QtyKantong);
  }

  const akunIds = new Set(ownerships.map((o) => o.ownerAkunId));
  if (anyRedirectedToTanpaMarketing) akunIds.add(TANPA_MARKETING_ID);

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
