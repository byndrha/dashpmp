import { getPool, sql } from "@/lib/db";
import { getPgPool } from "@/lib/pg";
import { MARKETING_ROLE_ID } from "@/lib/roles";
import { AppError } from "@/lib/action-result";

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

// Marketing identity now lives in Postgres akun/peran (see
// docs/superpowers/specs/2026-07-31-migrasi-akun-postgres-design.md) —
// MSSQL DashboardUser is frozen and no longer where accounts are created.
// MARKETING_ROLE_ID is still the right filter value since the Akun
// migration explicitly preserved every MSSQL RoleID as the same Postgres
// peran.id.
export async function getMarketingUsers(): Promise<MarketingUserOption[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT a.id, a.nama FROM akun a WHERE a.peran_id = $1 AND a.is_active = true ORDER BY a.nama`,
    [MARKETING_ROLE_ID]
  );
  return (result.rows as { id: number; nama: string }[]).map((r) => ({ UserID: String(r.id), Nama: r.nama }));
}

// DashboardMarketingWilayah (MSSQL) and akun (Postgres) are two different
// database engines — MarketingUserID can't be resolved to a name via a SQL
// JOIN across them, so the name lookup happens here in application code
// instead. MarketingUserID values in this table were migrated from MSSQL
// UserID to Postgres akun.id (scripts/migrate-marketing-userid-to-akun-id.ts)
// so this Number(...) lookup is safe for both old and new assignment rows.
export async function getMarketingWilayahAssignments(): Promise<MarketingWilayahAssignment[]> {
  const mssqlPool = await getPool();
  const pgPool = getPgPool();
  const mwResult = await mssqlPool.request().query(`
    SELECT MarketingWilayahID, MarketingUserID, Wilayah, Kecamatan, CreatedAt
    FROM DashboardMarketingWilayah
  `);
  const rows = mwResult.recordset as {
    MarketingWilayahID: number;
    MarketingUserID: string;
    Wilayah: string;
    Kecamatan: string | null;
    CreatedAt: string;
  }[];

  const akunIds = [...new Set(rows.map((r) => Number(r.MarketingUserID)).filter(Number.isFinite))];
  const nameMap = new Map<number, string>();
  if (akunIds.length > 0) {
    const namesResult = await pgPool.query(`SELECT id, nama FROM akun WHERE id = ANY($1::int[])`, [akunIds]);
    for (const r of namesResult.rows as { id: number; nama: string }[]) nameMap.set(r.id, r.nama);
  }

  return rows
    .map((r) => ({
      MarketingWilayahID: r.MarketingWilayahID,
      MarketingUserID: r.MarketingUserID,
      MarketingNama: nameMap.get(Number(r.MarketingUserID)) ?? "Tidak diketahui",
      Wilayah: r.Wilayah,
      Kecamatan: r.Kecamatan,
      CreatedAt: r.CreatedAt,
    }))
    .sort((a, b) => a.Wilayah.localeCompare(b.Wilayah) || (a.Kecamatan ?? "").localeCompare(b.Kecamatan ?? "") || a.MarketingNama.localeCompare(b.MarketingNama));
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
    throw new AppError("Wilayah/kecamatan ini sudah menjadi tanggung jawab Marketing lain.");
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
  JoinDate: string | null;
  CreatedAt: string;
}

export interface MitraOption {
  BusinessPartnerID: string;
  Name: string;
  Wilayah: string;
}

// Same cross-database name-resolution pattern as getMarketingWilayahAssignments
// — MarketingUserID -> nama is looked up against Postgres in application
// code, since it can't be joined in the same SQL statement as the MSSQL
// BusinessPartner join.
export async function getMarketingMitraAssignments(): Promise<MarketingMitraAssignment[]> {
  const mssqlPool = await getPool();
  const pgPool = getPgPool();
  const mmResult = await mssqlPool.request().query(`
    SELECT mm.MarketingMitraID, mm.MarketingUserID,
           mm.BusinessPartnerID, bp.Name AS MitraName,
           ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
           bp.NPWPAddress AS Kecamatan, bp.Capacity, bp.JoinDate, mm.CreatedAt
    FROM DashboardMarketingMitra mm
    JOIN BusinessPartner bp ON bp.BusinessPartnerID = mm.BusinessPartnerID
  `);
  const rows = mmResult.recordset as {
    MarketingMitraID: number;
    MarketingUserID: string;
    BusinessPartnerID: string;
    MitraName: string;
    Wilayah: string;
    Kecamatan: string | null;
    Capacity: number | null;
    JoinDate: string | null;
    CreatedAt: string;
  }[];

  const akunIds = [...new Set(rows.map((r) => Number(r.MarketingUserID)).filter(Number.isFinite))];
  const nameMap = new Map<number, string>();
  if (akunIds.length > 0) {
    const namesResult = await pgPool.query(`SELECT id, nama FROM akun WHERE id = ANY($1::int[])`, [akunIds]);
    for (const r of namesResult.rows as { id: number; nama: string }[]) nameMap.set(r.id, r.nama);
  }

  return rows
    .map((r) => ({
      MarketingMitraID: r.MarketingMitraID,
      MarketingUserID: r.MarketingUserID,
      MarketingNama: nameMap.get(Number(r.MarketingUserID)) ?? "Tidak diketahui",
      BusinessPartnerID: r.BusinessPartnerID,
      MitraName: r.MitraName,
      Wilayah: r.Wilayah,
      Kecamatan: r.Kecamatan,
      Capacity: r.Capacity,
      JoinDate: r.JoinDate,
      CreatedAt: r.CreatedAt,
    }))
    .sort((a, b) => a.MarketingNama.localeCompare(b.MarketingNama) || a.MitraName.localeCompare(b.MitraName));
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
    throw new AppError("Mitra ini sudah memiliki Marketing penanggung jawab prioritas.");
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

// Mitra whose approved Pengajuan was proposed by a marketing outside that
// mitra's own Wilayah/Kecamatan coverage — the proposer stays responsible
// regardless of territory, same override tier as an admin-set Mitra
// Prioritas assignment (both feed the same override Map; Prioritas wins on
// conflict — merged at each call site, not here). Computed live off
// DashboardMitraPengajuan's already-permanent MarketingUserID +
// ConvertedBusinessPartnerID link — no migration needed, this covers every
// historical approval automatically.
//
// MarketingUserID here is a Postgres akun.id (same convention as
// getMarketingWilayahAssignments above) — resolved to a name via a
// separate Postgres query, never JOINed against an MSSQL table.
export async function getCrossWilayahProposalOverrides(
  assignments: MarketingWilayahAssignment[]
): Promise<Map<string, string>> {
  const mssqlPool = await getPool();
  const pgPool = getPgPool();

  const result = await mssqlPool.request().query(`
    SELECT p.MarketingUserID, p.ConvertedBusinessPartnerID AS BusinessPartnerID,
           ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
           bp.NPWPAddress AS Kecamatan
    FROM DashboardMitraPengajuan p
    JOIN BusinessPartner bp ON bp.BusinessPartnerID = p.ConvertedBusinessPartnerID
    WHERE p.Status = 'Disetujui' AND p.ConvertedBusinessPartnerID IS NOT NULL
  `);
  const rows = result.recordset as {
    MarketingUserID: string;
    BusinessPartnerID: string;
    Wilayah: string;
    Kecamatan: string | null;
  }[];

  const akunIds = [...new Set(rows.map((r) => Number(r.MarketingUserID)).filter(Number.isFinite))];
  const nameMap = new Map<number, string>();
  if (akunIds.length > 0) {
    const namesResult = await pgPool.query(`SELECT id, nama FROM akun WHERE id = ANY($1::int[])`, [akunIds]);
    for (const r of namesResult.rows as { id: number; nama: string }[]) nameMap.set(r.id, r.nama);
  }

  const overrides = new Map<string, string>();
  for (const r of rows) {
    const marketingNama = nameMap.get(Number(r.MarketingUserID));
    if (!marketingNama) continue;
    // "Cross-wilayah" = no assignment row for THIS marketing covers the
    // mitra's actual Wilayah/Kecamatan — same matching order as
    // resolveResponsibleMarketing() itself (specific Kecamatan, then
    // whole-Wilayah), just checked in the opposite direction (does this
    // marketing's own coverage include this mitra, not "who covers it").
    const ownAssignments = assignments.filter((a) => a.MarketingNama === marketingNama);
    const covered = ownAssignments.some(
      (a) => a.Wilayah === r.Wilayah && (a.Kecamatan === r.Kecamatan || a.Kecamatan === null)
    );
    if (!covered) overrides.set(r.BusinessPartnerID, marketingNama);
  }
  return overrides;
}

// Single source of truth for "who owns this mitra" override resolution —
// every caller that needs the final merged override Map (not the
// per-source breakdown) should use this instead of assembling the merge
// itself. Prioritas wins over cross-wilayah on conflict (crossWilayah
// spread first, prioritas second).
export async function resolveMitraOverrideSources(assignments: MarketingWilayahAssignment[]): Promise<{
  crossWilayahOverrides: Map<string, string>;
  prioritasOverrides: Map<string, string>;
  merged: Map<string, string>;
}> {
  const [mitraAssignments, crossWilayahOverrides] = await Promise.all([
    getMarketingMitraAssignments(),
    getCrossWilayahProposalOverrides(assignments),
  ]);
  const prioritasOverrides = buildMitraOverrideMap(mitraAssignments);
  const merged = new Map([...crossWilayahOverrides, ...prioritasOverrides]);
  return { crossWilayahOverrides, prioritasOverrides, merged };
}

// Convenience wrapper for callers that only need final ownership
// resolution, not the per-source breakdown (Task 3's per-row
// IsCrossWilayahProposal/IsPriorityOverride flags need the breakdown —
// use resolveMitraOverrideSources for those instead).
export async function resolveMitraOverrides(assignments: MarketingWilayahAssignment[]): Promise<Map<string, string>> {
  return (await resolveMitraOverrideSources(assignments)).merged;
}
