import { getPool, sql } from "@/lib/db";
import {
  getMarketingWilayahAssignments,
  getMarketingMitraAssignments,
  resolveResponsibleMarketing,
  buildMitraOverrideMap,
} from "@/lib/queries/marketing-wilayah";

export interface VisitLogStatusRow {
  BusinessPartnerID: string;
  Name: string;
  Wilayah: string;
  Kecamatan: string | null;
  HasilKunjungan: string | null; // null = belum diisi untuk tanggal ini
}

// Roster mitra dalam cakupan satu Marketing (override prioritas +
// Wilayah/Kecamatan, resolusi sama persis dengan yang sudah dipakai
// getMarketingPerformance()) di-JOIN ke DashboardMarketingVisitLog untuk satu
// tanggal — mitra tanpa baris log di tanggal itu berarti belum dikunjungi.
export async function getVisitLogStatusForMarketing(
  marketingUserId: string,
  dateISO: string
): Promise<VisitLogStatusRow[]> {
  const [assignments, mitraAssignments] = await Promise.all([
    getMarketingWilayahAssignments(),
    getMarketingMitraAssignments(),
  ]);
  const mitraOverrides = buildMitraOverrideMap(mitraAssignments);

  const pool = await getPool();
  const mitraResult = await pool.request().query(`
    SELECT
        BusinessPartnerID,
        Name,
        ISNULL(NULLIF(LTRIM(RTRIM(NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
        NPWPAddress AS Kecamatan
    FROM BusinessPartner
    WHERE ISNULL(IsDeleted, 0) = 0
  `);

  const scoped = (
    mitraResult.recordset as { BusinessPartnerID: string; Name: string; Wilayah: string; Kecamatan: string | null }[]
  ).filter((r) => {
    const marketingName = resolveResponsibleMarketing(r.BusinessPartnerID, r.Wilayah, r.Kecamatan, assignments, mitraOverrides);
    return marketingName != null;
  });

  // resolveResponsibleMarketing above resolves to a Marketing NAME, not
  // UserID — the caller must have already resolved marketingUserId to a
  // name for this filter to be correct. Since this function only needs "is
  // this mitra in MY scope", and the caller (actions.ts) already knows its
  // own session user's name, re-derive the name here via the same
  // getMarketingWilayahAssignments/getMarketingMitraAssignments rows
  // (MarketingNama is present on both) rather than requiring the caller to
  // pass it separately.
  const ownName =
    assignments.find((a) => a.MarketingUserID === marketingUserId)?.MarketingNama ??
    mitraAssignments.find((a) => a.MarketingUserID === marketingUserId)?.MarketingNama;
  const ownScoped = ownName
    ? scoped.filter((r) => {
        const marketingName = resolveResponsibleMarketing(r.BusinessPartnerID, r.Wilayah, r.Kecamatan, assignments, mitraOverrides);
        return marketingName === ownName;
      })
    : [];

  if (ownScoped.length === 0) return [];

  const logRequest = pool.request().input("logDate", sql.Date, new Date(dateISO));
  const idParams = ownScoped.map((r, i) => {
    const name = `id${i}`;
    logRequest.input(name, sql.VarChar(16), r.BusinessPartnerID);
    return `@${name}`;
  });
  const logResult = await logRequest.query(`
    SELECT BusinessPartnerID, HasilKunjungan
    FROM DashboardMarketingVisitLog
    WHERE LogDate = @logDate AND BusinessPartnerID IN (${idParams.join(", ")})
  `);
  const logByPartner = new Map(
    (logResult.recordset as { BusinessPartnerID: string; HasilKunjungan: string | null }[]).map((r) => [
      r.BusinessPartnerID,
      r.HasilKunjungan,
    ])
  );

  return ownScoped
    .map((r) => ({ ...r, HasilKunjungan: logByPartner.get(r.BusinessPartnerID) ?? null }))
    .sort((a, b) => a.Name.localeCompare(b.Name));
}
