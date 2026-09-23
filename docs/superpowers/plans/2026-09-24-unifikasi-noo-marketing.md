# Unifikasi NOO Marketing (Pemasaran vs Kinerja) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat angka NOO Marketing di `/mkesindo/pemasaran` (Matriks Performa Marketing) sama persis dengan `/mkesindo/kinerja` untuk Marketing/bulan yang sama, dengan satu aturan kepemilikan mitra yang dipakai bersama, bukan dua sistem independen.

**Architecture:** Ekstrak `resolveAllMitraOwnership()` (aturan permanen: pemilik = siapa yang Pengajuan-nya disetujui, jendela NOO 30 hari rolling dari `ReviewedAt`, fallback ke `JoinDate` untuk mitra legacy tanpa Pengajuan) dari `src/lib/kinerja/` ke lokasi bersama `src/lib/queries/marketing-ownership.ts`, lalu tambahkan `resolveHybridOwner()` di file yang sama untuk kebutuhan operasional Pemasaran (Prioritas > mitra-yang-masih-NOO permanen ke pendaftar > mitra Existing ikut wilayah-live). `marketing-performance-trend.ts` (angka yang dibandingkan user) beralih penuh ke `resolveAllMitraOwnership()` sehingga identik dengan Kinerja; `marketing-performance.ts` dan `pangsa-pasar-trend.ts` beralih ke `resolveHybridOwner()`. Dua komponen client (`marketing-performance-panel.tsx`, `kinerja-marketing-sub-tab.tsx`) berhenti menghitung ulang NOO dari `JoinDate` dan cukup baca flag `IsCurrentlyNoo` yang sudah dihitung di server.

**Tech Stack:** Next.js (App Router, server components), TypeScript, `mssql` (MSSQL) untuk data ERP, `pg` (Postgres) untuk `akun`. Tidak ada test runner terpasang (tidak ada Jest/Vitest) — verifikasi lewat `tsc`/`next build` plus skrip `tsx` sekali-pakai yang membandingkan angka nyata.

**Spec:** Keputusan bisnis dikonfirmasi langsung di percakapan ini (2026-09-24) — lihat "Global Constraints" di bawah untuk rumusan persisnya. Tidak ada dokumen spec terpisah.

## Global Constraints

- NOO = jendela 30 hari rolling dari `nooStartDate`, BUKAN "sebulan kalender penuh" — `nooStartDate` = `ReviewedAt` Pengajuan yang disetujui (`DashboardMitraPengajuan`), business-date-labeled dengan `ROLLOVER_HOUR` (sama seperti sekarang di `marketing-collection-attribution.ts`).
- Mitra "legacy" (dibuat langsung di ERP, tidak lewat Pengajuan-approval dashboard) tetap dapat jendela NOO 30 hari, tapi diukur dari `BusinessPartner.JoinDate` (satu-satunya tanggal yang tersedia untuk mitra jenis ini) — dikonfirmasi user.
- Kepemilikan (atribusi mitra ke Marketing) untuk kredit NOO/Existing permanen: SELALU ikut siapa yang mendaftarkan (submitter Pengajuan yang disetujui), TIDAK PERNAH bergeser walau assignment Wilayah berubah atau mitra sudah lewat 30 hari jadi Existing. Ini aturan `/mkesindo/kinerja` yang sudah ada — sekarang jadi aturan bersama untuk kredit NOO di kedua halaman.
- Untuk panel operasional Pemasaran (Target Harian di "Kinerja Marketing", dan "Pangsa Pasar & Kontribusi Internal"): Mitra Prioritas (admin override) selalu permanen ke Marketing yang di-assign; mitra yang MASIH dalam jendela NOO permanen ke pendaftarnya (walau sekarang berada di wilayah Marketing lain); mitra yang SUDAH Existing (bukan Prioritas) ikut pembagian Wilayah/Kecamatan yang berlaku SEKARANG (live), bukan permanen.
- Jangan ubah `resolveMitraOverrideSources`/`getCrossWilayahProposalOverrides`/`resolveMitraOverrides` di `src/lib/queries/marketing-wilayah.ts` — dipakai konsumen lain (`mitra-do.ts`, `mitra.ts`, `sales-overview-marketing.ts`, `marketing-visit-log-status.ts`, `driver-app/actions.ts`) yang di luar scope perubahan ini.
- Jangan ubah `pangsa-pasar-trend.ts`'s aturan "kapan mitra dihitung masuk roster bulan itu" (`JoinDate < nextMonthStart`) — hanya atribusi (siapa marketing-nya) yang berubah ke `resolveHybridOwner()`, sama seperti `marketing-performance.ts`.
- Semua tanggal dibangun via `Date.UTC(...)`/helper `business-date.ts` yang sudah ada — jangan parse string tanggal langsung (lihat komentar-komentar existing tentang risiko timezone).

## Review Focus

- Mitra legacy tanpa `JoinDate` SAMA SEKALI (bukan cuma tanpa Pengajuan) — `nooStartDate` jadi `null` selamanya → harus tidak pernah dihitung NOO di manapun (Total sekalipun), bukan crash atau `NaN`.
- Mitra yang NOO window-nya berakhir DI TENGAH bulan berjalan (straddle) — qty & headcount bulan itu harus terbagi antara bucket NOO dan Existing, bukan semuanya jatuh ke satu bucket.
- Marketing yang sudah tidak punya assignment Wilayah/Kecamatan aktif sama sekali (pindah/keluar) tapi masih punya mitra ber-status NOO permanen miliknya — harus tetap muncul sebagai baris di Matriks Performa Marketing, bukan hilang karena dulu baris hanya muncul untuk Marketing yang punya `DashboardMarketingWilayah`.
- Mitra Prioritas (`DashboardMarketingMitra` override) yang `JoinDate`-nya kebetulan jatuh bulan berjalan — di UI lama diam-diam hilang dari section "Mitra Prioritas" (lihat Task 6); setelah perubahan ini harus selalu tampil di situ, tidak boleh hilang lagi maupun dobel-tampil di section lain.
- `getMarketingPerformanceTrend`/`getMarketingPerformance` dipanggil dengan `Promise.all` bersama query lain di `page.tsx` — pastikan tidak ada query N+1 baru yang tak sengaja masuk ke dalam loop per-hari/per-bulan (mis. `getMonthlyCapacitySnapshot`/`getArmadaNooDailyCapacity` tetap dipanggil sekali per bulan, bukan per mitra).

---

## File Structure

- **Create:** `src/lib/queries/marketing-ownership.ts` — modul bersama: `resolveAllMitraOwnership()` (aturan permanen, dipindah dari `lib/kinerja/marketing-collection-attribution.ts` + fallback `JoinDate`), `resolveHybridOwner()` (aturan hybrid, baru), `isMitraCurrentlyNoo()`, `NOO_WINDOW_DAYS`, tipe `MitraOwnership`.
- **Delete:** `src/lib/kinerja/marketing-collection-attribution.ts` (isinya pindah seluruhnya ke atas).
- **Modify:** `src/lib/kinerja/marketing-collection-penjualan.ts` — ganti import ke lokasi baru, hapus `NOO_WINDOW_DAYS` lokal.
- **Modify:** `src/lib/queries/marketing-performance-trend.ts` — tulis ulang penuh: atribusi + klasifikasi NOO/Existing dari `resolveAllMitraOwnership()`, granularitas harian (bukan bulanan).
- **Modify:** `src/lib/queries/marketing-performance.ts` — `getCell()` pakai `resolveHybridOwner()`; field `IsCrossWilayahProposal` di `MarketingScopeAllMitra` diganti `IsCurrentlyNoo`.
- **Modify:** `src/lib/queries/pangsa-pasar-trend.ts` — atribusi pakai `resolveHybridOwner()` menggantikan `resolveResponsibleMarketing()` + `resolveMitraOverrides()` langsung.
- **Modify:** `src/components/dashboard/marketing-performance-panel.tsx` — `isExisting`/`isNoo` baca `IsCurrentlyNoo` langsung, hapus math `JoinDate`/`currentMonthStartISO`.
- **Modify:** `src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx` — sama seperti di atas untuk `semuaMitraRoster`/`nooRoster`.

---

### Task 1: Modul kepemilikan mitra bersama (`marketing-ownership.ts`)

**Files:**
- Create: `src/lib/queries/marketing-ownership.ts`
- Delete: `src/lib/kinerja/marketing-collection-attribution.ts`
- Test: `scripts/_scratch_verify_marketing_ownership.ts` (skrip verifikasi manual, dijalankan lewat `npx tsx`, dihapus di Task 7 setelah lolos)

**Interfaces:**
- Produces: `NOO_WINDOW_DAYS: number`, `interface MitraOwnership { businessPartnerId: string; ownerAkunId: string; nooStartDate: Date | null }`, `async function resolveAllMitraOwnership(): Promise<MitraOwnership[]>`, `function isMitraCurrentlyNoo(ownership: MitraOwnership | undefined, today: Date): boolean`, `function resolveHybridOwner(businessPartnerId: string, wilayah: string | null, kecamatan: string | null, assignments: MarketingWilayahAssignment[], prioritasOverrides: Map<string, string>, ownershipByMitra: Map<string, MitraOwnership>, akunIdToNama: Map<string, string>, today: Date): { marketingNama: string | null; isCurrentlyNoo: boolean }`

- [ ] **Step 1: Buat file baru dengan isi lengkap**

```typescript
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
```

- [ ] **Step 2: Hapus file lama yang isinya sudah dipindah**

Hapus `src/lib/kinerja/marketing-collection-attribution.ts` sepenuhnya (seluruh isinya sudah ada di file baru Step 1 dengan satu tambahan: fallback `nooStartDate: mitra.JoinDate ? new Date(mitra.JoinDate) : null` menggantikan `nooStartDate: null` yang lama).

- [ ] **Step 3: Cek tidak ada import lama yang masih menunjuk file yang dihapus**

Run: `grep -rn "marketing-collection-attribution" src/`
Expected: tidak ada hasil (semua sudah dipindah/diupdate di Task 2).

Ini akan tetap gagal sampai Task 2 selesai — jangan commit Task 1 sendirian sebelum Task 2 (keduanya satu commit, lihat Step 4).

- [ ] **Step 4: Commit bersama Task 2**

Jangan commit di sini — lanjut ke Task 2 dulu, lalu commit keduanya sekaligus di akhir Task 2 (memindah sebuah file dan memperbaiki satu-satunya pemakainya adalah satu perubahan logis, bukan dua).

---

### Task 2: Pindahkan pemakai `marketing-collection-attribution.ts` ke modul baru

**Files:**
- Modify: `src/lib/kinerja/marketing-collection-penjualan.ts:1-8` (import), `:84` (hapus `NOO_WINDOW_DAYS` lokal)

**Interfaces:**
- Consumes: `resolveAllMitraOwnership`, `NOO_WINDOW_DAYS`, `type MitraOwnership` dari `@/lib/queries/marketing-ownership` (Task 1)

- [ ] **Step 1: Ganti import**

Di `src/lib/kinerja/marketing-collection-penjualan.ts`, ganti:

```typescript
import { resolveAllMitraOwnership, type MitraOwnership } from "@/lib/kinerja/marketing-collection-attribution";
```

menjadi:

```typescript
import { resolveAllMitraOwnership, NOO_WINDOW_DAYS, type MitraOwnership } from "@/lib/queries/marketing-ownership";
```

- [ ] **Step 2: Hapus konstanta `NOO_WINDOW_DAYS` lokal**

Hapus definisi lokal ini (sekarang diimpor dari modul bersama, jangan dobel):

```typescript
const NOO_WINDOW_DAYS = 30;
```

(beserta komentar di atasnya yang menjelaskan aturan 30 hari — komentar itu sudah dipindah ke `marketing-ownership.ts` di Task 1).

- [ ] **Step 3: Verifikasi build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: tidak ada error di `marketing-collection-penjualan.ts` atau file yang mengimpor `marketing-collection-attribution` (harus nol, lihat Task 1 Step 3).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/marketing-ownership.ts src/lib/kinerja/marketing-collection-attribution.ts src/lib/kinerja/marketing-collection-penjualan.ts
git commit -m "refactor: pindahkan resolveAllMitraOwnership ke modul bersama marketing-ownership"
```

(`git add` pada file yang dihapus otomatis men-stage penghapusannya.)

---

### Task 3: `marketing-performance-trend.ts` — samakan NOO dengan Kinerja

**Files:**
- Modify: `src/lib/queries/marketing-performance-trend.ts` (tulis ulang penuh)

**Interfaces:**
- Consumes: `resolveAllMitraOwnership`, `NOO_WINDOW_DAYS`, `type MitraOwnership` dari `@/lib/queries/marketing-ownership` (Task 1); `getMarketingUsers` dari `@/lib/queries/marketing-wilayah`; `getMonthlyCapacitySnapshot`, `getArmadaNooDailyCapacity` (tidak berubah)
- Produces: `CategoryAnatomy`, `MarketingTrendMonth`, `MarketingTrendRow`, `MarketingPerformanceTrendData`, `getMarketingPerformanceTrend(monthsBack: number)` — signature & shape TIDAK berubah, dipakai oleh `pemasaran/page.tsx` dan `pangsa-pasar-trend.ts` apa adanya.

- [ ] **Step 1: Tulis ulang seluruh file**

```typescript
import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";
import { getMarketingUsers } from "@/lib/queries/marketing-wilayah";
import { getMonthlyCapacitySnapshot } from "@/lib/queries/mitra-capacity-snapshot";
import { getArmadaNooDailyCapacity } from "@/lib/queries/armada-noo-target";
import { resolveAllMitraOwnership, NOO_WINDOW_DAYS } from "@/lib/queries/marketing-ownership";

const KANTONG_QTY_EXPR = `SUM(CASE WHEN dod.Name LIKE '%5 KG%' THEN dod.Delivered / 2.0 ELSE dod.Delivered END)`;

export interface CategoryAnatomy {
  general: number;
  bagQtyActual: number;
  bagQtyTarget: number;
  pct: number | null;
}

export interface MarketingTrendMonth {
  monthStartISO: string;
  existing: CategoryAnatomy;
  noo: CategoryAnatomy;
  total: CategoryAnatomy;
}

export interface MarketingTrendRow {
  MarketingUserID: string;
  MarketingNama: string;
  months: MarketingTrendMonth[];
}

export interface MarketingPerformanceTrendData {
  months: string[];
  rows: MarketingTrendRow[];
  combined: MarketingTrendMonth[];
}

function daysInMonth(monthStart: Date): number {
  return Math.round((monthBoundary(monthStart, 1).getTime() - monthStart.getTime()) / 86400000);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
}

function makeAnatomy(): CategoryAnatomy {
  return { general: 0, bagQtyActual: 0, bagQtyTarget: 0, pct: null };
}

function makeMonth(monthStartISO: string): MarketingTrendMonth {
  return { monthStartISO, existing: makeAnatomy(), noo: makeAnatomy(), total: makeAnatomy() };
}

function finalizeAnatomy(a: CategoryAnatomy): void {
  a.pct = a.bagQtyTarget > 0 ? (a.bagQtyActual / a.bagQtyTarget) * 100 : null;
}

interface DailyRow {
  BusinessPartnerID: string;
  TransDate: string;
  QtyKantong: number;
}

// Per-Marketing (plus a company-wide `combined` row) monthly trend of
// Existing/NOO/Total — "Matriks Performa Marketing" (spec §5). `monthsBack`
// is 3 (default) or 12 (expanded) months ending at the current WIB business
// month, oldest first.
//
// NOO/Existing classification AND ownership now come from
// resolveAllMitraOwnership() (src/lib/queries/marketing-ownership.ts) — the
// SAME permanent-ownership + 30-day-rolling-window rule the Kinerja
// Karyawan payroll module (getHistoriPenjualanSemuaKaryawan) uses, so a
// Marketing's NOO qty here now matches their NOO qty on /mkesindo/kinerja
// exactly. Confirmed with user 2026-09-24 after the two pages were found
// showing different NOO figures for the same person/month (MKT 02,
// September 2026: 1.320 here vs 539 on Kinerja) — root cause was two
// independent rules (JoinDate-in-calendar-month + live Wilayah attribution
// here, vs Pengajuan-approval-30-day-window + permanent attribution on
// Kinerja). This file used the OLD rule until this change.
export async function getMarketingPerformanceTrend(monthsBack: number): Promise<MarketingPerformanceTrendData> {
  const pool = await getPool();
  const businessToday = getBusinessDate();
  const currentMonthStart = monthBoundary(businessToday);

  const monthStarts: Date[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) monthStarts.push(monthBoundary(currentMonthStart, -i));
  const earliestMonthStart = monthStarts[0];
  const rangeEnd = monthBoundary(currentMonthStart, 1);

  const [marketingUsers, ownerships, dailyResult] = await Promise.all([
    getMarketingUsers(),
    resolveAllMitraOwnership(),
    pool
      .request()
      .input("rangeStart", sql.Date, earliestMonthStart)
      .input("rangeEnd", sql.Date, rangeEnd)
      .query(`
        SELECT
            bp.BusinessPartnerID,
            CAST(do_.TransDate AS DATE) AS TransDate,
            ${KANTONG_QTY_EXPR} AS QtyKantong
        FROM DeliveryOrder do_
        JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
        JOIN BusinessPartner bp ON bp.BusinessPartnerID = do_.BusinessPartnerID
        WHERE do_.IsDeleted = 0
          AND do_.TransDate >= @rangeStart AND do_.TransDate < @rangeEnd
        GROUP BY bp.BusinessPartnerID, CAST(do_.TransDate AS DATE)
      `),
  ]);

  const ownershipByMitra = new Map(ownerships.map((o) => [o.businessPartnerId, o]));
  const monthsISO = monthStarts.map((m) => m.toISOString().slice(0, 10));

  // Every Marketing who owns at least one mitra gets a row — permanent
  // ownership per Global Constraints, so this deliberately no longer
  // requires a currently-active DashboardMarketingWilayah assignment (a
  // Marketing who moved wilayah or left keeps their historical NOO/Existing
  // credit and must still show up here).
  const marketingIdsWithScope = new Set(ownerships.map((o) => o.ownerAkunId));
  const rows: MarketingTrendRow[] = [...marketingIdsWithScope].map((userId) => ({
    MarketingUserID: userId,
    MarketingNama: marketingUsers.find((u) => u.UserID === userId)?.Nama ?? "Tidak diketahui",
    months: monthsISO.map((iso) => makeMonth(iso)),
  }));
  const rowByMarketing = new Map(rows.map((r) => [r.MarketingUserID, r]));
  const combined: MarketingTrendMonth[] = monthsISO.map((iso) => makeMonth(iso));

  // Headcount (`general`): once per mitra per month it qualifies, decided
  // purely from the NOO-window dates (not tied to whether it actually had
  // any delivery that month) — same independence from qty the old rule
  // had. A mitra whose window ends mid-month counts in BOTH buckets'
  // `general` for that month (it genuinely was NOO for part of it and
  // Existing for the rest) — same straddling rule qtyNooBerjalan/
  // qtyExistingBerjalan already applies on /mkesindo/kinerja
  // (marketing-collection-penjualan.ts).
  for (let i = 0; i < monthStarts.length; i++) {
    const monthStart = monthStarts[i];
    const nextMonthStart = monthBoundary(monthStart, 1);
    for (const ownership of ownerships) {
      if (ownership.nooStartDate == null || ownership.nooStartDate.getTime() >= nextMonthStart.getTime()) continue;
      const windowEnd = addDays(ownership.nooStartDate, NOO_WINDOW_DAYS);
      const isNooThisMonth = windowEnd.getTime() >= monthStart.getTime();
      const isExistingThisMonth = windowEnd.getTime() < nextMonthStart.getTime();
      const row = rowByMarketing.get(ownership.ownerAkunId);
      if (isNooThisMonth) {
        if (row) row.months[i].noo.general += 1;
        combined[i].noo.general += 1;
      }
      if (isExistingThisMonth) {
        if (row) row.months[i].existing.general += 1;
        combined[i].existing.general += 1;
      }
    }
  }

  // bagQtyActual: day-granularity split — same rule
  // marketing-collection-penjualan.ts's per-day loop uses, so a mitra
  // whose 30-day window ends mid-month contributes to BOTH buckets that
  // month, split by day, instead of the whole month landing in one bucket.
  for (const r of dailyResult.recordset as DailyRow[]) {
    const ownership = ownershipByMitra.get(r.BusinessPartnerID);
    if (!ownership) continue;
    const rowDate = new Date(r.TransDate);
    const monthIndex = monthStarts.findIndex(
      (m) => rowDate.getTime() >= m.getTime() && rowDate.getTime() < monthBoundary(m, 1).getTime()
    );
    if (monthIndex < 0) continue;
    if (ownership.nooStartDate && rowDate.getTime() < ownership.nooStartDate.getTime()) continue; // before mitra existed
    const nooWindowEnd = ownership.nooStartDate ? addDays(ownership.nooStartDate, NOO_WINDOW_DAYS) : null;
    const isNoo = nooWindowEnd != null && rowDate.getTime() <= nooWindowEnd.getTime();
    const bucket = isNoo ? "noo" : "existing";

    const row = rowByMarketing.get(ownership.ownerAkunId);
    if (row) row.months[monthIndex][bucket].bagQtyActual += r.QtyKantong;
    combined[monthIndex][bucket].bagQtyActual += r.QtyKantong;
  }

  // bagQtyTarget: Existing's daily-capacity-based target (added once per
  // row per month it counts as Existing at all — same non-prorated
  // precision the old rule used), plus NOO's own shared target figure
  // (unchanged — still one flat figure per row per month, never per-mitra).
  for (let i = 0; i < monthStarts.length; i++) {
    const monthStart = monthStarts[i];
    const nextMonthStart = monthBoundary(monthStart, 1);
    const days = daysInMonth(monthStart);
    const [snapshot, nooDailyCapacity] = await Promise.all([
      getMonthlyCapacitySnapshot(monthStart),
      getArmadaNooDailyCapacity(monthStart.getTime() === currentMonthStart.getTime() ? businessToday : nextMonthStart),
    ]);
    const targetNooThisMonth = nooDailyCapacity * days;

    for (const ownership of ownerships) {
      if (ownership.nooStartDate == null || ownership.nooStartDate.getTime() >= nextMonthStart.getTime()) continue;
      const windowEnd = addDays(ownership.nooStartDate, NOO_WINDOW_DAYS);
      const isExistingThisMonth = windowEnd.getTime() < nextMonthStart.getTime();
      if (!isExistingThisMonth) continue;
      const capacity = snapshot.get(ownership.businessPartnerId) ?? 0;
      const row = rowByMarketing.get(ownership.ownerAkunId);
      if (row) row.months[i].existing.bagQtyTarget += capacity * days;
      combined[i].existing.bagQtyTarget += capacity * days;
    }

    for (const row of rows) row.months[i].noo.bagQtyTarget = targetNooThisMonth;
    combined[i].noo.bagQtyTarget = targetNooThisMonth;
  }

  for (const row of rows) {
    for (const month of row.months) {
      month.total.general = month.existing.general + month.noo.general;
      month.total.bagQtyActual = month.existing.bagQtyActual + month.noo.bagQtyActual;
      month.total.bagQtyTarget = month.existing.bagQtyTarget + month.noo.bagQtyTarget;
      finalizeAnatomy(month.existing);
      finalizeAnatomy(month.noo);
      finalizeAnatomy(month.total);
    }
  }
  for (const month of combined) {
    month.total.general = month.existing.general + month.noo.general;
    month.total.bagQtyActual = month.existing.bagQtyActual + month.noo.bagQtyActual;
    month.total.bagQtyTarget = month.existing.bagQtyTarget + month.noo.bagQtyTarget;
    finalizeAnatomy(month.existing);
    finalizeAnatomy(month.noo);
    finalizeAnatomy(month.total);
  }

  rows.sort((a, b) => a.MarketingNama.localeCompare(b.MarketingNama));
  return { months: monthsISO, rows, combined };
}
```

- [ ] **Step 2: Verifikasi build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: tidak ada error tipe (perhatikan pemanggil `getMarketingPerformanceTrend` di `pemasaran/page.tsx` dan `pangsa-pasar-trend.ts` — signature tidak berubah jadi seharusnya tetap cocok).

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/marketing-performance-trend.ts
git commit -m "fix: samakan perhitungan NOO Matriks Performa Marketing dengan aturan Kinerja Karyawan"
```

---

### Task 4: `marketing-performance.ts` — atribusi hybrid untuk Target Harian

**Files:**
- Modify: `src/lib/queries/marketing-performance.ts`

**Interfaces:**
- Consumes: `resolveAllMitraOwnership`, `resolveHybridOwner`, `type MitraOwnership` dari `@/lib/queries/marketing-ownership` (Task 1)
- Produces: `MarketingScopeAllMitra` — field `IsCrossWilayahProposal: boolean` DIHAPUS, diganti `IsCurrentlyNoo: boolean`. Konsumen: `marketing-performance-panel.tsx` dan `kinerja-marketing-sub-tab.tsx` (Task 6).

- [ ] **Step 1: Update import**

Di bagian atas file, ganti:

```typescript
import {
  getMarketingUsers,
  getMarketingWilayahAssignments,
  resolveResponsibleMarketing,
  resolveMitraOverrideSources,
} from "@/lib/queries/marketing-wilayah";
```

menjadi:

```typescript
import { getMarketingUsers, getMarketingWilayahAssignments, resolveMitraOverrideSources } from "@/lib/queries/marketing-wilayah";
import { resolveAllMitraOwnership, resolveHybridOwner } from "@/lib/queries/marketing-ownership";
```

(`resolveResponsibleMarketing` tidak lagi dipanggil langsung di file ini — dipanggil dari dalam `resolveHybridOwner`.)

- [ ] **Step 2: Ganti field `IsCrossWilayahProposal` di interface**

Cari:

```typescript
  // A mitra qualifying via cross-wilayah Pengajuan ownership (Task 2) counts
  // as NOO every month it's resolved into this scope, not just its JoinDate
  // month — see marketing-performance-trend.ts's isNoo for the same rule
  // applied historically.
  IsCrossWilayahProposal: boolean;
```

Ganti dengan:

```typescript
  // Whether this mitra is currently within its 30-day NOO window (see
  // resolveHybridOwner in marketing-ownership.ts) as of the moment this
  // data was fetched — replaces the old JoinDate-in-current-month check
  // client components used to do themselves. Confirmed with user
  // 2026-09-24: a mitra still NOO stays attributed to whoever registered
  // it even outside its own Wilayah/Kecamatan coverage; once Existing it
  // follows live Wilayah/Kecamatan instead.
  IsCurrentlyNoo: boolean;
```

- [ ] **Step 3: Ganti resolusi kepemilikan di `getMarketingPerformance()`**

Cari baris:

```typescript
  const { crossWilayahOverrides, prioritasOverrides, merged: mitraOverrides } = await resolveMitraOverrideSources(assignments);

  const pool = await getPool();
```

Ganti dengan:

```typescript
  const { prioritasOverrides } = await resolveMitraOverrideSources(assignments);
  const ownerships = await resolveAllMitraOwnership();
  const ownershipByMitra = new Map(ownerships.map((o) => [o.businessPartnerId, o]));
  const today = getBusinessDate();

  const pool = await getPool();
```

(`getBusinessDate` sudah diimpor di baris 2 file ini — tidak perlu import baru.)

- [ ] **Step 4: Ganti `getCell()` supaya pakai atribusi hybrid dan mengembalikan status NOO**

Cari:

```typescript
  const marketingByName = new Map(marketingUsers.map((u) => [u.Nama, u]));
  const cellKey = (marketingUserId: string, wilayah: string, kecamatan: string | null) =>
    `${marketingUserId}|${wilayah}|${kecamatan ?? ""}`;
  const cells = new Map<string, MarketingScopeCell>();

  function getCell(businessPartnerId: string, wilayah: string, kecamatan: string | null): MarketingScopeCell | null {
    const marketingName = resolveResponsibleMarketing(businessPartnerId, wilayah, kecamatan, assignments, mitraOverrides);
    if (!marketingName) return null;
    const user = marketingByName.get(marketingName);
    if (!user) return null;
    const key = cellKey(user.UserID, wilayah, kecamatan);
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        MarketingUserID: user.UserID,
        MarketingNama: user.Nama,
        Wilayah: wilayah,
        Kecamatan: kecamatan,
        TargetHarian: 0,
        DailyQty: new Array(periodDays).fill(0),
      };
      cells.set(key, cell);
    }
    return cell;
  }
```

Ganti dengan:

```typescript
  const marketingByName = new Map(marketingUsers.map((u) => [u.Nama, u]));
  const akunIdToNama = new Map(marketingUsers.map((u) => [u.UserID, u.Nama]));
  const cellKey = (marketingUserId: string, wilayah: string, kecamatan: string | null) =>
    `${marketingUserId}|${wilayah}|${kecamatan ?? ""}`;
  const cells = new Map<string, MarketingScopeCell>();

  function getCell(
    businessPartnerId: string,
    wilayah: string,
    kecamatan: string | null
  ): { cell: MarketingScopeCell; isCurrentlyNoo: boolean } | null {
    const resolved = resolveHybridOwner(
      businessPartnerId,
      wilayah,
      kecamatan,
      assignments,
      prioritasOverrides,
      ownershipByMitra,
      akunIdToNama,
      today
    );
    if (!resolved.marketingNama) return null;
    const user = marketingByName.get(resolved.marketingNama);
    if (!user) return null;
    const key = cellKey(user.UserID, wilayah, kecamatan);
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        MarketingUserID: user.UserID,
        MarketingNama: user.Nama,
        Wilayah: wilayah,
        Kecamatan: kecamatan,
        TargetHarian: 0,
        DailyQty: new Array(periodDays).fill(0),
      };
      cells.set(key, cell);
    }
    return { cell, isCurrentlyNoo: resolved.isCurrentlyNoo };
  }
```

- [ ] **Step 5: Update pemanggil `getCell()` di loop roster (`mitraResult`)**

Cari:

```typescript
  for (const r of mitraResult.recordset as {
    BusinessPartnerID: string;
    Name: string;
    Wilayah: string;
    Kecamatan: string | null;
    Capacity: number | null;
    JoinDate: string | null;
    PriceLevel: number | null;
  }[]) {
    const cell = getCell(r.BusinessPartnerID, r.Wilayah, r.Kecamatan);
    if (!cell) continue;
    if (r.Capacity) cell.TargetHarian += r.Capacity;
    resolvedMarketingByMitra.set(r.BusinessPartnerID, cell.MarketingUserID);
    const roster = allMitraByMarketing.get(cell.MarketingUserID) ?? [];
    roster.push({
      BusinessPartnerID: r.BusinessPartnerID,
      Name: r.Name,
      Wilayah: r.Wilayah,
      Kecamatan: r.Kecamatan,
      Capacity: r.Capacity,
      JoinDate: r.JoinDate,
      PriceLevel: r.PriceLevel,
      IsCrossWilayahProposal: crossWilayahOverrides.has(r.BusinessPartnerID) && !prioritasOverrides.has(r.BusinessPartnerID),
      IsPriorityOverride: prioritasOverrides.has(r.BusinessPartnerID),
    });
    allMitraByMarketing.set(cell.MarketingUserID, roster);
  }
```

Ganti dengan:

```typescript
  for (const r of mitraResult.recordset as {
    BusinessPartnerID: string;
    Name: string;
    Wilayah: string;
    Kecamatan: string | null;
    Capacity: number | null;
    JoinDate: string | null;
    PriceLevel: number | null;
  }[]) {
    const resolved = getCell(r.BusinessPartnerID, r.Wilayah, r.Kecamatan);
    if (!resolved) continue;
    const { cell, isCurrentlyNoo } = resolved;
    if (r.Capacity) cell.TargetHarian += r.Capacity;
    resolvedMarketingByMitra.set(r.BusinessPartnerID, cell.MarketingUserID);
    const roster = allMitraByMarketing.get(cell.MarketingUserID) ?? [];
    roster.push({
      BusinessPartnerID: r.BusinessPartnerID,
      Name: r.Name,
      Wilayah: r.Wilayah,
      Kecamatan: r.Kecamatan,
      Capacity: r.Capacity,
      JoinDate: r.JoinDate,
      PriceLevel: r.PriceLevel,
      IsCurrentlyNoo: isCurrentlyNoo,
      IsPriorityOverride: prioritasOverrides.has(r.BusinessPartnerID),
    });
    allMitraByMarketing.set(cell.MarketingUserID, roster);
  }
```

- [ ] **Step 6: Update pemanggil `getCell()` di loop harian (`dailyResult`)**

Cari:

```typescript
  for (const r of dailyResult.recordset as {
    BusinessPartnerID: string;
    Wilayah: string;
    Kecamatan: string | null;
    TransDate: string;
    QtyKantong: number;
  }[]) {
    const cell = getCell(r.BusinessPartnerID, r.Wilayah, r.Kecamatan);
    if (!cell) continue;
    const dayIndex = Math.round((new Date(r.TransDate).getTime() - rangeStart.getTime()) / 86400000);
    if (dayIndex < 0 || dayIndex >= periodDays) continue;
    cell.DailyQty[dayIndex] += r.QtyKantong;
    if (mitraDailyQty[r.BusinessPartnerID]) mitraDailyQty[r.BusinessPartnerID][dayIndex] += r.QtyKantong;
  }
```

Ganti dengan:

```typescript
  for (const r of dailyResult.recordset as {
    BusinessPartnerID: string;
    Wilayah: string;
    Kecamatan: string | null;
    TransDate: string;
    QtyKantong: number;
  }[]) {
    const resolved = getCell(r.BusinessPartnerID, r.Wilayah, r.Kecamatan);
    if (!resolved) continue;
    const { cell } = resolved;
    const dayIndex = Math.round((new Date(r.TransDate).getTime() - rangeStart.getTime()) / 86400000);
    if (dayIndex < 0 || dayIndex >= periodDays) continue;
    cell.DailyQty[dayIndex] += r.QtyKantong;
    if (mitraDailyQty[r.BusinessPartnerID]) mitraDailyQty[r.BusinessPartnerID][dayIndex] += r.QtyKantong;
  }
```

Sisa file (`visitLogResult` loop, `mitraDailyQty` init, `visitLogFilledByMarketing`, `mitraTerverifikasiByDay`, `return`) TIDAK berubah — semuanya hanya bergantung pada `resolvedMarketingByMitra`, yang tetap diisi dengan cara sama.

- [ ] **Step 7: Verifikasi build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: error muncul di `marketing-performance-panel.tsx` dan `kinerja-marketing-sub-tab.tsx` (masih pakai `IsCrossWilayahProposal`) — itu diperbaiki di Task 6. Pastikan TIDAK ADA error lain selain di dua file itu.

- [ ] **Step 8: Commit**

```bash
git add src/lib/queries/marketing-performance.ts
git commit -m "fix: atribusi Target Harian Kinerja Marketing pakai aturan hybrid Prioritas/NOO-permanen/wilayah-live"
```

---

### Task 5: `pangsa-pasar-trend.ts` — ikut atribusi hybrid yang sama

**Files:**
- Modify: `src/lib/queries/pangsa-pasar-trend.ts`

**Interfaces:**
- Consumes: `resolveAllMitraOwnership`, `resolveHybridOwner` dari `@/lib/queries/marketing-ownership` (Task 1); `getBusinessDate` dari `@/lib/business-date`

- [ ] **Step 1: Update import**

Ganti:

```typescript
import { getPool } from "@/lib/db";
import { monthBoundary } from "@/lib/business-date";
import { PARTNER_TYPE_CASE } from "@/lib/queries/aging";
import {
  getMarketingUsers,
  getMarketingWilayahAssignments,
  resolveResponsibleMarketing,
  resolveMitraOverrides,
} from "@/lib/queries/marketing-wilayah";
```

menjadi:

```typescript
import { getPool } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";
import { PARTNER_TYPE_CASE } from "@/lib/queries/aging";
import { getMarketingUsers, getMarketingWilayahAssignments, resolveMitraOverrideSources } from "@/lib/queries/marketing-wilayah";
import { resolveAllMitraOwnership, resolveHybridOwner } from "@/lib/queries/marketing-ownership";
```

- [ ] **Step 2: Ganti resolusi atribusi di `getPangsaPasarTrend()`**

Cari:

```typescript
  const [assignments, marketingUsers, mitraResult] = await Promise.all([
    getMarketingWilayahAssignments(),
    getMarketingUsers(),
    pool.request().query(`
      SELECT
          BusinessPartnerID,
          ISNULL(NULLIF(LTRIM(RTRIM(NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          NPWPAddress AS Kecamatan,
          JoinDate,
          ${PARTNER_TYPE_CASE} AS PartnerType
      FROM BusinessPartner bp
      WHERE ISNULL(IsDeleted, 0) = 0
    `),
  ]);
  const mitraOverrides = await resolveMitraOverrides(assignments);
  const marketingByName = new Map(marketingUsers.map((u) => [u.Nama, u]));

  const mitraMeta: MitraMeta[] = (
    mitraResult.recordset as { BusinessPartnerID: string; Wilayah: string; Kecamatan: string | null; JoinDate: string | null; PartnerType: string }[]
  ).map((r) => {
    const marketingName = resolveResponsibleMarketing(r.BusinessPartnerID, r.Wilayah, r.Kecamatan, assignments, mitraOverrides);
    const user = marketingName ? marketingByName.get(marketingName) : undefined;
    return { BusinessPartnerID: r.BusinessPartnerID, JoinDate: r.JoinDate, PartnerType: r.PartnerType, MarketingUserID: user?.UserID ?? null };
  });
```

Ganti dengan:

```typescript
  const [assignments, marketingUsers, mitraResult, ownerships] = await Promise.all([
    getMarketingWilayahAssignments(),
    getMarketingUsers(),
    pool.request().query(`
      SELECT
          BusinessPartnerID,
          ISNULL(NULLIF(LTRIM(RTRIM(NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          NPWPAddress AS Kecamatan,
          JoinDate,
          ${PARTNER_TYPE_CASE} AS PartnerType
      FROM BusinessPartner bp
      WHERE ISNULL(IsDeleted, 0) = 0
    `),
    resolveAllMitraOwnership(),
  ]);
  const { prioritasOverrides } = await resolveMitraOverrideSources(assignments);
  const ownershipByMitra = new Map(ownerships.map((o) => [o.businessPartnerId, o]));
  const akunIdToNama = new Map(marketingUsers.map((u) => [u.UserID, u.Nama]));
  const today = getBusinessDate();
  const marketingByName = new Map(marketingUsers.map((u) => [u.Nama, u]));

  // Atribusi sekarang pakai aturan hybrid yang sama dengan
  // marketing-performance.ts (Prioritas > mitra-yang-masih-NOO permanen ke
  // pendaftar > mitra Existing ikut wilayah-live) — confirmed with user
  // 2026-09-24. Aturan "kapan mitra masuk roster bulan itu" (JoinDate di
  // bawah, `meta.JoinDate == null || ... >= nextMonthStart`) TIDAK berubah.
  const mitraMeta: MitraMeta[] = (
    mitraResult.recordset as { BusinessPartnerID: string; Wilayah: string; Kecamatan: string | null; JoinDate: string | null; PartnerType: string }[]
  ).map((r) => {
    const { marketingNama } = resolveHybridOwner(
      r.BusinessPartnerID,
      r.Wilayah,
      r.Kecamatan,
      assignments,
      prioritasOverrides,
      ownershipByMitra,
      akunIdToNama,
      today
    );
    const user = marketingNama ? marketingByName.get(marketingNama) : undefined;
    return { BusinessPartnerID: r.BusinessPartnerID, JoinDate: r.JoinDate, PartnerType: r.PartnerType, MarketingUserID: user?.UserID ?? null };
  });
```

- [ ] **Step 3: Verifikasi build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: tidak ada error baru di `pangsa-pasar-trend.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/pangsa-pasar-trend.ts
git commit -m "fix: atribusi Pangsa Pasar & Kontribusi Internal pakai aturan hybrid yang sama"
```

---

### Task 6: Komponen client — baca `IsCurrentlyNoo`, hapus perhitungan `JoinDate` sendiri

**Files:**
- Modify: `src/components/dashboard/marketing-performance-panel.tsx:391-425`
- Modify: `src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx:244-303`

**Interfaces:**
- Consumes: `MarketingScopeAllMitra.IsCurrentlyNoo: boolean` (Task 4, menggantikan `IsCrossWilayahProposal`)

- [ ] **Step 1: `marketing-performance-panel.tsx` — ganti `isExisting`/`isNoo`**

Cari (baris 391-412):

```typescript
  const currentMonthStartISO = `${todayISO.slice(0, 7)}-01`;
  // JoinDate arrives from the server as a real JS Date at runtime (the
  // underlying BusinessPartner.JoinDate column is SQL datetime — the mssql
  // driver returns a Date object, and React's RSC serialization preserves
  // Date instances across the server/client boundary), even though its
  // declared type is `string | null`. Comparing a Date directly against an
  // ISO string via `<`/`>=` always evaluates false (Date coerces to its
  // numeric timestamp, the string fails ToNumber). Normalize both sides
  // through `new Date(...)` before comparing — this also works unchanged if
  // JoinDate genuinely is a string at runtime, since `new Date(dateObj)`
  // clones a Date input as-is. Matches the same normalization already used
  // in marketing-performance-trend.ts/pangsa-pasar-trend.ts.
  // IsCrossWilayahProposal is optional here (not just on MarketingScopeAllMitra)
  // because mitraPrioritas is MarketingMitraAssignment[] — the admin-curated
  // Prioritas list, which by the precedence rule (marketing-performance.ts /
  // marketing-performance-trend.ts) never carries the cross-wilayah flag in
  // the first place, so an absent field correctly falls back to JoinDate-only
  // bucketing for that list.
  const isExisting = (m: { JoinDate: string | null; IsCrossWilayahProposal?: boolean }) =>
    (!m.JoinDate || new Date(m.JoinDate).getTime() < new Date(currentMonthStartISO).getTime()) && !m.IsCrossWilayahProposal;
  const isNoo = (m: { JoinDate: string | null; IsCrossWilayahProposal?: boolean }) =>
    (!!m.JoinDate && new Date(m.JoinDate).getTime() >= new Date(currentMonthStartISO).getTime()) || !!m.IsCrossWilayahProposal;
```

Ganti dengan:

```typescript
  // NOO/Existing status now comes straight from the server
  // (MarketingScopeAllMitra.IsCurrentlyNoo, see marketing-performance.ts /
  // marketing-ownership.ts) instead of being recomputed here from
  // JoinDate — confirmed with user 2026-09-24. IsCurrentlyNoo is optional
  // here (not just on MarketingScopeAllMitra) because mitraPrioritas is
  // MarketingMitraAssignment[] — the admin-curated Prioritas list, which
  // has no NOO/Existing concept of its own and (per the same 2026-09-24
  // decision) always stays permanently attributed regardless of status, so
  // an absent field correctly falls back to "existing" bucketing —
  // unconditionally showing every Prioritas mitra there (this also fixes a
  // pre-existing gap: a Prioritas mitra whose JoinDate fell in the current
  // month used to silently disappear from this section entirely).
  const isExisting = (m: { IsCurrentlyNoo?: boolean }) => !m.IsCurrentlyNoo;
  const isNoo = (m: { IsCurrentlyNoo?: boolean }) => !!m.IsCurrentlyNoo;
```

Lalu hapus `currentMonthStartISO` dari dependency array `useMemo` tiga baris di bawahnya (`[mitraPrioritas, currentMonthStartISO]` → `[mitraPrioritas]`, dan dua `[allMitra, currentMonthStartISO]` → `[allMitra]`).

- [ ] **Step 2: `kinerja-marketing-sub-tab.tsx` — ganti `semuaMitraRoster`/`nooRoster`**

Cari (baris 244, lalu 279-303):

```typescript
  const todayISO = data?.todayISO ?? "";
  const currentMonthStartISO = todayISO ? `${todayISO.slice(0, 7)}-01` : "";
```

Ganti dengan:

```typescript
  const todayISO = data?.todayISO ?? "";
```

Cari:

```typescript
  // 3-way split, replacing the old existing/NOO split now that
  // IsPriorityOverride/IsCrossWilayahProposal live directly on each roster
  // row (Task 3): Prioritas wins over both other buckets (no double-listing
  // — both other filters explicitly exclude it), Semua Mitra is the
  // JoinDate-based "existing" collapse minus Prioritas and cross-wilayah
  // mitra, and Mitra NOO now also picks up cross-wilayah mitra regardless of
  // JoinDate (a cross-wilayah Pengajuan owner counts as NOO every month it's
  // resolved into this scope, same rule marketing-performance-trend.ts's
  // isNoo applies historically).
  const prioritasRoster = useMemo(
    () =>
      roster
        .filter((m) => m.IsPriorityOverride)
        .filter((m) => (!searchLower || m.Name.toLowerCase().includes(searchLower)) && (!wilayahFilter || m.Wilayah === wilayahFilter))
        .sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0)),
    [roster, searchLower, wilayahFilter]
  );
  const semuaMitraRoster = useMemo(
    () =>
      roster
        .filter(
          (m) =>
            !m.IsPriorityOverride &&
            !m.IsCrossWilayahProposal &&
            (!m.JoinDate || new Date(m.JoinDate).getTime() < new Date(currentMonthStartISO).getTime())
        )
        .filter((m) => (!searchLower || m.Name.toLowerCase().includes(searchLower)) && (!wilayahFilter || m.Wilayah === wilayahFilter))
        .sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0)),
    [roster, currentMonthStartISO, searchLower, wilayahFilter]
  );
  const nooRoster = useMemo(
    () =>
      roster
        .filter(
          (m) =>
            !m.IsPriorityOverride &&
            (m.IsCrossWilayahProposal || (!!m.JoinDate && new Date(m.JoinDate).getTime() >= new Date(currentMonthStartISO).getTime()))
        )
        .filter((m) => (!searchLower || m.Name.toLowerCase().includes(searchLower)) && (!wilayahFilter || m.Wilayah === wilayahFilter))
        .sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0)),
    [roster, currentMonthStartISO, searchLower, wilayahFilter]
  );
```

Ganti dengan:

```typescript
  // 3-way split — Prioritas wins over both other buckets (no
  // double-listing, both other filters explicitly exclude it), Semua
  // Mitra/Mitra NOO split purely on IsCurrentlyNoo (see
  // marketing-performance.ts / marketing-ownership.ts's resolveHybridOwner,
  // confirmed with user 2026-09-24 — replaces the old JoinDate/
  // IsCrossWilayahProposal-based split).
  const prioritasRoster = useMemo(
    () =>
      roster
        .filter((m) => m.IsPriorityOverride)
        .filter((m) => (!searchLower || m.Name.toLowerCase().includes(searchLower)) && (!wilayahFilter || m.Wilayah === wilayahFilter))
        .sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0)),
    [roster, searchLower, wilayahFilter]
  );
  const semuaMitraRoster = useMemo(
    () =>
      roster
        .filter((m) => !m.IsPriorityOverride && !m.IsCurrentlyNoo)
        .filter((m) => (!searchLower || m.Name.toLowerCase().includes(searchLower)) && (!wilayahFilter || m.Wilayah === wilayahFilter))
        .sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0)),
    [roster, searchLower, wilayahFilter]
  );
  const nooRoster = useMemo(
    () =>
      roster
        .filter((m) => !m.IsPriorityOverride && m.IsCurrentlyNoo)
        .filter((m) => (!searchLower || m.Name.toLowerCase().includes(searchLower)) && (!wilayahFilter || m.Wilayah === wilayahFilter))
        .sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0)),
    [roster, searchLower, wilayahFilter]
  );
```

- [ ] **Step 3: Verifikasi build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: nol error di seluruh proyek (ini menutup error yang sengaja dibiarkan di Task 4 Step 7).

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/marketing-performance-panel.tsx src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx
git commit -m "fix: komponen Kinerja Marketing baca status NOO dari server, bukan hitung ulang dari JoinDate"
```

---

### Task 7: Verifikasi data nyata — MKT 02 September 2026 harus sama di kedua halaman

**Files:**
- Create (sementara): `scripts/_scratch_verify_marketing_ownership.ts` — dihapus di Step 3 setelah lolos, JANGAN di-commit.

**Interfaces:**
- Consumes: `getMarketingPerformanceTrend` dari `@/lib/queries/marketing-performance-trend` (Task 3), `getHistoriPenjualanSemuaKaryawan` dari `@/lib/kinerja/marketing-collection-penjualan` (tidak berubah), `getMarketingUsers` dari `@/lib/queries/marketing-wilayah`

- [ ] **Step 1: Tulis skrip verifikasi**

```typescript
// scripts/_scratch_verify_marketing_ownership.ts — sementara, hapus setelah lolos.
import { getMarketingPerformanceTrend } from "@/lib/queries/marketing-performance-trend";
import { getHistoriPenjualanSemuaKaryawan } from "@/lib/kinerja/marketing-collection-penjualan";
import { getMarketingUsers } from "@/lib/queries/marketing-wilayah";

async function main() {
  const [trend, historiByAkunId, marketingUsers] = await Promise.all([
    getMarketingPerformanceTrend(3),
    getHistoriPenjualanSemuaKaryawan(),
    getMarketingUsers(),
  ]);

  const targetMonthISO = trend.months[trend.months.length - 1]; // bulan berjalan (terakhir dalam window 3 bulan)
  console.log(`Membandingkan bulan: ${targetMonthISO}\n`);

  for (const user of marketingUsers) {
    const trendRow = trend.rows.find((r) => r.MarketingUserID === user.UserID);
    const trendMonth = trendRow?.months.find((m) => m.monthStartISO === targetMonthISO);
    const pemasaranNoo = trendMonth?.noo.bagQtyActual ?? 0;

    const histori = historiByAkunId.get(user.UserID);
    const kinerjaBulan = histori?.bulanList.find((b) => b.bulanMulai === targetMonthISO);
    const kinerjaNoo = kinerjaBulan?.qtyNooBerjalan ?? 0;

    const match = Math.abs(pemasaranNoo - kinerjaNoo) < 0.01 ? "OK" : "BEDA!!";
    console.log(`${user.Nama.padEnd(20)} Pemasaran=${pemasaranNoo.toFixed(1).padStart(10)}  Kinerja=${kinerjaNoo.toFixed(1).padStart(10)}  ${match}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 2: Jalankan dan periksa hasilnya**

Run: `npx tsx scripts/_scratch_verify_marketing_ownership.ts`
Expected: setiap baris berakhiran `OK` (angka Pemasaran dan Kinerja identik, termasuk untuk MKT 02). Kalau ada baris `BEDA!!`, jangan lanjut — debug dulu (kemungkinan besar: `nooStartDate` mitra itu berbeda antara kedua fungsi karena satu masih pakai cache/hasil lama, atau ada mitra yang lolos dari `resolveAllMitraOwnership()` di satu sisi tapi tidak di sisi lain — cek dengan query manual `SELECT * FROM DashboardMitraPengajuan WHERE ConvertedBusinessPartnerID = '<id mitra bermasalah>'`).

- [ ] **Step 3: Hapus skrip sementara**

```bash
rm scripts/_scratch_verify_marketing_ownership.ts
```

Jangan commit skrip ini — ia hanya alat verifikasi sekali pakai, bukan bagian dari codebase.

- [ ] **Step 4: Build penuh**

Run: `npx next build`
Expected: build sukses tanpa error (menangkap masalah yang mungkin lolos dari `tsc --noEmit`, misalnya di file yang tidak pernah diimpor langsung oleh entry point manapun).

- [ ] **Step 5: Cek visual di browser — dua halaman menampilkan angka NOO yang sama**

Buka `/mkesindo/pemasaran` (bagian "Matriks Performa Marketing", baris NOO, kolom bulan berjalan) dan `/mkesindo/kinerja` (baris "NOO", baris "Total: ... Kantong") untuk Marketing yang sama (mis. MKT 02) — kedua angka harus identik. Screenshot kedua panel untuk didokumentasikan di deskripsi commit/PR akhir.
