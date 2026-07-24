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

// Resolves which Marketing is responsible for a Mitra's Wilayah/Kecamatan:
// an exact Wilayah+Kecamatan assignment wins first, then a whole-Wilayah
// assignment (Kecamatan IS NULL) as fallback, then unassigned (null).
export function resolveResponsibleMarketing(
  wilayah: string | null,
  kecamatan: string | null,
  assignments: MarketingWilayahAssignment[]
): string | null {
  if (!wilayah) return null;
  if (kecamatan) {
    const specific = assignments.find((a) => a.Wilayah === wilayah && a.Kecamatan === kecamatan);
    if (specific) return specific.MarketingNama;
  }
  const wholeWilayah = assignments.find((a) => a.Wilayah === wilayah && a.Kecamatan === null);
  return wholeWilayah ? wholeWilayah.MarketingNama : null;
}
