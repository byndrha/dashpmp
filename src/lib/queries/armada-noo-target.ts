import { getPool, sql } from "@/lib/db";

const WINDOW_DAYS = 30;

// Σ per-armada (KapasitasMaks - rata-rata muatan harian dalam WINDOW_DAYS
// hari sebelum `windowEnd`, exclusive) — Target NOO harian bersama (satu
// angka, tidak dibagi per marketing/wilayah, armada tidak terikat ke
// wilayah tertentu). Dinamis: tidak disnapshot, selalu dihitung ulang dari
// histori DeliveryOrder yang sudah ada — lihat spec §4 "target ini
// bergerak". Same VehicleMap three-way VehicleNo resolution and 5KG-bag
// halving convention as getPengirimanBoard()'s externalResult query in
// pengiriman-jadwal.ts. Average is total-kantong-in-window / WINDOW_DAYS
// (a fixed 30-day denominator, not "average over active delivery days") so
// a rarely-used armada still reads as having real spare capacity.
export async function getArmadaNooDailyCapacity(windowEnd: Date): Promise<number> {
  const pool = await getPool();
  const windowStart = new Date(windowEnd.getTime() - WINDOW_DAYS * 86400000);

  const result = await pool
    .request()
    .input("windowStart", sql.Date, windowStart)
    .input("windowEnd", sql.Date, windowEnd).query(`
      WITH VehicleMap AS (
          SELECT a.ArmadaID, a.KapasitasMaks, a.ExpeditionDetailID AS Key1, ed.VehicleNo AS Key2, a.Nama AS Key3
          FROM DashboardArmada a
          LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
          WHERE a.IsDeleted = 0
      ),
      DoQty AS (
          SELECT DeliveryOrderID, SUM(CASE WHEN Name LIKE '%5 KG%' THEN Qty / 2.0 ELSE Qty END) AS TotalKantong
          FROM DeliveryOrderDetail
          GROUP BY DeliveryOrderID
      ),
      DailyByArmada AS (
          SELECT vm.ArmadaID, SUM(ISNULL(dq.TotalKantong, 0)) AS TotalKantong30d
          FROM VehicleMap vm
          LEFT JOIN DeliveryOrder do_
            ON do_.IsDeleted = 0 AND do_.VehicleNo <> ''
            AND (do_.VehicleNo = vm.Key1 OR do_.VehicleNo = vm.Key2 OR do_.VehicleNo = vm.Key3)
            AND do_.TransDate >= @windowStart AND do_.TransDate < @windowEnd
          LEFT JOIN DoQty dq ON dq.DeliveryOrderID = do_.DeliveryOrderID
          GROUP BY vm.ArmadaID
      )
      SELECT vm.ArmadaID, vm.KapasitasMaks, ISNULL(dba.TotalKantong30d, 0) AS TotalKantong30d
      FROM VehicleMap vm
      LEFT JOIN DailyByArmada dba ON dba.ArmadaID = vm.ArmadaID
    `);

  let total = 0;
  for (const row of result.recordset as { ArmadaID: number; KapasitasMaks: number | null; TotalKantong30d: number }[]) {
    if (row.KapasitasMaks == null) continue;
    const avgDaily = row.TotalKantong30d / WINDOW_DAYS;
    const empty = row.KapasitasMaks - avgDaily;
    if (empty > 0) total += empty;
  }
  return total;
}
