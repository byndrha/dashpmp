// src/lib/queries/marketing-ownership.ts
//
// Single source of truth for "who owns this mitra" for NOO/Existing
// performance tracking — shared by the Kinerja Karyawan payroll module
// (permanent ownership, see resolveAllMitraOwnership) and the Pemasaran
// dashboard's operational panels (hybrid ownership, see resolveHybridOwner).
// Confirmed with user 2026-09-24: unifying these after finding the two
// pages showed different NOO figures for the same Marketing/month (MKT 02,
// September 2026: 1.320 on Pemasaran vs 539 on Kinerja) because they used
// two independently-built attribution/classification systems.
import { getPool } from "@/lib/db";
import { getBusinessDateWithRollover, ROLLOVER_HOUR } from "@/lib/business-date";
import {
  getMarketingUsers,
  getMarketingWilayahAssignments,
  resolveResponsibleMarketing,
  resolveMitraOverrideSources,
  type MarketingWilayahAssignment,
} from "@/lib/queries/marketing-wilayah";

// A mitra counts as NOO for exactly 30 days starting its nooStartDate —
// confirmed with user 2026-09-16 via a worked example (approved 20 Sep ->
// NOO through 20 Oct inclusive, Existing from 21 Oct onward). Shared here
// (not just owned by the Kinerja payroll module anymore) since the
// Pemasaran dashboard's trend/target panels now apply the identical rule
// (confirmed with user 2026-09-24).
export const NOO_WINDOW_DAYS = 30;

export interface MitraOwnership {
  businessPartnerId: string;
  /** akun.id as a string, matching MarketingUserID's/session.user.id's convention. */
  ownerAkunId: string;
  /**
   * UTC-midnight-labeled WIB business-date the mitra's 30-day NOO window
   * starts counting from. For a mitra with an approved Pengajuan, this is
   * the Pengajuan's ReviewedAt (approval moment), business-date-labeled.
   * For a "legacy" mitra created directly in the ERP with no Pengajuan
   * trail, this falls back to BusinessPartner.JoinDate (confirmed with
   * user 2026-09-24) — the only date available for when that mitra came
   * online. Null only when NEITHER exists (no Pengajuan and no JoinDate on
   * record), in which case the mitra can never be classified NOO and is
   * always Existing.
   */
  nooStartDate: Date | null;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
}

/** True if `today` falls within [nooStartDate, nooStartDate + NOO_WINDOW_DAYS]. */
export function isMitraCurrentlyNoo(ownership: MitraOwnership | undefined, today: Date): boolean {
  if (!ownership?.nooStartDate) return false;
  const windowEnd = addDays(ownership.nooStartDate, NOO_WINDOW_DAYS);
  return today.getTime() >= ownership.nooStartDate.getTime() && today.getTime() <= windowEnd.getTime();
}

interface ApprovedPengajuanRow {
  MarketingUserID: string;
  BusinessPartnerID: string;
  ReviewedAt: Date;
}

async function getApprovedPengajuanWithReviewedAt(): Promise<ApprovedPengajuanRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT p.MarketingUserID, p.ConvertedBusinessPartnerID AS BusinessPartnerID, p.ReviewedAt
    FROM DashboardMitraPengajuan p
    WHERE p.Status = 'Disetujui' AND p.ConvertedBusinessPartnerID IS NOT NULL
  `);
  return result.recordset as ApprovedPengajuanRow[];
}

async function getAllBusinessPartnerBasics(): Promise<
  { BusinessPartnerID: string; Wilayah: string | null; Kecamatan: string | null; JoinDate: string | null }[]
> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT bp.BusinessPartnerID,
           ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
           bp.NPWPAddress AS Kecamatan,
           bp.JoinDate
    FROM BusinessPartner bp
  `);
  return result.recordset as { BusinessPartnerID: string; Wilayah: string | null; Kecamatan: string | null; JoinDate: string | null }[];
}

/**
 * Resolves PERMANENT ownership for every BusinessPartner in the ERP — the
 * Marketing/Driver akun credited forever for this mitra, regardless of
 * later Wilayah/Kecamatan reassignment. Call once per page load and reuse
 * the resulting array — this does a handful of MSSQL/Postgres round-trips
 * total, not one per mitra.
 */
export async function resolveAllMitraOwnership(): Promise<MitraOwnership[]> {
  const [approvedPengajuan, allMitra, assignments, marketingUsers] = await Promise.all([
    getApprovedPengajuanWithReviewedAt(),
    getAllBusinessPartnerBasics(),
    getMarketingWilayahAssignments(),
    getMarketingUsers(),
  ]);
  const { merged: mitraOverrides } = await resolveMitraOverrideSources(assignments);
  const namaToAkunId = new Map(marketingUsers.map((m) => [m.Nama, m.UserID]));

  const pengajuanByMitra = new Map<string, ApprovedPengajuanRow>();
  for (const p of approvedPengajuan) {
    if (!pengajuanByMitra.has(p.BusinessPartnerID)) pengajuanByMitra.set(p.BusinessPartnerID, p);
  }

  const ownerships: MitraOwnership[] = [];
  for (const mitra of allMitra) {
    const pengajuan = pengajuanByMitra.get(mitra.BusinessPartnerID);
    if (pengajuan) {
      // ReviewedAt is set via GETDATE() in approvePengajuan() — confirmed
      // live this server's SQL Server clock is genuinely UTC, so
      // ReviewedAt is a TRUE UTC instant. getBusinessDateWithRollover
      // applies the same 14:00 WIB rollover TransDate's own business-date
      // labels use.
      ownerships.push({
        businessPartnerId: mitra.BusinessPartnerID,
        ownerAkunId: pengajuan.MarketingUserID,
        nooStartDate: getBusinessDateWithRollover(ROLLOVER_HOUR, pengajuan.ReviewedAt),
      });
      continue;
    }
    // Legacy mitra (or a mitra whose approving Pengajuan row was later
    // hard-deleted) — ownership falls back to whoever currently covers its
    // Wilayah/Kecamatan (or holds an admin Prioritas override), and its
    // NOO window (if any) falls back to JoinDate — confirmed with user
    // 2026-09-24: a mitra entered directly in the ERP still gets a 30-day
    // NOO window, just measured from JoinDate instead of a Pengajuan
    // approval that never happened.
    const ownerName = resolveResponsibleMarketing(
      mitra.BusinessPartnerID,
      mitra.Wilayah,
      mitra.Kecamatan,
      assignments,
      mitraOverrides
    );
    const ownerAkunId = ownerName ? namaToAkunId.get(ownerName) : undefined;
    if (!ownerAkunId) continue; // unassigned mitra — excluded, matches existing convention
    ownerships.push({
      businessPartnerId: mitra.BusinessPartnerID,
      ownerAkunId,
      nooStartDate: mitra.JoinDate ? new Date(mitra.JoinDate) : null,
    });
  }
  return ownerships;
}

/**
 * "Hybrid" ownership for the Pemasaran dashboard's operational panels
 * (Kinerja Marketing target-harian in marketing-performance.ts, Pangsa
 * Pasar in pangsa-pasar-trend.ts) — deliberately NOT the same as
 * resolveAllMitraOwnership's fully-permanent rule the payroll module uses.
 * Confirmed with user 2026-09-24:
 *   1. An admin-set Mitra Prioritas override always wins (unchanged from
 *      before this file existed).
 *   2. A mitra currently inside its 30-day NOO window stays permanently
 *      attributed to whoever registered it (its resolveAllMitraOwnership
 *      owner), even if that owner's Wilayah/Kecamatan coverage has since
 *      changed or no longer includes this mitra.
 *   3. Once a mitra's NOO window has ended (or it was never NOO), it
 *      follows the LIVE Wilayah/Kecamatan assignment instead — whoever
 *      covers that area today, not who registered it.
 * `ownershipByMitra`/`akunIdToNama` are precomputed by the caller (from
 * resolveAllMitraOwnership() + getMarketingUsers()) so this stays a pure,
 * per-mitra function safe to call once per row without extra DB round
 * trips.
 */
export function resolveHybridOwner(
  businessPartnerId: string,
  wilayah: string | null,
  kecamatan: string | null,
  assignments: MarketingWilayahAssignment[],
  prioritasOverrides: Map<string, string>,
  ownershipByMitra: Map<string, MitraOwnership>,
  akunIdToNama: Map<string, string>,
  today: Date
): { marketingNama: string | null; isCurrentlyNoo: boolean } {
  const ownership = ownershipByMitra.get(businessPartnerId);
  const isCurrentlyNoo = isMitraCurrentlyNoo(ownership, today);

  const prioritas = prioritasOverrides.get(businessPartnerId);
  if (prioritas) return { marketingNama: prioritas, isCurrentlyNoo };

  if (isCurrentlyNoo && ownership) {
    return { marketingNama: akunIdToNama.get(ownership.ownerAkunId) ?? null, isCurrentlyNoo };
  }

  const liveWilayah = resolveResponsibleMarketing(businessPartnerId, wilayah, kecamatan, assignments);
  return { marketingNama: liveWilayah, isCurrentlyNoo };
}
