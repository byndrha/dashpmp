# Konsolidasi Tab Pengiriman & Riwayat produksi-app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/mkesindo/produksi-app`'s "Pengiriman" and "Riwayat" tabs with a single "Riwayat" button on the "Stok Es" tab that opens a full-screen, date+shift-filterable view of every Kartu Pengiriman for a chosen work period.

**Architecture:** Two new period-explicit query functions (using the existing `report-shift.ts` 3-shift system) replace four old current-vs-previous-period functions. A new full-screen route (sibling to `(tabs)/`, self-gated) hosts a client component that filters by date+shift and reuses the existing `KartuPengirimanList` component verbatim via a `key`-remount. The old Pengiriman tab's route becomes the new Stok Es root route; the old Riwayat tab and its own separate `warehouse/` subpath are deleted.

**Tech Stack:** Next.js App Router (Server Actions, Server Components), MSSQL (`mssql` via `src/lib/db.ts`), Tailwind, shadcn/ui, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-09-03-produksi-app-riwayat-konsolidasi-design.md`

## Global Constraints

- Never modify `getDraftJadwalForProduksi`/`getAllDraftJadwalForProduksi`/`getDraftJadwalForProduksiAction`, `isCurrentOrFuturePeriod`, or anything in the pallet-allocation ("Mulai Muat" → alokasi) flow — all out of scope.
- The new period-explicit queries filter BOTH "Belum Selesai" and "Sudah Selesai Muat" by the card's own `JamJadwal` falling in the selected shift window — never by `JamSelesaiMuat` — so a card stays in the same period-view regardless of when it was actually completed.
- `getShiftWindow` (from `@/lib/report-shift`) returns naive-WIB `Date`s (raw UTC-component values equal the WIB wall-clock value). `DashboardPengirimanJadwal.JamJadwal`/`JamSelesaiMuat` use this SAME naive-WIB representation in practice (empirically confirmed via this session's own Truk-52 armada-overlap investigation) — compare them directly with `BETWEEN`, no timezone conversion. Do NOT "fix" this to match the older, contradicting comment on `isCurrentOrFuturePeriod` in `produksi-muatan.ts` — that comment describes a different, unrelated function this plan does not touch.
- This repo has no automated test suite. Verification is `npx tsc --noEmit` + `npm run lint` + **`npm run build`** (a real production build) for every task that touches a `"use client"` file — this session had a real production-deploy failure (commit `7d2fa21`) from a client component importing a plain value from a server-only (`mssql`-importing) query module. `report-shift.ts` and `business-date.ts` have zero imports from `@/lib/db` and are confirmed safe to import values from directly into client components.
- `@/lib/produksi-shift`'s `SHIFT_LABEL` (used by `kualitas-view.tsx`) is a SEPARATE, unrelated shift-labeling system — never import from it for this work. This plan's shift labels come only from `@/lib/report-shift`'s `getShiftLabel(shift, "work")`.

---

### Task 1: Query layer — period-explicit Kartu Pengiriman functions

**Files:**
- Modify: `src/lib/queries/produksi-muatan.ts`

**Interfaces:**
- Consumes: `getShiftWindow`, `type ShiftNumber` from `@/lib/report-shift` (new import). `JADWAL_KANTONG_10KG_EXPR`/`JADWAL_KANTONG_5KG_EXPR` (already imported in this file from `@/lib/queries/pengiriman-jadwal`).
- Produces (consumed by Task 2): `getKartuPengirimanBelumSelesaiUntukPeriode(tanggalUsaha: Date, shift: ShiftNumber): Promise<DraftJadwalForProduksi[]>`, `getKartuPengirimanSelesaiUntukPeriode(tanggalUsaha: Date, shift: ShiftNumber): Promise<SelesaiMuatJadwalForProduksi[]>`.

- [ ] **Step 1: Add the `report-shift` import**

At the top of `src/lib/queries/produksi-muatan.ts`, alongside the existing imports (after the `pengiriman-jadwal` import), add:

```ts
import { getShiftWindow, type ShiftNumber } from "@/lib/report-shift";
```

- [ ] **Step 2: Delete the four now-superseded functions**

Delete these from `src/lib/queries/produksi-muatan.ts` entirely (including their comments):
- `getDraftJadwalRiwayatForProduksi` (the whole exported function and its preceding comment block)
- `fetchRecentSelesaiMuatJadwalForProduksi` (the whole private async function and its preceding comment block)
- `getSelesaiMuatJadwalForProduksi` (the whole exported function and its preceding comment block)
- `getSelesaiMuatJadwalRiwayatForProduksi` (the whole exported function and its preceding comment block)

Do NOT delete: `isCurrentOrFuturePeriod`, `fetchAllDraftJadwalForProduksi`, `getAllDraftJadwalForProduksi`, `getDraftJadwalForProduksi`, the `DraftJadwalForProduksi`/`SelesaiMuatJadwalForProduksi` interfaces, `produksiStartMuat`, `produksiSelesaiMuatManual`, or anything else in this file.

- [ ] **Step 3: Add the two new period-explicit functions**

Append these at the end of `src/lib/queries/produksi-muatan.ts` (after `produksiSelesaiMuatManual`):

```ts
// Layar Riwayat baru (menggantikan tab Pengiriman/Riwayat lama) — "Belum
// Selesai" untuk satu periode kerja (tanggal usaha + shift) eksplisit,
// bukan cuma "sekarang" vs "sebelumnya". getShiftWindow mengembalikan Date
// ber-representasi naive-WIB, sama seperti JamJadwal kolom ini disimpan
// (dikonfirmasi empiris lewat investigasi bug armada Truk 52 sesi ini) --
// perbandingan BETWEEN di bawah aman tanpa konversi zona waktu apa pun.
export async function getKartuPengirimanBelumSelesaiUntukPeriode(
  tanggalUsaha: Date,
  shift: ShiftNumber
): Promise<DraftJadwalForProduksi[]> {
  const { start, end } = getShiftWindow(tanggalUsaha, shift, "work");
  const pool = await getPool();
  const result = await pool
    .request()
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end).query(`
      SELECT j.JadwalID, a.Nama AS ArmadaNama, j.JamJadwal, j.JamMulaiMuat,
             ISNULL(${JADWAL_KANTONG_10KG_EXPR}, 0) AS Qty10KGDibutuhkan,
             ISNULL(${JADWAL_KANTONG_5KG_EXPR}, 0) AS Qty5KGDibutuhkan
      FROM DashboardPengirimanJadwal j
      LEFT JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
      LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
      LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
      WHERE j.IsDeleted = 0 AND j.Status = 'Draft' AND j.JamJadwal BETWEEN @start AND @end
      GROUP BY j.JadwalID, a.Nama, j.JamJadwal, j.JamMulaiMuat
      ORDER BY j.JamJadwal DESC
    `);
  return result.recordset;
}

// "Sudah Selesai Muat" untuk periode yang sama — dikelompokkan berdasarkan
// JamJadwal kartu (jadwal keberangkatannya), BUKAN JamSelesaiMuat (kapan ia
// benar-benar diselesaikan), supaya satu kartu selalu konsisten berada di
// periode/bagian yang sama terlepas dari kapan proses Selesai Muat-nya
// terjadi -- lihat Global Constraints rencana ini.
export async function getKartuPengirimanSelesaiUntukPeriode(
  tanggalUsaha: Date,
  shift: ShiftNumber
): Promise<SelesaiMuatJadwalForProduksi[]> {
  const { start, end } = getShiftWindow(tanggalUsaha, shift, "work");
  const pool = await getPool();
  const result = await pool
    .request()
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end).query(`
      SELECT j.JadwalID, a.Nama AS ArmadaNama, j.JamJadwal, j.JamSelesaiMuat, j.Qty5KGDimuat,
             ISNULL(${JADWAL_KANTONG_10KG_EXPR}, 0) AS Qty10KG,
             ISNULL(${JADWAL_KANTONG_5KG_EXPR}, 0) AS Qty5KG
      FROM DashboardPengirimanJadwal j
      LEFT JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
      LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
      LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
      WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL AND j.JamJadwal BETWEEN @start AND @end
      GROUP BY j.JadwalID, a.Nama, j.JamJadwal, j.JamSelesaiMuat, j.Qty5KGDimuat
      ORDER BY j.JamJadwal DESC
    `);
  return result.recordset;
}
```

- [ ] **Step 4: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean. (`produksi/actions.ts` will show pre-existing errors referencing the now-deleted functions until Task 2 lands — that's expected at this point, not a regression to fix here.)

- [ ] **Step 5: Verify against the live database**

Write a one-off scratch script (e.g. `scripts/_verify-riwayat-query.ts`, deleted after use) that imports both new functions and calls them with today's `getReportShift("work")` values, printing the results — confirm it runs without error and returns a plausible row count/shape matching what the "Keberangkatan Mendekat" panel or Papan Pengiriman board shows for the same window. Delete the scratch script when done (`git status` must be clean of it before committing).

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/produksi-muatan.ts
git commit -m "feat: add period-explicit Kartu Pengiriman queries for the new Riwayat screen"
```

---

### Task 2: Server Actions — replace the 4 old actions with 2 new ones

**Files:**
- Modify: `src/app/mkesindo/produksi/actions.ts`

**Interfaces:**
- Consumes: from Task 1, `getKartuPengirimanBelumSelesaiUntukPeriode`, `getKartuPengirimanSelesaiUntukPeriode` (`@/lib/queries/produksi-muatan`). `type ShiftNumber` from `@/lib/report-shift`.
- Produces (consumed by Task 3): `getKartuPengirimanBelumSelesaiAction(tanggalUsahaISO: string, shift: ShiftNumber): Promise<ActionResult<DraftJadwalForProduksi[]>>`, `getKartuPengirimanSelesaiAction(tanggalUsahaISO: string, shift: ShiftNumber): Promise<ActionResult<SelesaiMuatJadwalForProduksi[]>>`.

- [ ] **Step 1: Update the `produksi-muatan` import block**

In `src/app/mkesindo/produksi/actions.ts`, change:

```ts
import {
  getDraftJadwalForProduksi,
  getDraftJadwalRiwayatForProduksi,
  getAllDraftJadwalForProduksi,
  getSelesaiMuatJadwalForProduksi,
  getSelesaiMuatJadwalRiwayatForProduksi,
  produksiStartMuat,
  produksiSelesaiMuat,
  produksiSelesaiMuatManual,
  type DraftJadwalForProduksi,
  type SelesaiMuatJadwalForProduksi,
  type ProduksiSelesaiMuatInput,
} from "@/lib/queries/produksi-muatan";
```

to:

```ts
import {
  getDraftJadwalForProduksi,
  getAllDraftJadwalForProduksi,
  getKartuPengirimanBelumSelesaiUntukPeriode,
  getKartuPengirimanSelesaiUntukPeriode,
  produksiStartMuat,
  produksiSelesaiMuat,
  produksiSelesaiMuatManual,
  type DraftJadwalForProduksi,
  type SelesaiMuatJadwalForProduksi,
  type ProduksiSelesaiMuatInput,
} from "@/lib/queries/produksi-muatan";
```

Add a new import line right after it:

```ts
import type { ShiftNumber } from "@/lib/report-shift";
```

- [ ] **Step 2: Delete the three superseded actions**

Delete these exported functions entirely (including their comments): `getSelesaiMuatJadwalForProduksiAction`, `getDraftJadwalRiwayatForProduksiAction`, `getSelesaiMuatJadwalRiwayatForProduksiAction`.

Do NOT delete: `getDraftJadwalForProduksiAction`, `produksiStartMuatAction`, `getJadwalDetailForProduksiAction`, `produksiSelesaiMuatAction`, `produksiSelesaiMuatManualAction`, or anything else in this file.

- [ ] **Step 3: Add the two new actions**

Add these where `getSelesaiMuatJadwalForProduksiAction` used to be (or anywhere convenient near the other read-only produksi-muatan actions):

```ts
export async function getKartuPengirimanBelumSelesaiAction(
  tanggalUsahaISO: string,
  shift: ShiftNumber
): Promise<ActionResult<DraftJadwalForProduksi[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getKartuPengirimanBelumSelesaiUntukPeriode(new Date(tanggalUsahaISO), shift);
  });
}

export async function getKartuPengirimanSelesaiAction(
  tanggalUsahaISO: string,
  shift: ShiftNumber
): Promise<ActionResult<SelesaiMuatJadwalForProduksi[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getKartuPengirimanSelesaiUntukPeriode(new Date(tanggalUsahaISO), shift);
  });
}
```

- [ ] **Step 4: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean now (Task 1's temporary pre-existing errors in this file are resolved by this task's changes).

- [ ] **Step 5: Commit**

```bash
git add src/app/mkesindo/produksi/actions.ts
git commit -m "feat: replace Pengiriman/Riwayat tab actions with period-explicit ones"
```

---

### Task 3: New full-screen Riwayat route

**Files:**
- Create: `src/app/mkesindo/produksi-app/riwayat/page.tsx`
- Create: `src/components/produksi-app/riwayat-kartu-pengiriman-view.tsx`

**Interfaces:**
- Consumes: `requireProduksi` (`@/lib/require-access`). `getReportShift` (`@/lib/report-shift`, server-side only, in `page.tsx`). From Task 1, `getKartuPengirimanBelumSelesaiUntukPeriode`/`getKartuPengirimanSelesaiUntukPeriode` (server-side only, in `page.tsx`). From Task 2, `getKartuPengirimanBelumSelesaiAction`/`getKartuPengirimanSelesaiAction` (client-side, in the view component). `getShiftLabel`, `type ShiftNumber` (`@/lib/report-shift`, safe to import as values into a client component — zero `@/lib/db` imports in its own chain, see Global Constraints). `KartuPengirimanList` (`@/components/produksi-app/kartu-pengiriman-list`, reused verbatim, zero changes to that file). `type DraftJadwalForProduksi`/`type SelesaiMuatJadwalForProduksi` (type-only, `@/lib/queries/produksi-muatan`).
- Produces (consumed by Task 5): the route `/mkesindo/produksi-app/riwayat` exists and renders correctly.

This route is OUTSIDE the `(tabs)/` route group, so it is NOT wrapped by `(tabs)/layout.tsx`'s `requireProduksi()` gate — `page.tsx` must call it itself, exactly like every satpam-app full-screen route this session (e.g. `inspeksi/[jadwalId]/page.tsx`, `patroli/foto/[sesiId]/page.tsx`).

- [ ] **Step 1: Write `src/app/mkesindo/produksi-app/riwayat/page.tsx`**

```tsx
import type { Metadata } from "next";
import { requireProduksi } from "@/lib/require-access";
import { getReportShift } from "@/lib/report-shift";
import {
  getKartuPengirimanBelumSelesaiUntukPeriode,
  getKartuPengirimanSelesaiUntukPeriode,
} from "@/lib/queries/produksi-muatan";
import { RiwayatKartuPengirimanView } from "@/components/produksi-app/riwayat-kartu-pengiriman-view";

export const metadata: Metadata = { title: "Riwayat Kartu Pengiriman" };

export default async function ProduksiAppRiwayatPage() {
  await requireProduksi();
  const { shift, businessDate } = getReportShift("work");
  const [belumSelesai, selesai] = await Promise.all([
    getKartuPengirimanBelumSelesaiUntukPeriode(businessDate, shift),
    getKartuPengirimanSelesaiUntukPeriode(businessDate, shift),
  ]);

  return (
    <RiwayatKartuPengirimanView
      initialTanggalUsahaISO={businessDate.toISOString().slice(0, 10)}
      initialShift={shift}
      initialBelumSelesai={belumSelesai}
      initialSelesai={selesai}
    />
  );
}
```

- [ ] **Step 2: Write `src/components/produksi-app/riwayat-kartu-pengiriman-view.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getShiftLabel, type ShiftNumber } from "@/lib/report-shift";
import {
  getKartuPengirimanBelumSelesaiAction,
  getKartuPengirimanSelesaiAction,
} from "@/app/mkesindo/produksi/actions";
import { KartuPengirimanList } from "@/components/produksi-app/kartu-pengiriman-list";
import type { DraftJadwalForProduksi, SelesaiMuatJadwalForProduksi } from "@/lib/queries/produksi-muatan";

const SHIFT_OPTIONS: ShiftNumber[] = [1, 2, 3];

// Layar penuh-layar baru yang menggantikan tab Pengiriman + Riwayat lama --
// dibuka lewat tombol "Riwayat" di tab Stok Es (Task 5). Filter tanggal+shift
// memuat ulang KEDUA daftar sekaligus lewat 2 action baru (Task 2);
// KartuPengirimanList (komponen lama, tidak diubah sama sekali) dipakai
// ulang lewat `key` yang berubah tiap filter berganti -- komponen itu hanya
// membaca initialJadwal/fetchSelesaiList SEKALI saat mount, jadi remount
// penuh adalah cara yang benar untuk "memberinya data baru", bukan
// mengandalkan prop-sync yang komponen itu memang tidak punya.
export function RiwayatKartuPengirimanView({
  initialTanggalUsahaISO,
  initialShift,
  initialBelumSelesai,
  initialSelesai,
}: {
  initialTanggalUsahaISO: string;
  initialShift: ShiftNumber;
  initialBelumSelesai: DraftJadwalForProduksi[];
  initialSelesai: SelesaiMuatJadwalForProduksi[];
}) {
  const router = useRouter();
  const [tanggalUsahaISO, setTanggalUsahaISO] = useState(initialTanggalUsahaISO);
  const [shift, setShift] = useState<ShiftNumber>(initialShift);
  const [belumSelesai, setBelumSelesai] = useState(initialBelumSelesai);
  const [selesai, setSelesai] = useState(initialSelesai);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refetch(tanggal: string, shiftValue: ShiftNumber) {
    setLoading(true);
    setError(null);
    Promise.all([
      getKartuPengirimanBelumSelesaiAction(tanggal, shiftValue),
      getKartuPengirimanSelesaiAction(tanggal, shiftValue),
    ]).then(([belumResult, selesaiResult]) => {
      if (!belumResult.success) {
        setError(belumResult.error);
        setLoading(false);
        return;
      }
      if (!selesaiResult.success) {
        setError(selesaiResult.error);
        setLoading(false);
        return;
      }
      setBelumSelesai(belumResult.data);
      setSelesai(selesaiResult.data);
      setLoading(false);
    });
  }

  // Data awal sudah datang dari server component (initial* props) -- effect
  // ini hanya boleh refetch saat filter BERUBAH setelah mount, bukan saat
  // mount itu sendiri (kalau tidak, permintaan pertama akan sia-sia
  // mengulang apa yang sudah difetch server).
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    refetch(tanggalUsahaISO, shift);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tanggalUsahaISO, shift]);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background px-4 py-2.5">
        <Button size="icon" variant="ghost" onClick={() => router.push("/mkesindo/produksi-app")}>
          <ArrowLeft className="size-5" />
        </Button>
        <h1 className="font-display text-base font-semibold">Riwayat Kartu Pengiriman</h1>
      </header>

      <div className="flex flex-col gap-3 border-b border-border p-4">
        <Input type="date" value={tanggalUsahaISO} onChange={(e) => setTanggalUsahaISO(e.target.value)} />
        <div className="grid grid-cols-3">
          {SHIFT_OPTIONS.map((s) => (
            <Button
              key={s}
              type="button"
              variant={shift === s ? "default" : "outline"}
              className="rounded-none"
              onClick={() => setShift(s)}
            >
              {getShiftLabel(s, "work")}
            </Button>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <p className="m-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <KartuPengirimanList
          key={`${tanggalUsahaISO}-${shift}`}
          initialJadwal={belumSelesai}
          fetchSelesaiList={async () => ({ success: true, data: selesai })}
          emptyMessage="Tidak ada Kartu Pengiriman pada periode ini."
          onAfterMuat={() => refetch(tanggalUsahaISO, shift)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 4: Run a real production build**

```bash
npm run build
```
Expected: exit code 0, `/mkesindo/produksi-app/riwayat` appears in the route table, no "Module not found"/"Build error" output. This is REQUIRED, not optional — `riwayat-kartu-pengiriman-view.tsx` is a new `"use client"` file; confirm it does not pull `mssql`/`@/lib/db` into the browser bundle (it shouldn't, since every value it imports — `getShiftLabel`, the two new Server Actions, `KartuPengirimanList` — is either a pure client-safe function, a Server Action stub, or an already-client component; every `produksi-muatan` import is `type`-only). If the build fails, read the actual error and find which import is at fault before changing anything.

- [ ] **Step 5: Manual browser verification**

Navigate directly to `/mkesindo/produksi-app/riwayat` (the button that links here doesn't exist until Task 5, so reach it by URL for now), logged in as a `requireProduksi`-authorized account. Confirm:
1. The page loads showing today's business-date + current shift's Kartu Pengiriman, split into "Belum Selesai" and "Sudah Selesai Muat".
2. Changing the date input or tapping a different shift button reloads both sections for the new period (loading spinner shows briefly).
3. Tapping "Selesai Muat" on a Belum-Selesai card, confirming Ya, moves it into "Sudah Selesai Muat" for the same filter.

If no `requireProduksi`-authorized test credentials are available in this environment, fall back to a careful, itemized code-review trace against this same 3-item checklist instead of skipping this step silently.

- [ ] **Step 6: Commit**

```bash
git add src/app/mkesindo/produksi-app/riwayat/page.tsx src/components/produksi-app/riwayat-kartu-pengiriman-view.tsx
git commit -m "feat: add the full-screen Riwayat Kartu Pengiriman screen"
```

---

### Task 4: Remove the Pengiriman/Riwayat tabs and repoint Stok Es to root

**Files:**
- Modify: `src/app/mkesindo/produksi-app/(tabs)/page.tsx` (content fully replaced)
- Delete: `src/app/mkesindo/produksi-app/(tabs)/warehouse/page.tsx` (and the now-empty `warehouse/` directory)
- Delete: `src/app/mkesindo/produksi-app/(tabs)/riwayat/page.tsx` (and the now-empty `riwayat/` directory — this is DIFFERENT from Task 3's new `src/app/mkesindo/produksi-app/riwayat/page.tsx`, which is outside `(tabs)/` and must NOT be touched by this task)
- Modify: `src/components/produksi-app/produksi-tab-shell.tsx`
- Modify: `src/components/produksi-app/bottom-nav.tsx`

**Interfaces:**
- Produces: `ProduksiTabKey = "warehouse" | "kualitas" | "bahan-baku" | "aktivitas-produksi"` (was 6 keys, now 4). `TAB_PATHS.warehouse === "/mkesindo/produksi-app"` (was `/mkesindo/produksi-app/warehouse`).

This task's file changes are tightly coupled — the route restructuring and the tab-shell/bottom-nav trimming must land together in one commit, otherwise the app briefly has a 404'ing default route or dead tab keys.

- [ ] **Step 1: Replace `src/app/mkesindo/produksi-app/(tabs)/page.tsx`'s content**

Replace the ENTIRE current content of this file (the old Pengiriman tab) with what `(tabs)/warehouse/page.tsx` currently contains, keeping `initialTab="warehouse"` exactly as that file already has it (only the FILE location changes, not the literal string):

```tsx
import type { Metadata } from "next";
import { requireProduksi } from "@/lib/require-access";
import { getWarehouseMap } from "@/lib/queries/produksi-warehouse";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getUserById } from "@/lib/queries/akun";
import { getTakeAwayMuatanPending } from "@/lib/queries/takeaway-muatan";
import { getDraftJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export const metadata: Metadata = { title: "Stok Es" };

export default async function ProduksiAppWarehousePage() {
  const session = await requireProduksi();
  const [posisi, mesinList, profile, takeAwayPending, jadwal] = await Promise.all([
    getWarehouseMap(),
    getMesinList(),
    getUserById(Number(session.user.id)),
    getTakeAwayMuatanPending(),
    getDraftJadwalForProduksi(),
  ]);

  return (
    <ProduksiTabShell
      initialTab="warehouse"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialWarehouse={posisi}
      initialMesin={mesinList}
      initialTakeAwayPending={takeAwayPending}
      initialWarehouseJadwal={jadwal}
    />
  );
}
```

- [ ] **Step 2: Delete the old route directories**

```bash
git rm src/app/mkesindo/produksi-app/\(tabs\)/warehouse/page.tsx
git rm src/app/mkesindo/produksi-app/\(tabs\)/riwayat/page.tsx
```
(Empty directories left behind are harmless and git-untracked; no further action needed.)

- [ ] **Step 3: Trim `src/components/produksi-app/produksi-tab-shell.tsx`**

Change the `ProduksiTabKey` type and `TAB_PATHS` map from:

```ts
export type ProduksiTabKey = "kartu-pengiriman" | "riwayat" | "warehouse" | "kualitas" | "bahan-baku" | "aktivitas-produksi";

const TAB_PATHS: Record<ProduksiTabKey, string> = {
  "kartu-pengiriman": "/mkesindo/produksi-app",
  riwayat: "/mkesindo/produksi-app/riwayat",
  warehouse: "/mkesindo/produksi-app/warehouse",
  kualitas: "/mkesindo/produksi-app/kualitas",
  "bahan-baku": "/mkesindo/produksi-app/bahan-baku",
  "aktivitas-produksi": "/mkesindo/produksi-app/aktivitas-produksi",
};
```

to:

```ts
export type ProduksiTabKey = "warehouse" | "kualitas" | "bahan-baku" | "aktivitas-produksi";

const TAB_PATHS: Record<ProduksiTabKey, string> = {
  warehouse: "/mkesindo/produksi-app",
  kualitas: "/mkesindo/produksi-app/kualitas",
  "bahan-baku": "/mkesindo/produksi-app/bahan-baku",
  "aktivitas-produksi": "/mkesindo/produksi-app/aktivitas-produksi",
};
```

Remove the `KartuPengirimanList` import (no longer used anywhere in this file — the "warehouse" tab never used it, only the two deleted tabs did).

Remove `initialKartuPengiriman`/`initialRiwayat` from BOTH places they appear in the function signature: the destructured parameter list (`{ initialTab, userName, profile, initialKartuPengiriman, initialRiwayat, initialWarehouse, ... }`) AND the inline props type object (`{ initialTab: ProduksiTabKey; ...; initialKartuPengiriman?: DraftJadwalForProduksi[]; initialRiwayat?: DraftJadwalForProduksi[]; ... }`). Remove the corresponding `kartuPengiriman`/`riwayat` state declarations (`useState<DraftJadwalForProduksi[] | null>`) entirely.

Remove the `refreshKartuPengiriman` function entirely.

In the `useEffect`'s `load()` function, remove the two `if (activeTab === "kartu-pengiriman" ...)` and `if (activeTab === "riwayat" ...)` blocks entirely. The `"kartu-pengiriman"` block calls `getDraftJadwalForProduksiAction()`; the `"riwayat"` block calls `getDraftJadwalRiwayatForProduksiAction()`. From the top-of-file import block, remove `getDraftJadwalRiwayatForProduksiAction`, `getSelesaiMuatJadwalForProduksiAction`, and `getSelesaiMuatJadwalRiwayatForProduksiAction` (all three no longer exist as exports after Task 2, and were only ever used by the two now-deleted render blocks as `fetchSelesaiList` props). **Do NOT remove `getDraftJadwalForProduksiAction`** — it is called a SECOND time later in this same effect, inside the `"warehouse"` block, to populate `warehouseJadwal` (used by "Keberangkatan Mendekat" and the dermaga slots), and that call site is NOT being removed by this task. Remove `kartuPengiriman`/`riwayat` from the effect's dependency array.

In the render section, remove both render blocks entirely:
```tsx
{visited.has("kartu-pengiriman") && kartuPengiriman && ( ... )}
{visited.has("riwayat") && riwayat && ( ... )}
```

In the remaining `warehouse` render block, change:
```tsx
onAfterMuat={() => {
  refreshWarehouse();
  refreshKartuPengiriman();
}}
```
to:
```tsx
onAfterMuat={refreshWarehouse}
```

- [ ] **Step 4: Trim `src/components/produksi-app/bottom-nav.tsx`**

Change the `TABS` array from:

```ts
const TABS: { key: ProduksiTabKey; label: string; icon: typeof ClipboardList }[] = [
  { key: "kartu-pengiriman", label: "Pengiriman", icon: ClipboardList },
  { key: "riwayat", label: "Riwayat", icon: History },
  { key: "warehouse", label: "Stok Es", icon: Snowflake },
  { key: "kualitas", label: "Kualitas", icon: ShieldCheck },
  { key: "bahan-baku", label: "Bahan Baku", icon: Package },
  { key: "aktivitas-produksi", label: "Aktivitas", icon: Users },
];
```

to:

```ts
const TABS: { key: ProduksiTabKey; label: string; icon: typeof Snowflake }[] = [
  { key: "warehouse", label: "Stok Es", icon: Snowflake },
  { key: "kualitas", label: "Kualitas", icon: ShieldCheck },
  { key: "bahan-baku", label: "Bahan Baku", icon: Package },
  { key: "aktivitas-produksi", label: "Aktivitas", icon: Users },
];
```

Update the top-of-file icon import to drop the now-unused `ClipboardList`/`History`:
```ts
import { Snowflake, ShieldCheck, Package, Users } from "lucide-react";
```

- [ ] **Step 5: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 6: Run a real production build**

```bash
npm run build
```
Expected: exit code 0. `/mkesindo/produksi-app` (root) should now build the Stok Es page; `/mkesindo/produksi-app/warehouse` and `/mkesindo/produksi-app/riwayat` (the OLD in-tabs one) should no longer appear in the route table, while `/mkesindo/produksi-app/riwayat` (Task 3's new one, outside `(tabs)/`) should still be present.

- [ ] **Step 7: Manual browser verification**

Navigate to `/mkesindo/produksi-app`, logged in as a `requireProduksi`-authorized account. Confirm:
1. It loads the Stok Es warehouse map directly (no Pengiriman tab shown first).
2. The bottom nav shows exactly 4 tabs: Stok Es, Kualitas, Bahan Baku, Aktivitas.
3. Switching between the 4 tabs still works (keep-alive behavior unaffected).
4. Navigating directly to `/mkesindo/produksi-app/warehouse` or `/mkesindo/produksi-app/riwayat` (the old in-tabs path) now 404s.

If no `requireProduksi`-authorized test credentials are available, fall back to a careful, itemized code-review trace against this same 4-item checklist.

- [ ] **Step 8: Commit**

```bash
git add "src/app/mkesindo/produksi-app/(tabs)" src/components/produksi-app/produksi-tab-shell.tsx src/components/produksi-app/bottom-nav.tsx
git commit -m "feat: remove the Pengiriman/Riwayat tabs, make Stok Es the produksi-app home"
```

---

### Task 5: "Riwayat" button on the Stok Es tab

**Files:**
- Modify: `src/components/produksi-app/warehouse-view.tsx`

**Interfaces:**
- Consumes: Task 3's route, `/mkesindo/produksi-app/riwayat` (real navigation, `router.push`).
- Produces: nothing further downstream — this is the final task.

- [ ] **Step 1: Add the "Riwayat" button to `KartuPengirimanMendekatPanel`**

At the top of `src/components/produksi-app/warehouse-view.tsx`, add the `useRouter` import (not currently imported in this file) and the `History` icon:

```tsx
import { useRouter } from "next/navigation";
```
(add this as its own import line, near the top with the other imports)

Change:
```tsx
import { Truck } from "lucide-react";
```
to:
```tsx
import { History, Truck } from "lucide-react";
```

Change the `KartuPengirimanMendekatPanel` function from:

```tsx
function KartuPengirimanMendekatPanel({ jadwal, now }: { jadwal: DraftJadwalForProduksi[]; now: Date }) {
  return (
    <div className="flex w-full shrink-0 flex-col gap-2 rounded-lg border border-border p-3 lg:w-72">
      <p className="text-sm font-medium">Keberangkatan Mendekat</p>
```

to:

```tsx
function KartuPengirimanMendekatPanel({ jadwal, now }: { jadwal: DraftJadwalForProduksi[]; now: Date }) {
  const router = useRouter();
  return (
    <div className="flex w-full shrink-0 flex-col gap-2 rounded-lg border border-border p-3 lg:w-72">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Keberangkatan Mendekat</p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => router.push("/mkesindo/produksi-app/riwayat")}
        >
          <History className="size-3.5" /> Riwayat
        </Button>
      </div>
```

(The `Button` component is already imported in this file — no new import needed for it. Leave the rest of the function's JSX exactly as-is, closing the new `</div>` where the old `<p>`'s position used to be — the `{jadwal.length === 0 ? (...) : (...)}` block and everything after it stays unchanged, just now a sibling of the new title-row `<div>` instead of the bare `<p>`.)

- [ ] **Step 2: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 3: Run a real production build**

```bash
npm run build
```
Expected: exit code 0, no new errors.

- [ ] **Step 4: Manual browser verification**

Navigate to `/mkesindo/produksi-app` (Stok Es), logged in as a `requireProduksi`-authorized account. Confirm:
1. A "Riwayat" button with a history icon appears next to "Keberangkatan Mendekat".
2. Tapping it navigates to `/mkesindo/produksi-app/riwayat` and shows the screen built in Task 3.

If no `requireProduksi`-authorized test credentials are available, fall back to a code-review trace confirming the `onClick` handler and route string are correct.

- [ ] **Step 5: Commit**

```bash
git add src/components/produksi-app/warehouse-view.tsx
git commit -m "feat: add a Riwayat button to the Stok Es Keberangkatan Mendekat panel"
```
