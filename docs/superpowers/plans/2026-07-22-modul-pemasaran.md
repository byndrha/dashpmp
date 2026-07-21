# Modul Pemasaran Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the web-based foundation of the "Pemasaran" (Marketing) module — Marketing staff submit "Pengajuan Mitra" (candidate mitra visits) from any browser (mobile-friendly, no native app yet), management sees a live list + per-marketing KPI progress bars, and approving a pengajuan auto-creates a real Mitra.

**Architecture:** Follows this codebase's existing "Dashboard module" pattern exactly: one new `Dashboard*` SQL Server table, a query file under `src/lib/queries/`, server actions under the route's `actions.ts`, dashboard components under `src/components/dashboard/`, one page under `src/app/(dashboard)/pemasaran/`. Approving a pengajuan calls the *existing* `createMitra()` / `setMitraLocation()` functions instead of duplicating mitra-creation logic. Location capture reuses the existing `WilayahSelect` / `KecamatanSelect` / `MitraLocationField` components as-is.

**Tech Stack:** Next.js 16 (App Router, Server Actions), `mssql` (no ORM), NextAuth v5 session/JWT permissions, shadcn/ui (base-ui) components, Tailwind v4.

## Global Constraints

- No ORM — raw parameterized SQL via `mssql`, matching every existing query file.
- New table follows the `Dashboard*` naming/column convention (see `DashboardMitraLocation`, `DashboardCollectionTarget`): plain `VARCHAR(16)` user-id columns (no hard FK to `DashboardUser`, since `session.user.id` is a stringified `UserID`), `CreatedAt DATETIME NOT NULL DEFAULT (GETDATE())`.
- Any WIB wall-clock time entered via a plain HTML `datetime-local` input must be converted to UTC explicitly (`Date.UTC(...)`, offset -7 hours) before being sent to SQL Server as a `DATETIME` — **never** `new Date(theInputString)` directly. This codebase has hit real bugs from server-local-timezone date parsing before (see `src/lib/business-date.ts` comments); the same class of bug applies here.
- Setujui/Tolak (approve/reject) authorization is checked **server-side inside the Server Action**, not just hidden in the UI — gate is `isSuperAdmin || roleId ∈ {3 (Supervisor), 4 (Accounting)}`.
- **No test framework exists in this repository** (no jest/vitest/playwright, no `test` script in `package.json`) — this plan's "run and verify" steps use this codebase's actual, already-established verification tools instead of inventing a test framework: `npx tsc --noEmit` (type-check), `npm run lint` (eslint), `npm run build` (production build — catches SSR issues), and for the database task, the project's SQL MCP tools. Do not add jest/vitest as a side effect of this plan.
- This plan does **not** include Capacitor packaging — that is sub-project 2, a separate future plan, per `docs/superpowers/specs/2026-07-22-modul-pemasaran-design.md`.

---

## Task 1: Database schema — `DashboardMitraPengajuan` table

**Files:**
- No files — this is a database schema change via the project's SQL MCP tool (`mcp__465d4c13-432b-442b-a233-0348f79f6ac6__sql_execute_ddl`), the same way `DashboardMitraLocation` was created earlier in this project.

**Interfaces:**
- Produces: the `DashboardMitraPengajuan` table that every later task's SQL reads/writes.

- [ ] **Step 1: Verify the table doesn't already exist**

Run this query with the project's SQL MCP tool (DQL):

```sql
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'DashboardMitraPengajuan'
```

Expected: 0 rows.

- [ ] **Step 2: Create the table**

Run this DDL with the project's SQL MCP tool:

```sql
CREATE TABLE DashboardMitraPengajuan (
  PengajuanID INT IDENTITY(1,1) PRIMARY KEY,
  MarketingUserID VARCHAR(16) NOT NULL,
  NamaCalon VARCHAR(128) NOT NULL,
  NoHP VARCHAR(50) NULL,
  WaktuPermintaanSampai DATETIME NULL,
  QtyKantong DECIMAL(23,4) NULL,
  PriceLevel INT NULL,
  Wilayah VARCHAR(128) NULL,
  Kecamatan VARCHAR(128) NULL,
  Alamat VARCHAR(1024) NULL,
  Latitude DECIMAL(10,7) NULL,
  Longitude DECIMAL(10,7) NULL,
  Status VARCHAR(20) NOT NULL DEFAULT 'Menunggu',
  CatatanTolak VARCHAR(512) NULL,
  ConvertedBusinessPartnerID VARCHAR(16) NULL,
  ReviewedByUserID VARCHAR(16) NULL,
  ReviewedAt DATETIME NULL,
  CreatedAt DATETIME NOT NULL DEFAULT (GETDATE())
);
```

- [ ] **Step 3: Verify the table shape**

Run with the SQL MCP tool's table-info command (`sql_get_table_info` with `table_name: "DashboardMitraPengajuan"`).

Expected: 18 columns matching the DDL above, `PengajuanID` as the primary key, `rowCount: 0`.

---

## Task 2: Query layer — reads (list, KPI) + role constants

**Files:**
- Create: `src/lib/queries/mitra-pengajuan.ts`

**Interfaces:**
- Consumes: `getPool`, `sql` from `@/lib/db`; `getBusinessDate`, `monthBoundary` from `@/lib/business-date` (existing signatures: `getBusinessDate(now?: Date): Date`, `monthBoundary(wibDate: Date, monthsOffset?: number): Date`).
- Produces (used by Task 3, 5, 6, 7, 8, 9):
  - `export type PengajuanStatus = "Menunggu" | "Disetujui" | "Ditolak"`
  - `export interface PengajuanRow { PengajuanID: number; MarketingUserID: string; MarketingNama: string; NamaCalon: string; NoHP: string | null; WaktuPermintaanSampai: string | null; QtyKantong: number | null; PriceLevel: number | null; Wilayah: string | null; Kecamatan: string | null; Alamat: string | null; Latitude: number | null; Longitude: number | null; Status: PengajuanStatus; CatatanTolak: string | null; ConvertedBusinessPartnerID: string | null; CreatedAt: string }`
  - `export interface MarketingKPIRow { UserID: string; Nama: string; Kunjungan: number; Konversi: number }`
  - `export const MARKETING_ROLE_ID = 1003`
  - `export const APPROVER_ROLE_IDS = [3, 4]`
  - `export async function getPengajuanList(): Promise<PengajuanRow[]>`
  - `export async function getMarketingKPI(): Promise<MarketingKPIRow[]>`

- [ ] **Step 1: Write the file**

```ts
import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";

// RoleID values from DashboardRole — already-existing roles in this
// database, not created by this feature. Marketing (1003) is who submits
// pengajuan; Supervisor (3) and Accounting (4), plus Super Admin, are who
// may approve/reject (business decision — see design spec).
export const MARKETING_ROLE_ID = 1003;
export const APPROVER_ROLE_IDS = [3, 4];

export type PengajuanStatus = "Menunggu" | "Disetujui" | "Ditolak";

export interface PengajuanRow {
  PengajuanID: number;
  MarketingUserID: string;
  MarketingNama: string;
  NamaCalon: string;
  NoHP: string | null;
  WaktuPermintaanSampai: string | null;
  QtyKantong: number | null;
  PriceLevel: number | null;
  Wilayah: string | null;
  Kecamatan: string | null;
  Alamat: string | null;
  Latitude: number | null;
  Longitude: number | null;
  Status: PengajuanStatus;
  CatatanTolak: string | null;
  ConvertedBusinessPartnerID: string | null;
  CreatedAt: string;
}

export async function getPengajuanList(): Promise<PengajuanRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
        dmp.PengajuanID,
        dmp.MarketingUserID,
        ISNULL(du.Nama, 'Tidak diketahui') AS MarketingNama,
        dmp.NamaCalon,
        dmp.NoHP,
        dmp.WaktuPermintaanSampai,
        dmp.QtyKantong,
        dmp.PriceLevel,
        dmp.Wilayah,
        dmp.Kecamatan,
        dmp.Alamat,
        dmp.Latitude,
        dmp.Longitude,
        dmp.Status,
        dmp.CatatanTolak,
        dmp.ConvertedBusinessPartnerID,
        dmp.CreatedAt
    FROM DashboardMitraPengajuan dmp
    LEFT JOIN DashboardUser du ON du.UserID = TRY_CAST(dmp.MarketingUserID AS INT)
    ORDER BY dmp.CreatedAt DESC
  `);
  return result.recordset;
}

export interface MarketingKPIRow {
  UserID: string;
  Nama: string;
  Kunjungan: number;
  Konversi: number;
}

// "Kunjungan" and "Konversi" are both scoped to the WIB business month
// (same monthBoundary() convention as every other monthly metric in this
// app — see revenue-target.ts, sales-overview.ts). Every active Marketing
// user is included even with zero pengajuan this month, so management can
// see who hasn't logged any visits yet, not just who has.
export async function getMarketingKPI(): Promise<MarketingKPIRow[]> {
  const pool = await getPool();
  const businessToday = getBusinessDate();
  const monthStart = monthBoundary(businessToday);
  const monthEnd = monthBoundary(businessToday, 1);

  const result = await pool
    .request()
    .input("monthStart", sql.Date, monthStart)
    .input("monthEnd", sql.Date, monthEnd)
    .input("roleId", sql.Int, MARKETING_ROLE_ID).query(`
      SELECT
          CAST(du.UserID AS VARCHAR(16)) AS UserID,
          du.Nama,
          COUNT(dmp.PengajuanID) AS Kunjungan,
          SUM(CASE WHEN dmp.QtyKantong > 0 THEN 1 ELSE 0 END) AS Konversi
      FROM DashboardUser du
      LEFT JOIN DashboardMitraPengajuan dmp
             ON dmp.MarketingUserID = CAST(du.UserID AS VARCHAR(16))
            AND dmp.CreatedAt >= @monthStart AND dmp.CreatedAt < @monthEnd
      WHERE du.RoleID = @roleId AND ISNULL(du.IsActive, 0) = 1
      GROUP BY du.UserID, du.Nama
      ORDER BY du.Nama
    `);

  return (
    result.recordset as { UserID: string; Nama: string; Kunjungan: number; Konversi: number | null }[]
  ).map((r) => ({ UserID: r.UserID, Nama: r.Nama, Kunjungan: r.Kunjungan, Konversi: r.Konversi ?? 0 }));
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (no errors).

- [ ] **Step 3: Verify against live data with the SQL MCP tool**

Run this DQL (mirrors what `getMarketingKPI()` executes) to confirm the "Marketing" role (1003) resolves correctly and the query has no syntax errors:

```sql
SELECT du.UserID, du.Nama, du.IsActive FROM DashboardUser du WHERE du.RoleID = 1003
```

Expected: at least the Marketing user(s) already known to exist in this database (confirmed present during design — RoleID 1003 exists).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/mitra-pengajuan.ts
git commit -m "Add Pengajuan Mitra read queries (list + marketing KPI)"
```

---

## Task 3: Query layer — mutations (create, approve, reject)

**Files:**
- Modify: `src/lib/queries/mitra-pengajuan.ts`

**Interfaces:**
- Consumes: `createMitra(input: MitraInput): Promise<string>` from `@/lib/queries/mitra` (existing); `setMitraLocation(input: { businessPartnerId: string; latitude: number; longitude: number; alamat: string | null; userId: string }): Promise<void>` from `@/lib/queries/mitra-location` (existing).
- Produces (used by Task 5):
  - `export interface PengajuanInput { namaCalon: string; noHP: string | null; waktuPermintaanSampai: string; qtyKantong: number | null; priceLevel: number | null; wilayah: string | null; kecamatan: string | null; alamat: string | null; latitude: number | null; longitude: number | null }`
  - `export async function createPengajuan(input: PengajuanInput, marketingUserId: string): Promise<void>`
  - `export async function approvePengajuan(pengajuanId: number, reviewerUserId: string): Promise<void>`
  - `export async function rejectPengajuan(pengajuanId: number, reviewerUserId: string, catatan: string | null): Promise<void>`

- [ ] **Step 1: Add the imports and the WIB datetime-local helper**

At the top of `src/lib/queries/mitra-pengajuan.ts`, add to the existing imports and add this helper function (after the existing imports, before `MARKETING_ROLE_ID`):

```ts
import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";
import { createMitra, type MitraInput } from "@/lib/queries/mitra";
import { setMitraLocation } from "@/lib/queries/mitra-location";

// A plain HTML <input type="datetime-local"> value ("2026-07-25T14:30") has
// no timezone info. This app's users are all in WIB (UTC+7) — parsing that
// string with `new Date(...)` directly would interpret it in the SERVER's
// local timezone instead (commonly UTC on a Coolify container), silently
// shifting the time by 7 hours. Convert explicitly, the same way every
// other WIB-sensitive date in this codebase is built (see business-date.ts).
function parseWibDateTimeLocal(value: string): Date {
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = (timePart ?? "00:00").split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute));
}
```

(`MitraInput` import is needed only for the type annotation used below — TypeScript will flag it as unused until Step 3.)

- [ ] **Step 2: Add `createPengajuan`**

Append to `src/lib/queries/mitra-pengajuan.ts`:

```ts
export interface PengajuanInput {
  namaCalon: string;
  noHP: string | null;
  waktuPermintaanSampai: string;
  qtyKantong: number | null;
  priceLevel: number | null;
  wilayah: string | null;
  kecamatan: string | null;
  alamat: string | null;
  latitude: number | null;
  longitude: number | null;
}

export async function createPengajuan(input: PengajuanInput, marketingUserId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("marketingUserId", sql.VarChar(16), marketingUserId)
    .input("namaCalon", sql.VarChar(128), input.namaCalon)
    .input("noHP", sql.VarChar(50), input.noHP)
    .input("waktu", sql.DateTime, parseWibDateTimeLocal(input.waktuPermintaanSampai))
    .input("qty", sql.Decimal(23, 4), input.qtyKantong)
    .input("priceLevel", sql.Int, input.priceLevel)
    .input("wilayah", sql.VarChar(128), input.wilayah)
    .input("kecamatan", sql.VarChar(128), input.kecamatan)
    .input("alamat", sql.VarChar(1024), input.alamat)
    .input("lat", sql.Decimal(10, 7), input.latitude)
    .input("lng", sql.Decimal(10, 7), input.longitude).query(`
      INSERT INTO DashboardMitraPengajuan
        (MarketingUserID, NamaCalon, NoHP, WaktuPermintaanSampai, QtyKantong, PriceLevel,
         Wilayah, Kecamatan, Alamat, Latitude, Longitude, Status, CreatedAt)
      VALUES
        (@marketingUserId, @namaCalon, @noHP, @waktu, @qty, @priceLevel,
         @wilayah, @kecamatan, @alamat, @lat, @lng, 'Menunggu', GETDATE())
    `);
}
```

- [ ] **Step 3: Add `approvePengajuan` and `rejectPengajuan`**

Append:

```ts
export async function approvePengajuan(pengajuanId: number, reviewerUserId: string): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, pengajuanId)
    .query(`SELECT * FROM DashboardMitraPengajuan WHERE PengajuanID = @id AND Status = 'Menunggu'`);

  const row = result.recordset[0] as
    | {
        NamaCalon: string;
        NoHP: string | null;
        Alamat: string | null;
        Wilayah: string | null;
        Kecamatan: string | null;
        PriceLevel: number | null;
        Latitude: number | null;
        Longitude: number | null;
      }
    | undefined;
  if (!row) throw new Error("Pengajuan tidak ditemukan atau sudah diproses");

  // Reuses the exact mitra-creation path the Mitra module's own "Tambah
  // Mitra" form uses — same Code/BusinessPartnerID generation, same
  // required-column defaults (see mitra.ts createMitra()), no duplicated
  // logic. Defaults Tipe Mitra to Retail ("Female") since this KPI is
  // specifically about retail outlets — correctable afterwards via the
  // Mitra module if a submission turns out to be an Agen.
  const mitraInput: MitraInput = {
    name: row.NamaCalon,
    mobileNo: row.NoHP,
    address: row.Alamat,
    wilayah: row.Wilayah,
    kecamatan: row.Kecamatan,
    gender: "Female",
    priceLevel: row.PriceLevel,
    termOfPaymentId: null,
    capacity: null,
  };
  const businessPartnerId = await createMitra(mitraInput);

  if (row.Latitude != null && row.Longitude != null) {
    await setMitraLocation({
      businessPartnerId,
      latitude: row.Latitude,
      longitude: row.Longitude,
      alamat: row.Alamat,
      userId: reviewerUserId,
    });
  }

  await pool
    .request()
    .input("id", sql.Int, pengajuanId)
    .input("bpId", sql.VarChar(16), businessPartnerId)
    .input("reviewer", sql.VarChar(16), reviewerUserId).query(`
      UPDATE DashboardMitraPengajuan
      SET Status = 'Disetujui', ConvertedBusinessPartnerID = @bpId,
          ReviewedByUserID = @reviewer, ReviewedAt = GETDATE()
      WHERE PengajuanID = @id
    `);
}

export async function rejectPengajuan(
  pengajuanId: number,
  reviewerUserId: string,
  catatan: string | null
): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, pengajuanId)
    .input("reviewer", sql.VarChar(16), reviewerUserId)
    .input("catatan", sql.VarChar(512), catatan).query(`
      UPDATE DashboardMitraPengajuan
      SET Status = 'Ditolak', CatatanTolak = @catatan,
          ReviewedByUserID = @reviewer, ReviewedAt = GETDATE()
      WHERE PengajuanID = @id AND Status = 'Menunggu'
    `);
}
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/mitra-pengajuan.ts
git commit -m "Add Pengajuan Mitra mutations: create, approve (auto-converts to Mitra), reject"
```

---

## Task 4: Permissions & sidebar registration

**Files:**
- Modify: `src/lib/permissions.ts`
- Modify: `src/components/dashboard/app-sidebar.tsx`

**Interfaces:**
- Produces: `"pemasaran"` becomes a valid `ModuleKey`, selectable in the existing Akun &gt; Peran editor (no changes needed there — it already iterates `MODULE_KEYS` generically, confirmed when the Transaksi module was added).

- [ ] **Step 1: Add the module key and label**

In `src/lib/permissions.ts`, change:

```ts
export const MODULE_KEYS = ["beranda", "pnl", "aging", "sales", "transaksi", "electricity", "delivery", "mitra"] as const;
```

to:

```ts
export const MODULE_KEYS = ["beranda", "pnl", "aging", "sales", "transaksi", "electricity", "delivery", "mitra", "pemasaran"] as const;
```

And change:

```ts
export const MODULE_LABEL: Record<ModuleKey, string> = {
  beranda: "Beranda",
  pnl: "Keuangan",
  aging: "Piutang",
  sales: "Penjualan",
  transaksi: "Transaksi",
  electricity: "Biaya Listrik",
  delivery: "Pengiriman",
  mitra: "Mitra",
};
```

to:

```ts
export const MODULE_LABEL: Record<ModuleKey, string> = {
  beranda: "Beranda",
  pnl: "Keuangan",
  aging: "Piutang",
  sales: "Penjualan",
  transaksi: "Transaksi",
  electricity: "Biaya Listrik",
  delivery: "Pengiriman",
  mitra: "Mitra",
  pemasaran: "Pemasaran",
};
```

- [ ] **Step 2: Add the sidebar nav item**

In `src/components/dashboard/app-sidebar.tsx`, add `Megaphone` to the lucide-react import:

```ts
import {
  LayoutGrid,
  LineChart,
  Receipt,
  ShoppingCart,
  ArrowLeftRight,
  Zap,
  Truck,
  Users,
  Megaphone,
  ShieldCheck,
} from "lucide-react";
```

Then add a new entry to `NAV_ITEMS`, right after the `mitra` entry:

```ts
  { href: "/mitra", label: "Mitra", icon: Users, moduleKey: "mitra" },
  { href: "/pemasaran", label: "Pemasaran", icon: Megaphone, moduleKey: "pemasaran" },
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/permissions.ts src/components/dashboard/app-sidebar.tsx
git commit -m "Register Pemasaran module key and sidebar entry"
```

---

## Task 5: Server actions

**Files:**
- Create: `src/app/(dashboard)/pemasaran/actions.ts`

**Interfaces:**
- Consumes: `createPengajuan`, `approvePengajuan`, `rejectPengajuan`, `APPROVER_ROLE_IDS`, `type PengajuanInput` from `@/lib/queries/mitra-pengajuan` (Task 2/3); `auth` from `@/lib/auth` (existing).
- Produces (used by Task 6, 7, 9):
  - `export async function createPengajuanAction(input: PengajuanInput): Promise<void>`
  - `export async function approvePengajuanAction(pengajuanId: number): Promise<void>`
  - `export async function rejectPengajuanAction(pengajuanId: number, catatan: string | null): Promise<void>`

- [ ] **Step 1: Write the file**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  createPengajuan,
  approvePengajuan,
  rejectPengajuan,
  APPROVER_ROLE_IDS,
  type PengajuanInput,
} from "@/lib/queries/mitra-pengajuan";

export async function createPengajuanAction(input: PengajuanInput) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");

  await createPengajuan(input, userId);
  revalidatePath("/pemasaran");
}

// Checked here, not just hidden in the UI — Setujui/Tolak must not be
// callable by anyone else even if they invoke the action directly.
async function requireApprover() {
  const session = await auth();
  const user = session?.user;
  if (!user) throw new Error("Unauthorized");
  if (!user.isSuperAdmin && !APPROVER_ROLE_IDS.includes(user.roleId)) {
    throw new Error("Tidak punya izin menyetujui/menolak pengajuan");
  }
  return user;
}

export async function approvePengajuanAction(pengajuanId: number) {
  const user = await requireApprover();
  await approvePengajuan(pengajuanId, user.id);
  revalidatePath("/pemasaran");
  revalidatePath("/mitra");
}

export async function rejectPengajuanAction(pengajuanId: number, catatan: string | null) {
  const user = await requireApprover();
  await rejectPengajuan(pengajuanId, user.id, catatan);
  revalidatePath("/pemasaran");
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/pemasaran/actions.ts"
git commit -m "Add Pemasaran server actions with server-side approver gating"
```

---

## Task 6: `PengajuanFormDialog` component

**Files:**
- Create: `src/components/dashboard/pengajuan-form-dialog.tsx`

**Interfaces:**
- Consumes: `MitraLocationField`, `type MitraLocationValue`, `type MitraGeocodeSuggestion` from `@/components/dashboard/mitra-location-field` (existing); `WilayahSelect` from `@/components/dashboard/wilayah-select` (existing, props `{ value: string; onChange: (name: string, regencyCode: string | null) => void }`); `KecamatanSelect` from `@/components/dashboard/kecamatan-select` (existing, props `{ regencyCode: string | null; value: string; onChange: (name: string) => void }`); `type PriceLevelOption` from `@/lib/queries/mitra` (existing, `{ Level: number; Price: number }`); `type PengajuanInput` from `@/lib/queries/mitra-pengajuan` (Task 3); `formatRupiah` from `@/lib/format`.
- Produces (used by Task 9): `export function PengajuanFormDialog({ open, onOpenChange, priceLevels, onSubmit, pending }: { open: boolean; onOpenChange: (open: boolean) => void; priceLevels: PriceLevelOption[]; onSubmit: (input: PengajuanInput) => void; pending: boolean })`

- [ ] **Step 1: Write the file**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { MitraLocationField, type MitraLocationValue } from "@/components/dashboard/mitra-location-field";
import { WilayahSelect } from "@/components/dashboard/wilayah-select";
import { KecamatanSelect } from "@/components/dashboard/kecamatan-select";
import { formatRupiah } from "@/lib/format";
import type { PriceLevelOption } from "@/lib/queries/mitra";
import type { PengajuanInput } from "@/lib/queries/mitra-pengajuan";

// Same coordinates as PABRIK_ORIGIN in app/api/routing/route.ts — a
// sensible starting pin, same default the Mitra location field itself uses.
function emptyLocation(): MitraLocationValue {
  return { latitude: -7.8462825, longitude: 111.4759937, alamat: null };
}

export function PengajuanFormDialog({
  open,
  onOpenChange,
  priceLevels,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  priceLevels: PriceLevelOption[];
  onSubmit: (input: PengajuanInput) => void;
  pending: boolean;
}) {
  const [wilayah, setWilayah] = useState("");
  const [kecamatan, setKecamatan] = useState("");
  const [regencyCode, setRegencyCode] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState<MitraLocationValue>(emptyLocation());
  const [priceLevel, setPriceLevel] = useState("");

  // Same pattern as MitraFormDialog (mitra-list.tsx): only clears Kecamatan
  // when Wilayah actually changes to a different region.
  function handleWilayahChange(name: string, code: string | null) {
    if (name !== wilayah) setKecamatan("");
    setWilayah(name);
    setRegencyCode(code);
  }

  function handleGeocode(suggestion: { alamat: string | null; wilayah: string | null; kecamatan: string | null }) {
    if (suggestion.alamat) setAddress(suggestion.alamat);
    if (suggestion.wilayah) setWilayah(suggestion.wilayah);
    if (suggestion.kecamatan) setKecamatan(suggestion.kecamatan);
  }

  function resetForm() {
    setWilayah("");
    setKecamatan("");
    setRegencyCode(null);
    setAddress("");
    setLocation(emptyLocation());
    setPriceLevel("");
  }

  function handleSubmit(formData: FormData) {
    onSubmit({
      namaCalon: String(formData.get("namaCalon") ?? ""),
      noHP: String(formData.get("noHP") ?? "") || null,
      waktuPermintaanSampai: String(formData.get("waktuPermintaanSampai") ?? ""),
      qtyKantong: formData.get("qtyKantong") ? Number(formData.get("qtyKantong")) : null,
      priceLevel: priceLevel ? Number(priceLevel) : null,
      wilayah: wilayah || null,
      kecamatan: kecamatan || null,
      alamat: address || null,
      latitude: location.latitude,
      longitude: location.longitude,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) resetForm();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pengajuan Mitra Baru</DialogTitle>
          <DialogDescription>Isi data kunjungan ke calon mitra. Waktu input tercatat otomatis.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="namaCalon">Nama Calon Mitra</Label>
            <Input id="namaCalon" name="namaCalon" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="noHP">No HP</Label>
            <Input id="noHP" name="noHP" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="waktuPermintaanSampai">Permintaan Pesanan Sampai</Label>
            <Input id="waktuPermintaanSampai" name="waktuPermintaanSampai" type="datetime-local" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qtyKantong">Qty Permintaan (kantong)</Label>
            <Input id="qtyKantong" name="qtyKantong" type="number" min={0} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Permintaan Harga</Label>
            <Select value={priceLevel} onValueChange={(v) => setPriceLevel(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pilih harga">
                  {(v: string) => {
                    const p = priceLevels.find((pl) => String(pl.Level) === v);
                    return p ? `Harga ${formatRupiah(p.Price)}` : "Pilih harga";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {priceLevels.map((p) => (
                  <SelectItem key={p.Level} value={String(p.Level)}>
                    Harga {formatRupiah(p.Price)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="alamat">Alamat</Label>
            <Input id="alamat" name="alamat" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Wilayah</Label>
            <WilayahSelect value={wilayah} onChange={handleWilayahChange} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Kecamatan</Label>
            <KecamatanSelect regencyCode={regencyCode} value={kecamatan} onChange={setKecamatan} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>Lokasi GPS</Label>
            <MitraLocationField value={location} onChange={setLocation} onGeocode={handleGeocode} />
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="submit" disabled={pending} className="ml-auto">
              {pending ? "Mengirim..." : "Kirim Pengajuan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/pengajuan-form-dialog.tsx
git commit -m "Add PengajuanFormDialog — reuses existing Wilayah/Kecamatan/GPS fields"
```

---

## Task 7: `PengajuanList` component (with Setujui/Tolak)

**Files:**
- Create: `src/components/dashboard/pengajuan-list.tsx`

**Interfaces:**
- Consumes: `type PengajuanRow` from `@/lib/queries/mitra-pengajuan` (Task 2); `approvePengajuanAction`, `rejectPengajuanAction` from `@/app/(dashboard)/pemasaran/actions` (Task 5); `formatDate`, `formatTime` from `@/lib/format` (existing, accept `string | Date`); `Textarea` from `@/components/ui/textarea` (already present in repo).
- Produces (used by Task 9): `export function PengajuanList({ rows, canApprove }: { rows: PengajuanRow[]; canApprove: boolean })`

- [ ] **Step 1: Write the file**

```tsx
"use client";

import { useState, useTransition } from "react";
import { MapPin, Phone, Calendar, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PengajuanRow } from "@/lib/queries/mitra-pengajuan";
import { approvePengajuanAction, rejectPengajuanAction } from "@/app/(dashboard)/pemasaran/actions";

const STATUS_BADGE: Record<PengajuanRow["Status"], string> = {
  Menunggu: "bg-warning/15 text-warning",
  Disetujui: "bg-primary/15 text-primary",
  Ditolak: "bg-destructive/15 text-destructive",
};

function RejectDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (catatan: string | null) => void;
  pending: boolean;
}) {
  const [catatan, setCatatan] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) setCatatan("");
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tolak Pengajuan</DialogTitle>
          <DialogDescription>Catatan alasan penolakan bersifat opsional.</DialogDescription>
        </DialogHeader>
        <Textarea placeholder="Catatan (opsional)" value={catatan} onChange={(e) => setCatatan(e.target.value)} />
        <DialogFooter>
          <Button variant="destructive" disabled={pending} onClick={() => onConfirm(catatan || null)}>
            {pending ? "Memproses..." : "Tolak Pengajuan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PengajuanList({ rows, canApprove }: { rows: PengajuanRow[]; canApprove: boolean }) {
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState<PengajuanRow | null>(null);

  function handleApprove(row: PengajuanRow) {
    if (!confirm(`Setujui pengajuan "${row.NamaCalon}"? Mitra baru akan otomatis dibuat.`)) return;
    startTransition(async () => {
      await approvePengajuanAction(row.PengajuanID);
    });
  }

  function handleReject(catatan: string | null) {
    if (!rejecting) return;
    const id = rejecting.PengajuanID;
    startTransition(async () => {
      await rejectPengajuanAction(id, catatan);
      setRejecting(null);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3">
        {rows.map((row) => (
          <Card key={row.PengajuanID} className="py-3.5">
            <CardContent className="flex flex-col gap-2 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.NamaCalon}</p>
                  <p className="text-xs text-muted-foreground">
                    Marketing: <span className="text-foreground">{row.MarketingNama}</span>
                  </p>
                </div>
                <span className={cn("shrink-0 rounded px-2 py-0.5 text-[11px] font-medium", STATUS_BADGE[row.Status])}>
                  {row.Status}
                </span>
              </div>

              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3" /> {row.NoHP || "-"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3" />
                  {row.Wilayah || "-"}
                  {row.Kecamatan ? ` | ${row.Kecamatan}` : ""}
                </span>
                {row.Alamat && <span className="truncate pl-[18px]">{row.Alamat}</span>}
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="size-3" />
                  Diminta sampai{" "}
                  {row.WaktuPermintaanSampai
                    ? `${formatDate(row.WaktuPermintaanSampai)} ${formatTime(row.WaktuPermintaanSampai)}`
                    : "-"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Package className="size-3" />
                  {row.QtyKantong ? `${row.QtyKantong.toLocaleString("id-ID")} kantong` : "Belum ada minat pesan"}
                </span>
              </div>

              <p className="border-t pt-2 text-[11px] text-muted-foreground">
                Input {formatDate(row.CreatedAt)} {formatTime(row.CreatedAt)}
              </p>

              {row.Status === "Ditolak" && row.CatatanTolak && (
                <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{row.CatatanTolak}</p>
              )}

              {canApprove && row.Status === "Menunggu" && (
                <div className="flex gap-2 border-t pt-2">
                  <Button size="sm" className="flex-1" disabled={pending} onClick={() => handleApprove(row)}>
                    Setujui
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={pending}
                    onClick={() => setRejecting(row)}
                  >
                    Tolak
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {rows.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Belum ada pengajuan.</p>
        )}
      </div>

      {rejecting && (
        <RejectDialog
          open={!!rejecting}
          onOpenChange={(open) => !open && setRejecting(null)}
          onConfirm={handleReject}
          pending={pending}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/pengajuan-list.tsx
git commit -m "Add PengajuanList with role-gated Setujui/Tolak actions"
```

---

## Task 8: `MarketingKPIPanel` component

**Files:**
- Create: `src/components/dashboard/marketing-kpi-panel.tsx`

**Interfaces:**
- Consumes: `type MarketingKPIRow` from `@/lib/queries/mitra-pengajuan` (Task 2).
- Produces (used by Task 9): `export function MarketingKPIPanel({ rows }: { rows: MarketingKPIRow[] })`

- [ ] **Step 1: Write the file**

```tsx
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MarketingKPIRow } from "@/lib/queries/mitra-pengajuan";

const TARGET_KUNJUNGAN_BULANAN = 300;
const TARGET_KONVERSI_PERSEN = 75;

function ProgressBar({
  label,
  valueLabel,
  pct,
  achieved,
}: {
  label: string;
  valueLabel: string;
  pct: number;
  achieved: boolean;
}) {
  const width = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{valueLabel}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", achieved ? "bg-primary" : "bg-warning")}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

export function MarketingKPIPanel({ rows }: { rows: MarketingKPIRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Pencapaian Marketing &mdash; Bulan Berjalan</CardTitle>
        <CardDescription>
          Target {TARGET_KUNJUNGAN_BULANAN} kunjungan outlet baru/bulan (10/hari/orang),{" "}
          {TARGET_KONVERSI_PERSEN}% konversi jadi pemesanan.
        </CardDescription>
      </CardHeader>
      <CardContent className="@container flex flex-col gap-4">
        {rows.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">Belum ada data marketing.</p>
        )}
        {rows.map((r) => {
          const kunjunganPct = (r.Kunjungan / TARGET_KUNJUNGAN_BULANAN) * 100;
          const konversiPct = r.Kunjungan > 0 ? (r.Konversi / r.Kunjungan) * 100 : 0;
          return (
            <div key={r.UserID} className="flex flex-col gap-2 border-b pb-4 last:border-b-0 last:pb-0">
              <p className="text-sm font-medium">{r.Nama}</p>
              <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
                <ProgressBar
                  label="Jumlah Kunjungan"
                  valueLabel={`${r.Kunjungan.toLocaleString("id-ID")} / ${TARGET_KUNJUNGAN_BULANAN}`}
                  pct={kunjunganPct}
                  achieved={kunjunganPct >= 100}
                />
                <ProgressBar
                  label="Konversi Transaksi"
                  valueLabel={`${konversiPct.toFixed(0)}% / ${TARGET_KONVERSI_PERSEN}%`}
                  pct={konversiPct}
                  achieved={konversiPct >= TARGET_KONVERSI_PERSEN}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/marketing-kpi-panel.tsx
git commit -m "Add MarketingKPIPanel with Jumlah Kunjungan / Konversi Transaksi progress bars"
```

---

## Task 9: Page assembly

**Files:**
- Create: `src/components/dashboard/pemasaran-section.tsx`
- Create: `src/app/(dashboard)/pemasaran/page.tsx`

**Interfaces:**
- Consumes: everything produced by Tasks 2, 3, 5, 6, 7, 8; `requireModuleAccess` from `@/lib/require-access` (existing, `requireModuleAccess(moduleKey: ModuleKey)` returns the NextAuth session); `getPriceLevelOptions` from `@/lib/queries/mitra` (existing).
- Produces: the `/pemasaran` route.

- [ ] **Step 1: Write the client wrapper (button + form dialog + list)**

`src/components/dashboard/pemasaran-section.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PengajuanFormDialog } from "@/components/dashboard/pengajuan-form-dialog";
import { PengajuanList } from "@/components/dashboard/pengajuan-list";
import { createPengajuanAction } from "@/app/(dashboard)/pemasaran/actions";
import type { PengajuanRow, PengajuanInput } from "@/lib/queries/mitra-pengajuan";
import type { PriceLevelOption } from "@/lib/queries/mitra";

export function PemasaranSection({
  rows,
  priceLevels,
  canApprove,
}: {
  rows: PengajuanRow[];
  priceLevels: PriceLevelOption[];
  canApprove: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleCreate(input: PengajuanInput) {
    startTransition(async () => {
      await createPengajuanAction(input);
      setCreating(false);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-sm font-semibold text-muted-foreground">Daftar Pengajuan Mitra</h2>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          Pengajuan Baru
        </Button>
      </div>

      <PengajuanList rows={rows} canApprove={canApprove} />

      <PengajuanFormDialog
        open={creating}
        onOpenChange={setCreating}
        priceLevels={priceLevels}
        onSubmit={handleCreate}
        pending={pending}
      />
    </div>
  );
}
```

- [ ] **Step 2: Write the page**

`src/app/(dashboard)/pemasaran/page.tsx`:

```tsx
import { requireModuleAccess } from "@/lib/require-access";
import { getPengajuanList, getMarketingKPI, APPROVER_ROLE_IDS } from "@/lib/queries/mitra-pengajuan";
import { getPriceLevelOptions } from "@/lib/queries/mitra";
import { MarketingKPIPanel } from "@/components/dashboard/marketing-kpi-panel";
import { PemasaranSection } from "@/components/dashboard/pemasaran-section";

export default async function PemasaranPage() {
  const session = await requireModuleAccess("pemasaran");
  const [rows, kpiRows, priceLevels] = await Promise.all([
    getPengajuanList(),
    getMarketingKPI(),
    getPriceLevelOptions(),
  ]);

  const canApprove = session.user.isSuperAdmin || APPROVER_ROLE_IDS.includes(session.user.roleId);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Pemasaran</h1>

      <MarketingKPIPanel rows={kpiRows} />

      <PemasaranSection rows={rows} priceLevels={priceLevels} canApprove={canApprove} />
    </div>
  );
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/pemasaran-section.tsx "src/app/(dashboard)/pemasaran/page.tsx"
git commit -m "Wire up /pemasaran page: KPI panel + pengajuan list + submit form"
```

---

## Task 10: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 2: Full lint**

Run: `npm run lint`
Expected: no errors, no warnings.

- [ ] **Step 3: Production build (catches SSR/route issues across the whole app)**

Run: `npm run build`
Expected: `✓ Compiled successfully`, and the route table printed at the end includes `ƒ /pemasaran`.

- [ ] **Step 4: Confirm the "Marketing" role now has a permission row it can be granted**

With the project's SQL MCP tool, run:

```sql
SELECT ModuleKey, CanView, CanEdit FROM DashboardRolePermission WHERE RoleID = 1003 AND ModuleKey = 'pemasaran'
```

Expected: 0 rows (nobody has explicitly granted `pemasaran` to role 1003 yet — that's expected, it's an admin action via Akun &gt; Peran, not part of this plan). This step is just confirming the query runs without error, proving `pemasaran` is now a recognized `ModuleKey` the Peran editor can save against.

- [ ] **Step 5: Manual browser checklist (requires logging in — do this yourself, the agent does not enter passwords)**

1. Log in as Super Admin. Go to Akun &gt; Peran, open the "Marketing" role, grant `Pemasaran` view+edit, save.
2. Go to `/pemasaran`. Confirm the KPI panel renders (likely all zeros/empty if no pengajuan exist yet) and "Daftar Pengajuan Mitra" shows "Belum ada pengajuan."
3. Click "Pengajuan Baru". Fill the form (Nama, No HP, Waktu Permintaan Sampai, pilih Wilayah/Kecamatan, geser pin di peta). Submit.
4. Confirm the new pengajuan appears in the list with status "Menunggu", correct Nama Marketing (your own name), and correct "Input" timestamp.
5. Confirm the KPI panel's "Jumlah Kunjungan" bar for your name increased by 1.
6. If your logged-in role is Super Admin/Supervisor/Accounting: click "Setujui" on the pengajuan, confirm it. Confirm status changes to "Disetujui", then open the Mitra module and confirm a new Mitra was created with the same name/address/location.
7. Log in as a plain "Marketing" role user (not Supervisor/Accounting/Super Admin) and confirm the Setujui/Tolak buttons do **not** appear on any pengajuan card.

- [ ] **Step 6: Report results**

Summarize what passed and what (if anything) needs follow-up before considering the module done.
