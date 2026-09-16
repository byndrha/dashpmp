// src/lib/kinerja/marketing-collection-attribution.ts
//
// Business-rule-specific mitra ownership resolution for the "Marketing
// and Collection" jabatan's "Penjualan" aspek. Every mitra (BusinessPartner)
// is attributed to exactly one owning Marketing akun.id, with a status:
// NOO for exactly the calendar month their Pengajuan was approved, then
// permanently Existing afterward — OR permanently Existing from the start
// if they have no approved Pengajuan at all (legacy mitra).
//
// Deliberately NOT reusing resolveResponsibleMarketing() as the sole
// resolution path: that function's wilayah-based assignment is
// live/retroactive (an assignment change today silently reshapes past
// months' figures in the OLD "Kinerja Marketing" panel — see its own
// design note), which is the opposite of what THIS feature needs for NOO
// credit (permanent, tied to whoever actually submitted the winning
// Pengajuan). It IS reused as the fallback for mitra with no Pengajuan
// trail (legacy mitra), matching this plan's explicit design decision. That
// fallback resolves overrides via the merged Prioritas + cross-wilayah
// override map (resolveMitraOverrideSources) — the same canonical merge
// every other resolveResponsibleMarketing() caller in the codebase uses —
// so an admin-set per-mitra Pemilik override is honored here too, not just
// cross-wilayah Pengajuan overrides.
import { getPool } from "@/lib/db";
import {
  getMarketingWilayahAssignments,
  getMarketingUsers,
  resolveMitraOverrideSources,
  resolveResponsibleMarketing,
} from "@/lib/queries/marketing-wilayah";

export interface MitraOwnership {
  businessPartnerId: string;
  /** akun.id as a string, matching MarketingUserID's/session.user.id's convention. */
  ownerAkunId: string;
  /** UTC-midnight first-of-month the mitra became NOO, or null if it was never NOO (legacy mitra, permanently Existing). */
  nooMonthStart: Date | null;
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
  { BusinessPartnerID: string; Wilayah: string | null; Kecamatan: string | null }[]
> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT bp.BusinessPartnerID,
           ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
           bp.NPWPAddress AS Kecamatan
    FROM BusinessPartner bp
  `);
  return result.recordset as { BusinessPartnerID: string; Wilayah: string | null; Kecamatan: string | null }[];
}

function monthBoundaryUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * Resolves ownership for every BusinessPartner in the ERP. Call once per
 * page load and reuse the resulting array — this does a handful of
 * MSSQL/Postgres round-trips total, not one per mitra.
 */
export async function resolveAllMitraOwnership(): Promise<MitraOwnership[]> {
  const [approvedPengajuan, allMitra, assignments, marketingUsers] = await Promise.all([
    getApprovedPengajuanWithReviewedAt(),
    getAllBusinessPartnerBasics(),
    getMarketingWilayahAssignments(),
    getMarketingUsers(),
  ]);
  const { merged: mitraOverrides } = await resolveMitraOverrideSources(assignments);

  // Nama -> akun.id reverse lookup — see Global Constraints for why this
  // is needed (resolveResponsibleMarketing returns a display name).
  const namaToAkunId = new Map(marketingUsers.map((m) => [m.Nama, m.UserID]));

  // Approved Pengajuan keyed by the mitra it produced. If duplicates ever
  // exist (should not, per the app-level claim-then-act approval logic),
  // the first one found wins.
  const pengajuanByMitra = new Map<string, ApprovedPengajuanRow>();
  for (const p of approvedPengajuan) {
    if (!pengajuanByMitra.has(p.BusinessPartnerID)) pengajuanByMitra.set(p.BusinessPartnerID, p);
  }

  const ownerships: MitraOwnership[] = [];
  for (const mitra of allMitra) {
    const pengajuan = pengajuanByMitra.get(mitra.BusinessPartnerID);
    if (pengajuan) {
      ownerships.push({
        businessPartnerId: mitra.BusinessPartnerID,
        ownerAkunId: pengajuan.MarketingUserID,
        nooMonthStart: monthBoundaryUtc(pengajuan.ReviewedAt),
      });
      continue;
    }
    // Legacy mitra, or a mitra whose approving Pengajuan row was later
    // hard-deleted (deletePengajuan does not touch BusinessPartner) —
    // both fall here automatically, no special-casing needed.
    const ownerName = resolveResponsibleMarketing(
      mitra.BusinessPartnerID,
      mitra.Wilayah,
      mitra.Kecamatan,
      assignments,
      mitraOverrides
    );
    const ownerAkunId = ownerName ? namaToAkunId.get(ownerName) : undefined;
    if (!ownerAkunId) continue; // unassigned mitra — excluded, matches existing convention
    ownerships.push({ businessPartnerId: mitra.BusinessPartnerID, ownerAkunId, nooMonthStart: null });
  }
  return ownerships;
}
