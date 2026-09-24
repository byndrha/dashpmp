import { getCompanyPool } from "@/lib/db-company";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";
import { resolveAgenKoneksi, type SumberAgen } from "@/lib/queries/mitra-es-balok";
import type { Segmentasi } from "@/lib/segmentasi-mitra";

export interface MitraGrowthCell {
  total: number;
  newThisMonth: number;
  newLastMonth: number;
}

export interface MitraGrowthRow {
  wilayah: string;
  agen: MitraGrowthCell;
  manufaktur: MitraGrowthCell;
  pesisir: MitraGrowthCell;
  belumDitentukan: MitraGrowthCell;
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
  Segmentasi: Segmentasi | null;
  ModifiedDate: Date;
}

// Same source-list rule as getMitraList (mitra-es-balok.ts's sourcesForKode,
// not exported) -- pmputra merges into one card per AgenID from "utama"
// only, pmpersada/pmpakis show utama+logistik as separate cards each.
function sourcesForKode(kode: string): SumberAgen[] {
  if (kode === "pmputra") return ["utama"];
  return ["utama", "logistik"];
}

// PMP_Agen has no creation-date column at all -- only ModifiedDate, which is
// stamped to "now" on EVERY edit (both createMitra's INSERT and
// updateMitra's UPDATE). Using it as a "join date" proxy means a mitra that
// has existed for years will show up as "baru bulan ini" the next time
// anyone edits so much as its phone number, and again on every later edit --
// not just once. User decision 2026-09-24, made after this exact risk was
// explained: use it anyway, accepting the false positives, rather than
// dropping the this-month/last-month columns entirely.
export async function getMitraGrowthByWilayah(kode: string): Promise<MitraGrowthRow[]> {
  const businessToday = getBusinessDate();
  const thisMonthStart = monthBoundary(businessToday);
  const lastMonthStart = monthBoundary(businessToday, -1);

  const sources = sourcesForKode(kode);
  const perSource = await Promise.all(
    sources.map(async (sumber) => {
      const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
      const pool = await getCompanyPool(physKode, label);
      const result = await pool.request().query(`
        SELECT ISNULL(NULLIF(LTRIM(RTRIM(w.Nama)), ''), 'Tidak Diketahui') AS Wilayah,
               prof.Segmentasi, a.ModifiedDate
        FROM PMP_Agen a
        LEFT JOIN PMP_AgenDetail ad ON ad.AgenID = a.AgenID AND ISNULL(ad.IsDeleted,0) = 0
        LEFT JOIN PMP_Wilayah w ON w.WilayahID = ad.RegionID
        LEFT JOIN DashboardAgenProfil prof ON prof.AgenID = a.AgenID
        WHERE ISNULL(a.IsDeleted,0) = 0
      `);
      return result.recordset as RawRow[];
    })
  );
  const rows = perSource.flat();

  const byWilayah = new Map<string, MitraGrowthRow>();
  for (const r of rows) {
    let entry = byWilayah.get(r.Wilayah);
    if (!entry) {
      entry = { wilayah: r.Wilayah, agen: EMPTY_CELL, manufaktur: EMPTY_CELL, pesisir: EMPTY_CELL, belumDitentukan: EMPTY_CELL, total: EMPTY_CELL };
      byWilayah.set(r.Wilayah, entry);
    }
    const modified = new Date(r.ModifiedDate);
    const cell: MitraGrowthCell = {
      total: 1,
      newThisMonth: modified >= thisMonthStart ? 1 : 0,
      newLastMonth: modified >= lastMonthStart && modified < thisMonthStart ? 1 : 0,
    };
    if (r.Segmentasi === "agen") entry.agen = addCell(entry.agen, cell);
    else if (r.Segmentasi === "manufaktur") entry.manufaktur = addCell(entry.manufaktur, cell);
    else if (r.Segmentasi === "pesisir") entry.pesisir = addCell(entry.pesisir, cell);
    else entry.belumDitentukan = addCell(entry.belumDitentukan, cell);
    entry.total = addCell(entry.total, cell);
  }

  return [...byWilayah.values()].sort((a, b) => a.wilayah.localeCompare(b.wilayah));
}
