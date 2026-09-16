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
  const allMonthKeys = new Set<string>();
  // Always include the current business month as a column even if it has
  // zero deliveries so far — the table must reach "today", not stop at
  // the last month with data.
  allMonthKeys.add(monthKey(monthBoundary(getBusinessDate())));

  for (const row of qtyPerMitraBulan) {
    const ownership = ownershipByMitra.get(row.BusinessPartnerID);
    if (!ownership) continue; // unattributed mitra — excluded, matches existing convention
    const rowMonthStart = new Date(Date.UTC(row.BulanMulai.getUTCFullYear(), row.BulanMulai.getUTCMonth(), 1));
    if (ownership.nooMonthStart && rowMonthStart.getTime() < ownership.nooMonthStart.getTime()) continue; // before mitra existed
    const isNooThisMonth =
      ownership.nooMonthStart != null && rowMonthStart.getTime() === ownership.nooMonthStart.getTime();
    const mk = monthKey(rowMonthStart);
    allMonthKeys.add(mk);
    const key = `${ownership.ownerAkunId}|${mk}|${isNooThisMonth ? "noo" : "existing"}`;
    qtyByKey.set(key, (qtyByKey.get(key) ?? 0) + row.QtyKantong);
  }

  const sortedMonthKeys = Array.from(allMonthKeys).sort();
  const akunIds = new Set(ownerships.map((o) => o.ownerAkunId));

  const result = new Map<string, HistoriPenjualanKaryawan>();
  for (const akunId of akunIds) {
    const bulanList: BulanPenjualan[] = [];
    for (let i = 0; i < sortedMonthKeys.length; i++) {
      const mk = sortedMonthKeys[i];
      const prevMk = i > 0 ? sortedMonthKeys[i - 1] : null;
      const rawNoo = qtyByKey.get(`${akunId}|${mk}|noo`) ?? 0;
      const rawExisting = qtyByKey.get(`${akunId}|${mk}|existing`) ?? 0;
      const rawNooPrev = prevMk ? qtyByKey.get(`${akunId}|${prevMk}|noo`) ?? 0 : 0;
      const rawExistingPrev = prevMk ? qtyByKey.get(`${akunId}|${prevMk}|existing`) ?? 0 : 0;

      const qtyNooBerjalan = applyQtyStrategy(rawNoo, "non_average");
      const qtyNooSebelumnya = applyQtyStrategy(rawNooPrev, "non_average");
      const qtyExistingBerjalan = applyQtyStrategy(rawExisting, "average");
      const qtyExistingSebelumnya = applyQtyStrategy(rawExistingPrev, "average");

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
