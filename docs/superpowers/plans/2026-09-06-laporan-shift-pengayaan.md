# Laporan Shift — Pengayaan Kartu Pengiriman & Kas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the already-shipped "Laporan Shift" tab's Kartu Pengiriman and Kas sections: richer route titles, a denser card layout, in-report cash-payment settlement (reusing the existing generic Pelunasan dialog), real cash-expense CRUD (manual + BBM), and a cross-shift per-driver recap.

**Architecture:** Three independent new/extended query pieces (Kartu Pengiriman enrichment, BBM edit/delete, Rekap-per-Driver) feed into the existing `getLaporanShiftDetail` composer; a pre-existing generic payment dialog (`PelunasanDialog`) is reused as-is (after fixing a real, already-identified authorization bug it shares with the just-fixed Laporan Shift action) rather than building new payment UI; the manual-kas UI pattern is adapted from the existing `LaporanKasKecil` component.

**Tech Stack:** Next.js App Router, MSSQL (`mssql`), TypeScript, Tailwind/shadcn UI components.

**Spec:** docs/superpowers/specs/2026-09-06-laporan-shift-pengayaan-design.md

## Global Constraints

- No worktree — this session's standing convention is to execute directly on `main`.
- Reuse existing components/actions wherever a proven one already exists (`PelunasanDialog`, `tambahPengeluaranAction`/`hapusPengeluaranAction`) — do not rebuild what already works.
- Every new/modified server action is gated `requireModuleAccess("laporan")` (matching every existing action in that file), except the `aging/actions.ts` fix, which keeps that file's own existing `auth()`-based gate (do not change its gating style, only its `perusahaanId` resolution).
- No automated test suite. Verification is `npx tsc --noEmit` + `npx eslint <files>` + live-DB scratch scripts (read-only checks via `BEGIN TRAN...ROLLBACK` or direct SELECT; capture-baseline/modify/verify/revert for anything that writes) — this codebase's established convention.
- Every write to a real financial document (a payment via `PelunasanDialog`, a BBM correction) verified live MUST be reverted to its exact prior state after verification — never leave test-created payments/corrections in the production database.
- "Wilayah"/"Kecamatan" for a stop are NOT dedicated columns — they are `BusinessPartner.NPWPName`/`BusinessPartner.NPWPAddress` (repurposed fields, confirmed live in `estimateTravelMinutesForJadwal`, `pengiriman-jadwal.ts:722-724`). Do not guess a different column.

---

### Task 1: Kartu Pengiriman query enrichment — jam keberangkatan, lokasi terjauh, businessPartnerId

**Files:**
- Modify: `src/lib/queries/laporan-shift-pengiriman.ts`

**Interfaces:**
- Consumes: `haversineKm` (`@/lib/route-estimate`, already exported); `getPabrikLocation` (`@/lib/queries/pabrik-location`, already exported, returns `{ latitude: number; longitude: number; alamat: string | null }`).
- Produces: `KartuPengirimanRow` gains `jamAktualBerangkat: string | null` (ISO) and `lokasiTerjauh: { wilayah: string; kecamatan: string | null } | null`; `KartuPengirimanStopRow` gains `businessPartnerId: string`. Consumed by Task 5 (composer, passthrough only) and Task 6 (UI).

- [ ] **Step 1: Add `JamAktualBerangkat` to the Jadwal-level query and interface**

In `src/lib/queries/laporan-shift-pengiriman.ts`, the step-1 query (currently `SELECT j.JadwalID, sm.Name AS DriverName, a.Nama AS ArmadaNama, j.JamSelesaiMuat ...`) becomes:

```ts
const jadwalResult = await pool
  .request()
  .input("start", sql.DateTime, window.start)
  .input("end", sql.DateTime, window.end).query(`
    SELECT j.JadwalID, sm.Name AS DriverName, a.Nama AS ArmadaNama, j.JamSelesaiMuat, j.JamAktualBerangkat,
           ISNULL(ed.VehicleNo, a.Nama) AS VehicleNo
    FROM DashboardPengirimanJadwal j
    LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
    LEFT JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID AND a.IsDeleted = 0
    LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
    WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL AND j.JamSelesaiMuat BETWEEN @start AND @end
    ORDER BY j.JamSelesaiMuat
  `);
const jadwalRows = jadwalResult.recordset as {
  JadwalID: number; DriverName: string | null; ArmadaNama: string | null; JamSelesaiMuat: Date; JamAktualBerangkat: Date | null; VehicleNo: string | null;
}[];
```

The `ISNULL(ed.VehicleNo, a.Nama)` fallback mirrors the exact `VehicleMap` resolution convention already established in `getPengirimanBoard` (`pengiriman-jadwal.ts` — `DashboardArmada.ExpeditionDetailID` links to `ExpeditionDetail.VehicleNo`, the real plate, falling back to the armada's own nickname `Nama` when not yet linked — see `[[armada-expeditiondetail-linkage]]`) — verify this exact JOIN shape against `getPengirimanBoard`'s real current code before trusting it verbatim, since column names on `ExpeditionDetail` should be double-checked live.

Update both `return`/early-return sites (the `stopRows.length === 0` early return and the final `return jadwalRows.map(...)`) to include `jamAktualBerangkat: j.JamAktualBerangkat ? j.JamAktualBerangkat.toISOString() : null` and `vehicleNo: j.VehicleNo`.

Update `KartuPengirimanRow`:

```ts
export interface KartuPengirimanRow {
  jadwalId: number;
  driverName: string | null;
  armadaNama: string | null;
  vehicleNo: string | null; // real plate when linked to ExpeditionDetail, else armada's own nickname
  jamSelesaiMuat: string; // ISO
  jamAktualBerangkat: string | null; // ISO, null if not yet departed
  lokasiTerjauh: { wilayah: string; kecamatan: string | null } | null;
  stops: KartuPengirimanStopRow[];
}
```

- [ ] **Step 2: Add `BusinessPartnerID` to the stops-level query and interface**

The step-2 query already joins `BusinessPartner bp` — add `bp.BusinessPartnerID` to the SELECT list and the `stopResult.recordset` type cast. Update `KartuPengirimanStopRow`:

```ts
export interface KartuPengirimanStopRow {
  jadwalDetailId: number;
  customerName: string;
  businessPartnerId: string;
  items: KartuPengirimanItemRow[];
  statusBayar: StatusBayar;
  nominalBayar: number | null;
  retur: KartuPengirimanReturRow[];
}
```

Include `businessPartnerId: s.BusinessPartnerID` in the assembled stop object (step 6 of the function).

- [ ] **Step 3: Add the farthest-destination lookup**

Append a new private function to the same file, mirroring `estimateTravelMinutesForJadwal`'s farthest-location logic (`pengiriman-jadwal.ts:704-763`) but WITHOUT its travel-time computation:

```ts
import { haversineKm, type LatLng } from "@/lib/route-estimate";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";

// Farthest-from-pabrik destination per Jadwal, for the route title format
// "[JamAktualBerangkat] - Wilayah, Kecamatan". Mirrors the farthest-location
// half of estimateTravelMinutesForJadwal (pengiriman-jadwal.ts, private,
// not reusable directly since it also computes travel-time and needs a
// differently-shaped caller) -- deliberately NOT importing that function,
// this is a fresh, lighter query scoped to this shift's own small JadwalID
// list. "Wilayah"/"Kecamatan" are NOT dedicated columns -- they read
// BusinessPartner.NPWPName/NPWPAddress (repurposed fields), same as the
// function this mirrors.
async function getLokasiTerjauhPerJadwal(
  pool: sql.ConnectionPool,
  jadwalIds: number[]
): Promise<Map<number, { wilayah: string; kecamatan: string | null }>> {
  const result = new Map<number, { wilayah: string; kecamatan: string | null }>();
  if (jadwalIds.length === 0) return result;

  const pabrik = await getPabrikLocation();
  const pabrikLatLng: LatLng = { lat: pabrik.latitude, lng: pabrik.longitude };

  const request = pool.request();
  const placeholders = jadwalIds.map((id, i) => {
    request.input(`jid${i}`, sql.Int, id);
    return `@jid${i}`;
  });
  const stopsResult = await request.query(`
    SELECT jd.JadwalID, ml.Latitude, ml.Longitude,
           ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
           bp.NPWPAddress AS Kecamatan
    FROM DashboardPengirimanJadwalDetail jd
    JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
    JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    LEFT JOIN DashboardMitraLocation ml ON ml.BusinessPartnerID = so.BusinessPartnerID
    WHERE jd.JadwalID IN (${placeholders.join(",")}) AND jd.IsDeleted = 0
  `);
  type StopRow = { JadwalID: number; Latitude: number | null; Longitude: number | null; Wilayah: string; Kecamatan: string | null };
  const byJadwal = new Map<number, (StopRow & { Latitude: number; Longitude: number })[]>();
  for (const row of stopsResult.recordset as StopRow[]) {
    if (row.Latitude == null || row.Longitude == null) continue;
    const list = byJadwal.get(row.JadwalID) ?? [];
    list.push(row as StopRow & { Latitude: number; Longitude: number });
    byJadwal.set(row.JadwalID, list);
  }

  for (const [jadwalId, stops] of byJadwal) {
    let farthest: { wilayah: string; kecamatan: string | null } | null = null;
    let farthestKm = -1;
    for (const stop of stops) {
      const km = haversineKm(pabrikLatLng, { lat: stop.Latitude, lng: stop.Longitude });
      if (km > farthestKm) {
        farthestKm = km;
        farthest = { wilayah: stop.Wilayah, kecamatan: stop.Kecamatan };
      }
    }
    if (farthest) result.set(jadwalId, farthest);
  }
  return result;
}
```

Call it in `getKartuPengirimanUntukShift` right after `jadwalIds` is computed (step 1), in parallel with step 2's stop query via `Promise.all`:

```ts
const [stopResult, lokasiTerjauhMap] = await Promise.all([stopRequest.query(`...`), getLokasiTerjauhPerJadwal(pool, jadwalIds)]);
```

(Adjust the surrounding code minimally to fit this — `stopRequest`'s inputs must still be bound before the `Promise.all`, exactly as they already are.) Use `lokasiTerjauhMap.get(j.JadwalID) ?? null` when assembling both the early-return and final-return `KartuPengirimanRow` objects.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/queries/laporan-shift-pengiriman.ts`
Expected: clean.

Live-DB check (read-only): call `getKartuPengirimanUntukShift` for a real `(tanggalUsaha, shift, perusahaanId)` known to have data (reuse a case from the original Laporan Shift plan's own testing, e.g. `2026-09-06` shift 3 or `2026-08-21`), confirm `jamAktualBerangkat` matches `DashboardPengirimanJadwal.JamAktualBerangkat` queried directly for the same JadwalID, confirm `lokasiTerjauh` matches what the existing Papan Pengiriman board shows for the same Jadwal (cross-check via `getPengirimanBoard`'s own `LokasiTerjauh` field for that JadwalID, or a direct query using the same SQL shape), and confirm `businessPartnerId` matches `SalesOrder.BusinessPartnerID` for that stop's SalesOrderID.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/laporan-shift-pengiriman.ts
git commit -m "feat: add jam keberangkatan, lokasi terjauh, businessPartnerId to Kartu Pengiriman"
```

---

### Task 2: BBM edit/delete query functions

**Files:**
- Modify: `src/lib/queries/driver-fuel.ts`

**Interfaces:**
- Produces: `BbmShiftRow` gains `bbmId: number`; new `updateBbmManual(bbmId: number, liter: number, nominalAsli: number, nominalEkstra: number, akunId: number): Promise<void>`; new `hapusBbmEntry(bbmId: number): Promise<void>` (no `akunId` — delete has no column to stamp it into, see Step 2). Consumed by Task 4 (server actions).

- [ ] **Step 1: Add `bbmId` to `BbmShiftRow` and its query**

```ts
export interface BbmShiftRow {
  bbmId: number;
  salesmanId: string;
  driverName: string | null;
  liter: number;
  nominalAsli: number;
  nominalEkstra: number;
  waktuIsi: string; // ISO
}
```

In `getBbmUntukShift`'s query, add `b.BBMID` to the SELECT and `bbmId: r.BBMID` to the mapped object (and the recordset type cast).

- [ ] **Step 2: Add staff-facing correction functions**

Append to `src/lib/queries/driver-fuel.ts`:

```ts
// Staff correction from Laporan Shift -- unlike updateFuelLog (the driver's
// own "Simpan" in the Isi BBM screen), this has NO SalesmanID ownership
// check: a dispatcher/staff correcting a shift's records is allowed to fix
// ANY driver's entry, not just their own. akunId is recorded for audit
// purposes matching this codebase's ModifiedDate convention, even though
// this table has no explicit "last modified by" column to write into
// beyond what's already there -- confirm at implementation time whether a
// ModifiedByAkunID-style column exists on DashboardPengirimanBBM (if the
// live schema has no such column, akunId is accepted for interface
// symmetry with the rest of this codebase's write functions but simply
// unused in the query body -- verify and document whichever is true).
export async function updateBbmManual(bbmId: number, liter: number, nominalAsli: number, nominalEkstra: number, akunId: number): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("bbmId", sql.Int, bbmId)
    .input("liter", sql.Decimal(10, 2), liter)
    .input("nominalAsli", sql.Decimal(18, 2), nominalAsli)
    .input("nominalEkstra", sql.Decimal(18, 2), nominalEkstra).query(`
      UPDATE DashboardPengirimanBBM
      SET Liter = @liter, NominalAsli = @nominalAsli, NominalEkstra = @nominalEkstra
      WHERE BBMID = @bbmId
    `);
  if (result.rowsAffected[0] === 0) throw new AppError("Catatan BBM tidak ditemukan.");
}

// Hard delete -- confirmed via grep that no other table/column references
// BBMID anywhere in src/lib/queries, same reasoning already established for
// hapusPengeluaran in kas-kecil.ts.
export async function hapusBbmEntry(bbmId: number): Promise<void> {
  const pool = await getPool();
  const result = await pool.request().input("bbmId", sql.Int, bbmId).query(`DELETE FROM DashboardPengirimanBBM WHERE BBMID = @bbmId`);
  if (result.rowsAffected[0] === 0) throw new AppError("Catatan BBM tidak ditemukan.");
}
```

(`akunId` param on `hapusBbmEntry` was dropped since delete has no columns to stamp it into — keep the signature exactly as shown above, two params only, not three; the note in `updateBbmManual`'s comment about verifying a ModifiedByAkunID-style column applies to that function only.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/queries/driver-fuel.ts`
Expected: clean.

Live-DB check: capture-baseline/modify/verify/revert on a REAL existing BBM row (do not create a new one) — read a real row's current `Liter`/`NominalAsli`/`NominalEkstra` via direct SELECT, call `updateBbmManual` with different values, confirm the change via `getBbmUntukShift`, then call `updateBbmManual` again to restore the exact original values, and confirm restoration via a final direct SELECT. Do NOT test `hapusBbmEntry` against a real row (deletion isn't reversible) — instead confirm its SQL is syntactically correct via a `BEGIN TRAN` + the delete + verify affected-row count + `ROLLBACK` (never `COMMIT`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/driver-fuel.ts
git commit -m "feat: add staff-facing BBM correction (update/delete) functions"
```

---

### Task 3: Rekap Total per Driver query (whole day, cross-shift)

**Files:**
- Modify: `src/lib/queries/laporan-shift-pengiriman.ts`

**Interfaces:**
- Produces: `RekapDriverRow { salesmanId: string; driverName: string | null; totalKirim: number; totalReturn: number; netto: number }`, `getRekapPerDriverUntukHari(tanggalUsaha: string): Promise<RekapDriverRow[]>`. Consumed by Task 5 (composer) and Task 8 (UI).

- [ ] **Step 1: Write the aggregation query**

This spans all 3 shifts of one Tanggal Usaha (not the shift-window-filtered pattern every other function in this plan uses) — filter directly on the calendar date implied by `getShiftWindow`'s own boundary math: Shift 2 and Shift 3 fall on the calendar day BEFORE `tanggalUsaha`, Shift 1 falls on `tanggalUsaha` itself (see `report-shift.ts`'s own documented chronological order, already relied on by `getPreviousShift`). The combined window for one whole Tanggal Usaha is therefore `[Shift 2's start, Shift 1's end]` — compute this via `getShiftWindow(businessDate, 2, "work").start` through `getShiftWindow(businessDate, 1, "work").end`.

Append to `src/lib/queries/laporan-shift-pengiriman.ts`:

```ts
export interface RekapDriverRow {
  salesmanId: string;
  driverName: string | null;
  totalKirim: number;
  totalReturn: number;
  netto: number;
}

// Kirim/Return/Netto per driver across ALL THREE shifts of one Tanggal
// Usaha -- deliberately whole-day, unlike every other function in this
// plan which is scoped to one shift's own window. Kirim = SUM(Qty) ordered
// (SalesOrderDetail), Return = SUM(QtyRetur) (StopDeliveryItem), Netto =
// Kirim - Return, all in raw item qty (not kantong-ekivalen -- this report
// mixes 10kg/5kg items per Jadwal and this recap doesn't need the
// kantong-ekivalen conversion the rest of this app's production reports
// use, since it's a delivery/return headcount per driver, not a
// production-capacity figure).
export async function getRekapPerDriverUntukHari(tanggalUsaha: string): Promise<RekapDriverRow[]> {
  const pool = await getPool();
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const start = getShiftWindow(businessDate, 2, "work").start;
  const end = getShiftWindow(businessDate, 1, "work").end;

  const result = await pool
    .request()
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end).query(`
      WITH JadwalHariIni AS (
        SELECT j.JadwalID, j.SalesmanID, sm.Name AS DriverName
        FROM DashboardPengirimanJadwal j
        LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
        WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL AND j.JamSelesaiMuat BETWEEN @start AND @end
      ),
      KirimPerJadwal AS (
        SELECT jh.JadwalID, SUM(sod.Qty) AS TotalKirim
        FROM JadwalHariIni jh
        JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = jh.JadwalID AND jd.IsDeleted = 0
        JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
        GROUP BY jh.JadwalID
      ),
      ReturPerJadwal AS (
        SELECT jh.JadwalID, SUM(sdi.QtyRetur) AS TotalReturn
        FROM JadwalHariIni jh
        JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = jh.JadwalID AND jd.IsDeleted = 0
        JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = jd.JadwalDetailID
        JOIN DashboardPengirimanStopDeliveryItem sdi ON sdi.StopDeliveryID = sd.StopDeliveryID
        GROUP BY jh.JadwalID
      )
      SELECT jh.SalesmanID, jh.DriverName,
             SUM(ISNULL(k.TotalKirim, 0)) AS TotalKirim,
             SUM(ISNULL(r.TotalReturn, 0)) AS TotalReturn
      FROM JadwalHariIni jh
      LEFT JOIN KirimPerJadwal k ON k.JadwalID = jh.JadwalID
      LEFT JOIN ReturPerJadwal r ON r.JadwalID = jh.JadwalID
      WHERE jh.SalesmanID IS NOT NULL
      GROUP BY jh.SalesmanID, jh.DriverName
      ORDER BY jh.DriverName
    `);
  return (result.recordset as { SalesmanID: string; DriverName: string | null; TotalKirim: number; TotalReturn: number }[]).map((r) => ({
    salesmanId: r.SalesmanID,
    driverName: r.DriverName,
    totalKirim: r.TotalKirim,
    totalReturn: r.TotalReturn,
    netto: r.TotalKirim - r.TotalReturn,
  }));
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/queries/laporan-shift-pengiriman.ts`
Expected: clean.

Live-DB check (read-only): call `getRekapPerDriverUntukHari` for a real recent `tanggalUsaha` with multiple Jadwal across at least 2 different shifts, cross-check one driver's `totalKirim`/`totalReturn` against a direct `SUM(...)` query over the same JadwalIDs (found via a direct `SELECT JadwalID FROM DashboardPengirimanJadwal WHERE SalesmanID = @id AND JamSelesaiMuat BETWEEN @start AND @end`), confirm no driver appears twice (the `GROUP BY` should collapse correctly) and no driver with zero Jadwal that day appears at all.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/laporan-shift-pengiriman.ts
git commit -m "feat: add cross-shift Rekap per Driver query"
```

---

### Task 4: Fix aging/actions.ts's perusahaanId bug + add BBM server actions

**Files:**
- Modify: `src/app/mkesindo/(dashboard)/aging/actions.ts`
- Modify: `src/app/mkesindo/(dashboard)/laporan/actions.ts`

**Interfaces:**
- Consumes: `getMkesindoPerusahaanId` (`@/lib/queries/perusahaan`, already exists); `updateBbmManual`/`hapusBbmEntry` (Task 2).
- Produces: `recordPaymentAction` (fixed in place, same name/signature); `updateBbmManualAction(bbmId: number, liter: number, nominalAsli: number, nominalEkstra: number): Promise<ActionResult<void>>`, `hapusBbmEntryAction(bbmId: number): Promise<ActionResult<void>>` in `laporan/actions.ts`. Consumed by Task 7 (UI).

- [ ] **Step 1: Fix `recordPaymentAction`'s `perusahaanId` resolution**

In `src/app/mkesindo/(dashboard)/aging/actions.ts`, replace:

```ts
if (!session.user.perusahaanId) throw new AppError("Akun ini belum ditautkan ke perusahaan, hubungi Admin.");

const result = await recordPayment({ ...input, konteks: "kasir", perusahaanId: session.user.perusahaanId });
```

with:

```ts
const perusahaanId = await getMkesindoPerusahaanId();
const result = await recordPayment({ ...input, konteks: "kasir", perusahaanId });
```

Add the import: `import { getMkesindoPerusahaanId } from "@/lib/queries/perusahaan";`. This mirrors the exact fix already applied and reviewed clean in `getLaporanShiftDetailAction` (`laporan/actions.ts`) for the identical defect — `/mkesindo/aging`, like `/mkesindo/laporan`, is unconditionally reachable only by `mkesindo`-scoped, `direktur`-scoped, or superadmin sessions (confirmed via `middleware.ts`'s per-scope confinement: any other `accountScope` gets redirected to its own home before ever reaching `/mkesindo/*`), so this is behavior-preserving for real MKEsindo staff and fixes the same Direktur/superadmin rejection Task 8 of the original Laporan Shift plan already fixed elsewhere.

- [ ] **Step 2: Add the BBM correction server actions**

Append to `src/app/mkesindo/(dashboard)/laporan/actions.ts`:

```ts
import { updateBbmManual, hapusBbmEntry } from "@/lib/queries/driver-fuel";

export async function updateBbmManualAction(
  bbmId: number,
  liter: number,
  nominalAsli: number,
  nominalEkstra: number
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireModuleAccess("laporan");
    assertCanEditLaporan(session.user);
    if (liter < 0 || nominalAsli < 0 || nominalEkstra < 0) throw new AppError("Nilai tidak boleh negatif.");
    await updateBbmManual(bbmId, liter, nominalAsli, nominalEkstra, Number(session.user.id));
    revalidatePath("/mkesindo/laporan");
  });
}

export async function hapusBbmEntryAction(bbmId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireModuleAccess("laporan");
    assertCanEditLaporan(session.user);
    await hapusBbmEntry(bbmId);
    revalidatePath("/mkesindo/laporan");
  });
}
```

(`assertCanEditLaporan` is the private helper already defined at the top of this file, used by every other write action in it — reuse it, do not duplicate its logic.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` and `npx eslint "src/app/mkesindo/(dashboard)/aging/actions.ts" "src/app/mkesindo/(dashboard)/laporan/actions.ts"`
Expected: clean.

Live-DB check for the `recordPaymentAction` fix: confirm `getMkesindoPerusahaanId()` returns the same value a real MKEsindo staff session's `session.user.perusahaanId` already carries (reuse the exact verification technique from the original Laporan Shift plan's own final-review fix), so the fix is a no-op for the already-working path. A live end-to-end click-through of `PelunasanDialog` itself is Task 6/7's responsibility (it doesn't exist as a UI trigger point until then) — this task only needs to confirm the action compiles and the perusahaanId resolution is correct in isolation.

For the two new BBM actions: no live-DB test needed beyond `tsc`/`eslint` (they're thin wrappers around Task 2's already-verified functions) — but do confirm `assertCanEditLaporan`'s real signature matches how it's called here (read the current file to confirm).

- [ ] **Step 4: Commit**

```bash
git add "src/app/mkesindo/(dashboard)/aging/actions.ts" "src/app/mkesindo/(dashboard)/laporan/actions.ts"
git commit -m "fix: resolve perusahaanId via getMkesindoPerusahaanId in recordPaymentAction; add BBM correction actions"
```

---

### Task 5: Compose new query pieces into `getLaporanShiftDetail`

**Files:**
- Modify: `src/lib/queries/laporan-shift-detail.ts`

**Interfaces:**
- Consumes: `getRekapPerDriverUntukHari` (Task 3); the already-enriched `KartuPengirimanRow`/`BbmShiftRow` (Tasks 1/2, passthrough only, no code change needed for those two beyond what TypeScript already infers).
- Produces: `LaporanShiftDetail` gains `perusahaanId: number` and `rekapPerDriver: RekapDriverRow[]`. Consumed by Task 6/7/8 (UI).

- [ ] **Step 1: Add `perusahaanId` and `rekapPerDriver` to the composed result**

`getLaporanShiftDetail` already receives `perusahaanId` as its own third parameter — it just isn't threaded into the returned object yet (the UI needs it to pass to `PelunasanDialog`). Add the import and a new `Promise.all` entry:

```ts
import { getRekapPerDriverUntukHari, type RekapDriverRow } from "@/lib/queries/laporan-shift-pengiriman";
```

Add `getRekapPerDriverUntukHari(tanggalUsaha)` to the existing `Promise.all` array (destructure it as `rekapPerDriver`), and add both new fields to the `LaporanShiftDetail` interface and the function's return object:

```ts
export interface LaporanShiftDetail {
  // ...existing fields...
  perusahaanId: number;
  rekapPerDriver: RekapDriverRow[];
}
```

```ts
return {
  // ...existing fields...
  perusahaanId,
  rekapPerDriver,
};
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/queries/laporan-shift-detail.ts`
Expected: clean.

Live-DB check: call `getLaporanShiftDetail` for a real `(tanggalUsaha, shift, perusahaanId)`, confirm `result.perusahaanId` equals the `perusahaanId` argument passed in (trivial passthrough — verify it isn't accidentally dropped), and confirm `result.rekapPerDriver` matches Task 3's own already-verified output for the same `tanggalUsaha`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/laporan-shift-detail.ts
git commit -m "feat: thread perusahaanId and rekapPerDriver through getLaporanShiftDetail"
```

---

### Task 6: UI — Kartu Pengiriman redesign, route title, Pelunasan integration

**Files:**
- Modify: `src/components/dashboard/laporan-shift-detail.tsx`

**Interfaces:**
- Consumes: `PelunasanDialog` (`@/components/dashboard/pelunasan-dialog`, already exists, unchanged); the enriched `KartuPengirimanRow`/`KartuPengirimanStopRow` (Task 1); `LaporanShiftDetail.perusahaanId` (Task 5).

- [ ] **Step 1: Read the current file's Kartu Pengiriman section**

Read `src/components/dashboard/laporan-shift-detail.tsx` (the `id="kartu-pengiriman"` section, currently a flat list of Jadwal → stops with plain text) and `PelunasanDialog`'s full props (`businessPartnerId`, `customerName`, `perusahaanId`, `open`, `onOpenChange`) before writing this task's JSX.

- [ ] **Step 2: Route title + richer card header**

Replace the current `<p className="mb-1.5 font-medium">Jadwal #{k.jadwalId} — {k.driverName ?? "-"} ({k.armadaNama ?? "-"})</p>` line with the spec's title format. Change the existing `import type { StatusBayar } from "@/lib/queries/laporan-shift-pengiriman";` to also bring in `KartuPengirimanRow`: `import type { StatusBayar, KartuPengirimanRow } from "@/lib/queries/laporan-shift-pengiriman";`. Add a small helper above the component:

```ts
function formatJudulRute(k: KartuPengirimanRow): string {
  const jam = k.jamAktualBerangkat ? formatTime(k.jamAktualBerangkat) : "-";
  if (!k.lokasiTerjauh) return jam;
  const lokasi = k.lokasiTerjauh.kecamatan ? `${k.lokasiTerjauh.wilayah}, ${k.lokasiTerjauh.kecamatan}` : k.lokasiTerjauh.wilayah;
  return `${jam} - ${lokasi}`;
}
```

Render it as the card's title, with `k.vehicleNo` (Task 1's new field — the real plate when linked, else the armada's nickname) and `k.driverName` as a secondary line, e.g. `{k.vehicleNo ?? "-"} · {k.driverName ?? "-"}`.

- [ ] **Step 3: Per-stop table with colored status + Pelunasan trigger**

Restructure each stop's render from the current flat `<div>` into a table-like row (reuse `@/components/ui/table` `Table`/`TableRow`/`TableCell` primitives, matching the convention already used in `laporan-kas-kecil.tsx`) with columns Tujuan/Kirim/Return/Nominal/Metode/Status. Status badge colors: green for `TUNAI`/`QRIS`/`TRANSFER` (paid), red for `TIDAK_BAYAR`, neutral/amber for `BELUM_BAYAR` (including the existing "Dibayar (metode belum tercatat)" special case from the prior feature — keep that exact rendering logic unchanged, just restyle its container).

Add the import `import { PelunasanDialog } from "@/components/dashboard/pelunasan-dialog";`. Add a "Catat Pembayaran" button next to any stop where `statusBayar === "BELUM_BAYAR"`, opening `PelunasanDialog` for that stop's `businessPartnerId`/`customerName`:

```tsx
const [pelunasanTarget, setPelunasanTarget] = useState<{ businessPartnerId: string; customerName: string } | null>(null);

// ...inside the stop row, when statusBayar === "BELUM_BAYAR":
<Button size="xs" variant="outline" onClick={() => setPelunasanTarget({ businessPartnerId: s.businessPartnerId, customerName: s.customerName })}>
  Catat Pembayaran
</Button>

// ...once, after the Kartu Pengiriman section's closing </section>, or anywhere in the component tree:
{detail && (
  <PelunasanDialog
    businessPartnerId={pelunasanTarget?.businessPartnerId ?? ""}
    customerName={pelunasanTarget?.customerName ?? ""}
    perusahaanId={detail.perusahaanId}
    open={pelunasanTarget != null}
    onOpenChange={(open) => {
      if (!open) {
        setPelunasanTarget(null);
        handleTampilkan(); // re-fetch this shift's data so the paid stop's status updates immediately
      }
    }}
  />
)}
```

(`handleTampilkan` already exists in this component — reuse it directly rather than duplicating its fetch logic. Confirm it correctly re-runs against the currently-selected `tanggalUsaha`/`shift` state, which it already does per the existing code.)

- [ ] **Step 4: Collapsible second-and-later Jadwal cards**

Add a `useState<Set<number>>` tracking which `jadwalId`s are expanded (default: only the FIRST card expanded, rest collapsed), toggled by clicking the card header. This is a pure client-side UI toggle, no data implication.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/components/dashboard/laporan-shift-detail.tsx`
Expected: clean.

Live browser click-through (use whatever preview/browser tool is available, an already-authenticated real session, never enter credentials): open Laporan Shift, pick a shift with a `BELUM_BAYAR` stop, click "Catat Pembayaran", confirm `PelunasanDialog` opens with the correct mitra name and its real outstanding invoices, select an invoice + amount, submit with a Tunai (or whatever methods are configured) metode, confirm success toast, confirm the dialog closes and the stop's status updates in the underlying table without a full page reload. Confirm collapsing/expanding a second Jadwal card works. Confirm the route title renders the new format correctly for a Jadwal that has both `jamAktualBerangkat` and `lokasiTerjauh` set, and degrades sensibly (shows just the time, or "-") for one that doesn't.

**IMPORTANT**: if you record a real test payment during this click-through, this creates a REAL, permanent `SalesPayment` document (there is no safe way to "undo" a recorded payment via `PelunasanDialog` itself — it isn't a draft). Prefer testing against a mitra/invoice combination where a small real payment is acceptable to leave in place (e.g., an invoice already near-fully-paid, or coordinate with whoever owns this environment before creating test financial documents) — document in your report exactly what real document (if any) was created and why it was judged acceptable to leave, rather than attempting a revert that this module doesn't support.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/laporan-shift-detail.tsx
git commit -m "feat: redesign Kartu Pengiriman card, route title, embed Pelunasan dialog"
```

---

### Task 7: UI — Kas redesign, BBM edit/delete, manual kas input

**Files:**
- Modify: `src/components/dashboard/laporan-shift-detail.tsx`

**Interfaces:**
- Consumes: `updateBbmManualAction`/`hapusBbmEntryAction` (Task 4); `tambahPengeluaranAction`/`hapusPengeluaranAction` (already exist, unchanged).

- [ ] **Step 1: Two-column Kas Masuk / Kas Keluar layout**

Restructure the `id="kas"` section into two side-by-side panels (`grid grid-cols-1 md:grid-cols-2 gap-3`, collapsing to one column on narrow viewports): left panel "Kas Masuk" showing `detail.kasKecil?.kasMasuk` (the existing single top-up figure — there's no itemized "kas masuk" breakdown in this codebase's data model beyond that one number plus BBM's own `kembalian`-style entries, which don't currently exist as a separate tracked field; render what's actually available rather than inventing rows the data doesn't have), right panel "Kas Keluar" listing BBM (editable, Step 2 below) then manual entries (Step 3 below), with the existing `Total Pengeluaran / Saldo Akhir` summary row kept at the bottom.

- [ ] **Step 2: BBM row edit/delete**

For each `detail.bbm` row, add an inline edit affordance (click to reveal 3 number inputs for Liter/NominalAsli/NominalEkstra + Simpan/Batal, matching the compact inline-edit pattern already used for `kasMasuk` in `laporan-kas-kecil.tsx`'s `KasKecilCard`) and a delete button (`confirm()` before calling, matching `PengeluaranList`'s own `handleHapus` pattern exactly):

```tsx
const [editingBbmId, setEditingBbmId] = useState<number | null>(null);
const [bbmForm, setBbmForm] = useState({ liter: "", nominalAsli: "", nominalEkstra: "" });

function handleSimpanBbm(bbmId: number) {
  startTransition(async () => {
    const result = await updateBbmManualAction(bbmId, Number(bbmForm.liter) || 0, Number(bbmForm.nominalAsli) || 0, Number(bbmForm.nominalEkstra) || 0);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setEditingBbmId(null);
    handleTampilkan();
  });
}

function handleHapusBbm(bbmId: number) {
  if (!confirm("Hapus catatan BBM ini?")) return;
  startTransition(async () => {
    const result = await hapusBbmEntryAction(bbmId);
    if (result.success) handleTampilkan();
  });
}
```

- [ ] **Step 3: Manual kas keluar add/delete**

Adapt `laporan-kas-kecil.tsx`'s `PengeluaranList` interaction (Input for keterangan + nominal, `tambahPengeluaranAction(tanggalUsaha, shift, keterangan, nominal)`, `hapusPengeluaranAction(pengeluaranId)`, both already existing and unchanged) into this new layout — the calls themselves are identical to that existing component's, only the surrounding JSX/styling changes to match Task 6's denser card aesthetic.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/components/dashboard/laporan-shift-detail.tsx`
Expected: clean.

Live browser + live-DB click-through: edit a real BBM row's Liter/nominal, confirm it saves and displays correctly, then edit it AGAIN to restore its exact original values (capture-baseline/modify/verify/revert, since `updateBbmManual` has no undo). Add a manual kas keluar entry, confirm it appears and the Saldo Akhir recalculates, then delete it (this one IS safe to leave deleted since you created it purely for this test — unlike the BBM edit, which must be restored since it's real historical data). Do NOT test `hapusBbmEntryAction` against a real row in the browser (no undo) — its function-level correctness was already verified read-only in Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/laporan-shift-detail.tsx
git commit -m "feat: add BBM edit/delete and redesigned Kas section to Laporan Shift"
```

---

### Task 8: UI — Rekap Total per Driver table

**Files:**
- Modify: `src/components/dashboard/laporan-shift-detail.tsx`

**Interfaces:**
- Consumes: `detail.rekapPerDriver` (Task 5).

- [ ] **Step 1: Add the table**

Add a new section beneath the Kartu Pengiriman list (inside the `id="kartu-pengiriman"` section, or as its own unlisted sub-block right after it — either is acceptable; do not add it as a new entry in the `SECTIONS` jump-nav array, since the spec scopes the jump-nav to the 6 existing sections and this recap is a sub-element of Kartu Pengiriman, not a new top-level report section):

```tsx
<div className="mt-2 rounded-md border p-2">
  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Rekap Total per Driver <span className="font-normal">(seluruh shift hari ini)</span></p>
  {detail.rekapPerDriver.length === 0 ? (
    <p className="text-xs text-muted-foreground">Tidak ada driver bertugas hari ini.</p>
  ) : (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Driver</TableHead>
          <TableHead className="text-right">Kirim</TableHead>
          <TableHead className="text-right">Return</TableHead>
          <TableHead className="text-right">Netto</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {detail.rekapPerDriver.map((r) => (
          <TableRow key={r.salesmanId}>
            <TableCell>{r.driverName ?? r.salesmanId}</TableCell>
            <TableCell className="text-right tabular-nums">{r.totalKirim}</TableCell>
            <TableCell className="text-right tabular-nums">{r.totalReturn}</TableCell>
            <TableCell className="text-right tabular-nums font-medium">{r.netto}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )}
</div>
```

Add the `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` imports from `@/components/ui/table` if not already imported by this file after Tasks 6/7's changes.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/components/dashboard/laporan-shift-detail.tsx`
Expected: clean.

Live browser check: confirm the table renders with real data matching Task 3's own live-verified figures for the same `tanggalUsaha`, and confirm it stays the SAME when switching between the day's different shifts in the selector (since this recap is whole-day, not per-shift — this is the one part of the page that should NOT change when only the `shift` dropdown changes, only when `tanggalUsaha` changes).

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/laporan-shift-detail.tsx
git commit -m "feat: add Rekap Total per Driver table to Laporan Shift"
```
