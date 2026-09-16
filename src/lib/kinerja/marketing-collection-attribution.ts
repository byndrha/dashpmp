// src/lib/kinerja/marketing-collection-attribution.ts
//
// Business-rule-specific mitra ownership resolution for the "Marketing
// and Collection" jabatan's "Penjualan" aspek. Every mitra (BusinessPartner)
// is attributed to exactly one owning Marketing akun.id, with a status:
// NOO for a rolling 30-day window starting the WIB business-date their
// Pengajuan was approved (see NOO_WINDOW_DAYS in
// marketing-collection-penjualan.ts, which owns the day-level NOO/Existing
// split — this module only records WHEN the window starts), then
// permanently Existing afterward — OR permanently Existing from the start
// if they have no approved Pengajuan at all (legacy mitra). Confirmed with
// user 2026-09-16: a mitra approved e.g. 20 Sep can contribute to NOO
// totals in BOTH September (20-30 Sep) and October (1-20 Oct) if the
// 30-day window straddles the month boundary — NOO is no longer "the
// single calendar month of approval."
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
import { getBusinessDateWithRollover, ROLLOVER_HOUR } from "@/lib/business-date";
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
  /**
   * UTC-midnight-labeled WIB business-date (14:00 rollover, same labeling
   * TransDate itself uses) the mitra's Pengajuan was approved — day
   * granularity, NOT floored to month start. The 30-day NOO window is
   * [nooStartDate, nooStartDate + 30 days], computed by the caller
   * (marketing-collection-penjualan.ts owns the window-length constant).
   * Null if the mitra was never NOO (legacy mitra, permanently Existing).
   */
  nooStartDate: Date | null;
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
      // ReviewedAt is set via GETDATE() in approvePengajuan() — confirmed
      // live that this server's SQL Server clock is genuinely UTC, so
      // ReviewedAt is a TRUE UTC instant, unlike TransDate elsewhere in
      // this codebase (SalesOrder/DeliveryOrder/SalesInvoice/SalesReturn),
      // which the desktop-ERP client writes as naive-WIB. Extracting the
      // WIB business-date directly off ReviewedAt's raw UTC components
      // would misclassify any approval made 17:00-23:59 UTC (00:00-06:59
      // WIB) into the previous WIB calendar day. getBusinessDateWithRollover
      // takes the raw true-UTC instant directly (it converts via
      // Intl.DateTimeFormat internally) and applies the same 14:00 WIB
      // rollover TransDate's own business-date labels use, so a day-level
      // comparison against TransDate values downstream is apples-to-apples.
      ownerships.push({
        businessPartnerId: mitra.BusinessPartnerID,
        ownerAkunId: pengajuan.MarketingUserID,
        nooStartDate: getBusinessDateWithRollover(ROLLOVER_HOUR, pengajuan.ReviewedAt),
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
    ownerships.push({ businessPartnerId: mitra.BusinessPartnerID, ownerAkunId, nooStartDate: null });
  }
  return ownerships;
}
