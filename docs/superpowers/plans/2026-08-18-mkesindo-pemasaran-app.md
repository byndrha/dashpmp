# Aplikasi Pemasaran /mkesindo/pemasaran-app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/mkesindo/pemasaran-app`, a mobile app-shell for MKEsindo marketing staff (bottom nav: Beranda, Mitra, Pemasaran; header-accessed Profil), wrapping already-built desktop functionality (Kinerja Marketing, Log Kunjungan, Pengiriman per Wilayah, Pengajuan Mitra Baru, Mitra CRUD, Top Mitra Piutang + Catatan) plus 2 new marketing-scoped queries, and redirect Marketing-role logins there instead of the desktop `/mkesindo/pemasaran`.

**Architecture:** Mirrors `produksi-app`'s established shell pattern exactly (client tab-shell component with `useState`-driven tabs + lazy per-tab data fetch, header with `UserMenu`-style avatar, `(tabs)` route group for the 3 bottom-nav destinations, separate non-tab routes for drill-down screens). A new `requireMarketing()` guard (role-based, not boolean-flag-based like `requireDriver`/`requireSatpam`/`requireProduksi`). One new `actions.ts` wraps existing query/action functions with `requireMarketing()` + auto-injects `session.user.id` so a client can never see or modify another marketing's data. Two genuinely new query functions (`getVisitLogStatusForMarketing`, `getSalesDayComparisonForMarketing`); everything else reuses existing, already-shipped query/action functions unchanged.

**Tech Stack:** Next.js 16 (App Router, Server Components + Server Actions), MSSQL (`mssql`), Postgres (`pg`, for `akun`/Marketing identity), NextAuth (JWT sessions).

**Spec:** `docs/superpowers/specs/2026-08-18-mkesindo-pemasaran-app-design.md`

## Global Constraints

- All Indonesian-language user-facing strings — no English UI text.
- No test runner exists in this project. Every task's verification is `npx tsc --noEmit` (zero errors) + `npx eslint <changed files>`; the final task additionally live-checks in the browser.
- Everything happens directly on the `main` branch. No worktree.
- **The desktop `/mkesindo/pemasaran` module is never modified** — every file this plan touches is new, except `src/lib/require-access.ts` (adds a function, doesn't change existing ones) and `src/app/mkesindo/(dashboard)/layout.tsx` (changes only the Marketing redirect target, lines ~52-53).
- **"Jenis Usaha" and "Harga/Kantong" follow existing behavior, not the Figma mockup literally** (explicit user decision): PartnerType stays auto-derived from qty (no user-facing field for it in the Pengajuan form); price stays a Price Level dropdown (`getPriceLevelOptions()`), never a free Rupiah input.
- Every new query/action that reads or writes data scoped to "this marketing's own X" must take `marketingUserId` as a parameter and be called from `actions.ts` with `session.user.id` — never let a client-supplied ID pick whose data to show/change.
- Reuse existing components/query functions verbatim wherever the spec's Pemetaan Layar table says "Reuse" — do not fork or rewrite them "to be safe."
- Mitra scoped to a marketing is `getMitraList().filter(m => m.MarketingNama === session.user.name)` — matches the existing name-based resolution convention already used in `marketing-performance.ts`'s `marketingByName` map (this codebase does not resolve Marketing scope by ID against `MitraRow`, only by name — do not invent an ID-based join that doesn't exist).

---

## Task 1: `requireMarketing()` guard + login redirect

**Files:**
- Modify: `src/lib/require-access.ts` (add new function, after `requireProduksi()`)
- Modify: `src/app/mkesindo/(dashboard)/layout.tsx:52-53`

**Interfaces:**
- Produces: `requireMarketing(): Promise<Session>` — consumed by every page task below (Tasks 5-16).

- [ ] **Step 1: Add the guard**

In `src/lib/require-access.ts`, add after the existing `requireProduksi()` function:

```ts
// Gerbang /mkesindo/pemasaran-app — Marketing bukan boolean flag seperti
// Driver/Satpam/Produksi, tapi Role (MARKETING_ROLE_ID) yang sudah ada sejak
// modul Pemasaran desktop dibangun. Super Admin tetap boleh masuk untuk
// keperluan preview/testing, sama seperti pola akses lain di app ini.
export async function requireMarketing() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.isSuperAdmin && session.user.roleId !== MARKETING_ROLE_ID) redirect("/akses-ditolak");
  return session;
}
```

Add `MARKETING_ROLE_ID` to the existing import from `@/lib/roles` at the top of the file (check the current import line — add it to the existing named-import list, don't create a second import line for the same module).

- [ ] **Step 2: Change the redirect target**

In `src/app/mkesindo/(dashboard)/layout.tsx`, find:

```ts
if (!session?.user?.isSuperAdmin && session?.user?.roleId === MARKETING_ROLE_ID && !pathname.startsWith("/mkesindo/pemasaran")) {
  redirect("/mkesindo/pemasaran");
}
```

Replace with:

```ts
if (!session?.user?.isSuperAdmin && session?.user?.roleId === MARKETING_ROLE_ID && !pathname.startsWith("/mkesindo/pemasaran-app")) {
  redirect("/mkesindo/pemasaran-app");
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/require-access.ts "src/app/mkesindo/(dashboard)/layout.tsx"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/require-access.ts "src/app/mkesindo/(dashboard)/layout.tsx"
git commit -m "feat: add requireMarketing guard, redirect Marketing role to pemasaran-app"
```

---

## Task 2: `getVisitLogStatusForMarketing` query

**Files:**
- Create: `src/lib/queries/marketing-visit-log-status.ts`

**Interfaces:**
- Consumes: `getPool`/`sql` (`@/lib/db`), `getMarketingWilayahAssignments`/`getMarketingMitraAssignments`/`resolveResponsibleMarketing`/`buildMitraOverrideMap` (`@/lib/queries/marketing-wilayah`, all unchanged, existing).
- Produces: `VisitLogStatusRow` type, `getVisitLogStatusForMarketing(marketingUserId: string, dateISO: string): Promise<VisitLogStatusRow[]>` — consumed by Task 4 (actions.ts) and Task 9 (Log Kunjungan sub-tab).

- [ ] **Step 1: Create the file**

```ts
// src/lib/queries/marketing-visit-log-status.ts
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
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/queries/marketing-visit-log-status.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/marketing-visit-log-status.ts
git commit -m "feat: add getVisitLogStatusForMarketing query"
```

---

## Task 3: `getSalesDayComparisonForMarketing` query

**Files:**
- Create: `src/lib/queries/sales-overview-marketing.ts`

**Interfaces:**
- Consumes: `getPool`/`sql` (`@/lib/db`), `getSalesForDay` (`@/lib/queries/sales-overview`, unchanged), `getMarketingWilayahAssignments`/`getMarketingMitraAssignments`/`resolveResponsibleMarketing`/`buildMitraOverrideMap` (`@/lib/queries/marketing-wilayah`), types `SalesToday`/`SalesDayComparisonResult`/`SalesDayComparison`/`SalesDayPoint`/`HourlyPoint` (`@/lib/queries/sales-overview`, re-exported not redefined).
- Produces: `getSalesDayComparisonForMarketing(marketingUserId: string): Promise<SalesDayComparisonResult>` — consumed by Task 4 (actions.ts) and Task 6 (Beranda).

Read `src/lib/queries/sales-overview.ts`'s `getSalesDayComparison()` function (and its private helpers `sameDayMonthsBack`, `buildBucketClauses`, `getHourlyBuckets`) in full before starting this task — this task's job is to produce a **marketing-scoped mirror** of that exact function, not a new design. The only structural difference: every query inside adds a `BusinessPartnerID IN (...)` filter (on `SalesInvoice.BusinessPartnerID` for the net-sales queries, `do_.BusinessPartnerID` for the qty/hourly queries) built from this marketing's resolved mitra roster — same resolution as Task 2. `getSalesForDay()` itself is reused unmodified for the "today" point; only the historical comparison queries need the added filter, since `getSalesForDay` already accepts no partner filter and this task doesn't need to change that function (it will need its own follow-up if a marketing-scoped "today" figure independent of this file is ever needed — out of scope here, this task only needs the Beranda's `comparisons[0]` point which comes from this file's own query, not from `getSalesForDay`).

- [ ] **Step 1: Create the file**

```ts
// src/lib/queries/sales-overview-marketing.ts
import { getPool, sql } from "@/lib/db";
import type { SalesDayComparisonResult, SalesDayComparison, SalesDayPoint, HourlyPoint } from "@/lib/queries/sales-overview";
import {
  getMarketingWilayahAssignments,
  getMarketingMitraAssignments,
  resolveResponsibleMarketing,
  buildMitraOverrideMap,
} from "@/lib/queries/marketing-wilayah";
import { getBusinessDate } from "@/lib/business-date";

// Same calendar day-of-month N months earlier, clamped to the last day of
// the target month — copied from sales-overview.ts's private
// sameDayMonthsBack (not exported there, so duplicated here verbatim rather
// than changing that file's export surface for one new caller).
function sameDayMonthsBack(date: Date, monthsBack: number): Date {
  const targetYear = date.getUTCFullYear();
  const targetMonthIndex = date.getUTCMonth() - monthsBack;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonthIndex, Math.min(date.getUTCDate(), daysInTargetMonth)));
}

async function resolveMitraIdsForMarketing(marketingUserId: string): Promise<string[]> {
  const [assignments, mitraAssignments] = await Promise.all([
    getMarketingWilayahAssignments(),
    getMarketingMitraAssignments(),
  ]);
  const mitraOverrides = buildMitraOverrideMap(mitraAssignments);
  const ownName =
    assignments.find((a) => a.MarketingUserID === marketingUserId)?.MarketingNama ??
    mitraAssignments.find((a) => a.MarketingUserID === marketingUserId)?.MarketingNama;
  if (!ownName) return [];

  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT BusinessPartnerID,
           ISNULL(NULLIF(LTRIM(RTRIM(NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
           NPWPAddress AS Kecamatan
    FROM BusinessPartner
    WHERE ISNULL(IsDeleted, 0) = 0
  `);
  return (result.recordset as { BusinessPartnerID: string; Wilayah: string; Kecamatan: string | null }[])
    .filter(
      (r) => resolveResponsibleMarketing(r.BusinessPartnerID, r.Wilayah, r.Kecamatan, assignments, mitraOverrides) === ownName
    )
    .map((r) => r.BusinessPartnerID);
}

// Marketing-scoped mirror of sales-overview.ts's getSalesDayComparison() —
// same 4 comparison points (Kemarin/Pekan Lalu/Bulan Lalu/Tahun Lalu), same
// "Pekan Lalu skipped if it crosses into last month" rule, same per-jam
// breakdown — but every query filtered to BusinessPartnerID IN (mitra
// roster for this marketing). Returns an all-zero result (empty comparisons
// still shaped correctly) when the marketing has no resolved mitra, rather
// than throwing.
export async function getSalesDayComparisonForMarketing(marketingUserId: string): Promise<SalesDayComparisonResult> {
  const mitraIds = await resolveMitraIdsForMarketing(marketingUserId);
  const businessToday = getBusinessDate();

  const zeroPoint: SalesDayPoint = { NetSales: 0, DOQty: 0 };
  const zeroHourly = (): HourlyPoint[] => Array.from({ length: 24 }, (_, hour) => ({ hour, NetSales: 0, DOQty: 0 }));
  const currentWibHour = Number(
    new Date(businessToday.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(11, 13)
  );

  if (mitraIds.length === 0) {
    const labels = ["Kemarin", "Pekan Lalu", "Bulan Lalu", "Tahun Lalu"];
    return {
      comparisons: labels.map(
        (label): SalesDayComparison => ({
          label,
          dateISO: businessToday.toISOString().slice(0, 10),
          current: zeroPoint,
          previous: zeroPoint,
          NominalPctChange: null,
          QtyPctChange: null,
          hourly: zeroHourly(),
        })
      ),
      todayHourly: zeroHourly(),
      currentWibHour,
    };
  }

  const pool = await getPool();
  const idParams = (request: sql.Request) =>
    mitraIds.map((id, i) => {
      request.input(`bp${i}`, sql.VarChar(16), id);
      return `@bp${i}`;
    });

  const points = [
    { label: "Kemarin", date: new Date(Date.UTC(businessToday.getUTCFullYear(), businessToday.getUTCMonth(), businessToday.getUTCDate() - 1)) },
    { label: "Pekan Lalu", date: new Date(Date.UTC(businessToday.getUTCFullYear(), businessToday.getUTCMonth(), businessToday.getUTCDate() - 7)) },
    { label: "Bulan Lalu", date: sameDayMonthsBack(businessToday, 1) },
    { label: "Tahun Lalu", date: sameDayMonthsBack(businessToday, 12) },
  ];
  // "Pekan Lalu" skipped when it crosses into a different calendar month —
  // same rule as getSalesDayComparison().
  const pekanLalu = points[1].date;
  const pekanLaluAvailable =
    pekanLalu.getUTCFullYear() === businessToday.getUTCFullYear() && pekanLalu.getUTCMonth() === businessToday.getUTCMonth();

  async function pointFor(date: Date, includeHourly: boolean): Promise<{ point: SalesDayPoint; hourly: HourlyPoint[] | null }> {
    const dayStart = date;
    const dayEnd = new Date(date.getTime() + 86400000);

    const netRequest = pool.request().input("start", sql.DateTime, dayStart).input("end", sql.DateTime, dayEnd);
    const netIds = idParams(netRequest);
    const netResult = await netRequest.query(`
      SELECT ISNULL(SUM(Netto), 0) AS NetSales
      FROM SalesInvoice
      WHERE IsDeleted = 0 AND ISNULL(IsPerforma,0) = 0
        AND TransDate >= @start AND TransDate < @end
        AND BusinessPartnerID IN (${netIds.join(", ")})
    `);

    const qtyRequest = pool.request().input("start", sql.DateTime, dayStart).input("end", sql.DateTime, dayEnd);
    const qtyIds = idParams(qtyRequest);
    const qtyResult = await qtyRequest.query(`
      SELECT ISNULL(SUM(dod.Delivered), 0) AS DOQty
      FROM DeliveryOrder do_
      JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
      WHERE do_.IsDeleted = 0
        AND do_.TransDate >= @start AND do_.TransDate < @end
        AND do_.BusinessPartnerID IN (${qtyIds.join(", ")})
    `);

    const point: SalesDayPoint = {
      NetSales: netResult.recordset[0].NetSales,
      DOQty: qtyResult.recordset[0].DOQty,
    };

    if (!includeHourly) return { point, hourly: null };

    const hourlyNetRequest = pool
      .request()
      .input("start", sql.DateTime, new Date(dayStart.getTime() - 7 * 60 * 60 * 1000))
      .input("end", sql.DateTime, new Date(dayEnd.getTime() - 7 * 60 * 60 * 1000));
    const hourlyNetIds = idParams(hourlyNetRequest);
    const hourlyNetResult = await hourlyNetRequest.query(`
      SELECT DATEPART(HOUR, DATEADD(HOUR, 7, TransDate)) AS HourWIB, SUM(Netto) AS NetSales
      FROM SalesInvoice
      WHERE IsDeleted = 0 AND ISNULL(IsPerforma,0) = 0
        AND TransDate >= @start AND TransDate < @end
        AND BusinessPartnerID IN (${hourlyNetIds.join(", ")})
      GROUP BY DATEPART(HOUR, DATEADD(HOUR, 7, TransDate))
    `);
    const hourlyQtyRequest = pool
      .request()
      .input("start", sql.DateTime, new Date(dayStart.getTime() - 7 * 60 * 60 * 1000))
      .input("end", sql.DateTime, new Date(dayEnd.getTime() - 7 * 60 * 60 * 1000));
    const hourlyQtyIds = idParams(hourlyQtyRequest);
    const hourlyQtyResult = await hourlyQtyRequest.query(`
      SELECT DATEPART(HOUR, DATEADD(HOUR, 7, do_.TransDate)) AS HourWIB, SUM(dod.Delivered) AS DOQty
      FROM DeliveryOrder do_
      JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
      WHERE do_.IsDeleted = 0
        AND do_.TransDate >= @start AND do_.TransDate < @end
        AND do_.BusinessPartnerID IN (${hourlyQtyIds.join(", ")})
      GROUP BY DATEPART(HOUR, DATEADD(HOUR, 7, do_.TransDate))
    `);

    const hourly = zeroHourly();
    for (const r of hourlyNetResult.recordset as { HourWIB: number; NetSales: number }[]) hourly[r.HourWIB].NetSales = r.NetSales;
    for (const r of hourlyQtyResult.recordset as { HourWIB: number; DOQty: number }[]) hourly[r.HourWIB].DOQty = r.DOQty;
    return { point, hourly };
  }

  function pctChange(current: number, previous: number): number | null {
    return previous ? ((current - previous) / previous) * 100 : null;
  }

  const [kemarin, pekan, bulan, tahun, todayResult] = await Promise.all([
    pointFor(points[0].date, true),
    pekanLaluAvailable ? pointFor(points[1].date, true) : Promise.resolve(null),
    pointFor(points[2].date, true),
    pointFor(points[3].date, true),
    pointFor(businessToday, true),
  ]);

  function buildComparison(label: string, date: Date, result: { point: SalesDayPoint; hourly: HourlyPoint[] | null } | null): SalesDayComparison {
    if (!result) {
      return {
        label,
        dateISO: date.toISOString().slice(0, 10),
        current: todayResult.point,
        previous: null,
        NominalPctChange: null,
        QtyPctChange: null,
        hourly: null,
      };
    }
    return {
      label,
      dateISO: date.toISOString().slice(0, 10),
      current: todayResult.point,
      previous: result.point,
      NominalPctChange: pctChange(todayResult.point.NetSales, result.point.NetSales),
      QtyPctChange: pctChange(todayResult.point.DOQty, result.point.DOQty),
      hourly: result.hourly,
    };
  }

  return {
    comparisons: [
      buildComparison("Kemarin", points[0].date, kemarin),
      buildComparison("Pekan Lalu", points[1].date, pekan),
      buildComparison("Bulan Lalu", points[2].date, bulan),
      buildComparison("Tahun Lalu", points[3].date, tahun),
    ],
    todayHourly: todayResult.hourly ?? zeroHourly(),
    currentWibHour,
  };
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/queries/sales-overview-marketing.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/sales-overview-marketing.ts
git commit -m "feat: add getSalesDayComparisonForMarketing query"
```

---

## Task 4: `pemasaran-app/actions.ts` server actions

**Files:**
- Create: `src/app/mkesindo/pemasaran-app/actions.ts`

**Interfaces:**
- Consumes: `requireMarketing` (Task 1); `getVisitLogStatusForMarketing` (Task 2); `getSalesDayComparisonForMarketing` (Task 3); `getMarketingVisitLogForDate`/`saveMarketingVisitLog` (`@/lib/queries/marketing-visit-log`, unchanged); `getMarketingPerformance` (`@/lib/queries/marketing-performance`, unchanged); `getPemasaranWilayahDelivery` (`@/lib/queries/pemasaran-wilayah-delivery`, unchanged); `getPengajuanList`/`createPengajuan`/`type PengajuanInput` (`@/lib/queries/mitra-pengajuan`, unchanged); `getMitraList`/`getMitraDetail`/`createMitra`/`updateMitra`/`type MitraInput`/`type MitraRow` (`@/lib/queries/mitra`, unchanged); `setMitraLocation`/`setMitraCompetitor` (unchanged); `getTopMitraPiutang`/`type TopMitraPiutangRow` (`@/lib/queries/top-mitra-piutang`, unchanged); `setMitraNote` (find the underlying query function `setMitraNoteAction` in `src/app/mkesindo/(dashboard)/aging/actions.ts` wraps — import that same underlying query function, not the desktop action, so this file doesn't cross-import another route's `"use server"` file); `getPriceLevelOptions`/`type PriceLevelOption` (`@/lib/queries/mitra`, unchanged); `AppError`/`runAction`/`type ActionResult` (`@/lib/action-result`, unchanged).
- Produces: `getBerandaDataAction()`, `getKinerjaMarketingAction()`, `getVisitLogStatusAction(dateISO)`, `getVisitLogDetailAction(businessPartnerId, dateISO)`, `saveVisitLogAction(input)`, `getWilayahDeliveryAction()`, `getPengajuanListAction()`, `createPengajuanAction(input)`, `getPriceLevelOptionsAction()`, `getMitraListAction()`, `getMitraDetailAction(businessPartnerId)`, `createMitraAction(input)`, `updateMitraAction(id, input)`, `setMitraLocationAction(input)`, `setMitraCompetitorAction(input)`, `setMitraNoteAction(input)` — consumed by every screen task (5-16).

Confirmed signatures (verified during this plan's own research, use these exactly):
- `setMitraLocation(input: { businessPartnerId: string; latitude: number; longitude: number; alamat: string | null; userId: string }): Promise<void>` — `@/lib/queries/mitra-location`.
- `setMitraCompetitor(input: { businessPartnerId: string; kompetitor: string | null; userId: string }): Promise<void>` — `@/lib/queries/mitra-competitor`. Note `kompetitor` is `string | null`, not `string`.
- `setMitraNote(businessPartnerId: string, note: string | null, userId: string): Promise<void>` — **3 positional arguments**, not an object — `@/lib/queries/collection-priority`.
- `getMitraDetail(businessPartnerId: string): Promise<MitraRow | null>` — `@/lib/queries/mitra`.

- [ ] **Step 1: Create the file**

```ts
// src/app/mkesindo/pemasaran-app/actions.ts
"use server";

import { requireMarketing } from "@/lib/require-access";
import { getVisitLogStatusForMarketing, type VisitLogStatusRow } from "@/lib/queries/marketing-visit-log-status";
import { getSalesDayComparisonForMarketing } from "@/lib/queries/sales-overview-marketing";
import { getMarketingVisitLogForDate, saveMarketingVisitLog, type MarketingVisitLogEntry } from "@/lib/queries/marketing-visit-log";
import { getMarketingPerformance, type MarketingPerformanceData } from "@/lib/queries/marketing-performance";
import { getPemasaranWilayahDelivery, type PemasaranWilayahDeliveryRow } from "@/lib/queries/pemasaran-wilayah-delivery";
import { getPengajuanList, createPengajuan, type PengajuanRow, type PengajuanInput } from "@/lib/queries/mitra-pengajuan";
import {
  getMitraList,
  getMitraDetail,
  createMitra,
  updateMitra,
  getPriceLevelOptions,
  type MitraRow,
  type MitraInput,
  type PriceLevelOption,
} from "@/lib/queries/mitra";
import { setMitraLocation } from "@/lib/queries/mitra-location";
import { setMitraCompetitor } from "@/lib/queries/mitra-competitor";
import { getTopMitraPiutang, type TopMitraPiutangRow } from "@/lib/queries/top-mitra-piutang";
import { setMitraNote } from "@/lib/queries/collection-priority";
import type { SalesDayComparisonResult } from "@/lib/queries/sales-overview";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

function ownMitra(all: MitraRow[], marketingName: string): MitraRow[] {
  return all.filter((m) => m.MarketingNama === marketingName);
}

export async function getBerandaDataAction(): Promise<
  ActionResult<{ sales: SalesDayComparisonResult; topPiutang: TopMitraPiutangRow[] }>
> {
  return runAction(async () => {
    const session = await requireMarketing();
    const marketingName = session.user.name ?? session.user.username;
    const [sales, allPiutang, ownMitraList] = await Promise.all([
      getSalesDayComparisonForMarketing(session.user.id),
      getTopMitraPiutang(),
      getMitraList(),
    ]);
    const ownIds = new Set(ownMitra(ownMitraList, marketingName).map((m) => m.BusinessPartnerID));
    return { sales, topPiutang: allPiutang.filter((r) => ownIds.has(r.BusinessPartnerID)) };
  });
}

export async function getKinerjaMarketingAction(): Promise<ActionResult<MarketingPerformanceData>> {
  return runAction(async () => {
    const session = await requireMarketing();
    const data = await getMarketingPerformance();
    return {
      ...data,
      cells: data.cells.filter((c) => c.MarketingUserID === session.user.id),
    };
  });
}

export async function getVisitLogStatusAction(dateISO: string): Promise<ActionResult<VisitLogStatusRow[]>> {
  return runAction(async () => {
    const session = await requireMarketing();
    return getVisitLogStatusForMarketing(session.user.id, dateISO);
  });
}

export async function getVisitLogDetailAction(
  businessPartnerId: string,
  dateISO: string
): Promise<ActionResult<MarketingVisitLogEntry | null>> {
  return runAction(async () => {
    await requireMarketing();
    return getMarketingVisitLogForDate(businessPartnerId, dateISO);
  });
}

export async function saveVisitLogAction(input: {
  businessPartnerId: string;
  dateISO: string;
  hasilKunjungan: string | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireMarketing();
    await saveMarketingVisitLog({ ...input, userId: session.user.id });
  });
}

export async function getWilayahDeliveryAction(): Promise<ActionResult<PemasaranWilayahDeliveryRow[]>> {
  return runAction(async () => {
    await requireMarketing();
    return getPemasaranWilayahDelivery();
  });
}

export async function getPengajuanListAction(): Promise<ActionResult<PengajuanRow[]>> {
  return runAction(async () => {
    const session = await requireMarketing();
    const all = await getPengajuanList();
    return all.filter((r) => r.MarketingUserID === session.user.id);
  });
}

export async function createPengajuanAction(input: PengajuanInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireMarketing();
    await createPengajuan(input, session.user.id);
  });
}

export async function getPriceLevelOptionsAction(): Promise<ActionResult<PriceLevelOption[]>> {
  return runAction(async () => {
    await requireMarketing();
    return getPriceLevelOptions();
  });
}

export async function getMitraListAction(): Promise<ActionResult<MitraRow[]>> {
  return runAction(async () => {
    const session = await requireMarketing();
    const all = await getMitraList();
    return ownMitra(all, session.user.name ?? session.user.username);
  });
}

export async function getMitraDetailAction(businessPartnerId: string): Promise<ActionResult<MitraRow | null>> {
  return runAction(async () => {
    await requireMarketing();
    return getMitraDetail(businessPartnerId);
  });
}

export async function createMitraAction(input: MitraInput): Promise<ActionResult<string>> {
  return runAction(async () => {
    await requireMarketing();
    return createMitra(input);
  });
}

export async function updateMitraAction(id: string, input: MitraInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireMarketing();
    await updateMitra(id, input);
  });
}

export async function setMitraLocationAction(input: {
  businessPartnerId: string;
  latitude: number;
  longitude: number;
  alamat: string | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireMarketing();
    await setMitraLocation({ ...input, userId: session.user.id });
  });
}

export async function setMitraCompetitorAction(input: {
  businessPartnerId: string;
  kompetitor: string | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireMarketing();
    await setMitraCompetitor({ ...input, userId: session.user.id });
  });
}

export async function setMitraNoteAction(input: { businessPartnerId: string; note: string | null }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireMarketing();
    await setMitraNote(input.businessPartnerId, input.note, session.user.id);
  });
}
```

All signatures above are confirmed real (verified during this plan's own research against the live query files) — implement exactly as written, no further signature verification needed.

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/app/mkesindo/pemasaran-app/actions.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/mkesindo/pemasaran-app/actions.ts
git commit -m "feat: add pemasaran-app server actions"
```

---

## Task 5: App shell + bottom nav (Beranda/Mitra/Pemasaran)

**Files:**
- Create: `src/components/pemasaran-app/bottom-nav.tsx`
- Create: `src/components/pemasaran-app/pemasaran-app-tab-shell.tsx`
- Create: `src/app/mkesindo/pemasaran-app/(tabs)/layout.tsx`
- Create: `src/app/mkesindo/pemasaran-app/(tabs)/page.tsx` (Beranda — shell wiring only, content in Task 6)
- Create: `src/app/mkesindo/pemasaran-app/(tabs)/mitra/page.tsx` (shell wiring only, content in Task 13)
- Create: `src/app/mkesindo/pemasaran-app/(tabs)/pemasaran/page.tsx` (shell wiring only, content in Task 7)

**Interfaces:**
- Consumes: `requireMarketing` (Task 1); `getBerandaDataAction` (Task 4, called lazily by the shell, not here); `UserMenu`/`AppearanceMenu` (`@/components/dashboard/user-menu`, `@/components/dashboard/appearance-menu`, unchanged).
- Produces: `PemasaranAppTabShell` component with prop `initialTab: "beranda" | "mitra" | "pemasaran"` — consumed by all three `(tabs)/*/page.tsx` files; a lazy-load/tab-switch pattern later tasks (6, 7, 13) plug their own content into.

Mirrors `src/components/produksi-app/produksi-tab-shell.tsx` and `src/components/produksi-app/bottom-nav.tsx` exactly in structure (client component, `useState` for active tab + visited set, `window.history.replaceState` on tab change, header with `AppearanceMenu` + `UserMenu`) — read those two files before starting. Differences: 3 tabs instead of 2, and each tab's content component is a separate task (this task only wires the shell + empty tab placeholders that Tasks 6/7/13 fill in).

- [ ] **Step 1: Bottom nav component**

```tsx
// src/components/pemasaran-app/bottom-nav.tsx
"use client";

import { LayoutDashboard, Users, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PemasaranAppTabKey } from "./pemasaran-app-tab-shell";

const TABS: { key: PemasaranAppTabKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "beranda", label: "Beranda", icon: LayoutDashboard },
  { key: "mitra", label: "Mitra", icon: Users },
  { key: "pemasaran", label: "Pemasaran", icon: TrendingUp },
];

export function PemasaranAppBottomNav({
  activeTab,
  onChange,
}: {
  activeTab: PemasaranAppTabKey;
  onChange: (tab: PemasaranAppTabKey) => void;
}) {
  return (
    <nav className="flex border-t border-border bg-background">
      {TABS.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <tab.icon className="size-5" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Tab shell**

```tsx
// src/components/pemasaran-app/pemasaran-app-tab-shell.tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PemasaranAppBottomNav } from "@/components/pemasaran-app/bottom-nav";
import { UserMenu } from "@/components/dashboard/user-menu";
import { AppearanceMenu } from "@/components/dashboard/appearance-menu";
import type { OwnProfile } from "@/components/dashboard/account-settings-dialog";

export type PemasaranAppTabKey = "beranda" | "mitra" | "pemasaran";

const TAB_PATHS: Record<PemasaranAppTabKey, string> = {
  beranda: "/mkesindo/pemasaran-app",
  mitra: "/mkesindo/pemasaran-app/mitra",
  pemasaran: "/mkesindo/pemasaran-app/pemasaran",
};

export function PemasaranAppTabShell({
  initialTab,
  userName,
  profile,
  beranda,
  mitra,
  pemasaran,
}: {
  initialTab: PemasaranAppTabKey;
  userName: string;
  profile: OwnProfile | null;
  beranda: React.ReactNode;
  mitra: React.ReactNode;
  pemasaran: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<PemasaranAppTabKey>(initialTab);
  const [visited, setVisited] = useState<Set<PemasaranAppTabKey>>(() => new Set([initialTab]));

  function handleChangeTab(tab: PemasaranAppTabKey) {
    setActiveTab(tab);
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    window.history.replaceState(null, "", TAB_PATHS[tab]);
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background px-4 py-2.5">
        <h1 className="font-display text-base font-semibold">Aplikasi Pemasaran</h1>
        <div className="flex items-center gap-1">
          <AppearanceMenu />
          <UserMenu name={userName} profile={profile} />
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        {visited.has("beranda") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "beranda" && "hidden")}>{beranda}</div>
        )}
        {visited.has("mitra") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "mitra" && "hidden")}>{mitra}</div>
        )}
        {visited.has("pemasaran") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "pemasaran" && "hidden")}>{pemasaran}</div>
        )}
      </div>
      <PemasaranAppBottomNav activeTab={activeTab} onChange={handleChangeTab} />
    </div>
  );
}
```

Note: unlike `ProduksiTabShell` (which lazy-*fetches* data on tab switch via server actions from a client `useEffect`), this shell takes each tab's content as `React.ReactNode` children — each `(tabs)/*/page.tsx` below is itself a Server Component that fetches its own tab's data server-side and renders it, then all three are passed into this one client shell for the tab-switching chrome. This avoids every tab needing its own client-side fetch-on-mount boilerplate; Tasks 6/7/13 each just export a plain async Server Component.

- [ ] **Step 3: Tabs layout guard**

```tsx
// src/app/mkesindo/pemasaran-app/(tabs)/layout.tsx
import { requireMarketing } from "@/lib/require-access";

export default async function PemasaranAppTabsLayout({ children }: { children: React.ReactNode }) {
  await requireMarketing();
  return children;
}
```

- [ ] **Step 4: Three page files (shell wiring)**

```tsx
// src/app/mkesindo/pemasaran-app/(tabs)/page.tsx
import { requireMarketing } from "@/lib/require-access";
import { getUserById } from "@/lib/queries/akun";
import { PemasaranAppTabShell } from "@/components/pemasaran-app/pemasaran-app-tab-shell";
import { BerandaTab } from "@/components/pemasaran-app/beranda-tab";
import { MitraTab } from "@/components/pemasaran-app/mitra-tab";
import { PemasaranTab } from "@/components/pemasaran-app/pemasaran-tab";

export default async function PemasaranAppBerandaPage() {
  const session = await requireMarketing();
  const profile = await getUserById(Number(session.user.id));
  return (
    <PemasaranAppTabShell
      initialTab="beranda"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      beranda={<BerandaTab />}
      mitra={<MitraTab />}
      pemasaran={<PemasaranTab />}
    />
  );
}
```

```tsx
// src/app/mkesindo/pemasaran-app/(tabs)/mitra/page.tsx
import { requireMarketing } from "@/lib/require-access";
import { getUserById } from "@/lib/queries/akun";
import { PemasaranAppTabShell } from "@/components/pemasaran-app/pemasaran-app-tab-shell";
import { BerandaTab } from "@/components/pemasaran-app/beranda-tab";
import { MitraTab } from "@/components/pemasaran-app/mitra-tab";
import { PemasaranTab } from "@/components/pemasaran-app/pemasaran-tab";

export default async function PemasaranAppMitraPage() {
  const session = await requireMarketing();
  const profile = await getUserById(Number(session.user.id));
  return (
    <PemasaranAppTabShell
      initialTab="mitra"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      beranda={<BerandaTab />}
      mitra={<MitraTab />}
      pemasaran={<PemasaranTab />}
    />
  );
}
```

```tsx
// src/app/mkesindo/pemasaran-app/(tabs)/pemasaran/page.tsx
import { requireMarketing } from "@/lib/require-access";
import { getUserById } from "@/lib/queries/akun";
import { PemasaranAppTabShell } from "@/components/pemasaran-app/pemasaran-app-tab-shell";
import { BerandaTab } from "@/components/pemasaran-app/beranda-tab";
import { MitraTab } from "@/components/pemasaran-app/mitra-tab";
import { PemasaranTab } from "@/components/pemasaran-app/pemasaran-tab";

export default async function PemasaranAppPemasaranPage() {
  const session = await requireMarketing();
  const profile = await getUserById(Number(session.user.id));
  return (
    <PemasaranAppTabShell
      initialTab="pemasaran"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      beranda={<BerandaTab />}
      mitra={<MitraTab />}
      pemasaran={<PemasaranTab />}
    />
  );
}
```

**Note for the implementer:** `getUserById(id: number): Promise<OwnProfileRow | null>` (`@/lib/queries/akun`) is the same function `produksi-app/(tabs)/page.tsx` already uses to build its own `profile` prop — confirmed real, no further verification needed. `BerandaTab`/`MitraTab`/`PemasaranTab` don't exist yet — Tasks 6/13/7 create them; this task's own typecheck will fail until those exist, which is expected and resolved once those tasks land (do not stub them out here just to make this task pass in isolation — implement Tasks 5-7 and 13 as one PR-sized unit if the reviewer flags the temporary red build, or create minimal placeholder components here that Tasks 6/7/13 then flesh out, whichever this task's implementer judges cleaner given the actual dependency order they execute in).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: errors only for `BerandaTab`/`MitraTab`/`PemasaranTab` not yet existing (Tasks 6/7/13) — no errors in the 4 files this task itself created.

Run: `npx eslint src/components/pemasaran-app/bottom-nav.tsx src/components/pemasaran-app/pemasaran-app-tab-shell.tsx "src/app/mkesindo/pemasaran-app/(tabs)/layout.tsx"`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/pemasaran-app/bottom-nav.tsx src/components/pemasaran-app/pemasaran-app-tab-shell.tsx "src/app/mkesindo/pemasaran-app/(tabs)"
git commit -m "feat: add pemasaran-app shell, bottom nav, tab pages"
```

---

## Task 6: Beranda tab (Ringkasan Utama, Perbandingan Penjualan, Top Mitra Piutang + Catatan)

**Files:**
- Create: `src/components/pemasaran-app/beranda-tab.tsx`

**Interfaces:**
- Consumes: `getBerandaDataAction` (Task 4); `TopMitraPiutangRow` type (`@/lib/queries/top-mitra-piutang`); `SalesDayComparisonResult`/`SalesDayComparison` types (`@/lib/queries/sales-overview`); `setMitraNoteAction` (Task 4); `formatRupiah`/`formatDate` (`@/lib/format`, unchanged).
- Produces: `BerandaTab` component (no props — self-fetches via `getBerandaDataAction` on mount) — consumed by Task 5.

- [ ] **Step 1: Create the component**

```tsx
// src/components/pemasaran-app/beranda-tab.tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { NotebookPen, PackageCheck, Wallet, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatRupiah } from "@/lib/format";
import { getBerandaDataAction, setMitraNoteAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { SalesDayComparisonResult } from "@/lib/queries/sales-overview";
import type { TopMitraPiutangRow } from "@/lib/queries/top-mitra-piutang";
import type { PiutangStatus } from "@/lib/queries/aging";
import { cn } from "@/lib/utils";

const STATUS_BADGE_VARIANT: Record<PiutangStatus, string> = {
  Sehat: "border-primary/30 bg-primary/5 text-primary",
  Perhatian: "border-warning/30 bg-warning/5 text-warning",
  Kritis: "border-destructive/30 bg-destructive/5 text-destructive",
};

export function BerandaTab() {
  const [sales, setSales] = useState<SalesDayComparisonResult | null>(null);
  const [topPiutang, setTopPiutang] = useState<TopMitraPiutangRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<TopMitraPiutangRow | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getBerandaDataAction().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSales(result.data.sales);
      setTopPiutang(result.data.topPiutang);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSaveNote(formData: FormData) {
    if (!editingNote) return;
    const targetId = editingNote.BusinessPartnerID;
    const note = String(formData.get("note") ?? "").trim();
    startTransition(async () => {
      const result = await setMitraNoteAction({ businessPartnerId: targetId, note: note || null });
      if (!result.success) return;
      setTopPiutang((prev) => prev?.map((r) => (r.BusinessPartnerID === targetId ? { ...r, TargetNote: note || null } : r)) ?? null);
      setEditingNote(null);
    });
  }

  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (!sales || !topPiutang) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const today = sales.comparisons[0]?.current;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="flex flex-col gap-1 p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <PackageCheck className="size-3.5" /> Kantong Terkirim
            </div>
            <p className="font-display text-lg font-semibold tabular-nums">{today?.DOQty.toLocaleString("id-ID") ?? 0}</p>
            <p className="text-[11px] text-muted-foreground">hari ini</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Wallet className="size-3.5" /> Penjualan
            </div>
            <p className="font-display text-lg font-semibold tabular-nums">{formatRupiah(today?.NetSales ?? 0)}</p>
            <p className="text-[11px] text-muted-foreground">hari ini</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Perbandingan Penjualan</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {sales.comparisons.map((c) => (
            <div key={c.label} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
              <div>
                <p className="font-medium">{c.label}</p>
                <p className="text-[11px] text-muted-foreground">{c.dateISO}</p>
              </div>
              <div className="text-right">
                <p className="tabular-nums">{formatRupiah(c.previous?.NetSales ?? 0)}</p>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {c.previous?.DOQty.toLocaleString("id-ID") ?? 0} kantong
                  {c.NominalPctChange != null && ` · ${c.NominalPctChange >= 0 ? "+" : ""}${c.NominalPctChange.toFixed(0)}%`}
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Top Mitra — Piutang Tertinggi</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {topPiutang.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Belum ada mitra dengan piutang berjalan.</p>
          ) : (
            topPiutang.map((r) => (
              <div key={r.BusinessPartnerID} className="rounded-md border border-border p-2.5 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{r.CustomerName}</p>
                  <Badge variant="outline" className={cn("shrink-0 text-[10px]", STATUS_BADGE_VARIANT[r.Status])}>
                    {r.Status}
                  </Badge>
                </div>
                <p className="tabular-nums text-primary">{formatRupiah(r.NominalPiutang)}</p>
                <button
                  type="button"
                  onClick={() => setEditingNote(r)}
                  className="mt-1 flex items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-primary"
                >
                  <NotebookPen className="size-3.5 shrink-0" />
                  {r.TargetNote ? <span className="truncate">{r.TargetNote}</span> : <span>Tambah catatan</span>}
                </button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={editingNote != null} onOpenChange={(open) => !open && setEditingNote(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Catatan — {editingNote?.CustomerName}</DialogTitle>
          </DialogHeader>
          <form action={handleSaveNote} className="flex flex-col gap-3">
            <Textarea name="note" rows={4} defaultValue={editingNote?.TargetNote ?? ""} />
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Menyimpan..." : "Simpan Catatan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no new errors from this file (other files may still be pending per Task 5's note).

Run: `npx eslint src/components/pemasaran-app/beranda-tab.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/pemasaran-app/beranda-tab.tsx
git commit -m "feat: add pemasaran-app Beranda tab"
```

---

## Task 7: Pemasaran tab shell (4 sub-tabs container)

**Files:**
- Create: `src/components/pemasaran-app/pemasaran-tab.tsx`

**Interfaces:**
- Consumes: nothing external — pure client-side sub-tab switcher.
- Produces: `PemasaranTab` component — consumed by Task 5. Renders the 4 sub-tab content components Tasks 8-11 create (`KinerjaMarketingSubTab`, `LogKunjunganSubTab`, `PengirimanSubTab`, `PengajuanSubTab`).

- [ ] **Step 1: Create the component**

```tsx
// src/components/pemasaran-app/pemasaran-tab.tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { KinerjaMarketingSubTab } from "@/components/pemasaran-app/kinerja-marketing-sub-tab";
import { LogKunjunganSubTab } from "@/components/pemasaran-app/log-kunjungan-sub-tab";
import { PengirimanSubTab } from "@/components/pemasaran-app/pengiriman-sub-tab";
import { PengajuanSubTab } from "@/components/pemasaran-app/pengajuan-sub-tab";

type SubTabKey = "kinerja" | "kunjungan" | "pengiriman" | "pengajuan";

const SUB_TABS: { key: SubTabKey; label: string }[] = [
  { key: "kinerja", label: "Kinerja Marketing" },
  { key: "kunjungan", label: "Log Kunjungan" },
  { key: "pengiriman", label: "Pengiriman" },
  { key: "pengajuan", label: "Pengajuan" },
];

export function PemasaranTab() {
  const [activeSubTab, setActiveSubTab] = useState<SubTabKey>("kinerja");
  const [visited, setVisited] = useState<Set<SubTabKey>>(() => new Set(["kinerja"]));

  function handleChange(tab: SubTabKey) {
    setActiveSubTab(tab);
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex overflow-x-auto border-b border-border bg-background">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => handleChange(tab.key)}
            className={cn(
              "shrink-0 whitespace-nowrap px-4 py-2.5 text-sm font-medium",
              activeSubTab === tab.key
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {visited.has("kinerja") && <div className={cn(activeSubTab !== "kinerja" && "hidden")}><KinerjaMarketingSubTab /></div>}
        {visited.has("kunjungan") && <div className={cn(activeSubTab !== "kunjungan" && "hidden")}><LogKunjunganSubTab /></div>}
        {visited.has("pengiriman") && <div className={cn(activeSubTab !== "pengiriman" && "hidden")}><PengirimanSubTab /></div>}
        {visited.has("pengajuan") && <div className={cn(activeSubTab !== "pengajuan" && "hidden")}><PengajuanSubTab /></div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: errors only for the 4 sub-tab components not yet created (Tasks 8-11) — no errors from this file's own code.

Run: `npx eslint src/components/pemasaran-app/pemasaran-tab.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/pemasaran-app/pemasaran-tab.tsx
git commit -m "feat: add Pemasaran tab sub-tab shell"
```

---

## Task 8: Sub-tab Kinerja Marketing

**Files:**
- Create: `src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx`

**Interfaces:**
- Consumes: `getKinerjaMarketingAction` (Task 4); `MarketingPerformanceData`/`MarketingScopeCell` types (`@/lib/queries/marketing-performance`).
- Produces: `KinerjaMarketingSubTab` component — consumed by Task 7.

Read `src/components/dashboard/marketing-performance-panel.tsx` (the existing desktop panel) before starting — this task ports the same `cells`/`mitraDailyQty`/`allMitraByMarketing` data into a mobile card list matching the "Kinerja Marketing" mockup screen (per-mitra card: name, wilayah, target, total kantong, 5 most recent days as small chips with day-over-day delta) rather than porting the desktop panel's own JSX 1:1 (that component is desktop-table-shaped, not mobile-card-shaped).

- [ ] **Step 1: Create the component**

```tsx
// src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx
"use client";

import { useEffect, useState } from "react";
import { Star, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getKinerjaMarketingAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { MarketingPerformanceData } from "@/lib/queries/marketing-performance";

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

export function KinerjaMarketingSubTab() {
  const [data, setData] = useState<MarketingPerformanceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getKinerjaMarketingAction().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setData(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (!data) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const ownMitraId = data.cells[0]?.MarketingUserID;
  const roster = ownMitraId ? (data.allMitraByMarketing[ownMitraId] ?? []) : [];
  const totalQty = data.cells.reduce((sum, c) => sum + c.DailyQty.reduce((s, q) => s + q, 0), 0);
  const totalTarget = data.cells.reduce((sum, c) => sum + c.TargetHarian, 0);
  const last5 = Array.from({ length: Math.min(5, data.periodDays) }, (_, i) => data.periodDays - 5 + i).filter((i) => i >= 0);

  return (
    <div className="flex flex-col gap-2 p-4">
      <Card>
        <CardContent className="flex items-center justify-between p-3">
          <div>
            <p className="text-xs text-muted-foreground">Total kantong periode berjalan</p>
            <p className="font-display text-xl font-semibold tabular-nums">{formatQty(totalQty)}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {totalTarget ? `${Math.round((totalQty / (totalTarget * data.periodDays)) * 100)}% pencapaian` : ""}
          </p>
        </CardContent>
      </Card>

      {roster
        .sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0))
        .map((m) => {
          const daily = data.mitraDailyQty[m.BusinessPartnerID] ?? [];
          const total = daily.reduce((s, q) => s + q, 0);
          return (
            <Card key={m.BusinessPartnerID}>
              <CardContent className="flex flex-col gap-1.5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-1 text-sm font-medium">
                      {(m.Capacity ?? 0) > 0 && <Star className="size-3 fill-warning text-warning" />}
                      {m.Name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {m.Wilayah}
                      {m.Kecamatan ? ` - ${m.Kecamatan}` : ""} · Target {formatQty(m.Capacity ?? 0)}/hari
                    </p>
                  </div>
                  <p className="shrink-0 tabular-nums font-medium">{formatQty(total)} kantong</p>
                </div>
                <div className="flex gap-1.5">
                  {last5.map((i) => (
                    <span key={i} className="rounded bg-muted px-2 py-0.5 text-[11px] tabular-nums">
                      {formatQty(daily[i] ?? 0)}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Run: `npx eslint src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx
git commit -m "feat: add Kinerja Marketing sub-tab"
```

---

## Task 9: Sub-tab Log Kunjungan

**Files:**
- Create: `src/components/pemasaran-app/log-kunjungan-sub-tab.tsx`

**Interfaces:**
- Consumes: `getVisitLogStatusAction`/`saveVisitLogAction` (Task 4); `VisitLogStatusRow` type (Task 2); `getBusinessDateISO` (`@/lib/business-date`, unchanged).
- Produces: `LogKunjunganSubTab` component — consumed by Task 7.

- [ ] **Step 1: Create the component**

```tsx
// src/components/pemasaran-app/log-kunjungan-sub-tab.tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { getBusinessDateISO } from "@/lib/business-date";
import { getVisitLogStatusAction, saveVisitLogAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { VisitLogStatusRow } from "@/lib/queries/marketing-visit-log-status";

export function LogKunjunganSubTab() {
  const [rows, setRows] = useState<VisitLogStatusRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<VisitLogStatusRow | null>(null);
  const [pending, startTransition] = useTransition();
  const dateISO = getBusinessDateISO();

  function reload() {
    getVisitLogStatusAction(dateISO).then((result) => {
      if (!result.success) {
        setError(result.error);
        return;
      }
      setRows(result.data);
    });
  }

  useEffect(() => {
    reload();
    // dateISO is stable within one page lifetime (derived from a fixed
    // business date), so this only needs to run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSave(formData: FormData) {
    if (!editing) return;
    const note = String(formData.get("note") ?? "").trim();
    startTransition(async () => {
      const result = await saveVisitLogAction({
        businessPartnerId: editing.BusinessPartnerID,
        dateISO,
        hasilKunjungan: note || null,
      });
      if (!result.success) return;
      setEditing(null);
      reload();
    });
  }

  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (!rows) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const filledCount = rows.filter((r) => r.HasilKunjungan != null).length;

  return (
    <div className="flex flex-col gap-2 p-4">
      <p className="text-xs text-muted-foreground">
        {filledCount} sudah diisi · {rows.length - filledCount} belum diisi
      </p>
      {rows.map((r) => (
        <Card key={r.BusinessPartnerID}>
          <CardContent
            className="flex cursor-pointer flex-col gap-1 p-3"
            onClick={() => setEditing(r)}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{r.Name}</p>
                <p className="text-xs text-muted-foreground">
                  {r.Wilayah}
                  {r.Kecamatan ? ` - ${r.Kecamatan}` : ""}
                </p>
              </div>
              <Badge variant={r.HasilKunjungan != null ? "default" : "outline"} className="shrink-0 text-[10px]">
                {r.HasilKunjungan != null ? "Sudah Diisi" : "Belum Diisi"}
              </Badge>
            </div>
            {r.HasilKunjungan && <p className="text-xs text-muted-foreground">{r.HasilKunjungan}</p>}
          </CardContent>
        </Card>
      ))}

      <Dialog open={editing != null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hasil Kunjungan — {editing?.Name}</DialogTitle>
          </DialogHeader>
          <form action={handleSave} className="flex flex-col gap-3">
            <Textarea name="note" rows={4} defaultValue={editing?.HasilKunjungan ?? ""} placeholder="Catat hasil kunjungan hari ini..." />
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Run: `npx eslint src/components/pemasaran-app/log-kunjungan-sub-tab.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/pemasaran-app/log-kunjungan-sub-tab.tsx
git commit -m "feat: add Log Kunjungan sub-tab"
```

---

## Task 10: Sub-tab Pengiriman

**Files:**
- Create: `src/components/pemasaran-app/pengiriman-sub-tab.tsx`

**Interfaces:**
- Consumes: `getWilayahDeliveryAction` (Task 4); `PemasaranWilayahDeliveryRow` type (`@/lib/queries/pemasaran-wilayah-delivery`).
- Produces: `PengirimanSubTab` component — consumed by Task 7.

- [ ] **Step 1: Create the component**

```tsx
// src/components/pemasaran-app/pengiriman-sub-tab.tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getWilayahDeliveryAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { PemasaranWilayahDeliveryRow } from "@/lib/queries/pemasaran-wilayah-delivery";

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

export function PengirimanSubTab() {
  const [rows, setRows] = useState<PemasaranWilayahDeliveryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getWilayahDeliveryAction().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setRows(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (!rows) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <p className="text-xs text-muted-foreground">Rata-rata kantong/hari bulan berjalan vs bulan lalu, per wilayah.</p>
      {rows.map((r) => {
        const up = r.PctChange != null && r.PctChange >= 0;
        return (
          <Card key={r.Wilayah}>
            <CardContent className="flex flex-col gap-2 p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">{r.Wilayah}</p>
                {r.PctChange != null && (
                  <span className={up ? "flex items-center gap-0.5 text-xs text-primary" : "flex items-center gap-0.5 text-xs text-destructive"}>
                    {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                    {r.PctChange.toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <p className="tabular-nums font-semibold">{formatQty(r.AvgPerHariThisMonth)}/hari</p>
                  <p className="text-muted-foreground">Bulan Ini</p>
                </div>
                <div>
                  <p className="tabular-nums font-semibold">{formatQty(r.AvgPerHariLastMonth)}/hari</p>
                  <p className="text-muted-foreground">Bulan Lalu</p>
                </div>
                <div>
                  <p className="tabular-nums font-semibold">{formatQty(r.TotalTarget)}</p>
                  <p className="text-muted-foreground">Total Target</p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Run: `npx eslint src/components/pemasaran-app/pengiriman-sub-tab.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/pemasaran-app/pengiriman-sub-tab.tsx
git commit -m "feat: add Pengiriman sub-tab"
```

---

## Task 11: Sub-tab Pengajuan (list)

**Files:**
- Create: `src/components/pemasaran-app/pengajuan-sub-tab.tsx`

**Interfaces:**
- Consumes: `getPengajuanListAction` (Task 4); `PengajuanRow` type (`@/lib/queries/mitra-pengajuan`).
- Produces: `PengajuanSubTab` component — consumed by Task 7. Links to `/mkesindo/pemasaran-app/pengajuan/baru` (Task 12).

- [ ] **Step 1: Create the component**

```tsx
// src/components/pemasaran-app/pengajuan-sub-tab.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { getPengajuanListAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { PengajuanRow, PengajuanStatus } from "@/lib/queries/mitra-pengajuan";

const STATUS_VARIANT: Record<PengajuanStatus, "default" | "outline" | "destructive"> = {
  Menunggu: "outline",
  Diproses: "outline",
  Disetujui: "default",
  Ditolak: "destructive",
};

export function PengajuanSubTab() {
  const [rows, setRows] = useState<PengajuanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPengajuanListAction().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setRows(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-2 p-4">
      <Button render={<Link href="/mkesindo/pemasaran-app/pengajuan/baru" />} className="w-full gap-1.5">
        <Plus className="size-4" /> Pengajuan Baru
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!rows && !error && (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {rows?.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Belum ada pengajuan.</p>}
      {rows?.map((r) => (
        <Card key={r.PengajuanID}>
          <CardContent className="flex flex-col gap-1 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">{r.NamaCalon}</p>
              <Badge variant={STATUS_VARIANT[r.Status]} className="shrink-0 text-[10px]">
                {r.Status}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {r.Wilayah}
              {r.Kecamatan ? ` - ${r.Kecamatan}` : ""} · {formatDate(r.CreatedAt)}
            </p>
            {r.NoHP && <p className="text-xs text-muted-foreground">{r.NoHP}</p>}
            {r.Status === "Ditolak" && r.CatatanTolak && (
              <p className="text-xs text-destructive">Ditolak: {r.CatatanTolak}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: errors only for `/mkesindo/pemasaran-app/pengajuan/baru` not existing yet (Task 12) — none from this file's own code (a `<Link href>` to a not-yet-existing route is not a TypeScript error in this Next.js setup; if it is flagged, this is resolved once Task 12 lands).

Run: `npx eslint src/components/pemasaran-app/pengajuan-sub-tab.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/pemasaran-app/pengajuan-sub-tab.tsx
git commit -m "feat: add Pengajuan sub-tab list"
```

---

## Task 12: Layar Pengajuan Mitra Baru (form)

**Files:**
- Create: `src/app/mkesindo/pemasaran-app/pengajuan/baru/page.tsx`
- Create: `src/components/pemasaran-app/pengajuan-form.tsx`

**Interfaces:**
- Consumes: `createPengajuanAction`/`getPriceLevelOptionsAction` (Task 4); `PengajuanInput` type (`@/lib/queries/mitra-pengajuan`); `PriceLevelOption` type (`@/lib/queries/mitra`); `requireMarketing` (Task 1).
- Produces: page at `/mkesindo/pemasaran-app/pengajuan/baru` — consumed by Task 11's link.

Field list matches `PengajuanInput` exactly (`namaCalon`, `noHP`, `waktuPermintaanSampai`, `qtyKantong`, `priceLevel`, `wilayah`, `kecamatan`, `alamat`, `latitude`/`longitude`, `kapasitas`, `kompetitor`) — per Global Constraints, **no "Jenis Usaha" field** (auto-derived server-side, unchanged) and **priceLevel is a dropdown populated from `getPriceLevelOptionsAction()`**, not a free Rupiah input. Read `src/components/dashboard/pengajuan-form-dialog.tsx` (the existing desktop form) before starting for field-level reference (labels, which fields are required) — this task ports the same fields into a full-screen mobile layout with a back-arrow header (matching the mockup), not a dialog.

- [ ] **Step 1: Create the page**

```tsx
// src/app/mkesindo/pemasaran-app/pengajuan/baru/page.tsx
import { requireMarketing } from "@/lib/require-access";
import { PengajuanForm } from "@/components/pemasaran-app/pengajuan-form";

export default async function PengajuanBaruPage() {
  await requireMarketing();
  return <PengajuanForm />;
}
```

- [ ] **Step 2: Create the form component**

```tsx
// src/components/pemasaran-app/pengajuan-form.tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRupiah } from "@/lib/format";
import { createPengajuanAction, getPriceLevelOptionsAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { PriceLevelOption } from "@/lib/queries/mitra";

export function PengajuanForm() {
  const router = useRouter();
  const [priceLevels, setPriceLevels] = useState<PriceLevelOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getPriceLevelOptionsAction().then((result) => {
      if (result.success) setPriceLevels(result.data);
    });
  }, []);

  function handleSubmit(formData: FormData) {
    setError(null);
    const priceLevel = formData.get("priceLevel") ? Number(formData.get("priceLevel")) : null;
    const qtyKantong = formData.get("qtyKantong") ? Number(formData.get("qtyKantong")) : null;
    startTransition(async () => {
      const result = await createPengajuanAction({
        namaCalon: String(formData.get("namaCalon") ?? ""),
        noHP: String(formData.get("noHP") ?? "") || null,
        waktuPermintaanSampai: String(formData.get("waktuPermintaanSampai") ?? ""),
        qtyKantong,
        priceLevel,
        wilayah: String(formData.get("wilayah") ?? "") || null,
        kecamatan: String(formData.get("kecamatan") ?? "") || null,
        alamat: String(formData.get("alamat") ?? "") || null,
        latitude: null,
        longitude: null,
        kapasitas: qtyKantong,
        kompetitor: String(formData.get("kompetitor") ?? "") || null,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.push("/mkesindo/pemasaran-app/pemasaran");
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-display text-base font-semibold">Pengajuan Mitra Baru</h1>
      </header>

      <form action={handleSubmit} className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <p className="text-xs font-semibold text-muted-foreground">Data Calon Mitra</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="namaCalon">Nama Mitra *</Label>
            <Input id="namaCalon" name="namaCalon" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="noHP">Nomor Telepon</Label>
            <Input id="noHP" name="noHP" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="alamat">Alamat *</Label>
            <Textarea id="alamat" name="alamat" rows={2} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wilayah">Wilayah *</Label>
            <Input id="wilayah" name="wilayah" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kecamatan">Kecamatan</Label>
            <Input id="kecamatan" name="kecamatan" />
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <p className="text-xs font-semibold text-muted-foreground">Kebutuhan &amp; Harga</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="priceLevel">Tingkat Harga</Label>
            <Select name="priceLevel">
              <SelectTrigger id="priceLevel">
                <SelectValue placeholder="Pilih tingkat harga" />
              </SelectTrigger>
              <SelectContent>
                {priceLevels?.map((p) => (
                  <SelectItem key={p.Level} value={String(p.Level)}>
                    Level {p.Level} — {formatRupiah(p.Price)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qtyKantong">Kantong/Hari</Label>
            <Input id="qtyKantong" name="qtyKantong" type="number" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="waktuPermintaanSampai">Permintaan Sampai</Label>
            <Input id="waktuPermintaanSampai" name="waktuPermintaanSampai" type="datetime-local" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kompetitor">Daftar Kompetitor</Label>
            <Textarea id="kompetitor" name="kompetitor" rows={2} placeholder="Es kristal lain, es balok, dll." />
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending}>
          {pending ? "Mengirim..." : "Kirim Pengajuan"}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Run: `npx eslint src/components/pemasaran-app/pengajuan-form.tsx "src/app/mkesindo/pemasaran-app/pengajuan/baru/page.tsx"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/pemasaran-app/pengajuan-form.tsx "src/app/mkesindo/pemasaran-app/pengajuan/baru/page.tsx"
git commit -m "feat: add Pengajuan Mitra Baru form screen"
```

---

## Task 13: Tab Mitra (list + Peta Wilayah stats)

**Files:**
- Create: `src/components/pemasaran-app/mitra-tab.tsx`

**Interfaces:**
- Consumes: `getMitraListAction`/`getWilayahDeliveryAction` (Task 4); `MitraRow` type (`@/lib/queries/mitra`); `PemasaranWilayahDeliveryRow` type.
- Produces: `MitraTab` component — consumed by Task 5. Links to `/mkesindo/pemasaran-app/mitra/[id]` (Task 14) and `/mkesindo/pemasaran-app/pengajuan/baru` (reuses Task 12's screen — "Ajukan Mitra" is the same flow as Pengajuan Mitra Baru, per the spec's Cakupan section noting no separate creation path exists outside Pengajuan).

- [ ] **Step 1: Create the component**

```tsx
// src/components/pemasaran-app/mitra-tab.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMitraListAction, getWilayahDeliveryAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { MitraRow } from "@/lib/queries/mitra";
import type { PemasaranWilayahDeliveryRow } from "@/lib/queries/pemasaran-wilayah-delivery";

export function MitraTab() {
  const [mitra, setMitra] = useState<MitraRow[] | null>(null);
  const [wilayahStats, setWilayahStats] = useState<PemasaranWilayahDeliveryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"daftar" | "wilayah">("daftar");

  useEffect(() => {
    let cancelled = false;
    Promise.all([getMitraListAction(), getWilayahDeliveryAction()]).then(([mitraResult, wilayahResult]) => {
      if (cancelled) return;
      if (!mitraResult.success) {
        setError(mitraResult.error);
        return;
      }
      setMitra(mitraResult.data);
      if (wilayahResult.success) setWilayahStats(wilayahResult.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!mitra) return [];
    const q = search.trim().toLowerCase();
    if (!q) return mitra;
    return mitra.filter((m) => m.Name.toLowerCase().includes(q));
  }, [mitra, search]);

  const mitraCountByWilayah = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of mitra ?? []) {
      if (!m.Wilayah) continue;
      map.set(m.Wilayah, (map.get(m.Wilayah) ?? 0) + 1);
    }
    return map;
  }, [mitra]);

  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (!mitra) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{mitra.length} mitra terdaftar</p>
        <Button size="sm" render={<Link href="/mkesindo/pemasaran-app/pengajuan/baru" />} className="gap-1.5">
          <Plus className="size-3.5" /> Ajukan Mitra
        </Button>
      </div>

      <div className="flex gap-1.5">
        <Button size="sm" variant={view === "daftar" ? "default" : "outline"} onClick={() => setView("daftar")}>
          Daftar Mitra
        </Button>
        <Button size="sm" variant={view === "wilayah" ? "default" : "outline"} onClick={() => setView("wilayah")}>
          Peta Wilayah
        </Button>
      </div>

      {view === "daftar" ? (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Cari nama mitra..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {filtered.map((m) => (
            <Card key={m.BusinessPartnerID}>
              <CardContent className="p-3">
                <Link href={`/mkesindo/pemasaran-app/mitra/${m.BusinessPartnerID}`} className="flex flex-col gap-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{m.Name}</p>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {m.PartnerType}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {m.Kontak ?? "-"} · {m.Wilayah ?? "-"}
                    {m.Kecamatan ? ` - ${m.Kecamatan}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{m.Capacity ?? 0} kantong/hari</p>
                </Link>
              </CardContent>
            </Card>
          ))}
        </>
      ) : (
        (wilayahStats ?? []).map((w) => (
          <Card key={w.Wilayah}>
            <CardContent className="flex items-center justify-between p-3">
              <p className="font-medium">{w.Wilayah}</p>
              <p className="text-sm tabular-nums text-muted-foreground">{mitraCountByWilayah.get(w.Wilayah) ?? 0} mitra</p>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
```

**Note for the implementer:** `formatRupiah((m.PriceLevel ?? 0) as number)` above is WRONG — `PriceLevel` is a level number (1-8), not a Rupiah amount (see the spec's "Harga per kantong" decision). Fix this before committing: either drop the price display from the Mitra list card entirely (`Capacity` alone is enough context), or fetch `getPriceLevelOptionsAction()` alongside the mitra list and look up the real Rupiah value for each row's `PriceLevel`. Do not ship the cast-to-number placeholder as written above.

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Run: `npx eslint src/components/pemasaran-app/mitra-tab.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/pemasaran-app/mitra-tab.tsx
git commit -m "feat: add Mitra tab (list + Peta Wilayah)"
```

---

## Task 14: Layar Detail Mitra

**Files:**
- Create: `src/app/mkesindo/pemasaran-app/mitra/[id]/page.tsx`
- Create: `src/components/pemasaran-app/mitra-detail.tsx`

**Interfaces:**
- Consumes: `getMitraDetailAction` (Task 4); `MitraRow` type.
- Produces: page at `/mkesindo/pemasaran-app/mitra/[id]` — consumed by Task 13's link. Links to `/mkesindo/pemasaran-app/mitra/[id]/edit` (Task 15).

- [ ] **Step 1: Create the page**

```tsx
// src/app/mkesindo/pemasaran-app/mitra/[id]/page.tsx
import { requireMarketing } from "@/lib/require-access";
import { getMitraDetailAction } from "@/app/mkesindo/pemasaran-app/actions";
import { MitraDetail } from "@/components/pemasaran-app/mitra-detail";
import { notFound } from "next/navigation";

export default async function MitraDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMarketing();
  const { id } = await params;
  const result = await getMitraDetailAction(id);
  if (!result.success || !result.data) notFound();
  return <MitraDetail mitra={result.data} />;
}
```

- [ ] **Step 2: Create the detail component**

```tsx
// src/components/pemasaran-app/mitra-detail.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { MitraRow } from "@/lib/queries/mitra";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

export function MitraDetail({ mitra }: { mitra: MitraRow }) {
  const router = useRouter();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="font-display text-base font-semibold">{mitra.Name}</h1>
        </div>
        <Badge variant="outline">{mitra.IsSuspended ? "Nonaktif" : "Aktif"}</Badge>
      </header>

      <div className="flex flex-col gap-1 p-4">
        <Row label="No. Telepon" value={mitra.Kontak ?? "-"} />
        <Row label="Jenis Usaha" value={mitra.PartnerType} />
        <Row label="Kabupaten" value={mitra.Wilayah ?? "-"} />
        <Row label="Wilayah / Kecamatan" value={mitra.Kecamatan ?? "-"} />
        <Row label="Alamat" value={mitra.Alamat ?? "-"} />
        <Row label="Kantong/Hari" value={mitra.Capacity != null ? String(mitra.Capacity) : "Belum diisi"} />
        <Row label="Kompetitor" value={mitra.Kompetitor ?? "-"} />
      </div>

      <div className="mt-auto p-4">
        <Button render={<Link href={`/mkesindo/pemasaran-app/mitra/${mitra.BusinessPartnerID}/edit`} />} className="w-full gap-1.5">
          <Pencil className="size-4" /> Edit Data Mitra
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Run: `npx eslint src/components/pemasaran-app/mitra-detail.tsx "src/app/mkesindo/pemasaran-app/mitra/[id]/page.tsx"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/pemasaran-app/mitra-detail.tsx "src/app/mkesindo/pemasaran-app/mitra/[id]"
git commit -m "feat: add Mitra detail screen"
```

---

## Task 15: Layar Edit Mitra

**Files:**
- Create: `src/app/mkesindo/pemasaran-app/mitra/[id]/edit/page.tsx`
- Create: `src/components/pemasaran-app/mitra-edit-form.tsx`

**Interfaces:**
- Consumes: `getMitraDetailAction`/`updateMitraAction`/`getPriceLevelOptionsAction` (Task 4); `MitraRow`/`MitraInput`/`PriceLevelOption` types.
- Produces: page at `/mkesindo/pemasaran-app/mitra/[id]/edit` — consumed by Task 14's link.

- [ ] **Step 1: Create the page**

```tsx
// src/app/mkesindo/pemasaran-app/mitra/[id]/edit/page.tsx
import { notFound } from "next/navigation";
import { requireMarketing } from "@/lib/require-access";
import { getMitraDetailAction } from "@/app/mkesindo/pemasaran-app/actions";
import { MitraEditForm } from "@/components/pemasaran-app/mitra-edit-form";

export default async function MitraEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMarketing();
  const { id } = await params;
  const result = await getMitraDetailAction(id);
  if (!result.success || !result.data) notFound();
  return <MitraEditForm mitra={result.data} />;
}
```

- [ ] **Step 2: Create the edit form component**

```tsx
// src/components/pemasaran-app/mitra-edit-form.tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRupiah } from "@/lib/format";
import { getPriceLevelOptionsAction, updateMitraAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { MitraRow, PriceLevelOption } from "@/lib/queries/mitra";

export function MitraEditForm({ mitra }: { mitra: MitraRow }) {
  const router = useRouter();
  const [priceLevels, setPriceLevels] = useState<PriceLevelOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getPriceLevelOptionsAction().then((result) => {
      if (result.success) setPriceLevels(result.data);
    });
  }, []);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateMitraAction(mitra.BusinessPartnerID, {
        name: String(formData.get("name") ?? ""),
        mobileNo: String(formData.get("mobileNo") ?? "") || null,
        address: String(formData.get("address") ?? "") || null,
        wilayah: String(formData.get("wilayah") ?? "") || null,
        kecamatan: String(formData.get("kecamatan") ?? "") || null,
        gender: mitra.Gender,
        priceLevel: formData.get("priceLevel") ? Number(formData.get("priceLevel")) : null,
        termOfPaymentId: mitra.TermOfPaymentID,
        capacity: formData.get("capacity") ? Number(formData.get("capacity")) : null,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.push(`/mkesindo/pemasaran-app/mitra/${mitra.BusinessPartnerID}`);
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-display text-base font-semibold">Edit Mitra</h1>
      </header>

      <form action={handleSubmit} className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Nama Mitra</Label>
          <Input id="name" name="name" defaultValue={mitra.Name} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mobileNo">Nomor Telepon</Label>
          <Input id="mobileNo" name="mobileNo" defaultValue={mitra.Kontak ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Jenis Usaha</Label>
          <Input value={mitra.PartnerType} disabled className="text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wilayah">Kabupaten</Label>
          <Input id="wilayah" name="wilayah" defaultValue={mitra.Wilayah ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="kecamatan">Wilayah / Kecamatan</Label>
          <Input id="kecamatan" name="kecamatan" defaultValue={mitra.Kecamatan ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="address">Alamat</Label>
          <Textarea id="address" name="address" rows={2} defaultValue={mitra.Alamat ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="priceLevel">Harga per Kantong</Label>
          <Select name="priceLevel" defaultValue={mitra.PriceLevel != null ? String(mitra.PriceLevel) : undefined}>
            <SelectTrigger id="priceLevel">
              <SelectValue placeholder="Pilih tingkat harga" />
            </SelectTrigger>
            <SelectContent>
              {priceLevels?.map((p) => (
                <SelectItem key={p.Level} value={String(p.Level)}>
                  Level {p.Level} — {formatRupiah(p.Price)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="capacity">Kebutuhan Kantong per Hari</Label>
          <Input id="capacity" name="capacity" type="number" defaultValue={mitra.Capacity ?? ""} />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending}>
          {pending ? "Menyimpan..." : "Simpan Perubahan"}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Run: `npx eslint src/components/pemasaran-app/mitra-edit-form.tsx "src/app/mkesindo/pemasaran-app/mitra/[id]/edit/page.tsx"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/pemasaran-app/mitra-edit-form.tsx "src/app/mkesindo/pemasaran-app/mitra/[id]/edit"
git commit -m "feat: add Mitra edit screen"
```

---

## Task 16: Profil, Pengaturan Akun, Ubah Password

**Files:**
- Create: `src/app/mkesindo/pemasaran-app/profil/page.tsx`
- Create: `src/app/mkesindo/pemasaran-app/profil/akun/page.tsx`
- Create: `src/app/mkesindo/pemasaran-app/profil/password/page.tsx`
- Modify: `src/components/pemasaran-app/pemasaran-app-tab-shell.tsx` (add a link to `/mkesindo/pemasaran-app/profil` from the header, replacing or alongside `UserMenu`)

**Interfaces:**
- Consumes: `updateOwnProfileAction`/`changeOwnPasswordAction` (`@/app/mkesindo/(dashboard)/profile-actions`, unchanged); `OwnProfile` type (`@/components/dashboard/account-settings-dialog`, unchanged); `requireMarketing` (Task 1).
- Produces: 3 pages — leaf screens, nothing consumed by later tasks.

Read `src/components/dashboard/account-settings-dialog.tsx`'s `ProfileForm`/`PasswordForm` (already read during this plan's research) before starting — reuse the exact same field set and the exact same two actions, just laid out as 3 separate full-screen mobile views with back-arrow headers instead of one dialog with two stacked forms, matching the mockup.

- [ ] **Step 1: Profil summary screen**

```tsx
// src/app/mkesindo/pemasaran-app/profil/page.tsx
import Link from "next/link";
import { LogOut, Settings, KeyRound } from "lucide-react";
import { requireMarketing } from "@/lib/require-access";
import { getUserById } from "@/lib/queries/akun";
import { Card, CardContent } from "@/components/ui/card";
import { SignOutButton } from "@/components/pemasaran-app/sign-out-button";

export default async function ProfilPage() {
  const session = await requireMarketing();
  const profile = await getUserById(Number(session.user.id));

  return (
    <div className="flex min-h-screen flex-col bg-background p-4">
      <h1 className="mb-4 font-display text-lg font-semibold">Profil</h1>
      <Card className="mb-4">
        <CardContent className="p-4">
          <p className="font-semibold">{profile?.nama ?? session.user.name}</p>
          <p className="text-xs text-muted-foreground">{profile?.username ?? session.user.username}</p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <Link href="/mkesindo/pemasaran-app/profil/akun" className="flex items-center gap-3 rounded-lg border border-border p-3">
          <Settings className="size-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Pengaturan Akun</p>
            <p className="text-xs text-muted-foreground">Nama, username, telepon, email</p>
          </div>
        </Link>
        <Link href="/mkesindo/pemasaran-app/profil/password" className="flex items-center gap-3 rounded-lg border border-border p-3">
          <KeyRound className="size-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Ubah Password</p>
            <p className="text-xs text-muted-foreground">Ganti password akun Anda</p>
          </div>
        </Link>
      </div>

      <div className="mt-4">
        <SignOutButton />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Sign-out button (client component, needed for `signOut()`)**

```tsx
// src/components/pemasaran-app/sign-out-button.tsx
"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <Button variant="outline" className="w-full gap-1.5 text-destructive" onClick={() => signOut({ callbackUrl: "/login" })}>
      <LogOut className="size-4" /> Keluar dari Akun
    </Button>
  );
}
```

- [ ] **Step 3: Pengaturan Akun screen**

```tsx
// src/app/mkesindo/pemasaran-app/profil/akun/page.tsx
import { requireMarketing } from "@/lib/require-access";
import { getUserById } from "@/lib/queries/akun";
import { notFound } from "next/navigation";
import { PengaturanAkunForm } from "@/components/pemasaran-app/pengaturan-akun-form";

export default async function PengaturanAkunPage() {
  const session = await requireMarketing();
  const profile = await getUserById(Number(session.user.id));
  if (!profile) notFound();
  return <PengaturanAkunForm profile={profile} />;
}
```

```tsx
// src/components/pemasaran-app/pengaturan-akun-form.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOwnProfileAction } from "@/app/mkesindo/(dashboard)/profile-actions";
import type { OwnProfile } from "@/components/dashboard/account-settings-dialog";

export function PengaturanAkunForm({ profile }: { profile: OwnProfile }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await updateOwnProfileAction({
        nama: String(formData.get("nama") ?? ""),
        nomorTelepon: String(formData.get("nomorTelepon") ?? "") || null,
        email: String(formData.get("email") ?? "") || null,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSuccess(true);
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-display text-base font-semibold">Pengaturan Akun</h1>
      </header>

      <form action={handleSubmit} className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nama">Nama</Label>
          <Input id="nama" name="nama" defaultValue={profile.nama} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Username</Label>
          <Input value={profile.username} disabled className="text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nomorTelepon">Nomor Telepon</Label>
          <Input id="nomorTelepon" name="nomorTelepon" defaultValue={profile.nomorTelepon ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={profile.email ?? ""} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-primary">Profil tersimpan.</p>}
        <Button type="submit" disabled={pending}>
          {pending ? "Menyimpan..." : "Simpan Perubahan"}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Ubah Password screen**

```tsx
// src/app/mkesindo/pemasaran-app/profil/password/page.tsx
import { requireMarketing } from "@/lib/require-access";
import { UbahPasswordForm } from "@/components/pemasaran-app/ubah-password-form";

export default async function UbahPasswordPage() {
  await requireMarketing();
  return <UbahPasswordForm />;
}
```

```tsx
// src/components/pemasaran-app/ubah-password-form.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeOwnPasswordAction } from "@/app/mkesindo/(dashboard)/profile-actions";

export function UbahPasswordForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(false);
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    if (newPassword !== confirmPassword) {
      setError("Konfirmasi password baru tidak cocok.");
      return;
    }
    startTransition(async () => {
      const result = await changeOwnPasswordAction({ currentPassword, newPassword });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSuccess(true);
      (document.getElementById("ubahPasswordForm") as HTMLFormElement | null)?.reset();
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-display text-base font-semibold">Ubah Password</h1>
      </header>

      <form id="ubahPasswordForm" action={handleSubmit} className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="currentPassword">Password Saat Ini</Label>
          <Input id="currentPassword" name="currentPassword" type="password" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="newPassword">Password Baru</Label>
          <Input id="newPassword" name="newPassword" type="password" minLength={6} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirmPassword">Konfirmasi Password Baru</Label>
          <Input id="confirmPassword" name="confirmPassword" type="password" minLength={6} required />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-primary">Password berhasil diubah.</p>}
        <Button type="submit" disabled={pending}>
          {pending ? "Menyimpan..." : "Ganti Password"}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Link Profil from the app shell header**

In `src/components/pemasaran-app/pemasaran-app-tab-shell.tsx` (Task 5), replace the `<UserMenu name={userName} profile={profile} />` usage with a plain avatar link to the new Profil screen, since this app uses dedicated full-screen Profil/Pengaturan Akun/Ubah Password routes instead of `UserMenu`'s dropdown+dialog pattern:

```tsx
import Link from "next/link";
import { User } from "lucide-react";
```

Replace the header's right-hand side:

```tsx
<div className="flex items-center gap-1">
  <AppearanceMenu />
  <Link href="/mkesindo/pemasaran-app/profil" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
    <User className="size-4" />
    {userName}
  </Link>
</div>
```

Remove the now-unused `UserMenu`/`OwnProfile` import and the `profile` prop can stay (still passed down for potential future use) or be removed from `PemasaranAppTabShell`'s props if the implementer confirms nothing else in the shell needs it — check before removing, since Task 5's three `page.tsx` files still fetch and pass `profile` down; if it's now fully unused, also remove that fetch from those 3 files to avoid dead code (`getUserById` calls with no consumer).

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/app/mkesindo/pemasaran-app/profil src/components/pemasaran-app/sign-out-button.tsx src/components/pemasaran-app/pengaturan-akun-form.tsx src/components/pemasaran-app/ubah-password-form.tsx src/components/pemasaran-app/pemasaran-app-tab-shell.tsx`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/mkesindo/pemasaran-app/profil src/components/pemasaran-app/sign-out-button.tsx src/components/pemasaran-app/pengaturan-akun-form.tsx src/components/pemasaran-app/ubah-password-form.tsx src/components/pemasaran-app/pemasaran-app-tab-shell.tsx
git commit -m "feat: add Profil, Pengaturan Akun, Ubah Password screens"
```

---

## Task 17: Full verification pass

**Files:** None — verification only, fix forward in the touched files above if something's found broken.

**Interfaces:** N/A.

- [ ] **Step 1: Whole-project typecheck and lint**

Run: `npx tsc --noEmit`
Expected: zero errors anywhere in the project (this is the first point where every file from Tasks 1-16 exists simultaneously, so any cross-task type mismatch — e.g. a prop name that drifted between the shell and a tab component — surfaces here even if each task's own isolated check passed).

Run: `npx eslint src/app/mkesindo/pemasaran-app src/components/pemasaran-app "src/app/mkesindo/(dashboard)/layout.tsx" src/lib/require-access.ts src/lib/queries/marketing-visit-log-status.ts src/lib/queries/sales-overview-marketing.ts`
Expected: no errors.

- [ ] **Step 2: Cross-check data against the desktop module**

Log in as a real Marketing-role account (not superadmin) and confirm landing on `/mkesindo/pemasaran-app`. For each tab/sub-tab, compare the numbers shown against the same marketing's data on the desktop `/mkesindo/pemasaran` (logged in separately as an account that can see it, e.g. superadmin) for the same period — Kinerja Marketing totals, Pengiriman per-wilayah rates, Pengajuan list, Top Mitra Piutang — must match exactly (same underlying queries, just re-scoped/re-rendered).

- [ ] **Step 3: Live browser walkthrough**

- Beranda: KPI cards show real non-zero numbers (or a sensible zero state), Perbandingan Penjualan shows 4 comparison rows, Top Mitra Piutang shows real mitra with working "Tambah catatan" (save, reload, confirm it persisted).
- Mitra: list loads, search filters correctly, tapping a card opens detail, Edit Mitra saves and reflects on the detail screen after.
- Pemasaran → Kinerja Marketing: shows this marketing's own mitra only (not other marketings').
- Pemasaran → Log Kunjungan: shows today's status per mitra, saving a note flips it to "Sudah Diisi" and persists on reload.
- Pemasaran → Pengiriman: wilayah cards match desktop.
- Pemasaran → Pengajuan: list shows own submissions only; "Pengajuan Baru" submits successfully and the new row appears in the list on return.
- Profil → Pengaturan Akun: save works, persists.
- Profil → Ubah Password: change with a disposable test account, confirm login with the new password works, then change it back.
- Confirm `/mkesindo/pemasaran` (desktop) still renders unchanged for a Supervisor/Accounting/Super Admin account (regression check — this plan never modifies it).
- Confirm Driver/Satpam/Produksi login redirects are unchanged (regression check on the one shared file this plan touches, `(dashboard)/layout.tsx`).

- [ ] **Step 4: Report and commit any fixes**

If Steps 1-3 find anything broken, fix it in the relevant file and re-run Steps 1 and 3 before considering this task done.

```bash
git add <fixed files>
git commit -m "fix: <describe what verification caught>"
```
