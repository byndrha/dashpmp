import { getPool, sql } from "@/lib/db";
import { MARKETING_ROLE_ID } from "@/lib/roles";

export interface MarketingUserOption {
  UserID: string;
  Nama: string;
}

export interface MarketingWilayahAssignment {
  MarketingWilayahID: number;
  MarketingUserID: string;
  MarketingNama: string;
  Wilayah: string;
  // NULL means the whole Wilayah (every Kecamatan within it), not "no
  // Kecamatan set" — see resolveResponsibleMarketing()'s matching order.
  Kecamatan: string | null;
  CreatedAt: string;
}

export async function getMarketingUsers(): Promise<MarketingUserOption[]> {
  const pool = await getPool();
  const result = await pool.request().input("roleId", sql.Int, MARKETING_ROLE_ID).query(`
    SELECT CAST(UserID AS VARCHAR(16)) AS UserID, Nama
    FROM DashboardUser
    WHERE RoleID = @roleId AND ISNULL(IsActive, 0) = 1
    ORDER BY Nama
  `);
  return result.recordset;
}

export async function getMarketingWilayahAssignments(): Promise<MarketingWilayahAssignment[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT mw.MarketingWilayahID, mw.MarketingUserID, ISNULL(du.Nama, 'Tidak diketahui') AS MarketingNama,
           mw.Wilayah, mw.Kecamatan, mw.CreatedAt
    FROM DashboardMarketingWilayah mw
    LEFT JOIN DashboardUser du ON du.UserID = TRY_CAST(mw.MarketingUserID AS INT)
    ORDER BY mw.Wilayah, ISNULL(mw.Kecamatan, ''), du.Nama
  `);
  return result.recordset;
}

// Atomic claim: the INSERT only happens if no conflicting row exists yet,
// checked and inserted within the same statement so two concurrent adds for
// the same Wilayah/Kecamatan can't both succeed (same pattern as
// publishJadwal's claim-then-act check in pengiriman-jadwal.ts). A
// whole-Wilayah row (Kecamatan IS NULL) conflicts with ANY existing row for
// that Wilayah, and vice versa — one marketing having "all of X" and another
// having "X + some Kecamatan" would make the Mitra in that Kecamatan
// ambiguous, which is exactly what this guards against.
export async function addMarketingWilayah(input: {
  marketingUserId: string;
  wilayah: string;
  kecamatan: string | null;
  createdByUserId: string;
}): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("marketingUserId", sql.VarChar(16), input.marketingUserId)
    .input("wilayah", sql.VarChar(128), input.wilayah)
    .input("kecamatan", sql.VarChar(128), input.kecamatan)
    .input("createdBy", sql.VarChar(16), input.createdByUserId).query(`
      INSERT INTO DashboardMarketingWilayah (MarketingUserID, Wilayah, Kecamatan, CreatedByUserID)
      SELECT @marketingUserId, @wilayah, @kecamatan, @createdBy
      WHERE NOT EXISTS (
        SELECT 1 FROM DashboardMarketingWilayah
        WHERE Wilayah = @wilayah
          AND (
            Kecamatan IS NULL
            OR @kecamatan IS NULL
            OR Kecamatan = @kecamatan
          )
      )
    `);
  if (result.rowsAffected[0] === 0) {
    throw new Error("Wilayah/kecamatan ini sudah menjadi tanggung jawab Marketing lain.");
  }
}

export async function removeMarketingWilayah(id: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .query(`DELETE FROM DashboardMarketingWilayah WHERE MarketingWilayahID = @id`);
}

// Per-mitra override: a Marketing can be made explicitly responsible for one
// specific Mitra, taking priority over whatever Wilayah/Kecamatan coverage
// would otherwise apply — even if that Mitra sits inside another Marketing's
// wilayah. One row per Mitra (DB-enforced via a unique index on
// BusinessPartnerID), so a Mitra has at most one priority override.
export interface MarketingMitraAssignment {
  MarketingMitraID: number;
  MarketingUserID: string;
  MarketingNama: string;
  BusinessPartnerID: string;
  MitraName: string;
  Wilayah: string;
  Kecamatan: string | null;
  Capacity: number | null;
  CreatedAt: string;
}

export interface MitraOption {
  BusinessPartnerID: string;
  Name: string;
  Wilayah: string;
}

export async function getMarketingMitraAssignments(): Promise<MarketingMitraAssignment[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT mm.MarketingMitraID, mm.MarketingUserID, ISNULL(du.Nama, 'Tidak diketahui') AS MarketingNama,
           mm.BusinessPartnerID, bp.Name AS MitraName,
           ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
           bp.NPWPAddress AS Kecamatan, bp.Capacity, mm.CreatedAt
    FROM DashboardMarketingMitra mm
    JOIN BusinessPartner bp ON bp.BusinessPartnerID = mm.BusinessPartnerID
    LEFT JOIN DashboardUser du ON du.UserID = TRY_CAST(mm.MarketingUserID AS INT)
    ORDER BY du.Nama, bp.Name
  `);
  return result.recordset;
}

// Lightweight list for the "assign a specific Mitra" search combobox — not
// the full getMitraList() (which also resolves Marketing/growth data this
// picker doesn't need).
// Excludes deactivated mitra (BusinessPartner.IsSuspended, toggled via the
// Mitra module's "Nonaktifkan" action) — this is the operational picker
// used to create a new Pemesanan and to assign Cakupan Wilayah, both of
// which a deactivated mitra shouldn't be selectable for.
export async function getMitraOptions(): Promise<MitraOption[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT BusinessPartnerID, Name,
           ISNULL(NULLIF(LTRIM(RTRIM(NPWPName)), ''), 'Tidak Diketahui') AS Wilayah
    FROM BusinessPartner
    WHERE ISNULL(IsDeleted, 0) = 0 AND ISNULL(IsSuspended, 0) = 0
    ORDER BY Name
  `);
  return result.recordset;
}

// Same atomic-claim pattern as addMarketingWilayah — the unique index on
// BusinessPartnerID is the real guarantee, this WHERE NOT EXISTS just turns
// the conflict into a clean thrown error instead of a raw constraint
// violation reaching the caller.
export async function addMarketingMitra(input: {
  marketingUserId: string;
  businessPartnerId: string;
  createdByUserId: string;
}): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("marketingUserId", sql.VarChar(16), input.marketingUserId)
    .input("businessPartnerId", sql.VarChar(16), input.businessPartnerId)
    .input("createdBy", sql.VarChar(16), input.createdByUserId).query(`
      INSERT INTO DashboardMarketingMitra (MarketingUserID, BusinessPartnerID, CreatedByUserID)
      SELECT @marketingUserId, @businessPartnerId, @createdBy
      WHERE NOT EXISTS (
        SELECT 1 FROM DashboardMarketingMitra WHERE BusinessPartnerID = @businessPartnerId
      )
    `);
  if (result.rowsAffected[0] === 0) {
    throw new Error("Mitra ini sudah memiliki Marketing penanggung jawab prioritas.");
  }
}

export async function removeMarketingMitra(id: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .query(`DELETE FROM DashboardMarketingMitra WHERE MarketingMitraID = @id`);
}

export function buildMitraOverrideMap(assignments: MarketingMitraAssignment[]): Map<string, string> {
  return new Map(assignments.map((a) => [a.BusinessPartnerID, a.MarketingNama]));
}

// Resolves which Marketing is responsible for a Mitra: a per-Mitra priority
// override wins first (even across Wilayah boundaries), then an exact
// Wilayah+Kecamatan assignment, then a whole-Wilayah assignment (Kecamatan
// IS NULL) as fallback, then unassigned (null).
export function resolveResponsibleMarketing(
  businessPartnerId: string | null,
  wilayah: string | null,
  kecamatan: string | null,
  assignments: MarketingWilayahAssignment[],
  mitraOverrides?: Map<string, string>
): string | null {
  if (businessPartnerId) {
    const override = mitraOverrides?.get(businessPartnerId);
    if (override) return override;
  }
  if (!wilayah) return null;
  if (kecamatan) {
    const specific = assignments.find((a) => a.Wilayah === wilayah && a.Kecamatan === kecamatan);
    if (specific) return specific.MarketingNama;
  }
  const wholeWilayah = assignments.find((a) => a.Wilayah === wilayah && a.Kecamatan === null);
  return wholeWilayah ? wholeWilayah.MarketingNama : null;
}
