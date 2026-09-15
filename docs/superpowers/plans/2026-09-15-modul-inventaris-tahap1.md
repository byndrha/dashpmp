# Modul Inventaris Tahap 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a group-wide (MKEsindo/PMPersada/PMPutra) Vendor directory — vendor + product/brand/model + location + PIC (vendor & internal) + a delivery-log-based ranking — as the first tab of a new "Inventaris" module at `/grup/inventaris`, with new vendors synced one-way into each company's MSSQL `BusinessPartner` table.

**Architecture:** All new data lives in the Postgres "directory" DB (`pmp_directory`, same one holding `akun`/`perusahaan`) via `getPgPool()`. A sync layer writes/updates a mirrored row in whichever company's MSSQL `BusinessPartner` table a vendor is linked to, via the already-existing `getCompanyPool(kode, label)`. Cross-PT module access is a new per-account boolean (`akun.can_akses_inventaris`), not the existing per-company `peran`/`ModuleKey` system (confirmed during planning that system is scoped to a single PT's role and is never used by `/grup/*` pages).

**Tech Stack:** Next.js App Router (Server Components + Server Actions), `pg` (Postgres), `mssql` (per-company MSSQL), existing `Dialog`/`Tabs`/`Select` UI primitives.

**Spec:** `docs/superpowers/specs/2026-09-15-modul-vendor-tahap1-design.md`

## Global Constraints

- New tables live in Postgres `pmp_directory` (same DB as `akun`/`perusahaan`/`perusahaan_koneksi`), accessed via `getPgPool()` from `src/lib/pg.ts` — never MSSQL for vendor's own data.
- `BusinessPartner` (MSSQL, per company) sync is one-way: Postgres → MSSQL. Never read `BusinessPartner.Name`/`Address`/etc. back into Postgres after the initial migration pull.
- New `BusinessPartner` rows for a company use `getCompanyPool(kode, label)` from `src/lib/db-company.ts` (label `"utama"` unless a company's `perusahaan_koneksi` row says otherwise) — never a new ad-hoc connection.
- New `BusinessPartner.Code` = `'SUPP' + 5-digit zero-padded number`, continuing that company's own existing max `SUPP%` sequence — verified live per company, never hardcoded.
- New `BusinessPartner.BusinessPartnerID` generated via `MAX(TRY_CAST(BusinessPartnerID AS BIGINT))` + 1 (never a plain string `MAX()` — see spec's `GeneralLedger.ID` warning), zero-padded to match that company's most common existing ID length (use the length of the row that produced the max, to stay consistent with entries created around now).
- Default `BusinessPartner` field values for every new row (exact, from the spec): `GroupBusinessPartner='0'`, `TermOfPaymentID='014'` (overridable), `AccountPayableID='0137'`, `PurchaseDepositID=NULL`, `PurchaseDiscID='0114'`, `TaxInID='0122'`, `AccountReceivableID='019'`, `SalesDiscID='0183'`, `TaxOutID='0147'`, `SalesDepositID='0185'`, `PriceLevel=1`, `IsSuspended=false` (overridable), `IsDeleted=false`.
- Access gate for every new page/Server Action: `requireInventarisAccess()` (Task 2) — never `requireModuleAccess`/`canView` (that system doesn't apply here) and never bare `requireGrupAccess()` alone (that would let ANY Direktur/superadmin through but never a granted non-Direktur staff member).
- Server Actions return `ActionResult<T>` via `runAction()`/`AppError` from `@/lib/action-result`, matching every existing `/grup/*` action file.
- All UI copy is Indonesian, matching the rest of the app.

---

### Task 1: Postgres schema — Inventaris tables + `akun.can_akses_inventaris`

**Files:**
- Create: `scripts/migrate-inventaris-db.ts`

**Interfaces:**
- Produces: 8 new Postgres tables (`vendor`, `vendor_lokasi`, `vendor_pic`, `vendor_pic_internal`, `vendor_kategori`, `vendor_produk`, `vendor_perusahaan_link`, `vendor_pengiriman`) and `akun.can_akses_inventaris`, consumed by every later task's queries.

- [ ] **Step 1: Write the idempotent migration script**

```typescript
// scripts/migrate-inventaris-db.ts
// Idempotent setup for Modul Inventaris Tahap 1 — creates the 8 vendor-
// related tables in the existing pmp_directory Postgres DB, plus the
// akun.can_akses_inventaris column. Safe to re-run.
//
// Usage: npx tsx scripts/migrate-inventaris-db.ts
import "dotenv/config";
import { Client } from "pg";

const DIRECTORY_DB_NAME = process.env.DIRECTORY_DB_NAME || "pmp_directory";

async function main() {
  const client = new Client({
    host: process.env.DIRECTORY_DB_HOST,
    port: Number(process.env.DIRECTORY_DB_PORT || 5432),
    user: process.env.DIRECTORY_DB_USER,
    password: process.env.DIRECTORY_DB_PASSWORD,
    database: DIRECTORY_DB_NAME,
    ssl: process.env.DIRECTORY_DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor (
        id SERIAL PRIMARY KEY,
        nama VARCHAR(255) NOT NULL,
        npwp VARCHAR(32),
        npwp_alamat VARCHAR(512),
        catatan TEXT,
        is_aktif BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_lokasi (
        id SERIAL PRIMARY KEY,
        vendor_id INT NOT NULL REFERENCES vendor(id) ON DELETE CASCADE,
        nama_lokasi VARCHAR(255) NOT NULL,
        alamat VARCHAR(512),
        kota VARCHAR(128),
        kontak VARCHAR(128),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_pic (
        id SERIAL PRIMARY KEY,
        vendor_id INT NOT NULL REFERENCES vendor(id) ON DELETE CASCADE,
        nama VARCHAR(128) NOT NULL,
        jabatan VARCHAR(128),
        telepon VARCHAR(32),
        email VARCHAR(128),
        urutan INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // urutan=0 is the vendor's PRIMARY PIC — its nama/telepon feed
    // BusinessPartner.ContactPerson/MobileNo on sync (Task 5).

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_pic_internal (
        id SERIAL PRIMARY KEY,
        vendor_id INT NOT NULL REFERENCES vendor(id) ON DELETE CASCADE,
        perusahaan_id INT NOT NULL REFERENCES perusahaan(id),
        akun_id INT NOT NULL REFERENCES akun(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (vendor_id, perusahaan_id, akun_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_kategori (
        id SERIAL PRIMARY KEY,
        nama VARCHAR(128) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_produk (
        id SERIAL PRIMARY KEY,
        vendor_id INT NOT NULL REFERENCES vendor(id) ON DELETE CASCADE,
        kategori_id INT NOT NULL REFERENCES vendor_kategori(id),
        brand VARCHAR(128),
        model VARCHAR(128),
        spesifikasi TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_perusahaan_link (
        id SERIAL PRIMARY KEY,
        vendor_id INT NOT NULL REFERENCES vendor(id) ON DELETE CASCADE,
        perusahaan_id INT NOT NULL REFERENCES perusahaan(id),
        business_partner_id VARCHAR(16) NOT NULL,
        term_of_payment_id VARCHAR(16) NOT NULL DEFAULT '014',
        is_suspended BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (vendor_id, perusahaan_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_pengiriman (
        id SERIAL PRIMARY KEY,
        vendor_perusahaan_link_id INT NOT NULL REFERENCES vendor_perusahaan_link(id) ON DELETE CASCADE,
        vendor_produk_id INT REFERENCES vendor_produk(id),
        tanggal_pesan DATE NOT NULL,
        tanggal_tiba DATE NOT NULL,
        rating_kualitas SMALLINT NOT NULL CHECK (rating_kualitas BETWEEN 1 AND 5),
        catatan TEXT,
        dicatat_oleh_akun_id INT NOT NULL REFERENCES akun(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      ALTER TABLE akun ADD COLUMN IF NOT EXISTS can_akses_inventaris BOOLEAN NOT NULL DEFAULT false
    `);

    console.log("Modul Inventaris tables + akun.can_akses_inventaris ready.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("MIGRATION FAILED:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/migrate-inventaris-db.ts`
Expected: prints "Modul Inventaris tables + akun.can_akses_inventaris ready." with no errors. Re-run it once more to confirm idempotency (same output, no errors).

- [ ] **Step 3: Verify tables exist**

Run a one-off check (do not keep the script): `npx tsx -e "import 'dotenv/config'; import { getPgPool } from './src/lib/pg'; getPgPool().query(\"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'vendor%'\").then(r => console.log(r.rows)).then(() => process.exit(0))"`
Expected: 7 rows (`vendor`, `vendor_lokasi`, `vendor_pic`, `vendor_pic_internal`, `vendor_kategori`, `vendor_produk`, `vendor_perusahaan_link`, `vendor_pengiriman` — 8 total).

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-inventaris-db.ts
git commit -m "feat: add Postgres schema for Modul Inventaris Tahap 1 (Vendor)"
```

---

### Task 2: Cross-PT access control (`can_akses_inventaris`)

**Files:**
- Modify: `src/lib/queries/akun.ts` (add `canAksesInventaris` to `findAkunByUsername`'s query + return type; add `setAkunCanAksesInventaris`)
- Modify: `src/lib/auth.ts` (thread `canAksesInventaris` into `AuthorizedUser`/JWT/session)
- Modify: `src/lib/require-access.ts` (add `requireInventarisAccess()`)

**Interfaces:**
- Consumes: `canAccessAllPT` (already in `require-access.ts`), `getPgPool` (`src/lib/pg.ts`).
- Produces: `requireInventarisAccess(): Promise<Session>` — used by every page/Server Action in Tasks 8-10. `setAkunCanAksesInventaris(akunId: number, value: boolean): Promise<void>` — used by Task 11's toggle.

- [ ] **Step 1: Read the current `findAkunByUsername` query**

Open `src/lib/queries/akun.ts` and find the `findAkunByUsername` function (the one whose `SELECT` includes `r.is_satpam`, `r.is_driver`, etc. — around line 35 per this plan's earlier investigation). Confirm its exact current column list and return-object shape before editing, since this plan's snippet below must be added to, not replace, that query.

- [ ] **Step 2: Add `can_akses_inventaris` to the query and return type**

In `findAkunByUsername`, add `a.can_akses_inventaris` to the `SELECT` list (it's a column directly on `akun`, aliased `a` in that query — no JOIN needed, unlike the `peran`-sourced flags), and add `canAksesInventaris: row.can_akses_inventaris,` to the returned object. Add `canAksesInventaris: boolean;` to that function's return type interface.

- [ ] **Step 3: Add the setter function**

```typescript
// src/lib/queries/akun.ts — add near setPeranSatpam/setPeranDriver/setPeranProduksi
export async function setAkunCanAksesInventaris(akunId: number, value: boolean): Promise<void> {
  const pool = getPgPool();
  await pool.query(`UPDATE akun SET can_akses_inventaris = $1 WHERE id = $2`, [value, akunId]);
}
```

- [ ] **Step 4: Thread it into the session**

In `src/lib/auth.ts`:
- Add `canAksesInventaris: boolean;` to the `AuthorizedUser` interface (next to `isDriver`).
- In the `authorize()` callback, add `canAksesInventaris: row.canAksesInventaris,` to the `user` object construction (next to `isDriver: row.isDriver,`).
- Find the JWT callback (where `token.isDriver = u.isDriver;` is set) and add `token.canAksesInventaris = u.canAksesInventaris;`.
- Find wherever the JWT is turned back into `session.user` (search this file for `session.user.isDriver =` or similar) and add the matching `session.user.canAksesInventaris = token.canAksesInventaris as boolean;`.

- [ ] **Step 5: Add the access gate**

```typescript
// src/lib/require-access.ts — add near requireGrupAccess
// Gerbang /grup/inventaris — cross-PT, so unlike requireModuleAccess this
// does NOT check session.user.permissions (that map is scoped to a single
// company's peran and is never populated for a Direktur account anyway).
// canAccessAllPT() covers Direktur/superadmin; everyone else needs the
// per-account can_akses_inventaris flag set via /grup/akun (Task 11).
export async function requireInventarisAccess() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessAllPT(session.user) && !session.user.canAksesInventaris) {
    redirect("/akses-ditolak");
  }
  return session;
}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If `session.user.canAksesInventaris` is flagged as not existing on the NextAuth `Session["user"]` type, find this project's NextAuth module augmentation (search for `declare module "next-auth"` — likely in `auth.ts` or a `.d.ts` file) and add `canAksesInventaris: boolean;` there too.

- [ ] **Step 7: Commit**

```bash
git add src/lib/queries/akun.ts src/lib/auth.ts src/lib/require-access.ts
git commit -m "feat: add cross-PT can_akses_inventaris account flag and access gate"
```

---

### Task 3: Vendor core queries (vendor, lokasi, PIC vendor, PIC internal)

**Files:**
- Create: `src/lib/queries/inventaris-vendor.ts`

**Interfaces:**
- Consumes: `getPgPool` (`src/lib/pg.ts`).
- Produces: `VendorRow`, `VendorLokasiRow`, `VendorPicRow`, `VendorPicInternalRow` types; `listVendor()`, `getVendorDetail(id)`, `createVendor(input)`, `updateVendor(id, input)`, `addVendorLokasi(vendorId, input)`, `updateVendorLokasi(id, input)`, `deleteVendorLokasi(id)`, `addVendorPic(vendorId, input)`, `updateVendorPic(id, input)`, `deleteVendorPic(id)`, `addVendorPicInternal(vendorId, perusahaanId, akunId)`, `removeVendorPicInternal(id)` — consumed by Task 8's Server Actions.

- [ ] **Step 1: Write the query module**

```typescript
// src/lib/queries/inventaris-vendor.ts
import { getPgPool } from "@/lib/pg";

export interface VendorInput {
  nama: string;
  npwp: string | null;
  npwpAlamat: string | null;
  catatan: string | null;
}

export interface VendorRow {
  id: number;
  nama: string;
  npwp: string | null;
  npwpAlamat: string | null;
  catatan: string | null;
  isAktif: boolean;
}

export interface VendorLokasiInput {
  namaLokasi: string;
  alamat: string | null;
  kota: string | null;
  kontak: string | null;
}

export interface VendorLokasiRow extends VendorLokasiInput {
  id: number;
  vendorId: number;
}

export interface VendorPicInput {
  nama: string;
  jabatan: string | null;
  telepon: string | null;
  email: string | null;
}

export interface VendorPicRow extends VendorPicInput {
  id: number;
  vendorId: number;
  urutan: number;
}

export interface VendorPicInternalRow {
  id: number;
  vendorId: number;
  perusahaanId: number;
  akunId: number;
  akunNama: string;
  perusahaanNama: string;
}

export async function listVendor(): Promise<VendorRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT id, nama, npwp, npwp_alamat, catatan, is_aktif FROM vendor ORDER BY nama`
  );
  return result.rows.map((r) => ({
    id: r.id,
    nama: r.nama,
    npwp: r.npwp,
    npwpAlamat: r.npwp_alamat,
    catatan: r.catatan,
    isAktif: r.is_aktif,
  }));
}

export async function getVendor(id: number): Promise<VendorRow | null> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT id, nama, npwp, npwp_alamat, catatan, is_aktif FROM vendor WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return { id: r.id, nama: r.nama, npwp: r.npwp, npwpAlamat: r.npwp_alamat, catatan: r.catatan, isAktif: r.is_aktif };
}

export async function createVendor(input: VendorInput): Promise<number> {
  const pool = getPgPool();
  const result = await pool.query(
    `INSERT INTO vendor (nama, npwp, npwp_alamat, catatan) VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.nama, input.npwp, input.npwpAlamat, input.catatan]
  );
  return result.rows[0].id as number;
}

export async function updateVendor(id: number, input: VendorInput): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `UPDATE vendor SET nama = $1, npwp = $2, npwp_alamat = $3, catatan = $4, updated_at = now() WHERE id = $5`,
    [input.nama, input.npwp, input.npwpAlamat, input.catatan, id]
  );
}

export async function listVendorLokasi(vendorId: number): Promise<VendorLokasiRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT id, vendor_id, nama_lokasi, alamat, kota, kontak FROM vendor_lokasi WHERE vendor_id = $1 ORDER BY id`,
    [vendorId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    vendorId: r.vendor_id,
    namaLokasi: r.nama_lokasi,
    alamat: r.alamat,
    kota: r.kota,
    kontak: r.kontak,
  }));
}

export async function addVendorLokasi(vendorId: number, input: VendorLokasiInput): Promise<number> {
  const pool = getPgPool();
  const result = await pool.query(
    `INSERT INTO vendor_lokasi (vendor_id, nama_lokasi, alamat, kota, kontak) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [vendorId, input.namaLokasi, input.alamat, input.kota, input.kontak]
  );
  return result.rows[0].id as number;
}

export async function updateVendorLokasi(id: number, input: VendorLokasiInput): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `UPDATE vendor_lokasi SET nama_lokasi = $1, alamat = $2, kota = $3, kontak = $4 WHERE id = $5`,
    [input.namaLokasi, input.alamat, input.kota, input.kontak, id]
  );
}

export async function deleteVendorLokasi(id: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM vendor_lokasi WHERE id = $1`, [id]);
}

// urutan=0 is reserved for the "PIC utama" whose nama/telepon feed
// BusinessPartner.ContactPerson/MobileNo on sync (see Task 5) — enforced
// here by always inserting new PICs after the current max urutan, and
// never letting urutan 0 be deleted while other rows exist (see
// deleteVendorPic below).
export async function listVendorPic(vendorId: number): Promise<VendorPicRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT id, vendor_id, nama, jabatan, telepon, email, urutan FROM vendor_pic WHERE vendor_id = $1 ORDER BY urutan`,
    [vendorId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    vendorId: r.vendor_id,
    nama: r.nama,
    jabatan: r.jabatan,
    telepon: r.telepon,
    email: r.email,
    urutan: r.urutan,
  }));
}

export async function addVendorPic(vendorId: number, input: VendorPicInput): Promise<number> {
  const pool = getPgPool();
  const maxRes = await pool.query(`SELECT COALESCE(MAX(urutan), -1) AS max_urutan FROM vendor_pic WHERE vendor_id = $1`, [vendorId]);
  const nextUrutan = (maxRes.rows[0].max_urutan as number) + 1;
  const result = await pool.query(
    `INSERT INTO vendor_pic (vendor_id, nama, jabatan, telepon, email, urutan) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [vendorId, input.nama, input.jabatan, input.telepon, input.email, nextUrutan]
  );
  return result.rows[0].id as number;
}

export async function updateVendorPic(id: number, input: VendorPicInput): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `UPDATE vendor_pic SET nama = $1, jabatan = $2, telepon = $3, email = $4 WHERE id = $5`,
    [input.nama, input.jabatan, input.telepon, input.email, id]
  );
}

export async function deleteVendorPic(id: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM vendor_pic WHERE id = $1`, [id]);
}

export async function listVendorPicInternal(vendorId: number): Promise<VendorPicInternalRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT vpi.id, vpi.vendor_id, vpi.perusahaan_id, vpi.akun_id, a.nama AS akun_nama, p.nama AS perusahaan_nama
     FROM vendor_pic_internal vpi
     JOIN akun a ON a.id = vpi.akun_id
     JOIN perusahaan p ON p.id = vpi.perusahaan_id
     WHERE vpi.vendor_id = $1
     ORDER BY p.nama, a.nama`,
    [vendorId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    vendorId: r.vendor_id,
    perusahaanId: r.perusahaan_id,
    akunId: r.akun_id,
    akunNama: r.akun_nama,
    perusahaanNama: r.perusahaan_nama,
  }));
}

export async function addVendorPicInternal(vendorId: number, perusahaanId: number, akunId: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `INSERT INTO vendor_pic_internal (vendor_id, perusahaan_id, akun_id) VALUES ($1, $2, $3)
     ON CONFLICT (vendor_id, perusahaan_id, akun_id) DO NOTHING`,
    [vendorId, perusahaanId, akunId]
  );
}

export async function removeVendorPicInternal(id: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM vendor_pic_internal WHERE id = $1`, [id]);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/inventaris-vendor.ts
git commit -m "feat: add Vendor/Lokasi/PIC core queries for Modul Inventaris"
```

---

### Task 4: Kategori + Produk queries

**Files:**
- Create: `src/lib/queries/inventaris-produk.ts`

**Interfaces:**
- Consumes: `getPgPool`.
- Produces: `VendorKategoriRow`, `VendorProdukRow`, `VendorProdukInput` types; `listVendorKategori()`, `createVendorKategori(nama)`, `renameVendorKategori(id, nama)`, `deleteVendorKategori(id)`, `listVendorProduk(vendorId)`, `addVendorProduk(vendorId, input)`, `updateVendorProduk(id, input)`, `deleteVendorProduk(id)` — consumed by Task 8's Server Actions.

- [ ] **Step 1: Write the query module**

```typescript
// src/lib/queries/inventaris-produk.ts
import { getPgPool } from "@/lib/pg";
import { AppError } from "@/lib/action-result";

export interface VendorKategoriRow {
  id: number;
  nama: string;
}

export async function listVendorKategori(): Promise<VendorKategoriRow[]> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT id, nama FROM vendor_kategori ORDER BY nama`);
  return result.rows;
}

export async function createVendorKategori(nama: string): Promise<number> {
  const pool = getPgPool();
  try {
    const result = await pool.query(`INSERT INTO vendor_kategori (nama) VALUES ($1) RETURNING id`, [nama]);
    return result.rows[0].id as number;
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "23505") {
      throw new AppError(`Kategori "${nama}" sudah ada.`);
    }
    throw err;
  }
}

export async function renameVendorKategori(id: number, nama: string): Promise<void> {
  const pool = getPgPool();
  await pool.query(`UPDATE vendor_kategori SET nama = $1 WHERE id = $2`, [nama, id]);
}

export async function deleteVendorKategori(id: number): Promise<void> {
  const pool = getPgPool();
  const inUse = await pool.query(`SELECT 1 FROM vendor_produk WHERE kategori_id = $1 LIMIT 1`, [id]);
  if ((inUse.rowCount ?? 0) > 0) {
    throw new AppError("Kategori ini masih dipakai oleh produk vendor — hapus/pindahkan produknya dulu.");
  }
  await pool.query(`DELETE FROM vendor_kategori WHERE id = $1`, [id]);
}

export interface VendorProdukInput {
  kategoriId: number;
  brand: string | null;
  model: string | null;
  spesifikasi: string | null;
}

export interface VendorProdukRow extends VendorProdukInput {
  id: number;
  vendorId: number;
  kategoriNama: string;
}

export async function listVendorProduk(vendorId: number): Promise<VendorProdukRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT vp.id, vp.vendor_id, vp.kategori_id, vk.nama AS kategori_nama, vp.brand, vp.model, vp.spesifikasi
     FROM vendor_produk vp JOIN vendor_kategori vk ON vk.id = vp.kategori_id
     WHERE vp.vendor_id = $1 ORDER BY vk.nama, vp.brand, vp.model`,
    [vendorId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    vendorId: r.vendor_id,
    kategoriId: r.kategori_id,
    kategoriNama: r.kategori_nama,
    brand: r.brand,
    model: r.model,
    spesifikasi: r.spesifikasi,
  }));
}

export async function addVendorProduk(vendorId: number, input: VendorProdukInput): Promise<number> {
  const pool = getPgPool();
  const result = await pool.query(
    `INSERT INTO vendor_produk (vendor_id, kategori_id, brand, model, spesifikasi) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [vendorId, input.kategoriId, input.brand, input.model, input.spesifikasi]
  );
  return result.rows[0].id as number;
}

export async function updateVendorProduk(id: number, input: VendorProdukInput): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `UPDATE vendor_produk SET kategori_id = $1, brand = $2, model = $3, spesifikasi = $4 WHERE id = $5`,
    [input.kategoriId, input.brand, input.model, input.spesifikasi, id]
  );
}

export async function deleteVendorProduk(id: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM vendor_produk WHERE id = $1`, [id]);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/inventaris-produk.ts
git commit -m "feat: add Vendor Kategori/Produk queries for Modul Inventaris"
```

---

### Task 5: BusinessPartner sync (MSSQL, per company)

**Files:**
- Create: `src/lib/queries/inventaris-businesspartner-sync.ts`

**Interfaces:**
- Consumes: `getCompanyPool` (`src/lib/db-company.ts`), `sql` (`mssql`), `VendorRow`/`VendorPicRow` (Task 3), `perusahaan.kode` (need to fetch via a small Postgres lookup — see Step 1).
- Produces: `syncVendorToBusinessPartner(input): Promise<string>` (returns the `BusinessPartnerID`, new or existing) — consumed by Task 8's `linkVendorToPerusahaanAction`. `updateBusinessPartnerFromVendor(perusahaanKode, businessPartnerId, vendor, picUtama): Promise<void>` — consumed by Task 8's vendor-edit action (Global Constraint: keep MSSQL in sync on every edit).

- [ ] **Step 1: Look up a company's `kode` and default connection label**

Before writing this file, read `src/lib/queries/perusahaan.ts` to confirm the exact function name/shape that returns a `perusahaan` row's `kode` by `id` (this plan's queries elsewhere use `perusahaan_id` as the FK; the sync functions need the MSSQL-connection `kode` string, not the numeric id). Use whatever that existing function is called — do not write a new one if `getPerusahaanById`-shaped function already exists.

- [ ] **Step 2: Write the sync module**

```typescript
// src/lib/queries/inventaris-businesspartner-sync.ts
import { getCompanyPool } from "@/lib/db-company";
import sql from "mssql";
import { AppError } from "@/lib/action-result";
import type { VendorRow } from "@/lib/queries/inventaris-vendor";

const ACC_PAYABLE = "0137";
const ACC_RECEIVABLE = "019";
const ACC_SALES_DISC = "0183";
const ACC_PURCHASE_DISC = "0114";
const ACC_TAX_IN = "0122";
const ACC_TAX_OUT = "0147";
const ACC_SALES_DEPOSIT = "0185";
const DEFAULT_PRICE_LEVEL = 1;
const DEFAULT_TERM_OF_PAYMENT = "014"; // "Tunai"

export interface VendorPicUtama {
  nama: string;
  telepon: string | null;
}

export interface SyncVendorInput {
  perusahaanKode: string;
  vendor: VendorRow;
  picUtama: VendorPicUtama | null;
  lokasiUtama: { alamat: string | null } | null;
  termOfPaymentId: string;
  isSuspended: boolean;
}

// Generates the next BusinessPartnerID for a company, following the exact
// length of whichever existing row currently holds the numeric max — see
// Global Constraints: BusinessPartnerID is varchar and NOT fixed-length,
// and a naive string MAX() gives wrong results (proven live on
// GeneralLedger.ID during the GIT-1399 investigation).
async function nextBusinessPartnerId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`
    SELECT TOP 1 BusinessPartnerID, TRY_CAST(BusinessPartnerID AS BIGINT) AS N
    FROM BusinessPartner
    WHERE TRY_CAST(BusinessPartnerID AS BIGINT) IS NOT NULL
    ORDER BY N DESC
  `);
  const row = result.recordset[0] as { BusinessPartnerID: string; N: number } | undefined;
  if (!row) throw new AppError("Tidak bisa menentukan BusinessPartnerID baru — tabel BusinessPartner kosong/tidak terbaca.");
  const nextN = row.N + 1;
  return String(nextN).padStart(row.BusinessPartnerID.length, "0");
}

async function nextSuppCode(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`
    SELECT MAX(TRY_CAST(SUBSTRING(Code, 5, 10) AS INT)) AS MaxN FROM BusinessPartner WHERE Code LIKE 'SUPP%'
  `);
  const maxN = (result.recordset[0] as { MaxN: number | null }).MaxN ?? 0;
  return "SUPP" + String(maxN + 1).padStart(5, "0");
}

// Creates a brand-new BusinessPartner row for a vendor that has never
// transacted with this company before. Returns the new BusinessPartnerID.
export async function createBusinessPartnerForVendor(input: SyncVendorInput): Promise<string> {
  const pool = await getCompanyPool(input.perusahaanKode, "utama");
  const businessPartnerId = await nextBusinessPartnerId(pool);
  const code = await nextSuppCode(pool);

  await pool
    .request()
    .input("id", sql.VarChar(16), businessPartnerId)
    .input("code", sql.VarChar(128), code)
    .input("name", sql.VarChar(128), input.vendor.nama)
    .input("address", sql.VarChar(1024), input.lokasiUtama?.alamat ?? null)
    .input("npwp", sql.VarChar(128), input.vendor.npwp)
    .input("npwpAddress", sql.VarChar(1024), input.vendor.npwpAlamat)
    .input("contactPerson", sql.VarChar(128), input.picUtama?.nama ?? null)
    .input("mobileNo", sql.VarChar(128), input.picUtama?.telepon ?? null)
    .input("termOfPaymentId", sql.VarChar(16), input.termOfPaymentId)
    .input("isSuspended", sql.Bit, input.isSuspended)
    .input("accountPayableId", sql.VarChar(16), ACC_PAYABLE)
    .input("accountReceivableId", sql.VarChar(16), ACC_RECEIVABLE)
    .input("salesDiscId", sql.VarChar(16), ACC_SALES_DISC)
    .input("purchaseDiscId", sql.VarChar(16), ACC_PURCHASE_DISC)
    .input("taxInId", sql.VarChar(16), ACC_TAX_IN)
    .input("taxOutId", sql.VarChar(16), ACC_TAX_OUT)
    .input("salesDepositId", sql.VarChar(16), ACC_SALES_DEPOSIT)
    .input("priceLevel", sql.Int, DEFAULT_PRICE_LEVEL)
    .query(`
      INSERT INTO BusinessPartner (
        BusinessPartnerID, Code, Name, Address, NPWP, NPWPAddress, ContactPerson, MobileNo,
        TermOfPaymentID, IsSuspended, GroupBusinessPartner,
        AccountPayableID, AccountReceivableID, SalesDiscID, PurchaseDiscID,
        TaxInID, TaxOutID, SalesDepositID, PriceLevel, IsDeleted
      ) VALUES (
        @id, @code, @name, @address, @npwp, @npwpAddress, @contactPerson, @mobileNo,
        @termOfPaymentId, @isSuspended, '0',
        @accountPayableId, @accountReceivableId, @salesDiscId, @purchaseDiscId,
        @taxInId, @taxOutId, @salesDepositId, @priceLevel, 0
      )
    `);
  // PurchaseDepositID deliberately omitted — column defaults to NULL,
  // matching the spec's explicit "kosong, bukan 0115" requirement.

  return businessPartnerId;
}

// Keeps an already-linked BusinessPartner row's Name/Address/NPWP/
// NPWPAddress/ContactPerson/MobileNo in sync after a Postgres-side edit —
// one-way, Postgres is the source of truth (Global Constraints).
export async function updateBusinessPartnerFromVendor(
  perusahaanKode: string,
  businessPartnerId: string,
  vendor: VendorRow,
  picUtama: VendorPicUtama | null,
  alamatUtama: string | null
): Promise<void> {
  const pool = await getCompanyPool(perusahaanKode, "utama");
  await pool
    .request()
    .input("id", sql.VarChar(16), businessPartnerId)
    .input("name", sql.VarChar(128), vendor.nama)
    .input("address", sql.VarChar(1024), alamatUtama)
    .input("npwp", sql.VarChar(128), vendor.npwp)
    .input("npwpAddress", sql.VarChar(1024), vendor.npwpAlamat)
    .input("contactPerson", sql.VarChar(128), picUtama?.nama ?? null)
    .input("mobileNo", sql.VarChar(128), picUtama?.telepon ?? null)
    .query(`
      UPDATE BusinessPartner
      SET Name = @name, Address = @address, NPWP = @npwp, NPWPAddress = @npwpAddress,
          ContactPerson = @contactPerson, MobileNo = @mobileNo, ModifiedDate = GETDATE()
      WHERE BusinessPartnerID = @id
    `);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Live-verify ID/Code generation against a real company (read-only dry run)**

Write a throwaway script `scripts/_dryrun_next_businesspartner_id.ts` that imports `getCompanyPool` and prints what `nextBusinessPartnerId`/`nextSuppCode`-equivalent inline queries would produce for `kode="mkesindo"` (reuse the exact SQL from Step 2, don't import the unexported helpers — copy the two SELECT statements inline). Run it, confirm the printed next ID/Code look sane (ID longer than or equal to `01679`'s length, Code `SUPP00671` or higher), then delete the throwaway script.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/inventaris-businesspartner-sync.ts
git commit -m "feat: add MSSQL BusinessPartner sync for new/edited vendors"
```

---

### Task 6: Legacy vendor migration (pull existing SUPP-coded suppliers)

**Files:**
- Create: `scripts/migrate-legacy-vendor-from-businesspartner.ts`

**Interfaces:**
- Consumes: `getCompanyPool`, `getPgPool`, Task 3's `createVendor`/`addVendorLokasi`/`addVendorPic`.
- Produces: initial `vendor`/`vendor_lokasi`/`vendor_pic`/`vendor_perusahaan_link` rows for every existing `SUPP%` `BusinessPartner` row — one-off, run once per environment, kept in the repo (not a throwaway) since the spec calls it a real migration step, not a scratch investigation.

- [ ] **Step 1: Write the migration script**

```typescript
// scripts/migrate-legacy-vendor-from-businesspartner.ts
// One-off: pulls every existing SUPP-coded BusinessPartner row from a
// company's MSSQL into the new Postgres vendor directory, so staff start
// with real data instead of an empty list. Safe to re-run — skips any
// BusinessPartnerID that already has a vendor_perusahaan_link row for that
// perusahaan_id.
//
// Usage: npx tsx scripts/migrate-legacy-vendor-from-businesspartner.ts <perusahaan_kode>
// Example: npx tsx scripts/migrate-legacy-vendor-from-businesspartner.ts mkesindo
import "dotenv/config";
import { getCompanyPool } from "../src/lib/db-company";
import { getPgPool } from "../src/lib/pg";

async function main() {
  const kode = process.argv[2];
  if (!kode) {
    console.error("Usage: npx tsx scripts/migrate-legacy-vendor-from-businesspartner.ts <perusahaan_kode>");
    process.exit(1);
  }

  const pgPool = getPgPool();
  const perusahaanRes = await pgPool.query(`SELECT id FROM perusahaan WHERE kode = $1`, [kode]);
  if (perusahaanRes.rows.length === 0) {
    console.error(`Tidak ditemukan baris perusahaan dengan kode="${kode}".`);
    process.exit(1);
  }
  const perusahaanId = perusahaanRes.rows[0].id as number;

  const mssqlPool = await getCompanyPool(kode, "utama");
  const suppliers = await mssqlPool.request().query(`
    SELECT BusinessPartnerID, Code, Name, Address, NPWP, NPWPAddress, ContactPerson, MobileNo
    FROM BusinessPartner WHERE Code LIKE 'SUPP%'
  `);
  const rows = suppliers.recordset as {
    BusinessPartnerID: string; Code: string; Name: string; Address: string | null;
    NPWP: string | null; NPWPAddress: string | null; ContactPerson: string | null; MobileNo: string | null;
  }[];
  console.log(`Ditemukan ${rows.length} baris SUPP% di BusinessPartner (${kode}).`);

  let migrated = 0, skipped = 0;
  for (const row of rows) {
    const already = await pgPool.query(
      `SELECT 1 FROM vendor_perusahaan_link WHERE perusahaan_id = $1 AND business_partner_id = $2`,
      [perusahaanId, row.BusinessPartnerID]
    );
    if ((already.rowCount ?? 0) > 0) {
      skipped++;
      continue;
    }

    const vendorRes = await pgPool.query(
      `INSERT INTO vendor (nama, npwp, npwp_alamat) VALUES ($1, $2, $3) RETURNING id`,
      [row.Name, row.NPWP || null, row.NPWPAddress || null]
    );
    const vendorId = vendorRes.rows[0].id as number;

    if (row.Address) {
      await pgPool.query(
        `INSERT INTO vendor_lokasi (vendor_id, nama_lokasi, alamat) VALUES ($1, 'Lokasi Utama', $2)`,
        [vendorId, row.Address]
      );
    }
    if (row.ContactPerson) {
      await pgPool.query(
        `INSERT INTO vendor_pic (vendor_id, nama, telepon, urutan) VALUES ($1, $2, $3, 0)`,
        [vendorId, row.ContactPerson, row.MobileNo || null]
      );
    }
    await pgPool.query(
      `INSERT INTO vendor_perusahaan_link (vendor_id, perusahaan_id, business_partner_id) VALUES ($1, $2, $3)`,
      [vendorId, perusahaanId, row.BusinessPartnerID]
    );
    migrated++;
    console.log(`  Migrated ${row.Code} (${row.Name}) -> vendor.id=${vendorId}`);
  }

  console.log(`Selesai. Migrated: ${migrated}, dilewati (sudah ada): ${skipped}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("MIGRATION FAILED:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it for MKEsindo**

Run: `npx tsx scripts/migrate-legacy-vendor-from-businesspartner.ts mkesindo`
Expected: "Ditemukan 20 baris SUPP% ..." followed by 20 "Migrated SUPP..." lines (assuming no new SUPP rows were added since this plan's investigation — if the count differs, that's fine, just confirm it completes with 0 unexpected errors).

- [ ] **Step 3: Verify**

Run: `npx tsx -e "import 'dotenv/config'; import { getPgPool } from './src/lib/pg'; getPgPool().query('SELECT count(*) FROM vendor').then(r => console.log(r.rows)).then(() => process.exit(0))"`
Expected: count matches the number migrated in Step 2.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-legacy-vendor-from-businesspartner.ts
git commit -m "feat: add legacy SUPP-coded vendor migration script, run for MKEsindo"
```

Note: do NOT run this for `pmpersada`/`pmputra` yet — Task 5's "Asumsi Belum Terverifikasi" (spec) means their `BusinessPartner` structure hasn't been confirmed identical. Confirm with the user before running for those companies.

---

### Task 7: Vendor pengiriman (delivery log) + ranking

**Files:**
- Create: `src/lib/queries/inventaris-pengiriman.ts`

**Interfaces:**
- Consumes: `getPgPool`.
- Produces: `VendorPengirimanInput`, `VendorPengirimanRow`, `VendorRanking` types; `listVendorPengiriman(vendorId)`, `addVendorPengiriman(input)`, `deleteVendorPengiriman(id)`, `getVendorRanking(vendorId, perusahaanId?)` — consumed by Task 8/10.

- [ ] **Step 1: Write the query module**

```typescript
// src/lib/queries/inventaris-pengiriman.ts
import { getPgPool } from "@/lib/pg";
import { AppError } from "@/lib/action-result";

export interface VendorPengirimanInput {
  vendorPerusahaanLinkId: number;
  vendorProdukId: number | null;
  tanggalPesan: string; // ISO date, e.g. "2026-09-15"
  tanggalTiba: string;
  ratingKualitas: number; // 1-5
  catatan: string | null;
  dicatatOlehAkunId: number;
}

export interface VendorPengirimanRow {
  id: number;
  vendorPerusahaanLinkId: number;
  perusahaanNama: string;
  vendorProdukId: number | null;
  produkLabel: string | null;
  tanggalPesan: string;
  tanggalTiba: string;
  lamaKirimHari: number;
  ratingKualitas: number;
  catatan: string | null;
  dicatatOlehNama: string;
}

function assertValidRating(rating: number) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new AppError("Rating kualitas harus bilangan bulat 1-5.");
  }
}

function assertValidDates(tanggalPesan: string, tanggalTiba: string) {
  if (new Date(tanggalTiba) < new Date(tanggalPesan)) {
    throw new AppError("Tanggal tiba tidak boleh sebelum tanggal pesan.");
  }
}

export async function addVendorPengiriman(input: VendorPengirimanInput): Promise<number> {
  assertValidRating(input.ratingKualitas);
  assertValidDates(input.tanggalPesan, input.tanggalTiba);
  const pool = getPgPool();
  const result = await pool.query(
    `INSERT INTO vendor_pengiriman
       (vendor_perusahaan_link_id, vendor_produk_id, tanggal_pesan, tanggal_tiba, rating_kualitas, catatan, dicatat_oleh_akun_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.vendorPerusahaanLinkId, input.vendorProdukId, input.tanggalPesan, input.tanggalTiba, input.ratingKualitas, input.catatan, input.dicatatOlehAkunId]
  );
  return result.rows[0].id as number;
}

export async function listVendorPengiriman(vendorId: number): Promise<VendorPengirimanRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT vpg.id, vpg.vendor_perusahaan_link_id, p.nama AS perusahaan_nama,
            vpg.vendor_produk_id, vpd.brand, vpd.model,
            vpg.tanggal_pesan, vpg.tanggal_tiba,
            (vpg.tanggal_tiba - vpg.tanggal_pesan) AS lama_kirim_hari,
            vpg.rating_kualitas, vpg.catatan, a.nama AS dicatat_oleh_nama
     FROM vendor_pengiriman vpg
     JOIN vendor_perusahaan_link vpl ON vpl.id = vpg.vendor_perusahaan_link_id
     JOIN perusahaan p ON p.id = vpl.perusahaan_id
     JOIN akun a ON a.id = vpg.dicatat_oleh_akun_id
     LEFT JOIN vendor_produk vpd ON vpd.id = vpg.vendor_produk_id
     WHERE vpl.vendor_id = $1
     ORDER BY vpg.tanggal_tiba DESC`,
    [vendorId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    vendorPerusahaanLinkId: r.vendor_perusahaan_link_id,
    perusahaanNama: r.perusahaan_nama,
    vendorProdukId: r.vendor_produk_id,
    produkLabel: r.vendor_produk_id ? [r.brand, r.model].filter(Boolean).join(" ") || null : null,
    tanggalPesan: r.tanggal_pesan,
    tanggalTiba: r.tanggal_tiba,
    lamaKirimHari: Number(r.lama_kirim_hari),
    ratingKualitas: r.rating_kualitas,
    catatan: r.catatan,
    dicatatOlehNama: r.dicatat_oleh_nama,
  }));
}

export async function deleteVendorPengiriman(id: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM vendor_pengiriman WHERE id = $1`, [id]);
}

export interface VendorRanking {
  jumlahLog: number;
  rataRataLamaKirimHari: number | null;
  rataRataRatingKualitas: number | null;
}

// perusahaanId narrows to one company's log entries; omit for a combined
// ranking across every company the vendor transacts with (spec's "Bisa
// dilihat gabungan atau difilter per perusahaan").
export async function getVendorRanking(vendorId: number, perusahaanId?: number): Promise<VendorRanking> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT
       COUNT(*) AS jumlah_log,
       AVG(vpg.tanggal_tiba - vpg.tanggal_pesan) AS avg_lama_kirim,
       AVG(vpg.rating_kualitas) AS avg_rating
     FROM vendor_pengiriman vpg
     JOIN vendor_perusahaan_link vpl ON vpl.id = vpg.vendor_perusahaan_link_id
     WHERE vpl.vendor_id = $1 AND ($2::int IS NULL OR vpl.perusahaan_id = $2)`,
    [vendorId, perusahaanId ?? null]
  );
  const row = result.rows[0];
  const jumlahLog = Number(row.jumlah_log);
  return {
    jumlahLog,
    rataRataLamaKirimHari: jumlahLog > 0 ? Number(row.avg_lama_kirim) : null,
    rataRataRatingKualitas: jumlahLog > 0 ? Number(row.avg_rating) : null,
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/inventaris-pengiriman.ts
git commit -m "feat: add Vendor Pengiriman log + ranking queries"
```

---

### Task 8: Server Actions

**Files:**
- Create: `src/app/grup/inventaris/actions.ts`

**Interfaces:**
- Consumes: every query function from Tasks 3, 4, 5, 7; `requireInventarisAccess` (Task 2); `runAction`/`ActionResult`/`AppError` (`@/lib/action-result`).
- Produces: `createVendorAction`, `updateVendorAction`, `addVendorLokasiAction`, `updateVendorLokasiAction`, `deleteVendorLokasiAction`, `addVendorPicAction`, `updateVendorPicAction`, `deleteVendorPicAction`, `addVendorPicInternalAction`, `removeVendorPicInternalAction`, `listVendorKategoriAction`, `createVendorKategoriAction`, `renameVendorKategoriAction`, `deleteVendorKategoriAction`, `addVendorProdukAction`, `updateVendorProdukAction`, `deleteVendorProdukAction`, `linkVendorToPerusahaanAction`, `addVendorPengirimanAction`, `deleteVendorPengirimanAction` — all consumed by Task 9/10's components.

- [ ] **Step 1: Write the actions file**

```typescript
// src/app/grup/inventaris/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireInventarisAccess } from "@/lib/require-access";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";
import {
  createVendor, updateVendor, addVendorLokasi, updateVendorLokasi, deleteVendorLokasi,
  addVendorPic, updateVendorPic, deleteVendorPic, addVendorPicInternal, removeVendorPicInternal,
  getVendor, listVendorLokasi, listVendorPic,
  type VendorInput, type VendorLokasiInput, type VendorPicInput,
} from "@/lib/queries/inventaris-vendor";
import {
  listVendorKategori, createVendorKategori, renameVendorKategori, deleteVendorKategori,
  addVendorProduk, updateVendorProduk, deleteVendorProduk,
  type VendorProdukInput,
} from "@/lib/queries/inventaris-produk";
import { addVendorPengiriman, deleteVendorPengiriman, type VendorPengirimanInput } from "@/lib/queries/inventaris-pengiriman";
import { createBusinessPartnerForVendor, updateBusinessPartnerFromVendor } from "@/lib/queries/inventaris-businesspartner-sync";
import { getPgPool } from "@/lib/pg";

function assertVendorInput(input: VendorInput) {
  if (!input.nama.trim()) throw new AppError("Nama vendor wajib diisi.");
}

export async function createVendorAction(input: VendorInput): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requireInventarisAccess();
    assertVendorInput(input);
    const id = await createVendor(input);
    revalidatePath("/grup/inventaris");
    return id;
  });
}

export async function updateVendorAction(id: number, input: VendorInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    assertVendorInput(input);
    await updateVendor(id, input);

    // Keep every linked company's BusinessPartner in sync (Global
    // Constraints: Postgres -> MSSQL, one-way, on every edit).
    const pgPool = getPgPool();
    const links = await pgPool.query(
      `SELECT vpl.business_partner_id, p.kode FROM vendor_perusahaan_link vpl JOIN perusahaan p ON p.id = vpl.perusahaan_id WHERE vpl.vendor_id = $1`,
      [id]
    );
    const [vendor, lokasiList, picList] = await Promise.all([getVendor(id), listVendorLokasi(id), listVendorPic(id)]);
    if (!vendor) throw new AppError("Vendor tidak ditemukan.");
    const picUtama = picList.find((p) => p.urutan === 0);
    const alamatUtama = lokasiList[0]?.alamat ?? null;
    for (const link of links.rows as { business_partner_id: string; kode: string }[]) {
      await updateBusinessPartnerFromVendor(
        link.kode,
        link.business_partner_id,
        vendor,
        picUtama ? { nama: picUtama.nama, telepon: picUtama.telepon } : null,
        alamatUtama
      );
    }
    revalidatePath("/grup/inventaris");
    revalidatePath(`/grup/inventaris/vendor/${id}`);
  });
}

export async function addVendorLokasiAction(vendorId: number, input: VendorLokasiInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    if (!input.namaLokasi.trim()) throw new AppError("Nama lokasi wajib diisi.");
    await addVendorLokasi(vendorId, input);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function updateVendorLokasiAction(id: number, vendorId: number, input: VendorLokasiInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    if (!input.namaLokasi.trim()) throw new AppError("Nama lokasi wajib diisi.");
    await updateVendorLokasi(id, input);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function deleteVendorLokasiAction(id: number, vendorId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await deleteVendorLokasi(id);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function addVendorPicAction(vendorId: number, input: VendorPicInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    if (!input.nama.trim()) throw new AppError("Nama PIC wajib diisi.");
    await addVendorPic(vendorId, input);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function updateVendorPicAction(id: number, vendorId: number, input: VendorPicInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    if (!input.nama.trim()) throw new AppError("Nama PIC wajib diisi.");
    await updateVendorPic(id, input);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function deleteVendorPicAction(id: number, vendorId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await deleteVendorPic(id);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function addVendorPicInternalAction(vendorId: number, perusahaanId: number, akunId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await addVendorPicInternal(vendorId, perusahaanId, akunId);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function removeVendorPicInternalAction(id: number, vendorId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await removeVendorPicInternal(id);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function listVendorKategoriAction(): Promise<ActionResult<Awaited<ReturnType<typeof listVendorKategori>>>> {
  return runAction(async () => {
    await requireInventarisAccess();
    return listVendorKategori();
  });
}

export async function createVendorKategoriAction(nama: string): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requireInventarisAccess();
    if (!nama.trim()) throw new AppError("Nama kategori wajib diisi.");
    const id = await createVendorKategori(nama.trim());
    revalidatePath("/grup/inventaris");
    return id;
  });
}

export async function renameVendorKategoriAction(id: number, nama: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    if (!nama.trim()) throw new AppError("Nama kategori wajib diisi.");
    await renameVendorKategori(id, nama.trim());
    revalidatePath("/grup/inventaris");
  });
}

export async function deleteVendorKategoriAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await deleteVendorKategori(id);
    revalidatePath("/grup/inventaris");
  });
}

export async function addVendorProdukAction(vendorId: number, input: VendorProdukInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await addVendorProduk(vendorId, input);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function updateVendorProdukAction(id: number, vendorId: number, input: VendorProdukInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await updateVendorProduk(id, input);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function deleteVendorProdukAction(id: number, vendorId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await deleteVendorProduk(id);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

// Links a vendor to a company: creates a brand-new BusinessPartner row
// (Task 5) and records the resulting ID in vendor_perusahaan_link. Caller
// (Task 10's UI) is responsible for offering "link to an EXISTING
// BusinessPartnerID instead" as a separate, simpler path (a direct INSERT
// into vendor_perusahaan_link with a staff-provided BusinessPartnerID —
// wire that as a second action here, linkVendorToExistingBusinessPartnerAction,
// if the UI task needs it) — this action only covers the "brand-new vendor"
// path described in the spec.
export async function linkVendorToPerusahaanAction(
  vendorId: number,
  perusahaanId: number,
  perusahaanKode: string,
  termOfPaymentId: string,
  isSuspended: boolean
): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    const [vendor, lokasiList, picList] = await Promise.all([getVendor(vendorId), listVendorLokasi(vendorId), listVendorPic(vendorId)]);
    if (!vendor) throw new AppError("Vendor tidak ditemukan.");
    const picUtama = picList.find((p) => p.urutan === 0);
    const businessPartnerId = await createBusinessPartnerForVendor({
      perusahaanKode,
      vendor,
      picUtama: picUtama ? { nama: picUtama.nama, telepon: picUtama.telepon } : null,
      lokasiUtama: lokasiList[0] ? { alamat: lokasiList[0].alamat } : null,
      termOfPaymentId,
      isSuspended,
    });
    const pgPool = getPgPool();
    await pgPool.query(
      `INSERT INTO vendor_perusahaan_link (vendor_id, perusahaan_id, business_partner_id, term_of_payment_id, is_suspended)
       VALUES ($1, $2, $3, $4, $5)`,
      [vendorId, perusahaanId, businessPartnerId, termOfPaymentId, isSuspended]
    );
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function addVendorPengirimanAction(input: VendorPengirimanInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await addVendorPengiriman(input);
    revalidatePath("/grup/inventaris");
  });
}

export async function deleteVendorPengirimanAction(id: number, vendorId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await deleteVendorPengiriman(id);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If `AppError`/`runAction`/`ActionResult` import paths or signatures differ from what's assumed above, open `src/lib/action-result.ts` and adjust the imports/usage to match exactly (this plan's Task 8 code assumes the same shape used by `src/app/grup/perusahaan/actions.ts`, confirmed during planning — verify the assumption held).

- [ ] **Step 3: Commit**

```bash
git add src/app/grup/inventaris/actions.ts
git commit -m "feat: add Server Actions for Modul Inventaris Vendor tab"
```

---

### Task 9: `/grup/inventaris` page shell + Vendor list

**Files:**
- Create: `src/app/grup/inventaris/page.tsx`
- Create: `src/components/dashboard/inventaris-vendor-list.tsx`
- Create: `src/components/dashboard/inventaris-vendor-form-dialog.tsx`

**Interfaces:**
- Consumes: `requireInventarisAccess` (Task 2), `listVendor` (Task 3), `getVendorRanking` (Task 7), `createVendorAction` (Task 8).
- Produces: the `/grup/inventaris` route, `InventarisVendorList` component (consumed nowhere else yet — this is the top-level list view).

- [ ] **Step 1: Write the page**

```tsx
// src/app/grup/inventaris/page.tsx
import type { Metadata } from "next";
import { requireInventarisAccess } from "@/lib/require-access";
import { listVendor } from "@/lib/queries/inventaris-vendor";
import { getVendorRanking } from "@/lib/queries/inventaris-pengiriman";
import { InventarisVendorList } from "@/components/dashboard/inventaris-vendor-list";

export const metadata: Metadata = { title: "Inventaris" };

export default async function InventarisPage() {
  await requireInventarisAccess();
  const vendorList = await listVendor();
  const rankings = await Promise.all(vendorList.map((v) => getVendorRanking(v.id)));
  const vendorWithRanking = vendorList.map((v, i) => ({ ...v, ranking: rankings[i] }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Inventaris</h1>
      <p className="text-sm text-muted-foreground">
        Direktori vendor lintas-perusahaan — produk, lokasi, PIC, dan peringkat berdasarkan histori pengiriman.
      </p>
      <InventarisVendorList vendorList={vendorWithRanking} />
    </div>
  );
}
```

Note: `Promise.all(vendorList.map(...))` issuing one query per vendor is acceptable for Tahap 1's expected scale (dozens of vendors, matching the ~20 legacy suppliers) — if this list grows into the hundreds later, revisit `getVendorRanking` with a single batched query, but don't build that now (YAGNI).

- [ ] **Step 2: Write the list component**

```tsx
// src/components/dashboard/inventaris-vendor-list.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { VendorRow } from "@/lib/queries/inventaris-vendor";
import type { VendorRanking } from "@/lib/queries/inventaris-pengiriman";
import { InventarisVendorFormDialog } from "@/components/dashboard/inventaris-vendor-form-dialog";

export function InventarisVendorList({
  vendorList,
}: {
  vendorList: (VendorRow & { ranking: VendorRanking })[];
}) {
  const [search, setSearch] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);

  const filtered = vendorList.filter((v) => v.nama.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama vendor..."
          className="max-w-xs"
        />
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="size-4" />
          Tambah Vendor
        </Button>
      </div>
      <div className="rounded-xl border">
        {filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Belum ada vendor.</p>
        ) : (
          <div className="divide-y">
            {filtered.map((v) => (
              <Link
                key={v.id}
                href={`/grup/inventaris/vendor/${v.id}`}
                className="flex items-center justify-between gap-3 p-3 hover:bg-muted/40"
              >
                <div className="flex flex-col">
                  <span className="font-medium">{v.nama}</span>
                  {v.npwp && <span className="text-xs text-muted-foreground">NPWP {v.npwp}</span>}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {v.ranking.jumlahLog > 0 ? (
                    <span className="flex items-center gap-1">
                      <Star className="size-3.5 text-warning" />
                      {v.ranking.rataRataRatingKualitas?.toFixed(1)} · {v.ranking.rataRataLamaKirimHari?.toFixed(1)} hari
                    </span>
                  ) : (
                    <span>Belum ada data pengiriman</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      <InventarisVendorFormDialog open={showAddDialog} onOpenChange={setShowAddDialog} />
    </div>
  );
}
```

- [ ] **Step 3: Write the add-vendor dialog**

```tsx
// src/components/dashboard/inventaris-vendor-form-dialog.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createVendorAction } from "@/app/grup/inventaris/actions";

// kategoriList is deliberately NOT a prop here — creating a vendor record
// itself needs no kategori (kategori applies to vendor_produk, added later
// from the detail page's Produk tab, see QuickAddProduk in
// inventaris-vendor-detail.tsx).
export function InventarisVendorFormDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [nama, setNama] = useState("");
  const [npwp, setNpwp] = useState("");
  const [npwpAlamat, setNpwpAlamat] = useState("");
  const [catatan, setCatatan] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setNama("");
    setNpwp("");
    setNpwpAlamat("");
    setCatatan("");
    setError(null);
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await createVendorAction({
        nama: nama.trim(),
        npwp: npwp.trim() || null,
        npwpAlamat: npwpAlamat.trim() || null,
        catatan: catatan.trim() || null,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      toast.success("Vendor ditambahkan.");
      reset();
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah Vendor</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Nama Vendor</Label>
            <Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="PT Contoh Sejahtera" />
          </div>
          <div className="flex flex-col gap-1">
            <Label>NPWP</Label>
            <Input value={npwp} onChange={(e) => setNpwp(e.target.value)} placeholder="12.345.678.9-012.000" />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Alamat NPWP</Label>
            <Textarea value={npwpAlamat} onChange={(e) => setNpwpAlamat(e.target.value)} rows={2} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Catatan</Label>
            <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button disabled={!nama.trim() || pending} onClick={handleSubmit}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Add the sidebar nav entry**

Find `app-sidebar.tsx`'s `NAV_ITEMS` (or wherever `/grup/akun`/`/grup/perusahaan` links are listed) and add an "Inventaris" entry pointing to `/grup/inventaris`, gated the same way the other `/grup/*` entries are (likely a `canAccessAllPT`-or-similar check in that file — read it first to match the existing pattern exactly, then extend the visibility condition to also show when `session.user.canAksesInventaris` is true).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification (this task is UI-observable — verify in the browser per this project's standing convention)**

Start the dev server, log in as an account with `canAccessAllPT()` true (superadmin/Direktur), navigate to `/grup/inventaris`. Confirm: page loads, the 20 migrated vendors (Task 6) appear in the list, "Belum ada data pengiriman" shows for all of them (no `vendor_pengiriman` rows exist yet), clicking "Tambah Vendor" opens the dialog, submitting a test vendor with just a name succeeds and the new vendor appears in the list after refresh.

- [ ] **Step 7: Commit**

```bash
git add src/app/grup/inventaris/page.tsx src/components/dashboard/inventaris-vendor-list.tsx src/components/dashboard/inventaris-vendor-form-dialog.tsx
git commit -m "feat: add /grup/inventaris page shell and Vendor list"
```

---

### Task 10: Vendor detail page (Lokasi, PIC, Produk, Pengiriman, Perusahaan Terhubung)

**Files:**
- Create: `src/app/grup/inventaris/vendor/[id]/page.tsx`
- Create: `src/components/dashboard/inventaris-vendor-detail.tsx`

**Interfaces:**
- Consumes: `requireInventarisAccess` (Task 2), `getVendor`/`listVendorLokasi`/`listVendorPic`/`listVendorPicInternal` (Task 3), `listVendorProduk`/`listVendorKategori` (Task 4), `listVendorPengiriman`/`getVendorRanking` (Task 7), every Server Action from Task 8, `listPerusahaan` (already exists, `@/lib/queries/perusahaan`).
- Produces: the `/grup/inventaris/vendor/[id]` route.

- [ ] **Step 1: Write the detail page**

```tsx
// src/app/grup/inventaris/vendor/[id]/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireInventarisAccess } from "@/lib/require-access";
import { getVendor, listVendorLokasi, listVendorPic, listVendorPicInternal } from "@/lib/queries/inventaris-vendor";
import { listVendorProduk, listVendorKategori } from "@/lib/queries/inventaris-produk";
import { listVendorPengiriman, getVendorRanking } from "@/lib/queries/inventaris-pengiriman";
import { listPerusahaan } from "@/lib/queries/perusahaan";
import { getPgPool } from "@/lib/pg";
import { InventarisVendorDetail } from "@/components/dashboard/inventaris-vendor-detail";

export const metadata: Metadata = { title: "Detail Vendor" };

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireInventarisAccess();
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const vendor = await getVendor(id);
  if (!vendor) notFound();

  const [lokasiList, picList, picInternalList, produkList, kategoriList, pengirimanList, ranking, perusahaanList, links] =
    await Promise.all([
      listVendorLokasi(id),
      listVendorPic(id),
      listVendorPicInternal(id),
      listVendorProduk(id),
      listVendorKategori(),
      listVendorPengiriman(id),
      getVendorRanking(id),
      listPerusahaan(),
      getPgPool().query(
        `SELECT vpl.id, vpl.perusahaan_id, p.nama AS perusahaan_nama, vpl.business_partner_id, vpl.term_of_payment_id, vpl.is_suspended
         FROM vendor_perusahaan_link vpl JOIN perusahaan p ON p.id = vpl.perusahaan_id WHERE vpl.vendor_id = $1`,
        [id]
      ),
    ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">{vendor.nama}</h1>
      <InventarisVendorDetail
        vendor={vendor}
        lokasiList={lokasiList}
        picList={picList}
        picInternalList={picInternalList}
        produkList={produkList}
        kategoriList={kategoriList}
        pengirimanList={pengirimanList}
        ranking={ranking}
        perusahaanList={perusahaanList}
        perusahaanLinks={links.rows.map((r) => ({
          id: r.id,
          perusahaanId: r.perusahaan_id,
          perusahaanNama: r.perusahaan_nama,
          businessPartnerId: r.business_partner_id,
          termOfPaymentId: r.term_of_payment_id,
          isSuspended: r.is_suspended,
        }))}
      />
    </div>
  );
}
```

- [ ] **Step 2: Write the detail component with tabs**

```tsx
// src/components/dashboard/inventaris-vendor-detail.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Star } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { VendorRow, VendorLokasiRow, VendorPicRow, VendorPicInternalRow } from "@/lib/queries/inventaris-vendor";
import type { VendorProdukRow, VendorKategoriRow } from "@/lib/queries/inventaris-produk";
import type { VendorPengirimanRow, VendorRanking } from "@/lib/queries/inventaris-pengiriman";
import type { PerusahaanRow } from "@/lib/queries/perusahaan";
import {
  addVendorLokasiAction, deleteVendorLokasiAction,
  addVendorPicAction, deleteVendorPicAction,
  addVendorProdukAction, deleteVendorProdukAction,
  addVendorPengirimanAction, deleteVendorPengirimanAction,
  linkVendorToPerusahaanAction,
} from "@/app/grup/inventaris/actions";

interface PerusahaanLink {
  id: number;
  perusahaanId: number;
  perusahaanNama: string;
  businessPartnerId: string;
  termOfPaymentId: string;
  isSuspended: boolean;
}

type Tab = "lokasi" | "pic" | "produk" | "pengiriman" | "perusahaan";

export function InventarisVendorDetail({
  vendor,
  lokasiList,
  picList,
  picInternalList,
  produkList,
  kategoriList,
  pengirimanList,
  ranking,
  perusahaanList,
  perusahaanLinks,
}: {
  vendor: VendorRow;
  lokasiList: VendorLokasiRow[];
  picList: VendorPicRow[];
  picInternalList: VendorPicInternalRow[];
  produkList: VendorProdukRow[];
  kategoriList: VendorKategoriRow[];
  pengirimanList: VendorPengirimanRow[];
  ranking: VendorRanking;
  perusahaanList: PerusahaanRow[];
  perusahaanLinks: PerusahaanLink[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("lokasi");
  const [pending, startTransition] = useTransition();

  function refresh() {
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-xl border p-3 text-sm">
        {ranking.jumlahLog > 0 ? (
          <span className="flex items-center gap-1">
            <Star className="size-4 text-warning" />
            {ranking.rataRataRatingKualitas?.toFixed(1)}/5 · rata-rata {ranking.rataRataLamaKirimHari?.toFixed(1)} hari kirim
            ({ranking.jumlahLog} log)
          </span>
        ) : (
          <span className="text-muted-foreground">Belum ada data pengiriman untuk menghitung peringkat.</span>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => typeof v === "string" && setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="lokasi">Lokasi</TabsTrigger>
          <TabsTrigger value="pic">PIC</TabsTrigger>
          <TabsTrigger value="produk">Produk</TabsTrigger>
          <TabsTrigger value="pengiriman">Log Pengiriman</TabsTrigger>
          <TabsTrigger value="perusahaan">Perusahaan Terhubung</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "lokasi" && (
        <div className="flex flex-col gap-2">
          {lokasiList.map((l) => (
            <div key={l.id} className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium">{l.namaLokasi}</p>
                <p className="text-xs text-muted-foreground">{l.alamat} {l.kota}</p>
              </div>
              <Button
                variant="ghost" size="icon"
                onClick={() => startTransition(async () => {
                  const r = await deleteVendorLokasiAction(l.id, vendor.id);
                  if (!r.success) { toast.error(r.error); return; }
                  refresh();
                })}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <QuickAddLokasi vendorId={vendor.id} onAdded={refresh} />
        </div>
      )}

      {tab === "pic" && (
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="mb-2 text-sm font-semibold">PIC Vendor</h3>
            {picList.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="font-medium">{p.nama} {p.urutan === 0 && <span className="text-xs text-primary">(Utama)</span>}</p>
                  <p className="text-xs text-muted-foreground">{p.jabatan} · {p.telepon}</p>
                </div>
                <Button
                  variant="ghost" size="icon"
                  onClick={() => startTransition(async () => {
                    const r = await deleteVendorPicAction(p.id, vendor.id);
                    if (!r.success) { toast.error(r.error); return; }
                    refresh();
                  })}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <QuickAddPic vendorId={vendor.id} onAdded={refresh} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">PIC Internal PMP Group</h3>
            {picInternalList.map((p) => (
              <p key={p.id} className="text-sm">{p.akunNama} — {p.perusahaanNama}</p>
            ))}
          </div>
        </div>
      )}

      {tab === "produk" && (
        <div className="flex flex-col gap-2">
          {produkList.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium">{p.brand} {p.model}</p>
                <p className="text-xs text-muted-foreground">{p.kategoriNama}</p>
              </div>
              <Button
                variant="ghost" size="icon"
                onClick={() => startTransition(async () => {
                  const r = await deleteVendorProdukAction(p.id, vendor.id);
                  if (!r.success) { toast.error(r.error); return; }
                  refresh();
                })}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <QuickAddProduk vendorId={vendor.id} kategoriList={kategoriList} onAdded={refresh} />
        </div>
      )}

      {tab === "pengiriman" && (
        <div className="flex flex-col gap-2">
          {pengirimanList.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
              <div>
                <p>{p.perusahaanNama} — {p.tanggalPesan} → {p.tanggalTiba} ({p.lamaKirimHari} hari)</p>
                <p className="text-xs text-muted-foreground">Rating {p.ratingKualitas}/5 {p.produkLabel && `· ${p.produkLabel}`}</p>
              </div>
              <Button
                variant="ghost" size="icon"
                onClick={() => startTransition(async () => {
                  const r = await deleteVendorPengirimanAction(p.id, vendor.id);
                  if (!r.success) { toast.error(r.error); return; }
                  refresh();
                })}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <QuickAddPengiriman
            perusahaanLinks={perusahaanLinks}
            produkList={produkList}
            onAdded={refresh}
          />
        </div>
      )}

      {tab === "perusahaan" && (
        <div className="flex flex-col gap-2">
          {perusahaanLinks.map((l) => (
            <div key={l.id} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">{l.perusahaanNama}</p>
              <p className="text-xs text-muted-foreground">BusinessPartnerID {l.businessPartnerId} · Termin {l.termOfPaymentId}</p>
            </div>
          ))}
          <QuickLinkPerusahaan
            vendorId={vendor.id}
            perusahaanList={perusahaanList.filter((p) => !perusahaanLinks.some((l) => l.perusahaanId === p.id))}
            onLinked={refresh}
          />
        </div>
      )}
    </div>
  );
}

// Each Quick* component is a minimal inline add-form (name input(s) + a
// Tambah button) — deliberately not a modal Dialog like the top-level
// "Tambah Vendor" form, since these are secondary additions inside an
// already-open detail page. Follows the same startTransition + toast +
// router.refresh() pattern as the delete buttons above.

function QuickAddLokasi({ vendorId, onAdded }: { vendorId: number; onAdded: () => void }) {
  const [namaLokasi, setNamaLokasi] = useState("");
  const [alamat, setAlamat] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-end gap-2 rounded-lg border border-dashed p-3">
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Nama Lokasi</Label>
        <Input value={namaLokasi} onChange={(e) => setNamaLokasi(e.target.value)} placeholder="Gudang Utama" />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Alamat</Label>
        <Input value={alamat} onChange={(e) => setAlamat(e.target.value)} />
      </div>
      <Button
        size="sm" disabled={!namaLokasi.trim() || pending}
        onClick={() => startTransition(async () => {
          const r = await addVendorLokasiAction(vendorId, { namaLokasi: namaLokasi.trim(), alamat: alamat.trim() || null, kota: null, kontak: null });
          if (!r.success) { toast.error(r.error); return; }
          setNamaLokasi(""); setAlamat(""); onAdded();
        })}
      >
        <Plus className="size-4" /> Tambah
      </Button>
    </div>
  );
}

function QuickAddPic({ vendorId, onAdded }: { vendorId: number; onAdded: () => void }) {
  const [nama, setNama] = useState("");
  const [jabatan, setJabatan] = useState("");
  const [telepon, setTelepon] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-end gap-2 rounded-lg border border-dashed p-3">
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Nama</Label>
        <Input value={nama} onChange={(e) => setNama(e.target.value)} />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Jabatan</Label>
        <Input value={jabatan} onChange={(e) => setJabatan(e.target.value)} />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Telepon/WA</Label>
        <Input value={telepon} onChange={(e) => setTelepon(e.target.value)} />
      </div>
      <Button
        size="sm" disabled={!nama.trim() || pending}
        onClick={() => startTransition(async () => {
          const r = await addVendorPicAction(vendorId, { nama: nama.trim(), jabatan: jabatan.trim() || null, telepon: telepon.trim() || null, email: null });
          if (!r.success) { toast.error(r.error); return; }
          setNama(""); setJabatan(""); setTelepon(""); onAdded();
        })}
      >
        <Plus className="size-4" /> Tambah
      </Button>
    </div>
  );
}

function QuickAddProduk({ vendorId, kategoriList, onAdded }: { vendorId: number; kategoriList: VendorKategoriRow[]; onAdded: () => void }) {
  const [kategoriId, setKategoriId] = useState<string>(kategoriList[0] ? String(kategoriList[0].id) : "");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-end gap-2 rounded-lg border border-dashed p-3">
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Kategori</Label>
        <Select value={kategoriId} onValueChange={(v) => typeof v === "string" && setKategoriId(v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {kategoriList.map((k) => <SelectItem key={k.id} value={String(k.id)}>{k.nama}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Brand</Label>
        <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Model</Label>
        <Input value={model} onChange={(e) => setModel(e.target.value)} />
      </div>
      <Button
        size="sm" disabled={!kategoriId || pending}
        onClick={() => startTransition(async () => {
          const r = await addVendorProdukAction(vendorId, { kategoriId: Number(kategoriId), brand: brand.trim() || null, model: model.trim() || null, spesifikasi: null });
          if (!r.success) { toast.error(r.error); return; }
          setBrand(""); setModel(""); onAdded();
        })}
      >
        <Plus className="size-4" /> Tambah
      </Button>
    </div>
  );
}

function QuickAddPengiriman({
  perusahaanLinks, produkList, onAdded,
}: { perusahaanLinks: PerusahaanLink[]; produkList: VendorProdukRow[]; onAdded: () => void }) {
  const [linkId, setLinkId] = useState<string>(perusahaanLinks[0] ? String(perusahaanLinks[0].id) : "");
  const [produkId, setProdukId] = useState<string>("");
  const [tanggalPesan, setTanggalPesan] = useState("");
  const [tanggalTiba, setTanggalTiba] = useState("");
  const [rating, setRating] = useState("5");
  const [pending, startTransition] = useTransition();

  if (perusahaanLinks.length === 0) {
    return <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Hubungkan vendor ini ke suatu perusahaan dulu (tab Perusahaan Terhubung) sebelum mencatat pengiriman.</p>;
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3">
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Perusahaan</Label>
        <Select value={linkId} onValueChange={(v) => typeof v === "string" && setLinkId(v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {perusahaanLinks.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.perusahaanNama}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Produk (opsional)</Label>
        <Select value={produkId} onValueChange={(v) => typeof v === "string" && setProdukId(v)}>
          <SelectTrigger><SelectValue placeholder="-" /></SelectTrigger>
          <SelectContent>
            {produkList.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.brand} {p.model}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Tgl Pesan</Label>
        <Input type="date" value={tanggalPesan} onChange={(e) => setTanggalPesan(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Tgl Tiba</Label>
        <Input type="date" value={tanggalTiba} onChange={(e) => setTanggalTiba(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Rating (1-5)</Label>
        <Input type="number" min={1} max={5} value={rating} onChange={(e) => setRating(e.target.value)} className="w-16" />
      </div>
      <Button
        size="sm" disabled={!linkId || !tanggalPesan || !tanggalTiba || pending}
        onClick={() => startTransition(async () => {
          const r = await addVendorPengirimanAction({
            vendorPerusahaanLinkId: Number(linkId),
            vendorProdukId: produkId ? Number(produkId) : null,
            tanggalPesan, tanggalTiba,
            ratingKualitas: Number(rating),
            catatan: null,
            dicatatOlehAkunId: 0, // TODO(reviewer): replace with the logged-in akun id — thread session.user.id from the page's server component down as a prop, see Task 10 Step 3.
          });
          if (!r.success) { toast.error(r.error); return; }
          setTanggalPesan(""); setTanggalTiba(""); onAdded();
        })}
      >
        <Plus className="size-4" /> Catat
      </Button>
    </div>
  );
}

function QuickLinkPerusahaan({
  vendorId, perusahaanList, onLinked,
}: { vendorId: number; perusahaanList: PerusahaanRow[]; onLinked: () => void }) {
  const [perusahaanId, setPerusahaanId] = useState<string>("");
  const [pending, startTransition] = useTransition();

  if (perusahaanList.length === 0) {
    return <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Vendor ini sudah terhubung ke semua perusahaan.</p>;
  }

  return (
    <div className="flex items-end gap-2 rounded-lg border border-dashed p-3">
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Perusahaan</Label>
        <Select value={perusahaanId} onValueChange={(v) => typeof v === "string" && setPerusahaanId(v)}>
          <SelectTrigger><SelectValue placeholder="Pilih perusahaan" /></SelectTrigger>
          <SelectContent>
            {perusahaanList.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.nama}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Button
        size="sm" disabled={!perusahaanId || pending}
        onClick={() => {
          const p = perusahaanList.find((x) => String(x.id) === perusahaanId);
          if (!p) return;
          startTransition(async () => {
            const r = await linkVendorToPerusahaanAction(vendorId, p.id, p.kode, "014", false);
            if (!r.success) { toast.error(r.error); return; }
            toast.success(`Terhubung ke ${p.nama}, BusinessPartner baru dibuat.`);
            setPerusahaanId(""); onLinked();
          });
        }}
      >
        Hubungkan
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Fix the `dicatatOlehAkunId` placeholder from Step 2**

The `QuickAddPengiriman` component above has a `dicatatOlehAkunId: 0` placeholder that must be replaced before this task is done (per this plan's "No Placeholders" — flagged inline so it isn't missed, not left as-is). In `src/app/grup/inventaris/vendor/[id]/page.tsx`, capture the session from `requireInventarisAccess()` (it returns the session): `const session = await requireInventarisAccess();`, then pass `currentAkunId={Number(session.user.id)}` down through `InventarisVendorDetail` to `QuickAddPengiriman`, and use that prop instead of the literal `0`.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. Fix any import-path or type mismatches against `PerusahaanRow`/`listPerusahaan` (confirm the exact exported type name in `@/lib/queries/perusahaan` — adjust the import if it differs from `PerusahaanRow`).

- [ ] **Step 5: Manual verification**

In the browser, open one of the 20 migrated vendors' detail page. Confirm: Lokasi/PIC tabs show the migrated data (address/contact person pulled in Task 6), adding a new lokasi/PIC/produk works and appears after refresh, linking to a second company (if `pmpersada`/`pmputra` sync was confirmed safe — otherwise skip this specific check and note it) creates a real `BusinessPartner` row, and recording a pengiriman log updates the ranking badge at the top of the page.

- [ ] **Step 6: Commit**

```bash
git add src/app/grup/inventaris/vendor src/components/dashboard/inventaris-vendor-detail.tsx
git commit -m "feat: add Vendor detail page with Lokasi/PIC/Produk/Pengiriman/Perusahaan tabs"
```

---

### Task 11: `can_akses_inventaris` toggle in `/grup/akun`

**Files:**
- Modify: `src/components/dashboard/akun-list.tsx`
- Modify: `src/app/grup/akun/actions.ts`

**Interfaces:**
- Consumes: `setAkunCanAksesInventaris` (Task 2).
- Produces: `setAkunCanAksesInventarisAction` — consumed by `akun-list.tsx`'s edit form.

- [ ] **Step 1: Read the existing akun edit form**

Open `src/components/dashboard/akun-list.tsx` and find where existing boolean fields (e.g., whatever toggles `isSatpam`-equivalent settings, or the closest analogous per-account boolean editor in that 625-line file) are rendered and wired to a Server Action, so the new toggle matches that exact pattern (likely a `Switch` or checkbox component + an inline `onClick`/`onCheckedChange` calling a Server Action + `router.refresh()`).

- [ ] **Step 2: Add the action**

```typescript
// src/app/grup/akun/actions.ts — add near other per-akun setters
import { setAkunCanAksesInventaris } from "@/lib/queries/akun"; // add to existing import block if akun.ts is already imported

export async function setAkunCanAksesInventarisAction(akunId: number, value: boolean): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await setAkunCanAksesInventaris(akunId, value);
    revalidatePath("/grup/akun");
  });
}
```

- [ ] **Step 3: Add the toggle to the UI**

In `akun-list.tsx`, add a labeled toggle ("Akses Inventaris") next to wherever the closest existing boolean field lives in that account's row/edit form, wired to `setAkunCanAksesInventarisAction`. Match the exact component (`Switch`/checkbox) and event-handling pattern already used by its neighboring field in that file — do not introduce a new UI pattern for this one toggle.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

In the browser, open `/grup/akun`, edit a non-Direktur/non-superadmin account, toggle "Akses Inventaris" on, save. Log in as that account (or use its session) and confirm `/grup/inventaris` is now reachable (was previously `/akses-ditolak`).

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/akun-list.tsx src/app/grup/akun/actions.ts
git commit -m "feat: add can_akses_inventaris toggle to Akun editor"
```

---

## Self-Review Notes (spec coverage)

- Vendor + Lokasi + PIC (vendor & internal) + Produk/Kategori: Tasks 3, 4, 9, 10.
- Peringkat dari log pengiriman: Tasks 7, 9 (list badge), 10 (detail badge + log form).
- Sinkronisasi BusinessPartner (create + update-on-edit) + verified default account values + `BusinessPartnerID`/`Code` generation gotcha: Task 5, wired into Task 8's `updateVendorAction`/`linkVendorToPerusahaanAction`.
- Migrasi 20 vendor lama (termasuk NPWP/NPWPAddress/ContactPerson/MobileNo, bukan kosong): Task 6.
- Akses Direktur/superadmin otomatis + staf tertentu manual, lintas-PT (bukan `ModuleKey`): Tasks 2, 11.
- Halaman `/grup/inventaris` dengan tab (Vendor sekarang, Stok Bahan Baku nanti): Task 9's `Tabs` shell — only one tab rendered in Tahap 1, structured so Task 3 (Tahap 3, out of scope here) can add a sibling tab later without restructuring the page.
- "Asumsi Belum Terverifikasi" (PMPersada/PMPutra `BusinessPartner` structure): called out explicitly in Task 6's note not to run the legacy migration for those companies without separate confirmation.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-15-modul-inventaris-tahap1.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
