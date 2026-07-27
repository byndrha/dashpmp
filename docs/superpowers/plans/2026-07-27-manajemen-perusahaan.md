# Manajemen Perusahaan (PT) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Superadmin a registry page (`/perusahaan`) to add/edit/remove PT entries (name, business type, wilayah, pabrik coordinates, DB credentials, status), and make the sidebar's PT Switcher read from this table instead of its current hardcoded arrays.

**Architecture:** One new table (`DashboardPerusahaan`) in the existing `MKEsindo` database acting as a control-plane registry — not live multi-tenant DB switching. A new query layer (`src/lib/queries/perusahaan.ts`) + server actions (`src/app/(dashboard)/perusahaan/actions.ts`) + a page and two client components follow the exact CRUD pattern already established by `src/components/dashboard/akun-list.tsx` and `src/lib/queries/armada.ts`. `src/components/dashboard/pt-switcher.tsx` is rewritten to accept the registry data as a prop instead of hardcoding it, fetched once in `src/app/(dashboard)/layout.tsx`.

**Tech Stack:** Next.js 16 App Router, Server Actions, raw parameterized `mssql` queries via `@/lib/db`, Node `crypto` (AES-256-GCM) for credential encryption.

## Global Constraints

- Direct-to-`main` workflow, no feature branch — matches every prior plan executed in this session (explicit prior user consent for this working style).
- Push only on explicit user request — commit locally after each task, do not push until asked.
- This project has **no automated test runner** (verified: `package.json` has no `test` script; no `jest`/`vitest`/`pytest` anywhere in the repo). Every prior plan in this codebase's own `.superpowers/sdd/progress.md` ledger was verified with `npx tsc --noEmit` + `npx eslint <files>` (always both, always zero errors) plus live-browser checks for user-facing behavior. This plan follows that same convention instead of the pytest-style TDD template — wherever a step would normally be "write a failing test", it is instead a one-off `npx tsx` verification script (mirroring `scripts/gen-invoice-link.ts`, used twice already this session): write it, run it, confirm the printed result, delete the script file (never commit throwaway scripts).
- All new DB-facing code uses parameterized queries (`.input(name, sql.Type, value)`) — never string-interpolate user input into SQL, matching every existing query file in `src/lib/queries/`.
- Query `Row` types mirror DB columns in PascalCase (e.g. `ArmadaRow`); `Input` types (used for create/update) use camelCase field names — this is the established split convention, seen exactly in `src/lib/queries/armada.ts`'s `ArmadaRow` vs `ArmadaInput`. (The approved design spec used PascalCase for both; this plan follows the codebase's actual dominant convention instead, which is a naming-only refinement, not a behavior change.)
- Soft delete via `IsDeleted BIT`, never a hard `DELETE FROM`, matching every other dashboard-only table in this codebase (`DashboardArmada`, `DashboardMitraPengajuan`, etc.).
- Superadmin-only pages/actions bypass the `ModuleKey`/`PermissionMap` system entirely via `requireSuperAdmin()` — do **not** add `"perusahaan"` to `MODULE_KEYS` in `src/lib/permissions.ts` (confirmed: `"akun"` itself is not in that list either, same precedent).

---

### Task 0: Database schema (controller-run, not delegated)

**Files:** none (DDL run directly against the live `MKEsindo` database, not part of a code commit)

- [ ] **Step 1: Run this DDL**

```sql
CREATE TABLE DashboardPerusahaan (
  PerusahaanID INT IDENTITY PRIMARY KEY,
  Nama VARCHAR(128) NOT NULL,
  JenisBisnis VARCHAR(128) NULL,
  Wilayah VARCHAR(128) NULL,
  PabrikLatitude DECIMAL(10,7) NULL,
  PabrikLongitude DECIMAL(10,7) NULL,
  PabrikAlamat VARCHAR(512) NULL,
  Status VARCHAR(20) NOT NULL DEFAULT 'Draft',
  StandaloneUrl VARCHAR(512) NULL,
  DbServer VARCHAR(256) NULL,
  DbPort INT NULL,
  DbName VARCHAR(128) NULL,
  DbUser VARCHAR(128) NULL,
  DbPasswordEncrypted VARCHAR(512) NULL,
  Catatan VARCHAR(1024) NULL,
  CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
  UpdatedAt DATETIME NOT NULL DEFAULT GETDATE(),
  IsDeleted BIT NOT NULL DEFAULT 0
);
```

- [ ] **Step 2: Seed the two PTs already in production use, verified live**

`DashboardPabrikLocation`'s current row was confirmed live as `Latitude = -7.8462825, Longitude = 111.4759937, Alamat = NULL` — copy those exact values here (this is a display-only copy; `DashboardPabrikLocation` remains the actual source of truth the rest of the app reads from, per the design spec's explicit out-of-scope note).

```sql
INSERT INTO DashboardPerusahaan (Nama, JenisBisnis, Wilayah, PabrikLatitude, PabrikLongitude, PabrikAlamat, Status, StandaloneUrl)
VALUES
  ('PT Mitra Kelola Esindo', 'Es Kristal', 'Ponorogo', -7.8462825, 111.4759937, NULL, 'AktifPenuh', NULL),
  ('PT Prima Maesa Putra', 'Es Balok', 'Ponorogo', NULL, NULL, NULL, 'StandaloneHTML', '/static/prima-maesa-putra');
```

- [ ] **Step 3: Verify**

Run:
```sql
SELECT PerusahaanID, Nama, Status, StandaloneUrl FROM DashboardPerusahaan ORDER BY PerusahaanID;
```
Expected: 2 rows — `PT Mitra Kelola Esindo` / `AktifPenuh` / `NULL`, and `PT Prima Maesa Putra` / `StandaloneHTML` / `/static/prima-maesa-putra`.

Also confirm the table shape via `INFORMATION_SCHEMA.COLUMNS` (or the SQL tool's table-info equivalent): 17 columns, `PerusahaanID` is the primary key, `Nama`/`Status`/`CreatedAt`/`UpdatedAt`/`IsDeleted` are `NOT NULL`, everything else nullable.

---

### Task 1: `src/lib/crypto-secret.ts` — credential encryption

**Files:**
- Create: `src/lib/crypto-secret.ts`

**Interfaces:**
- Produces: `encryptSecret(plaintext: string): string`, `decryptSecret(ciphertext: string): string` — used by Task 2.

- [ ] **Step 1: Write the file**

```ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Derived from AUTH_SECRET (already required for NextAuth) with a
// purpose-specific prefix, independent from src/lib/crypto-token.ts's own
// derived keys (invoice/payment public links) — a leaked value from one
// purpose can't be used to derive another.
function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured — cannot encrypt/decrypt stored secrets");
  return createHash("sha256").update(`perusahaan-db-credential:${secret}`).digest();
}

// Random IV per call, unlike crypto-token.ts's deterministic IV — a stored
// secret has no "same link every time" requirement, and determinism here
// would only leak which stored passwords happen to be identical.
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
}

export function decryptSecret(ciphertext: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertext, "base64url");
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
```

- [ ] **Step 2: Verify with a one-off script**

Create `scripts/verify-crypto-secret.ts`:
```ts
import "dotenv/config";
import { encryptSecret, decryptSecret } from "../src/lib/crypto-secret";

const plaintext = "S3cretP@ssw0rd!";
const ciphertext1 = encryptSecret(plaintext);
const ciphertext2 = encryptSecret(plaintext);
const decrypted = decryptSecret(ciphertext1);

console.log("ciphertext1 !== ciphertext2 (random IV):", ciphertext1 !== ciphertext2);
console.log("decrypted === plaintext:", decrypted === plaintext);
if (ciphertext1 === ciphertext2 || decrypted !== plaintext) {
  console.error("FAIL");
  process.exit(1);
}
console.log("PASS");
```

Run: `npx tsx scripts/verify-crypto-secret.ts`
Expected output:
```
ciphertext1 !== ciphertext2 (random IV): true
decrypted === plaintext: true
PASS
```

Then delete the script: it was only for this one-time verification, not a permanent test suite (this codebase has none).

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` — expect no errors.
Run: `npx eslint src/lib/crypto-secret.ts` — expect no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/crypto-secret.ts
git commit -m "Add encryptSecret/decryptSecret for at-rest credential storage"
```

---

### Task 2: `src/lib/queries/perusahaan.ts` — query layer

**Files:**
- Create: `src/lib/queries/perusahaan.ts`

**Interfaces:**
- Consumes: `encryptSecret`/`decryptSecret` from Task 1 (`@/lib/crypto-secret`).
- Produces: `PerusahaanStatus`, `PerusahaanRow`, `PerusahaanInput`, `PerusahaanSwitcherEntry`, `listPerusahaan()`, `createPerusahaan(input)`, `updatePerusahaan(id, input)`, `softDeletePerusahaan(id)`, `listPerusahaanForSwitcher()` — used by Task 3 (actions) and Task 7 (switcher wiring).

- [ ] **Step 1: Write the file**

```ts
import { getPool, sql } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto-secret";

export const PERUSAHAAN_STATUSES = ["Draft", "StandaloneHTML", "AktifPenuh"] as const;
export type PerusahaanStatus = (typeof PERUSAHAAN_STATUSES)[number];

export interface PerusahaanRow {
  PerusahaanID: number;
  Nama: string;
  JenisBisnis: string | null;
  Wilayah: string | null;
  PabrikLatitude: number | null;
  PabrikLongitude: number | null;
  PabrikAlamat: string | null;
  Status: PerusahaanStatus;
  StandaloneUrl: string | null;
  DbServer: string | null;
  DbPort: number | null;
  DbName: string | null;
  DbUser: string | null;
  HasDbPassword: boolean;
  Catatan: string | null;
}

export interface PerusahaanInput {
  nama: string;
  jenisBisnis: string | null;
  wilayah: string | null;
  pabrikLatitude: number | null;
  pabrikLongitude: number | null;
  pabrikAlamat: string | null;
  status: PerusahaanStatus;
  standaloneUrl: string | null;
  dbServer: string | null;
  dbPort: number | null;
  dbName: string | null;
  dbUser: string | null;
  // On create: used as-is (blank means no password set). On update: blank
  // means "keep the existing stored credential" — only a non-blank value
  // triggers re-encryption and overwrite.
  dbPassword: string | null;
  catatan: string | null;
}

export interface PerusahaanSwitcherEntry {
  PerusahaanID: number;
  Nama: string;
  Status: PerusahaanStatus;
  StandaloneUrl: string | null;
}

export async function listPerusahaan(): Promise<PerusahaanRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT PerusahaanID, Nama, JenisBisnis, Wilayah, PabrikLatitude, PabrikLongitude, PabrikAlamat,
           Status, StandaloneUrl, DbServer, DbPort, DbName, DbUser,
           CASE WHEN DbPasswordEncrypted IS NULL THEN 0 ELSE 1 END AS HasDbPassword,
           Catatan
    FROM DashboardPerusahaan
    WHERE IsDeleted = 0
    ORDER BY Nama
  `);
  return (result.recordset as (Omit<PerusahaanRow, "HasDbPassword"> & { HasDbPassword: number })[]).map((r) => ({
    ...r,
    HasDbPassword: r.HasDbPassword === 1,
  }));
}

export async function listPerusahaanForSwitcher(): Promise<PerusahaanSwitcherEntry[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT PerusahaanID, Nama, Status, StandaloneUrl
    FROM DashboardPerusahaan
    WHERE IsDeleted = 0 AND Status <> 'Draft'
    ORDER BY Status DESC, Nama
  `);
  return result.recordset;
}

export async function createPerusahaan(input: PerusahaanInput): Promise<number> {
  const pool = await getPool();
  const encryptedPassword = input.dbPassword ? encryptSecret(input.dbPassword) : null;
  const result = await pool
    .request()
    .input("nama", sql.VarChar(128), input.nama)
    .input("jenisBisnis", sql.VarChar(128), input.jenisBisnis)
    .input("wilayah", sql.VarChar(128), input.wilayah)
    .input("pabrikLatitude", sql.Decimal(10, 7), input.pabrikLatitude)
    .input("pabrikLongitude", sql.Decimal(10, 7), input.pabrikLongitude)
    .input("pabrikAlamat", sql.VarChar(512), input.pabrikAlamat)
    .input("status", sql.VarChar(20), input.status)
    .input("standaloneUrl", sql.VarChar(512), input.standaloneUrl)
    .input("dbServer", sql.VarChar(256), input.dbServer)
    .input("dbPort", sql.Int, input.dbPort)
    .input("dbName", sql.VarChar(128), input.dbName)
    .input("dbUser", sql.VarChar(128), input.dbUser)
    .input("dbPasswordEncrypted", sql.VarChar(512), encryptedPassword)
    .input("catatan", sql.VarChar(1024), input.catatan).query(`
      INSERT INTO DashboardPerusahaan
        (Nama, JenisBisnis, Wilayah, PabrikLatitude, PabrikLongitude, PabrikAlamat, Status, StandaloneUrl,
         DbServer, DbPort, DbName, DbUser, DbPasswordEncrypted, Catatan, IsDeleted, CreatedAt, UpdatedAt)
      OUTPUT inserted.PerusahaanID
      VALUES
        (@nama, @jenisBisnis, @wilayah, @pabrikLatitude, @pabrikLongitude, @pabrikAlamat, @status, @standaloneUrl,
         @dbServer, @dbPort, @dbName, @dbUser, @dbPasswordEncrypted, @catatan, 0, GETDATE(), GETDATE())
    `);
  return (result.recordset[0] as { PerusahaanID: number }).PerusahaanID;
}

export async function updatePerusahaan(id: number, input: PerusahaanInput): Promise<void> {
  const pool = await getPool();
  const request = pool
    .request()
    .input("id", sql.Int, id)
    .input("nama", sql.VarChar(128), input.nama)
    .input("jenisBisnis", sql.VarChar(128), input.jenisBisnis)
    .input("wilayah", sql.VarChar(128), input.wilayah)
    .input("pabrikLatitude", sql.Decimal(10, 7), input.pabrikLatitude)
    .input("pabrikLongitude", sql.Decimal(10, 7), input.pabrikLongitude)
    .input("pabrikAlamat", sql.VarChar(512), input.pabrikAlamat)
    .input("status", sql.VarChar(20), input.status)
    .input("standaloneUrl", sql.VarChar(512), input.standaloneUrl)
    .input("dbServer", sql.VarChar(256), input.dbServer)
    .input("dbPort", sql.Int, input.dbPort)
    .input("dbName", sql.VarChar(128), input.dbName)
    .input("dbUser", sql.VarChar(128), input.dbUser)
    .input("catatan", sql.VarChar(1024), input.catatan);

  // Blank dbPassword means "keep existing" — the UPDATE statement itself
  // omits DbPasswordEncrypted in that case, so the stored value is
  // untouched. Two separate query strings (not a runtime-built one) keeps
  // this parameterized and readable.
  if (input.dbPassword) {
    await request.input("dbPasswordEncrypted", sql.VarChar(512), encryptSecret(input.dbPassword)).query(`
      UPDATE DashboardPerusahaan SET
        Nama = @nama, JenisBisnis = @jenisBisnis, Wilayah = @wilayah,
        PabrikLatitude = @pabrikLatitude, PabrikLongitude = @pabrikLongitude, PabrikAlamat = @pabrikAlamat,
        Status = @status, StandaloneUrl = @standaloneUrl,
        DbServer = @dbServer, DbPort = @dbPort, DbName = @dbName, DbUser = @dbUser,
        DbPasswordEncrypted = @dbPasswordEncrypted, Catatan = @catatan, UpdatedAt = GETDATE()
      WHERE PerusahaanID = @id
    `);
  } else {
    await request.query(`
      UPDATE DashboardPerusahaan SET
        Nama = @nama, JenisBisnis = @jenisBisnis, Wilayah = @wilayah,
        PabrikLatitude = @pabrikLatitude, PabrikLongitude = @pabrikLongitude, PabrikAlamat = @pabrikAlamat,
        Status = @status, StandaloneUrl = @standaloneUrl,
        DbServer = @dbServer, DbPort = @dbPort, DbName = @dbName, DbUser = @dbUser,
        Catatan = @catatan, UpdatedAt = GETDATE()
      WHERE PerusahaanID = @id
    `);
  }
}

export async function softDeletePerusahaan(id: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .query(`UPDATE DashboardPerusahaan SET IsDeleted = 1, UpdatedAt = GETDATE() WHERE PerusahaanID = @id`);
}
```

- [ ] **Step 2: Verify with a one-off script against the live database**

Create `scripts/verify-perusahaan.ts`:
```ts
import "dotenv/config";
import {
  listPerusahaan,
  createPerusahaan,
  updatePerusahaan,
  softDeletePerusahaan,
  listPerusahaanForSwitcher,
} from "../src/lib/queries/perusahaan";

async function main() {
  const before = await listPerusahaan();
  console.log("Before:", before.length, "rows — expect 2 (seeded MKEsindo + Prima Maesa Putra)");

  const id = await createPerusahaan({
    nama: "PT Verify Test",
    jenisBisnis: "Test",
    wilayah: "Test",
    pabrikLatitude: null,
    pabrikLongitude: null,
    pabrikAlamat: null,
    status: "Draft",
    standaloneUrl: null,
    dbServer: "1.2.3.4",
    dbPort: 1433,
    dbName: "TestDB",
    dbUser: "sa",
    dbPassword: "hunter2",
    catatan: null,
  });
  console.log("Created PerusahaanID:", id);

  const afterCreate = await listPerusahaan();
  const created = afterCreate.find((r) => r.PerusahaanID === id);
  console.log("HasDbPassword after create:", created?.HasDbPassword, "— expect true");

  const switcherList = await listPerusahaanForSwitcher();
  console.log(
    "Draft row excluded from switcher list:",
    !switcherList.some((r) => r.PerusahaanID === id),
    "— expect true"
  );

  await updatePerusahaan(id, {
    nama: "PT Verify Test Updated",
    jenisBisnis: "Test",
    wilayah: "Test",
    pabrikLatitude: null,
    pabrikLongitude: null,
    pabrikAlamat: null,
    status: "StandaloneHTML",
    standaloneUrl: "/static/test",
    dbServer: "1.2.3.4",
    dbPort: 1433,
    dbName: "TestDB",
    dbUser: "sa",
    dbPassword: null, // blank — must keep existing password
    catatan: null,
  });
  const afterUpdate = await listPerusahaan();
  const updated = afterUpdate.find((r) => r.PerusahaanID === id);
  console.log("Name updated:", updated?.Nama === "PT Verify Test Updated");
  console.log("Password preserved after blank-password update:", updated?.HasDbPassword === true);

  await softDeletePerusahaan(id);
  const afterDelete = await listPerusahaan();
  console.log("Row gone after soft delete:", !afterDelete.some((r) => r.PerusahaanID === id), "— expect true");

  if (before.length !== 2 || !created || created.HasDbPassword !== true || switcherList.some((r) => r.PerusahaanID === id)) {
    console.error("FAIL");
    process.exit(1);
  }
  console.log("PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx scripts/verify-perusahaan.ts`
Expected output ends with `PASS`, and every intermediate boolean line reads `true`.

Then delete the script.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` — expect no errors.
Run: `npx eslint src/lib/queries/perusahaan.ts` — expect no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/perusahaan.ts
git commit -m "Add perusahaan.ts query layer for PT registry CRUD"
```

---

### Task 3: `src/app/(dashboard)/perusahaan/actions.ts` — server actions

**Files:**
- Create: `src/app/(dashboard)/perusahaan/actions.ts`

**Interfaces:**
- Consumes: everything from Task 2 (`@/lib/queries/perusahaan`), `requireSuperAdmin` from `@/lib/require-access`.
- Produces: `createPerusahaanAction(input)`, `updatePerusahaanAction(id, input)`, `deletePerusahaanAction(id)` — used by Task 5 (`PerusahaanList`)/Task 4 (`PerusahaanFormDialog`).

- [ ] **Step 1: Write the file**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/require-access";
import { createPerusahaan, updatePerusahaan, softDeletePerusahaan, type PerusahaanInput } from "@/lib/queries/perusahaan";

function assertValid(input: PerusahaanInput) {
  if (!input.nama.trim()) throw new Error("Nama PT wajib diisi.");
  if (input.status === "StandaloneHTML" && !input.standaloneUrl?.trim()) {
    throw new Error("URL Standalone wajib diisi untuk status Standalone HTML.");
  }
}

export async function createPerusahaanAction(input: PerusahaanInput): Promise<void> {
  await requireSuperAdmin();
  assertValid(input);
  await createPerusahaan(input);
  revalidatePath("/perusahaan");
}

export async function updatePerusahaanAction(id: number, input: PerusahaanInput): Promise<void> {
  await requireSuperAdmin();
  assertValid(input);
  await updatePerusahaan(id, input);
  revalidatePath("/perusahaan");
}

export async function deletePerusahaanAction(id: number): Promise<void> {
  await requireSuperAdmin();
  await softDeletePerusahaan(id);
  revalidatePath("/perusahaan");
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit` — expect no errors.
Run: `npx eslint "src/app/(dashboard)/perusahaan/actions.ts"` — expect no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/perusahaan/actions.ts"
git commit -m "Add Perusahaan server actions (create/update/delete, Superadmin-gated)"
```

---

### Task 4: `src/components/dashboard/perusahaan-form-dialog.tsx` — create/edit dialog

**Files:**
- Create: `src/components/dashboard/perusahaan-form-dialog.tsx`

**Interfaces:**
- Consumes: `PerusahaanRow`, `PerusahaanInput`, `PERUSAHAAN_STATUSES`, `PerusahaanStatus` from `@/lib/queries/perusahaan` (Task 2); `MitraLocationField`, `MitraLocationValue` from `@/components/dashboard/mitra-location-field` (already exists).
- Produces: `PerusahaanFormDialog({ target, onOpenChange, onSubmit, pending, error })` component — used by Task 5.

- [ ] **Step 1: Write the file**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { MitraLocationField, type MitraLocationValue } from "@/components/dashboard/mitra-location-field";
import { PERUSAHAAN_STATUSES, type PerusahaanRow, type PerusahaanInput, type PerusahaanStatus } from "@/lib/queries/perusahaan";

const STATUS_LABEL: Record<PerusahaanStatus, string> = {
  Draft: "Draft",
  StandaloneHTML: "Standalone HTML",
  AktifPenuh: "Aktif Penuh",
};

function emptyForm(): PerusahaanInput {
  return {
    nama: "",
    jenisBisnis: null,
    wilayah: null,
    pabrikLatitude: null,
    pabrikLongitude: null,
    pabrikAlamat: null,
    status: "Draft",
    standaloneUrl: null,
    dbServer: null,
    dbPort: null,
    dbName: null,
    dbUser: null,
    dbPassword: null,
    catatan: null,
  };
}

function rowToForm(row: PerusahaanRow): PerusahaanInput {
  return {
    nama: row.Nama,
    jenisBisnis: row.JenisBisnis,
    wilayah: row.Wilayah,
    pabrikLatitude: row.PabrikLatitude,
    pabrikLongitude: row.PabrikLongitude,
    pabrikAlamat: row.PabrikAlamat,
    status: row.Status,
    standaloneUrl: row.StandaloneUrl,
    dbServer: row.DbServer,
    dbPort: row.DbPort,
    dbName: row.DbName,
    dbUser: row.DbUser,
    dbPassword: null, // never pre-filled — write-only field
    catatan: row.Catatan,
  };
}

// `target`: "new" for the create dialog, a PerusahaanRow for edit, null to
// stay closed — matches the externally-controlled dialog pattern already
// used by UbahPemesananDialog/ArmadaManager's form dialogs in this codebase.
export function PerusahaanFormDialog({
  target,
  onOpenChange,
  onSubmit,
  pending,
  error,
}: {
  target: PerusahaanRow | "new" | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: PerusahaanInput) => void;
  pending: boolean;
  error: string | null;
}) {
  const initial = target === "new" ? emptyForm() : target ? rowToForm(target) : emptyForm();
  const [status, setStatus] = useState<PerusahaanStatus>(initial.status);
  const [location, setLocation] = useState<MitraLocationValue | null>(
    initial.pabrikLatitude != null && initial.pabrikLongitude != null
      ? { latitude: initial.pabrikLatitude, longitude: initial.pabrikLongitude, alamat: initial.pabrikAlamat }
      : null
  );

  function handleSubmit(formData: FormData) {
    onSubmit({
      nama: String(formData.get("nama") ?? ""),
      jenisBisnis: String(formData.get("jenisBisnis") ?? "") || null,
      wilayah: String(formData.get("wilayah") ?? "") || null,
      pabrikLatitude: location?.latitude ?? null,
      pabrikLongitude: location?.longitude ?? null,
      pabrikAlamat: location?.alamat ?? null,
      status,
      standaloneUrl: String(formData.get("standaloneUrl") ?? "") || null,
      dbServer: String(formData.get("dbServer") ?? "") || null,
      dbPort: formData.get("dbPort") ? Number(formData.get("dbPort")) : null,
      dbName: String(formData.get("dbName") ?? "") || null,
      dbUser: String(formData.get("dbUser") ?? "") || null,
      dbPassword: String(formData.get("dbPassword") ?? "") || null,
      catatan: String(formData.get("catatan") ?? "") || null,
    });
  }

  return (
    <Dialog
      open={target != null}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) {
          setStatus(initial.status);
          setLocation(
            initial.pabrikLatitude != null && initial.pabrikLongitude != null
              ? { latitude: initial.pabrikLatitude, longitude: initial.pabrikLongitude, alamat: initial.pabrikAlamat }
              : null
          );
        }
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{target === "new" ? "Tambah PT" : `Ubah PT — ${initial.nama}`}</DialogTitle>
          <DialogDescription>
            Data registry perusahaan — belum menghubungkan dashboard ini ke database PT lain.
          </DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nama">Nama PT</Label>
            <Input id="nama" name="nama" defaultValue={initial.nama} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jenisBisnis">Jenis Bisnis</Label>
              <Input id="jenisBisnis" name="jenisBisnis" placeholder="mis. Es Kristal" defaultValue={initial.jenisBisnis ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wilayah">Wilayah</Label>
              <Input id="wilayah" name="wilayah" placeholder="mis. Ponorogo" defaultValue={initial.wilayah ?? ""} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus((v as PerusahaanStatus) ?? "Draft")}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => STATUS_LABEL[v as PerusahaanStatus]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PERUSAHAAN_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {status === "StandaloneHTML" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="standaloneUrl">URL Standalone</Label>
              <Input
                id="standaloneUrl"
                name="standaloneUrl"
                placeholder="/static/nama-pt"
                defaultValue={initial.standaloneUrl ?? ""}
                required
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Lokasi Pabrik</Label>
            <MitraLocationField value={location} onChange={setLocation} wilayah={initial.wilayah} />
          </div>

          <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">
              Kredensial Database (opsional, untuk dashboard PT ini nanti)
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dbServer">Server / IP</Label>
                <Input id="dbServer" name="dbServer" defaultValue={initial.dbServer ?? ""} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dbPort">Port</Label>
                <Input id="dbPort" name="dbPort" type="number" defaultValue={initial.dbPort ?? ""} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dbName">Nama Database</Label>
                <Input id="dbName" name="dbName" defaultValue={initial.dbName ?? ""} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dbUser">Username</Label>
                <Input id="dbUser" name="dbUser" defaultValue={initial.dbUser ?? ""} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dbPassword">Password</Label>
              <Input
                id="dbPassword"
                name="dbPassword"
                type="password"
                placeholder={target !== "new" ? "(tidak diubah, kosongkan untuk tetap pakai yang lama)" : ""}
              />
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catatan">Catatan</Label>
            <Textarea id="catatan" name="catatan" rows={2} defaultValue={initial.catatan ?? ""} />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending} className="ml-auto">
              {pending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit` — expect no errors.
Run: `npx eslint src/components/dashboard/perusahaan-form-dialog.tsx` — expect no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/perusahaan-form-dialog.tsx
git commit -m "Add PerusahaanFormDialog for create/edit PT"
```

---

### Task 5: `src/components/dashboard/perusahaan-list.tsx` — list UI

**Files:**
- Create: `src/components/dashboard/perusahaan-list.tsx`

**Interfaces:**
- Consumes: `PerusahaanRow` from `@/lib/queries/perusahaan` (Task 2); `createPerusahaanAction`/`updatePerusahaanAction`/`deletePerusahaanAction` from `@/app/(dashboard)/perusahaan/actions` (Task 3); `PerusahaanFormDialog` from Task 4.
- Produces: `PerusahaanList({ rows })` — used by Task 6 (`page.tsx`).

- [ ] **Step 1: Write the file**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Trash2, MapPin, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PerusahaanRow, PerusahaanStatus, PerusahaanInput } from "@/lib/queries/perusahaan";
import { PerusahaanFormDialog } from "@/components/dashboard/perusahaan-form-dialog";
import {
  createPerusahaanAction,
  updatePerusahaanAction,
  deletePerusahaanAction,
} from "@/app/(dashboard)/perusahaan/actions";

const STATUS_BADGE: Record<PerusahaanStatus, string> = {
  Draft: "bg-muted text-muted-foreground",
  StandaloneHTML: "bg-warning/15 text-warning",
  AktifPenuh: "bg-primary/15 text-primary",
};

const STATUS_LABEL: Record<PerusahaanStatus, string> = {
  Draft: "Draft",
  StandaloneHTML: "Standalone HTML",
  AktifPenuh: "Aktif Penuh",
};

export function PerusahaanList({ rows }: { rows: PerusahaanRow[] }) {
  const [target, setTarget] = useState<PerusahaanRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(input: PerusahaanInput) {
    setError(null);
    startTransition(async () => {
      try {
        if (target === "new") {
          await createPerusahaanAction(input);
        } else if (target) {
          await updatePerusahaanAction(target.PerusahaanID, input);
        }
        setTarget(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan PT.");
      }
    });
  }

  function handleDelete(row: PerusahaanRow) {
    if (!confirm(`Hapus PT "${row.Nama}"? Tindakan ini tidak dapat dibatalkan.`)) return;
    startTransition(async () => {
      try {
        await deletePerusahaanAction(row.PerusahaanID);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Gagal menghapus PT.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{rows.length} PT terdaftar.</p>
        <Button
          onClick={() => {
            setError(null);
            setTarget("new");
          }}
        >
          <Plus className="size-4" />
          Tambah PT
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <Card key={r.PerusahaanID} className="py-3.5">
            <CardContent className="flex flex-col gap-2 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate font-medium">
                    <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                    {r.Nama}
                  </p>
                  <p className="text-xs text-muted-foreground">{r.JenisBisnis ?? "-"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => {
                      setError(null);
                      setTarget(r);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" disabled={pending} onClick={() => handleDelete(r)}>
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              <span className={cn("w-fit rounded px-1.5 py-0.5 text-[10px] font-medium", STATUS_BADGE[r.Status])}>
                {STATUS_LABEL[r.Status]}
              </span>

              <div className="flex flex-col gap-1 border-t pt-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3" /> {r.Wilayah ?? "-"}
                </span>
                <span>DB: {r.DbServer ? `${r.DbServer}${r.DbName ? `/${r.DbName}` : ""}` : "belum diisi"}</span>
              </div>
            </CardContent>
          </Card>
        ))}
        {rows.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Belum ada PT terdaftar.</p>
        )}
      </div>

      <PerusahaanFormDialog
        target={target}
        onOpenChange={(open) => !open && setTarget(null)}
        onSubmit={handleSubmit}
        pending={pending}
        error={error}
      />
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit` — expect no errors.
Run: `npx eslint src/components/dashboard/perusahaan-list.tsx` — expect no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/perusahaan-list.tsx
git commit -m "Add PerusahaanList page-level CRUD grid"
```

---

### Task 6: Wire the `/perusahaan` page and its sidebar link

**Files:**
- Create: `src/app/(dashboard)/perusahaan/page.tsx`
- Modify: `src/components/dashboard/app-sidebar.tsx`

**Interfaces:**
- Consumes: `listPerusahaan` from `@/lib/queries/perusahaan` (Task 2), `PerusahaanList` from Task 5, `requireSuperAdmin` from `@/lib/require-access`.

- [ ] **Step 1: Create the page**

```tsx
import { requireSuperAdmin } from "@/lib/require-access";
import { listPerusahaan } from "@/lib/queries/perusahaan";
import { PerusahaanList } from "@/components/dashboard/perusahaan-list";

export default async function PerusahaanPage() {
  await requireSuperAdmin();
  const rows = await listPerusahaan();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Perusahaan</h1>
      <p className="text-sm text-muted-foreground">
        Registry PT — hanya Super Administrator yang dapat melihat dan mengatur data ini. Menyimpan konfigurasi PT baru
        untuk pembangunan dashboard berikutnya, belum mengubah database yang sedang dipakai dashboard ini.
      </p>
      <PerusahaanList rows={rows} />
    </div>
  );
}
```

- [ ] **Step 2: Read the current sidebar file to find the exact insertion point**

Run: `grep -n "Administrasi\|ShieldCheck\|Akun" src/components/dashboard/app-sidebar.tsx`

Confirm it still matches this known shape (from the file as of this plan's writing):
```tsx
import {
  LayoutGrid,
  LineChart,
  Receipt,
  ShoppingCart,
  ArrowLeftRight,
  Zap,
  Truck,
  ClipboardList,
  Users,
  Megaphone,
  ShieldCheck,
} from "lucide-react";
...
        {isSuperAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administrasi</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link href="/akun" onClick={closeOnMobile} />}
                    isActive={pathname.startsWith("/akun")}
                    tooltip="Akun"
                  >
                    <ShieldCheck className="shrink-0" />
                    <span>Akun</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
```
If the surrounding code has changed since, adapt the edit below to the actual current structure — the goal is unchanged: add one more `SidebarMenuItem` inside the same `isSuperAdmin` Administrasi block.

- [ ] **Step 3: Add the `Building2` icon import**

Change:
```tsx
import {
  LayoutGrid,
  LineChart,
  Receipt,
  ShoppingCart,
  ArrowLeftRight,
  Zap,
  Truck,
  ClipboardList,
  Users,
  Megaphone,
  ShieldCheck,
} from "lucide-react";
```
to:
```tsx
import {
  LayoutGrid,
  LineChart,
  Receipt,
  ShoppingCart,
  ArrowLeftRight,
  Zap,
  Truck,
  ClipboardList,
  Users,
  Megaphone,
  ShieldCheck,
  Building2,
} from "lucide-react";
```

- [ ] **Step 4: Add the "Perusahaan" sidebar item**

Change:
```tsx
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link href="/akun" onClick={closeOnMobile} />}
                    isActive={pathname.startsWith("/akun")}
                    tooltip="Akun"
                  >
                    <ShieldCheck className="shrink-0" />
                    <span>Akun</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
```
to:
```tsx
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link href="/akun" onClick={closeOnMobile} />}
                    isActive={pathname.startsWith("/akun")}
                    tooltip="Akun"
                  >
                    <ShieldCheck className="shrink-0" />
                    <span>Akun</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link href="/perusahaan" onClick={closeOnMobile} />}
                    isActive={pathname.startsWith("/perusahaan")}
                    tooltip="Perusahaan"
                  >
                    <Building2 className="shrink-0" />
                    <span>Perusahaan</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
```

- [ ] **Step 5: Type-check, lint, and build**

Run: `npx tsc --noEmit` — expect no errors.
Run: `npx eslint "src/app/(dashboard)/perusahaan/page.tsx" src/components/dashboard/app-sidebar.tsx` — expect no errors.
Run: `npx next build` — expect a clean build, and confirm `/perusahaan` appears in the printed route table.

- [ ] **Step 6: Live-verify in the browser**

1. Start the dev server (`preview_start` with the project's `dev` launch config, or reuse the already-running one), navigate to `/`, confirm logged in as a Super Admin account.
2. Confirm the sidebar's "Administrasi" section now shows both "Akun" and "Perusahaan".
3. Click "Perusahaan" → lands on `/perusahaan`, shows exactly 2 cards: "PT Mitra Kelola Esindo" (badge "Aktif Penuh") and "PT Prima Maesa Putra" (badge "Standalone HTML").
4. Click "Tambah PT" → fill Nama = "PT Test Verifikasi", Jenis Bisnis = "Es Balok", Wilayah = "Madiun", Status = "Draft", leave DB credential fields blank → Simpan. Confirm a 3rd card appears with a "Draft" badge.
5. Click "Ubah" on that new card → confirm the dialog opens pre-filled with "PT Test Verifikasi" and the DB Password field is empty (not showing any value) → change Status to "Standalone HTML" → a "URL Standalone" field appears, required → fill `/static/test-verifikasi` → also fill DB Server = "10.0.0.1", DB Password = "testpass123" → Simpan. Confirm the card now shows "Standalone HTML" and `DB: 10.0.0.1`.
6. Click "Ubah" again on the same card → confirm the DB Password field is still empty (proving it isn't echoed back) → change nothing in the password field → change Wilayah to "Trenggalek" → Simpan. Confirm Wilayah updated on the card (this exercises the "blank password = keep existing" path).
7. Click the trash icon on the test card → confirm the browser `confirm()` dialog appears → confirm → card disappears.
8. Regression: navigate to `/akun` — confirm it still loads normally (untouched by this task).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/perusahaan/page.tsx" src/components/dashboard/app-sidebar.tsx
git commit -m "Add /perusahaan page and sidebar entry"
```

---

### Task 7: Make the PT Switcher data-driven

**Files:**
- Modify: `src/components/dashboard/pt-switcher.tsx`
- Modify: `src/components/dashboard/app-sidebar.tsx`
- Modify: `src/app/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: `listPerusahaanForSwitcher`, `PerusahaanSwitcherEntry` from `@/lib/queries/perusahaan` (Task 2).

- [ ] **Step 1: Rewrite `pt-switcher.tsx`**

Replace the entire file:
```tsx
"use client";

import { Check, ChevronsUpDown, Building2, ExternalLink } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PerusahaanSwitcherEntry } from "@/lib/queries/perusahaan";

// "AktifPenuh" entries are switchable in principle, but only one exists
// today (PT Mitra Kelola Esindo) and this dashboard has no live
// multi-tenant database switching yet — selecting a different AktifPenuh
// entry, once a second one exists, does nothing until that separate,
// larger project is built. "StandaloneHTML" entries behave exactly like
// the previous hardcoded STATIC_REPORTS list: open a new tab, don't change
// what this dashboard is showing. "Draft" entries are never in `list` —
// listPerusahaanForSwitcher() already excludes them.
export function PTSwitcher({ list }: { list: PerusahaanSwitcherEntry[] }) {
  const aktif = list.filter((p) => p.Status === "AktifPenuh");
  const standalone = list.filter((p) => p.Status === "StandaloneHTML");
  const active = aktif[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2 py-1.5 text-left text-xs hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center">
        <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium group-data-[collapsible=icon]:hidden">
          {active?.Nama ?? "Pilih PT"}
        </span>
        <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {aktif.map((entity) => (
          <DropdownMenuItem key={entity.PerusahaanID} className="justify-between text-xs">
            {entity.Nama}
            {entity.PerusahaanID === active?.PerusahaanID && <Check className="size-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
        {standalone.length > 0 && <DropdownMenuSeparator />}
        {standalone.map((entity) => (
          <DropdownMenuItem
            key={entity.PerusahaanID}
            className="justify-between text-xs"
            onClick={() => entity.StandaloneUrl && window.open(entity.StandaloneUrl, "_blank", "noopener,noreferrer")}
          >
            {entity.Nama}
            <ExternalLink className="size-3.5 text-muted-foreground" />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Thread the prop through `app-sidebar.tsx`**

Change the `AppSidebar` function signature:
```tsx
export function AppSidebar({
  permissions,
  isSuperAdmin,
}: {
  permissions: PermissionMap;
  isSuperAdmin: boolean;
}) {
```
to:
```tsx
export function AppSidebar({
  permissions,
  isSuperAdmin,
  perusahaanList,
}: {
  permissions: PermissionMap;
  isSuperAdmin: boolean;
  perusahaanList: PerusahaanSwitcherEntry[];
}) {
```
Add the import (alongside the other type-only imports near the top):
```tsx
import type { PerusahaanSwitcherEntry } from "@/lib/queries/perusahaan";
```
Change the render call:
```tsx
<PTSwitcher />
```
to:
```tsx
<PTSwitcher list={perusahaanList} />
```

- [ ] **Step 3: Fetch the list in `layout.tsx` and pass it down**

Change:
```tsx
import { auth } from "@/lib/auth";
import { getUserById } from "@/lib/queries/akun";
```
to:
```tsx
import { auth } from "@/lib/auth";
import { getUserById } from "@/lib/queries/akun";
import { listPerusahaanForSwitcher } from "@/lib/queries/perusahaan";
```
Change:
```tsx
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const profile = session?.user?.id ? await getUserById(Number(session.user.id)) : null;

  return (
    <SidebarProvider>
      <AppSidebar permissions={session?.user?.permissions ?? {}} isSuperAdmin={session?.user?.isSuperAdmin ?? false} />
```
to:
```tsx
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const [profile, perusahaanList] = await Promise.all([
    session?.user?.id ? getUserById(Number(session.user.id)) : Promise.resolve(null),
    listPerusahaanForSwitcher(),
  ]);

  return (
    <SidebarProvider>
      <AppSidebar
        permissions={session?.user?.permissions ?? {}}
        isSuperAdmin={session?.user?.isSuperAdmin ?? false}
        perusahaanList={perusahaanList}
      />
```

- [ ] **Step 4: Type-check, lint, and build**

Run: `npx tsc --noEmit` — expect no errors.
Run: `npx eslint src/components/dashboard/pt-switcher.tsx src/components/dashboard/app-sidebar.tsx "src/app/(dashboard)/layout.tsx"` — expect no errors.
Run: `npx next build` — expect a clean build.

- [ ] **Step 5: Live-verify in the browser**

1. Reload any dashboard page. Open the PT Switcher (the button showing "PT Mitra Kelola Esindo" near the top of the sidebar).
2. Confirm it shows "PT Mitra Kelola Esindo" with a checkmark (the only `AktifPenuh` row), a separator, then "PT Prima Maesa Putra" with an external-link icon.
3. Click "PT Prima Maesa Putra" — confirm it opens `/static/prima-maesa-putra` in a new tab, exactly like it did before this change.
4. Go to `/perusahaan`, add a new PT with Status = "Draft" and no other special fields. Reopen the PT Switcher — confirm the Draft PT does **not** appear anywhere in the list. Delete the test PT afterward.
5. Collapse the sidebar (icon-only mode) — confirm the switcher still renders without layout breakage (matches the earlier sidebar-logo fix session's scrutiny of this same collapsed-rail area).

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/pt-switcher.tsx src/components/dashboard/app-sidebar.tsx "src/app/(dashboard)/layout.tsx"
git commit -m "Make PT Switcher read from the Perusahaan registry instead of hardcoded arrays"
```

---

### Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full type-check, lint, and production build**

Run: `npx tsc --noEmit` — expect zero errors project-wide.
Run: `npx eslint .` (or the project's standard lint invocation) — expect zero errors.
Run: `npx next build` — expect a clean build; confirm `/perusahaan` is present in the printed route table and no new route accidentally became static when it should be dynamic (Superadmin-gated pages must stay server-rendered per request, matching `/akun`'s own listing in the route table).

- [ ] **Step 2: Regression spot-check in the browser**

Load `/`, `/delivery`, `/pemesanan`, `/transaksi`, `/pemasaran`, `/akun` — confirm all still render with no new console errors, and the sidebar layout (icon shape, mobile auto-close from the earlier session's fix) is unaffected.

- [ ] **Step 3: Confirm no leftover throwaway scripts**

Run: `git status --short`
Expected: no untracked files under `scripts/` (the two one-off verification scripts from Tasks 1 and 2 must already be deleted, not committed).

- [ ] **Step 4: Update the progress ledger**

Append a new section to `.superpowers/sdd/progress.md` (same format as every prior plan in this file) summarizing: all 8 tasks complete, table `DashboardPerusahaan` created and seeded, `/perusahaan` reachable from the sidebar's Administrasi section, PT Switcher now data-driven. Note explicitly (matching the design spec's own "out of scope" section) that this is a registry only — no live multi-tenant database switching exists yet.

- [ ] **Step 5: Final commit**

```bash
git add .superpowers/sdd/progress.md
git commit -m "Update progress ledger for Manajemen Perusahaan plan"
```

Do not push — per this session's established convention, push only happens on explicit user request.
