# Validasi Waktu Pengiriman, Data Armada, dan Ubah Pemesanan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) A departure's `JamJadwal` can never be earlier than the `TransDate` of any Sales Order bundled into it. (2) `DashboardArmada` gains fuel/tax fields. (3) Papan Pengiriman's armada rows show Kapasitas/Kantong-hari-ini/Jarak-tempuh-hari-ini. (4) Validasi Rute shows Jenis BBM + Total Biaya BBM. (5) A new "Ubah Pemesanan" dialog reschedules one Sales Order's armada/waktu/driver without disturbing the other SOs bundled in its current Draft.

**Architecture:** All new validation lives server-side in `pengiriman-jadwal.ts` (single source of truth, reused by every mutation path). Armada fuel/tax fields follow the exact pattern the existing `ARMADA_STATUS`/`armada-status.ts` split already established (client-safe constants file, separate from the `mssql`-importing query file). Route distance is persisted only at `startBerangkat` (the one moment a route is mandatorily, server-side validated) rather than computed live on every board render. "Ubah Pemesanan" reuses `createJadwalDraft`/`updateJadwalDriverTime` exactly as `createPemesanan` already does, wrapped in a new orchestrator that first detaches the SO from its current Draft.

**Tech Stack:** Next.js Server Components + Server Actions, raw parameterized `mssql` queries, existing `src/components/ui` primitives.

## Global Constraints

- No automated test suite exists in this codebase. Verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`, and manual browser checks.
- The 14:00 WIB cutoff convention (`getBusinessDateISO()`, `src/lib/business-date.ts`, unmodified by this plan) is applied within Pemesanan/Pengiriman only — not retrofitted into any other module.
- Every mutation that sets/changes a Jadwal's `JamJadwal` must go through the new `assertJamJadwalNotBeforeOrders` check (Task 1) — this is the single enforcement point; no duplicate ad-hoc checks elsewhere.
- Client components must never import a runtime value from `src/lib/queries/armada.ts` for anything that could be satisfied by the client-safe `src/lib/armada-status.ts` / new `src/lib/armada-fuel.ts` instead — `armada.ts` imports `mssql`, and this exact mistake (`ARMADA_STATUS` imported at runtime from `queries/armada.ts` into a client component) already broke a production build once in this codebase's history.
- Reference: `docs/superpowers/specs/2026-07-25-pengiriman-armada-validasi-design.md` for the full approved design.

---

### Task 0: Database schema (controller-run, not delegated)

- [ ] **Step 1: Run this DDL**

```sql
ALTER TABLE DashboardArmada ADD
  JenisBBM VARCHAR(20) NULL,
  BiayaBBMPerLiter DECIMAL(18,2) NULL,
  PajakLimaTahunan DATE NULL,
  BiayaPajakLimaTahunan DECIMAL(18,2) NULL;

ALTER TABLE DashboardPengirimanJadwal ADD JarakKM DECIMAL(10,2) NULL;
```

- [ ] **Step 2: Verify**

Confirm `DashboardArmada` has the 4 new columns and `DashboardPengirimanJadwal` has `JarakKM`, via `INFORMATION_SCHEMA.COLUMNS` or equivalent.

---

### Task 1: `JamJadwal >= MAX(SalesOrder.TransDate)` validation

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts`

**Interfaces:**
- Produces: a new private helper `assertJamJadwalNotBeforeOrders(pool, salesOrderIds, jamJadwal)`, called from `createJadwalDraft`, `updateJadwalDriverTime`, and `addSalesOrdersToJadwal` (all three already exist, unmodified signatures).

- [ ] **Step 1: Add the import and helper**

Add to the top imports (this file currently imports `getPool, sql` from `@/lib/db` and several others — add this one line):

```ts
import { formatDate, formatTime } from "@/lib/format";
```

Add this new private function, placed right before `export async function createJadwalDraft`:

```ts
// Single enforcement point for the rule that a departure can never be
// scheduled earlier than the Sales Order(s) it's delivering — a Jadwal
// can't exist before the order that created the need for it. Called from
// every path that sets or changes JamJadwal (createJadwalDraft,
// updateJadwalDriverTime, addSalesOrdersToJadwal) so there's exactly one
// place this rule lives, not one per call site.
async function assertJamJadwalNotBeforeOrders(pool: sql.ConnectionPool, salesOrderIds: string[], jamJadwal: Date): Promise<void> {
  if (salesOrderIds.length === 0) return;
  const request = pool.request();
  const placeholders = salesOrderIds.map((id, i) => {
    request.input(`so${i}`, sql.VarChar(16), id);
    return `@so${i}`;
  });
  const result = await request.query(`
    SELECT MAX(TransDate) AS MaxTransDate FROM SalesOrder WHERE SalesOrderID IN (${placeholders.join(",")})
  `);
  const maxTransDate = (result.recordset[0]?.MaxTransDate as Date | null) ?? null;
  if (maxTransDate && jamJadwal < maxTransDate) {
    throw new Error(
      `Waktu pengiriman (${formatDate(jamJadwal)} ${formatTime(jamJadwal)}) tidak boleh sebelum waktu pemesanan SO terkait (${formatDate(maxTransDate)} ${formatTime(maxTransDate)}).`
    );
  }
}
```

- [ ] **Step 2: Wire into `createJadwalDraft`**

Find:
```ts
  const totalQty = await sumSalesOrderQty(pool, input.salesOrderIds);
  await assertWithinCapacity(pool, input.armadaId, totalQty);

  const result = await pool
```

Change to:
```ts
  const totalQty = await sumSalesOrderQty(pool, input.salesOrderIds);
  await assertWithinCapacity(pool, input.armadaId, totalQty);
  await assertJamJadwalNotBeforeOrders(pool, input.salesOrderIds, input.jamJadwal);

  const result = await pool
```

- [ ] **Step 3: Wire into `updateJadwalDriverTime`**

Find:
```ts
  const row = current.recordset[0] as { Status: JadwalStatus; ArmadaID: number } | undefined;
  if (!row) throw new Error("Keberangkatan tidak ditemukan.");

  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("jamJadwal", sql.DateTime, input.jamJadwal)
```

Change to:
```ts
  const row = current.recordset[0] as { Status: JadwalStatus; ArmadaID: number } | undefined;
  if (!row) throw new Error("Keberangkatan tidak ditemukan.");

  const detailResult = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT SalesOrderID FROM DashboardPengirimanJadwalDetail WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const bundledSalesOrderIds = (detailResult.recordset as { SalesOrderID: string }[]).map((r) => r.SalesOrderID);
  await assertJamJadwalNotBeforeOrders(pool, bundledSalesOrderIds, input.jamJadwal);

  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("jamJadwal", sql.DateTime, input.jamJadwal)
```

- [ ] **Step 4: Wire into `addSalesOrdersToJadwal`**

Find:
```ts
  const header = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT ArmadaID, Status FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const headerRow = header.recordset[0] as { ArmadaID: number; Status: JadwalStatus } | undefined;
  if (!headerRow) throw new Error("Keberangkatan tidak ditemukan.");
  if (headerRow.Status !== "Draft") throw new Error("Keberangkatan ini sudah berangkat, tidak bisa menambah SO.");
```

Change to:
```ts
  const header = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT ArmadaID, Status, JamJadwal FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const headerRow = header.recordset[0] as { ArmadaID: number; Status: JadwalStatus; JamJadwal: Date } | undefined;
  if (!headerRow) throw new Error("Keberangkatan tidak ditemukan.");
  if (headerRow.Status !== "Draft") throw new Error("Keberangkatan ini sudah berangkat, tidak bisa menambah SO.");
  await assertJamJadwalNotBeforeOrders(pool, salesOrderIds, headerRow.JamJadwal);
```

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `pengiriman-jadwal.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts
git commit -m "Enforce JamJadwal not before bundled SalesOrder TransDate"
```

---

### Task 2: Pemesanan form's delivery-date floor

**Files:**
- Modify: `src/app/(dashboard)/pemesanan/page.tsx`
- Modify: `src/components/dashboard/pemesanan-form-dialog.tsx`

**Interfaces:**
- Consumes: `getBusinessDateISO` (existing, `@/lib/business-date`).
- `PemesananFormDialog` gains a required prop `todayISO: string`.

- [ ] **Step 1: Edit `src/app/(dashboard)/pemesanan/page.tsx`**

Add the import (alongside the existing `@/lib/queries/*` imports):
```ts
import { getBusinessDateISO } from "@/lib/business-date";
```

Find:
```tsx
  await requireModuleAccess("pemesanan");
  const params = await searchParams;
  const filter = resolveFilter(params);
```

Change to:
```tsx
  await requireModuleAccess("pemesanan");
  const params = await searchParams;
  const filter = resolveFilter(params);
  const todayISO = getBusinessDateISO();
```

Find:
```tsx
        <PemesananFormDialog
          mitraList={mitraList}
          armadaList={armadaList}
          drivers={drivers}
          priceLevels10kg={priceLevels10kg}
          priceLevels5kg={priceLevels5kg}
        />
```

Change to:
```tsx
        <PemesananFormDialog
          mitraList={mitraList}
          armadaList={armadaList}
          drivers={drivers}
          priceLevels10kg={priceLevels10kg}
          priceLevels5kg={priceLevels5kg}
          todayISO={todayISO}
        />
```

- [ ] **Step 2: Edit `src/components/dashboard/pemesanan-form-dialog.tsx`**

Find:
```tsx
export function PemesananFormDialog({
  mitraList,
  armadaList,
  drivers,
  priceLevels10kg,
  priceLevels5kg,
}: {
  mitraList: MitraRow[];
  armadaList: ArmadaRow[];
  drivers: DriverOption[];
  priceLevels10kg: PriceLevelOption[];
  priceLevels5kg: PriceLevelOption[];
}) {
```

Change to:
```tsx
export function PemesananFormDialog({
  mitraList,
  armadaList,
  drivers,
  priceLevels10kg,
  priceLevels5kg,
  todayISO,
}: {
  mitraList: MitraRow[];
  armadaList: ArmadaRow[];
  drivers: DriverOption[];
  priceLevels10kg: PriceLevelOption[];
  priceLevels5kg: PriceLevelOption[];
  todayISO: string;
}) {
```

Find:
```tsx
                <Input id="tanggal" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
```

Change to:
```tsx
                <Input id="tanggal" type="date" min={todayISO} value={date} onChange={(e) => setDate(e.target.value)} />
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/pemesanan/page.tsx" src/components/dashboard/pemesanan-form-dialog.tsx
git commit -m "Floor Pemesanan's delivery-date picker at today's business date"
```

---

### Task 3: Armada fuel/tax fields — query layer

**Files:**
- Create: `src/lib/armada-fuel.ts`
- Modify: `src/lib/queries/armada.ts`

**Interfaces:**
- Produces: `FUEL_TYPES`, `type FuelType` (from `armada-fuel.ts`, re-exported from `armada.ts` the same way `ARMADA_STATUS` already is). `ArmadaRow`/`ArmadaInput` both gain `jenisBBM`/`JenisBBM: FuelType | null`, `biayaBBMPerLiter`/`BiayaBBMPerLiter: number | null`, `pajakLimaTahunan`/`PajakLimaTahunan: string | null`, `biayaPajakLimaTahunan`/`BiayaPajakLimaTahunan: number | null`.

- [ ] **Step 1: Write `src/lib/armada-fuel.ts`**

```ts
export const FUEL_TYPES = ["Pertalite", "Pertamax", "Pertamax Turbo", "Solar", "Dexlite"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];
```

- [ ] **Step 2: Rewrite `src/lib/queries/armada.ts`**

Replace the entire file with:

```ts
import { getPool, sql } from "@/lib/db";
import { ARMADA_STATUS, type ArmadaStatus } from "@/lib/armada-status";
import { FUEL_TYPES, type FuelType } from "@/lib/armada-fuel";

export { ARMADA_STATUS, type ArmadaStatus, FUEL_TYPES, type FuelType };

export interface ArmadaRow {
  ArmadaID: number;
  Nama: string;
  PlatNomor: string | null;
  Brand: string | null;
  Model: string | null;
  KonsumsiBBM: number | null;
  KapasitasMaks: number | null;
  Status: ArmadaStatus;
  FotoPath: string | null;
  JenisBBM: FuelType | null;
  BiayaBBMPerLiter: number | null;
  PajakLimaTahunan: string | Date | null;
  BiayaPajakLimaTahunan: number | null;
}

export interface ArmadaInput {
  nama: string;
  platNomor: string | null;
  brand: string | null;
  model: string | null;
  konsumsiBBM: number | null;
  kapasitasMaks: number | null;
  status: ArmadaStatus;
  fotoPath: string | null;
  jenisBBM: FuelType | null;
  biayaBBMPerLiter: number | null;
  pajakLimaTahunan: string | null;
  biayaPajakLimaTahunan: number | null;
}

export async function getArmadaList(): Promise<ArmadaRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ArmadaID, Nama, PlatNomor, Brand, Model, KonsumsiBBM, KapasitasMaks, Status, FotoPath,
           JenisBBM, BiayaBBMPerLiter, PajakLimaTahunan, BiayaPajakLimaTahunan
    FROM DashboardArmada
    WHERE IsDeleted = 0
    ORDER BY Nama
  `);
  return result.recordset;
}

export async function createArmada(input: ArmadaInput): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("nama", sql.VarChar(128), input.nama)
    .input("platNomor", sql.VarChar(20), input.platNomor)
    .input("brand", sql.VarChar(64), input.brand)
    .input("model", sql.VarChar(64), input.model)
    .input("konsumsiBBM", sql.Decimal(10, 2), input.konsumsiBBM)
    .input("kapasitasMaks", sql.Decimal(23, 4), input.kapasitasMaks)
    .input("status", sql.VarChar(20), input.status)
    .input("fotoPath", sql.VarChar(256), input.fotoPath)
    .input("jenisBBM", sql.VarChar(20), input.jenisBBM)
    .input("biayaBBMPerLiter", sql.Decimal(18, 2), input.biayaBBMPerLiter)
    .input("pajakLimaTahunan", sql.Date, input.pajakLimaTahunan)
    .input("biayaPajakLimaTahunan", sql.Decimal(18, 2), input.biayaPajakLimaTahunan).query(`
      INSERT INTO DashboardArmada
        (Nama, PlatNomor, Brand, Model, KonsumsiBBM, KapasitasMaks, Status, FotoPath, IsDeleted, ModifiedDate,
         JenisBBM, BiayaBBMPerLiter, PajakLimaTahunan, BiayaPajakLimaTahunan)
      OUTPUT inserted.ArmadaID
      VALUES
        (@nama, @platNomor, @brand, @model, @konsumsiBBM, @kapasitasMaks, @status, @fotoPath, 0, GETDATE(),
         @jenisBBM, @biayaBBMPerLiter, @pajakLimaTahunan, @biayaPajakLimaTahunan)
    `);
  return (result.recordset[0] as { ArmadaID: number }).ArmadaID;
}

export async function updateArmada(id: number, input: ArmadaInput): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .input("nama", sql.VarChar(128), input.nama)
    .input("platNomor", sql.VarChar(20), input.platNomor)
    .input("brand", sql.VarChar(64), input.brand)
    .input("model", sql.VarChar(64), input.model)
    .input("konsumsiBBM", sql.Decimal(10, 2), input.konsumsiBBM)
    .input("kapasitasMaks", sql.Decimal(23, 4), input.kapasitasMaks)
    .input("status", sql.VarChar(20), input.status)
    .input("fotoPath", sql.VarChar(256), input.fotoPath)
    .input("jenisBBM", sql.VarChar(20), input.jenisBBM)
    .input("biayaBBMPerLiter", sql.Decimal(18, 2), input.biayaBBMPerLiter)
    .input("pajakLimaTahunan", sql.Date, input.pajakLimaTahunan)
    .input("biayaPajakLimaTahunan", sql.Decimal(18, 2), input.biayaPajakLimaTahunan).query(`
      UPDATE DashboardArmada SET
        Nama = @nama, PlatNomor = @platNomor, Brand = @brand, Model = @model,
        KonsumsiBBM = @konsumsiBBM, KapasitasMaks = @kapasitasMaks, Status = @status, FotoPath = @fotoPath,
        JenisBBM = @jenisBBM, BiayaBBMPerLiter = @biayaBBMPerLiter,
        PajakLimaTahunan = @pajakLimaTahunan, BiayaPajakLimaTahunan = @biayaPajakLimaTahunan,
        ModifiedDate = GETDATE()
      WHERE ArmadaID = @id
    `);
}

export async function deleteArmada(id: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .query(`UPDATE DashboardArmada SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE ArmadaID = @id`);
}
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: errors will appear in `armada-dialog.tsx` (Task 4 fixes these) — confirm no errors in `armada.ts` or `armada-fuel.ts` themselves.

- [ ] **Step 4: Commit**

```bash
git add src/lib/armada-fuel.ts src/lib/queries/armada.ts
git commit -m "Add Jenis BBM, Biaya BBM/Liter, Pajak 5 Tahunan fields to DashboardArmada"
```

---

### Task 4: Armada fuel/tax fields — UI

**Files:**
- Modify: `src/components/dashboard/armada-dialog.tsx`

**Interfaces:**
- Consumes: `FUEL_TYPES`, `type FuelType` from Task 3 (`@/lib/armada-fuel` — import from there directly, not from `@/lib/queries/armada`, per the Global Constraint on client-safe imports).

- [ ] **Step 1: Edit `src/components/dashboard/armada-dialog.tsx`**

Add to the imports:
```ts
import { FUEL_TYPES, type FuelType } from "@/lib/armada-fuel";
```

Find:
```ts
function emptyForm(): ArmadaInput {
  return {
    nama: "",
    platNomor: null,
    brand: null,
    model: null,
    konsumsiBBM: null,
    kapasitasMaks: null,
    status: "Baik",
    fotoPath: null,
  };
}
```

Change to:
```ts
function emptyForm(): ArmadaInput {
  return {
    nama: "",
    platNomor: null,
    brand: null,
    model: null,
    konsumsiBBM: null,
    kapasitasMaks: null,
    status: "Baik",
    fotoPath: null,
    jenisBBM: null,
    biayaBBMPerLiter: null,
    pajakLimaTahunan: null,
    biayaPajakLimaTahunan: null,
  };
}
```

Find:
```ts
function rowToForm(row: ArmadaRow): ArmadaInput {
  return {
    nama: row.Nama,
    platNomor: row.PlatNomor,
    brand: row.Brand,
    model: row.Model,
    konsumsiBBM: row.KonsumsiBBM,
    kapasitasMaks: row.KapasitasMaks,
    status: row.Status,
    fotoPath: row.FotoPath,
  };
}
```

Change to (`PajakLimaTahunan` may come back as a `Date` — normalize to a plain `YYYY-MM-DD` string for the date `Input`, same shape `ArmadaInput.pajakLimaTahunan` expects):
```ts
function rowToForm(row: ArmadaRow): ArmadaInput {
  return {
    nama: row.Nama,
    platNomor: row.PlatNomor,
    brand: row.Brand,
    model: row.Model,
    konsumsiBBM: row.KonsumsiBBM,
    kapasitasMaks: row.KapasitasMaks,
    status: row.Status,
    fotoPath: row.FotoPath,
    jenisBBM: row.JenisBBM,
    biayaBBMPerLiter: row.BiayaBBMPerLiter,
    pajakLimaTahunan: row.PajakLimaTahunan ? new Date(row.PajakLimaTahunan).toISOString().slice(0, 10) : null,
    biayaPajakLimaTahunan: row.BiayaPajakLimaTahunan,
  };
}
```

Inside `ArmadaFormDialog`, find:
```ts
  const [fotoPath, setFotoPath] = useState(initial.fotoPath);
  const [status, setStatus] = useState<ArmadaStatus>(initial.status);
```

Change to:
```ts
  const [fotoPath, setFotoPath] = useState(initial.fotoPath);
  const [status, setStatus] = useState<ArmadaStatus>(initial.status);
  const [jenisBBM, setJenisBBM] = useState<FuelType | null>(initial.jenisBBM);
```

Find:
```ts
  function handleSubmit(formData: FormData) {
    onSubmit({
      nama: String(formData.get("nama") ?? ""),
      platNomor: String(formData.get("platNomor") ?? "") || null,
      brand: String(formData.get("brand") ?? "") || null,
      model: String(formData.get("model") ?? "") || null,
      konsumsiBBM: formData.get("konsumsiBBM") ? Number(formData.get("konsumsiBBM")) : null,
      kapasitasMaks: formData.get("kapasitasMaks") ? Number(formData.get("kapasitasMaks")) : null,
      status,
      fotoPath,
    });
  }
```

Change to:
```ts
  function handleSubmit(formData: FormData) {
    onSubmit({
      nama: String(formData.get("nama") ?? ""),
      platNomor: String(formData.get("platNomor") ?? "") || null,
      brand: String(formData.get("brand") ?? "") || null,
      model: String(formData.get("model") ?? "") || null,
      konsumsiBBM: formData.get("konsumsiBBM") ? Number(formData.get("konsumsiBBM")) : null,
      kapasitasMaks: formData.get("kapasitasMaks") ? Number(formData.get("kapasitasMaks")) : null,
      status,
      fotoPath,
      jenisBBM,
      biayaBBMPerLiter: formData.get("biayaBBMPerLiter") ? Number(formData.get("biayaBBMPerLiter")) : null,
      pajakLimaTahunan: String(formData.get("pajakLimaTahunan") ?? "") || null,
      biayaPajakLimaTahunan: formData.get("biayaPajakLimaTahunan") ? Number(formData.get("biayaPajakLimaTahunan")) : null,
    });
  }
```

Find the `onOpenChange` reset block:
```ts
        if (next) {
          setFotoPath(initial.fotoPath);
          setStatus(initial.status);
          setUploadError(null);
        }
```

Change to:
```ts
        if (next) {
          setFotoPath(initial.fotoPath);
          setStatus(initial.status);
          setJenisBBM(initial.jenisBBM);
          setUploadError(null);
        }
```

Find the Kapasitas Maks field block (the last field before the "Foto Armada" section) and insert 4 new fields right after it, still inside the same `<form className="grid grid-cols-2 gap-3">`:

```tsx
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kapasitasMaks" className="sr-only">Kapasitas Maks (kantong)</Label>
            <Input
              id="kapasitasMaks"
              name="kapasitasMaks"
              type="number"
              placeholder="Kapasitas Maks (kantong)"
              defaultValue={initial.kapasitasMaks ?? ""}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="sr-only">Jenis BBM</Label>
            <Select value={jenisBBM ?? ""} onValueChange={(v) => setJenisBBM((v as FuelType) || null)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Jenis BBM">{(v: string) => v || "Jenis BBM"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FUEL_TYPES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="biayaBBMPerLiter" className="sr-only">Biaya BBM/Liter (Rp)</Label>
            <Input
              id="biayaBBMPerLiter"
              name="biayaBBMPerLiter"
              type="number"
              step="1"
              placeholder="Biaya BBM/Liter (Rp)"
              defaultValue={initial.biayaBBMPerLiter ?? ""}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pajakLimaTahunan" className="text-xs text-muted-foreground">
              Jatuh Tempo Pajak 5 Tahunan
            </Label>
            <Input id="pajakLimaTahunan" name="pajakLimaTahunan" type="date" defaultValue={initial.pajakLimaTahunan ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="biayaPajakLimaTahunan" className="sr-only">Biaya Pajak 5 Tahunan (Rp)</Label>
            <Input
              id="biayaPajakLimaTahunan"
              name="biayaPajakLimaTahunan"
              type="number"
              step="1"
              placeholder="Biaya Pajak 5 Tahunan (Rp)"
              defaultValue={initial.biayaPajakLimaTahunan ?? ""}
            />
          </div>
```

(This replaces the original single Kapasitas Maks block with the same block followed immediately by the 4 new fields — read the current file to confirm the exact surrounding braces before editing, since this description shows the anchor plus the insertion together.)

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/armada-dialog.tsx
git commit -m "Add Jenis BBM/Biaya BBM/Pajak 5 Tahunan fields to Kelola Armada form"
```

---

### Task 5: `JarakKM` persistence — backend

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts`

**Interfaces:**
- `JadwalCard` gains `JarakKM: number | null`. `getPengirimanBoard`'s SQL selects/groups it. `startBerangkat` captures the validated route's distance and writes it.

- [ ] **Step 1: Add `MultiPointRoute` to the existing osrm import**

Find:
```ts
import { getMultiPointRoute } from "@/lib/osrm";
```

Change to:
```ts
import { getMultiPointRoute, type MultiPointRoute } from "@/lib/osrm";
```

- [ ] **Step 2: Extend `JadwalCard` and `getPengirimanBoard`'s SQL**

Find:
```ts
export interface JadwalCard {
  JadwalID: number;
  ArmadaID: number;
  SalesmanID: string | null;
  DriverName: string | null;
  JamJadwal: string | Date;
  JamMulaiMuat: string | Date | null;
  JamAktualBerangkat: string | Date | null;
  Status: JadwalStatus;
  TotalKantong: number;
  // Renamed from TotalDO — during Draft this counts SO lines, not DO
  // documents (there are none yet). Same count either way since one SO
  // becomes exactly one DO, just a more accurate name.
  TotalStop: number;
}
```

Change to:
```ts
export interface JadwalCard {
  JadwalID: number;
  ArmadaID: number;
  SalesmanID: string | null;
  DriverName: string | null;
  JamJadwal: string | Date;
  JamMulaiMuat: string | Date | null;
  JamAktualBerangkat: string | Date | null;
  Status: JadwalStatus;
  TotalKantong: number;
  // Renamed from TotalDO — during Draft this counts SO lines, not DO
  // documents (there are none yet). Same count either way since one SO
  // becomes exactly one DO, just a more accurate name.
  TotalStop: number;
  // Only ever set once, at startBerangkat — null for every Draft.
  JarakKM: number | null;
}
```

Find (inside `getPengirimanBoard`'s SQL):
```ts
        SELECT
            j.JadwalID,
            j.ArmadaID,
            j.SalesmanID,
            sm.Name AS DriverName,
            j.JamJadwal,
            j.JamMulaiMuat,
            j.JamAktualBerangkat,
            j.Status,
            ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS TotalKantong,
            COUNT(DISTINCT jd.JadwalDetailID) AS TotalStop
        FROM DashboardPengirimanJadwal j
        LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
        LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
        LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
        WHERE j.IsDeleted = 0
          AND j.JamJadwal >= DATEADD(HOUR, -7, CAST(@businessDate AS DATETIME)) AND j.JamJadwal < DATEADD(HOUR, -7, DATEADD(DAY, 1, CAST(@businessDate AS DATETIME)))
        GROUP BY j.JadwalID, j.ArmadaID, j.SalesmanID, sm.Name, j.JamJadwal, j.JamMulaiMuat, j.JamAktualBerangkat, j.Status
        ORDER BY j.JamJadwal
```

Change to:
```ts
        SELECT
            j.JadwalID,
            j.ArmadaID,
            j.SalesmanID,
            sm.Name AS DriverName,
            j.JamJadwal,
            j.JamMulaiMuat,
            j.JamAktualBerangkat,
            j.Status,
            ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS TotalKantong,
            COUNT(DISTINCT jd.JadwalDetailID) AS TotalStop,
            j.JarakKM
        FROM DashboardPengirimanJadwal j
        LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
        LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
        LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
        WHERE j.IsDeleted = 0
          AND j.JamJadwal >= DATEADD(HOUR, -7, CAST(@businessDate AS DATETIME)) AND j.JamJadwal < DATEADD(HOUR, -7, DATEADD(DAY, 1, CAST(@businessDate AS DATETIME)))
        GROUP BY j.JadwalID, j.ArmadaID, j.SalesmanID, sm.Name, j.JamJadwal, j.JamMulaiMuat, j.JamAktualBerangkat, j.Status, j.JarakKM
        ORDER BY j.JamJadwal
```

- [ ] **Step 3: Capture and persist the route distance in `startBerangkat`**

Find:
```ts
  const pabrik = await getPabrikLocation();
  try {
    await getMultiPointRoute([
      { lat: pabrik.latitude, lng: pabrik.longitude },
      ...stopsForRouteCheck.map((s) => ({ lat: s.Latitude as number, lng: s.Longitude as number })),
      { lat: pabrik.latitude, lng: pabrik.longitude },
    ]);
  } catch {
    throw new Error("Rute belum berhasil divalidasi — pastikan seluruh tujuan punya lokasi tersimpan.");
  }
```

Change to:
```ts
  const pabrik = await getPabrikLocation();
  let validatedRoute: MultiPointRoute;
  try {
    validatedRoute = await getMultiPointRoute([
      { lat: pabrik.latitude, lng: pabrik.longitude },
      ...stopsForRouteCheck.map((s) => ({ lat: s.Latitude as number, lng: s.Longitude as number })),
      { lat: pabrik.latitude, lng: pabrik.longitude },
    ]);
  } catch {
    throw new Error("Rute belum berhasil divalidasi — pastikan seluruh tujuan punya lokasi tersimpan.");
  }
```

Find the claim UPDATE:
```ts
  const claim = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(
      `UPDATE DashboardPengirimanJadwal SET Status = 'Terbit', JamAktualBerangkat = GETDATE(), ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId AND Status = 'Draft'`
    );
```

Change to:
```ts
  const claim = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("jarakKM", sql.Decimal(10, 2), validatedRoute.distanceKm)
    .query(
      `UPDATE DashboardPengirimanJadwal SET Status = 'Terbit', JamAktualBerangkat = GETDATE(), JarakKM = @jarakKM, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId AND Status = 'Draft'`
    );
```

Find the failure-path rollback (in the `catch` block near the end of `startBerangkat`):
```ts
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .query(
        `UPDATE DashboardPengirimanJadwal SET Status = 'Draft', JamAktualBerangkat = NULL, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`
      );
    throw err;
```

Change to:
```ts
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .query(
        `UPDATE DashboardPengirimanJadwal SET Status = 'Draft', JamAktualBerangkat = NULL, JarakKM = NULL, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`
      );
    throw err;
```

- [ ] **Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `pengiriman-jadwal.ts` (Task 6 will consume the new `JarakKM` field).

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts
git commit -m "Persist validated route distance (JarakKM) at Berangkat"
```

---

### Task 6: Papan Pengiriman armada row — Kapasitas/Kantong/Jarak stats

**Files:**
- Modify: `src/components/dashboard/pengiriman-board.tsx`

**Interfaces:**
- Consumes: `JadwalCard.JarakKM` from Task 5.

- [ ] **Step 1: Edit `ArmadaRowBoard` in `src/components/dashboard/pengiriman-board.tsx`**

Find:
```tsx
function ArmadaRowBoard({
  armada,
  jadwal,
  hourWidth,
  dayWidth,
  onCardClick,
  onCreateClick,
}: {
  armada: ArmadaRow;
  jadwal: JadwalCardData[];
  hourWidth: number;
  dayWidth: number;
  onCardClick: (jadwalId: number) => void;
  onCreateClick: (armadaId: number) => void;
}) {
  const cardWidth = Math.max(MIN_CARD_WIDTH, hourWidth - 6);
  return (
```

Change to:
```tsx
function ArmadaRowBoard({
  armada,
  jadwal,
  hourWidth,
  dayWidth,
  onCardClick,
  onCreateClick,
}: {
  armada: ArmadaRow;
  jadwal: JadwalCardData[];
  hourWidth: number;
  dayWidth: number;
  onCardClick: (jadwalId: number) => void;
  onCreateClick: (armadaId: number) => void;
}) {
  const cardWidth = Math.max(MIN_CARD_WIDTH, hourWidth - 6);
  const totalKantongHariIni = jadwal.reduce((sum, j) => sum + j.TotalKantong, 0);
  // "telah ditempuh" (already traveled) — only Jadwal that actually
  // departed (JamAktualBerangkat set) contribute; a Draft hasn't gone
  // anywhere yet, so it contributes 0 regardless of its JarakKM (which is
  // always null for a Draft anyway — JarakKM is only ever set at
  // startBerangkat).
  const totalJarakHariIni = jadwal
    .filter((j) => j.JamAktualBerangkat != null)
    .reduce((sum, j) => sum + (j.JarakKM ?? 0), 0);
  return (
```

Find:
```tsx
        <div className="flex items-center justify-between gap-1">
          <Badge
            variant="outline"
            className={cn(
              "h-5 px-1.5 text-[10px]",
              armada.Status === "Baik" && "border-primary/30 text-primary",
              armada.Status !== "Baik" && "border-destructive/30 text-destructive"
            )}
          >
            {armada.Status}
          </Badge>
          <Button
            variant="outline"
            size="icon"
            className="size-6"
            disabled={armada.Status !== "Baik"}
            onClick={() => onCreateClick(armada.ArmadaID)}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>
```

Change to:
```tsx
        <div className="flex items-center justify-between gap-1">
          <Badge
            variant="outline"
            className={cn(
              "h-5 px-1.5 text-[10px]",
              armada.Status === "Baik" && "border-primary/30 text-primary",
              armada.Status !== "Baik" && "border-destructive/30 text-destructive"
            )}
          >
            {armada.Status}
          </Badge>
          <Button
            variant="outline"
            size="icon"
            className="size-6"
            disabled={armada.Status !== "Baik"}
            onClick={() => onCreateClick(armada.ArmadaID)}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-md border bg-muted/20 px-1.5 py-1 text-center">
          <div>
            <p className="text-[9px] text-muted-foreground">Kapasitas</p>
            <p className="text-xs font-medium tabular-nums">{armada.KapasitasMaks ?? "-"}</p>
          </div>
          <div>
            <p className="text-[9px] text-muted-foreground">Kantong</p>
            <p className="text-xs font-medium tabular-nums">{totalKantongHariIni}</p>
          </div>
          <div>
            <p className="text-[9px] text-muted-foreground">Jarak</p>
            <p className="text-xs font-medium tabular-nums">
              {totalJarakHariIni.toLocaleString("id-ID", { maximumFractionDigits: 1 })} km
            </p>
          </div>
        </div>
      </div>
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/pengiriman-board.tsx
git commit -m "Show Kapasitas/Kantong/Jarak stats on Papan Pengiriman armada rows"
```

---

### Task 7: Validasi Rute — Jenis BBM + Total Biaya BBM

**Files:**
- Modify: `src/components/dashboard/route-validation-dialog.tsx`
- Modify: `src/components/dashboard/pengiriman-board.tsx`

**Interfaces:**
- `RouteValidationDialog` gains props `jenisBBM: FuelType | null; biayaBBMPerLiter: number | null`.

- [ ] **Step 1: Edit `src/components/dashboard/route-validation-dialog.tsx`**

Find:
```ts
import { formatDate, formatTime } from "@/lib/format";
```

Change to:
```ts
import { formatDate, formatRupiah, formatTime } from "@/lib/format";
```

Add an import for the type:
```ts
import type { FuelType } from "@/lib/armada-fuel";
```

Find:
```ts
export function RouteValidationDialog({
  jadwal,
  businessDate,
  drivers,
  konsumsiBBM,
  kapasitasMaks,
  onOpenChange,
  onDeleted,
}: {
  jadwal: JadwalCardData | null;
  businessDate: string;
  drivers: DriverOption[];
  // Fuel estimate input — the Armada the open Jadwal belongs to, resolved
  // by the caller (JadwalCard itself doesn't carry KonsumsiBBM, ArmadaRow
  // does).
  konsumsiBBM: number | null;
  // Capacity hard-block input, same resolution path as konsumsiBBM. Null
  // means no limit has been configured, so nothing is blocked.
  kapasitasMaks: number | null;
  onOpenChange: (open: boolean) => void;
  // Fired after a successful "Batalkan Draft" so the caller can close this
  // dialog (it has no Jadwal left to show once deleted).
  onDeleted?: () => void;
}) {
```

Change to:
```ts
export function RouteValidationDialog({
  jadwal,
  businessDate,
  drivers,
  konsumsiBBM,
  kapasitasMaks,
  jenisBBM,
  biayaBBMPerLiter,
  onOpenChange,
  onDeleted,
}: {
  jadwal: JadwalCardData | null;
  businessDate: string;
  drivers: DriverOption[];
  // Fuel estimate input — the Armada the open Jadwal belongs to, resolved
  // by the caller (JadwalCard itself doesn't carry KonsumsiBBM, ArmadaRow
  // does).
  konsumsiBBM: number | null;
  // Capacity hard-block input, same resolution path as konsumsiBBM. Null
  // means no limit has been configured, so nothing is blocked.
  kapasitasMaks: number | null;
  // Same resolution path as konsumsiBBM/kapasitasMaks — both null when
  // the Armada hasn't had these fields filled in yet.
  jenisBBM: FuelType | null;
  biayaBBMPerLiter: number | null;
  onOpenChange: (open: boolean) => void;
  // Fired after a successful "Batalkan Draft" so the caller can close this
  // dialog (it has no Jadwal left to show once deleted).
  onDeleted?: () => void;
}) {
```

Find:
```ts
  const totalFuelLiters = useMemo(() => {
    if (route == null || konsumsiBBM == null) return null;
    return Math.round(route.distanceKm * konsumsiBBM * 10) / 10;
  }, [route, konsumsiBBM]);
```

Change to:
```ts
  const totalFuelLiters = useMemo(() => {
    if (route == null || konsumsiBBM == null) return null;
    return Math.round(route.distanceKm * konsumsiBBM * 10) / 10;
  }, [route, konsumsiBBM]);
  const totalFuelCost = useMemo(() => {
    if (totalFuelLiters == null || biayaBBMPerLiter == null) return null;
    return Math.round(totalFuelLiters * biayaBBMPerLiter);
  }, [totalFuelLiters, biayaBBMPerLiter]);
```

Find:
```tsx
                {totalFuelLiters != null && (
                  <span className="flex items-center gap-1">
                    <Fuel className="size-3.5 text-muted-foreground" />
                    {totalFuelLiters.toLocaleString("id-ID")} L
                  </span>
                )}
              </div>
            )}
```

Change to:
```tsx
                {totalFuelLiters != null && (
                  <span className="flex items-center gap-1">
                    <Fuel className="size-3.5 text-muted-foreground" />
                    {totalFuelLiters.toLocaleString("id-ID")} L
                    {jenisBBM && ` (${jenisBBM})`}
                  </span>
                )}
                {totalFuelCost != null && (
                  <span className="flex items-center gap-1 font-medium">{formatRupiah(totalFuelCost)}</span>
                )}
              </div>
            )}
```

- [ ] **Step 2: Edit `src/components/dashboard/pengiriman-board.tsx`**

Find:
```tsx
      <RouteValidationDialog
        jadwal={openJadwal}
        businessDate={businessDate}
        drivers={drivers}
        konsumsiBBM={openArmada?.KonsumsiBBM ?? null}
        kapasitasMaks={openArmada?.KapasitasMaks ?? null}
        onOpenChange={(open) => !open && setDetailJadwalId(null)}
        onDeleted={() => setDetailJadwalId(null)}
      />
```

Change to:
```tsx
      <RouteValidationDialog
        jadwal={openJadwal}
        businessDate={businessDate}
        drivers={drivers}
        konsumsiBBM={openArmada?.KonsumsiBBM ?? null}
        kapasitasMaks={openArmada?.KapasitasMaks ?? null}
        jenisBBM={openArmada?.JenisBBM ?? null}
        biayaBBMPerLiter={openArmada?.BiayaBBMPerLiter ?? null}
        onOpenChange={(open) => !open && setDetailJadwalId(null)}
        onDeleted={() => setDetailJadwalId(null)}
      />
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/route-validation-dialog.tsx src/components/dashboard/pengiriman-board.tsx
git commit -m "Show Jenis BBM and Total Biaya BBM in Validasi Rute"
```

---

### Task 8: Ubah Pemesanan — backend

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts`
- Modify: `src/lib/queries/pemesanan.ts`

**Interfaces:**
- Produces (`pengiriman-jadwal.ts`): `removeSalesOrderFromJadwal(jadwalId: number, salesOrderId: string): Promise<void>`, `CurrentAssignment { jadwalId: number; armadaId: number; jamJadwal: Date; salesmanId: string | null }`, `getCurrentAssignment(salesOrderId: string): Promise<CurrentAssignment | null>`.
- Produces (`pemesanan.ts`): `ReschedulePemesananInput { salesOrderId: string; armadaId: number; deliveryDateTime: Date; salesmanId: string | null }`, `reschedulePemesanan(input: ReschedulePemesananInput): Promise<{ jadwalId: number }>`.

- [ ] **Step 1: Append to `src/lib/queries/pengiriman-jadwal.ts`**

Add at the end of the file:

```ts
// Detaches one SO from a Draft without disturbing the other SOs still
// bundled in it — the gap "Batalkan Draft" (whole-departure cancel) and
// "Tambahkan" (add-only) leave: there was no way to move a single stop to
// a different vehicle/time. If this was the last remaining stop, the
// now-empty Draft is cleaned up too, mirroring deleteJadwalDraft's own
// discipline of never leaving a visible-but-empty ghost Draft.
export async function removeSalesOrderFromJadwal(jadwalId: number, salesOrderId: string): Promise<void> {
  const pool = await getPool();
  const header = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT Status FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const status = (header.recordset[0] as { Status: JadwalStatus } | undefined)?.Status;
  if (status !== "Draft") {
    throw new Error("Hanya SO pada keberangkatan berstatus Draft yang bisa diubah penjadwalannya.");
  }

  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("soId", sql.VarChar(16), salesOrderId)
    .query(`UPDATE DashboardPengirimanJadwalDetail SET IsDeleted = 1 WHERE JadwalID = @jadwalId AND SalesOrderID = @soId AND IsDeleted = 0`);

  const remaining = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT COUNT(*) AS Cnt FROM DashboardPengirimanJadwalDetail WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const cnt = (remaining.recordset[0] as { Cnt: number }).Cnt;
  if (cnt === 0) {
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .query(`UPDATE DashboardPengirimanJadwal SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
  }
}

export interface CurrentAssignment {
  jadwalId: number;
  armadaId: number;
  jamJadwal: Date;
  salesmanId: string | null;
}

// Resolves a Sales Order's current Draft assignment, if any — used to
// pre-fill "Ubah Pemesanan". Deliberately Draft-only (Status = 'Draft'):
// once a Jadwal is Terbit, reassigning driver/vehicle already has its own
// established path (RouteValidationDialog's "Simpan", which cascades onto
// the real DeliveryOrder) — that's a different edit surface from this one.
export async function getCurrentAssignment(salesOrderId: string): Promise<CurrentAssignment | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("salesOrderId", sql.VarChar(16), salesOrderId).query(`
      SELECT TOP 1 j.JadwalID, j.ArmadaID, j.JamJadwal, j.SalesmanID
      FROM DashboardPengirimanJadwalDetail jd
      JOIN DashboardPengirimanJadwal j ON j.JadwalID = jd.JadwalID AND j.IsDeleted = 0 AND j.Status = 'Draft'
      WHERE jd.SalesOrderID = @salesOrderId AND jd.IsDeleted = 0
      ORDER BY jd.JadwalDetailID DESC
    `);
  const row = result.recordset[0] as { JadwalID: number; ArmadaID: number; JamJadwal: Date; SalesmanID: string | null } | undefined;
  if (!row) return null;
  return { jadwalId: row.JadwalID, armadaId: row.ArmadaID, jamJadwal: row.JamJadwal, salesmanId: row.SalesmanID };
}
```

- [ ] **Step 2: Append to `src/lib/queries/pemesanan.ts`**

Add to the imports (merge with the existing `import { createJadwalDraft, updateJadwalDriverTime } from "@/lib/queries/pengiriman-jadwal";` line):
```ts
import {
  createJadwalDraft,
  updateJadwalDriverTime,
  getCurrentAssignment,
  removeSalesOrderFromJadwal,
} from "@/lib/queries/pengiriman-jadwal";
```

Add at the end of the file:
```ts
export interface ReschedulePemesananInput {
  salesOrderId: string;
  armadaId: number;
  deliveryDateTime: Date;
  salesmanId: string | null;
}

// Moves ONE Sales Order to a different armada/waktu/driver without
// touching whatever other SOs are still bundled in its current Draft (if
// it's currently assigned to one at all — a never-scheduled SO, status
// "Belum Dijadwalkan", has no current assignment and this just schedules
// it fresh). Reuses createJadwalDraft/updateJadwalDriverTime exactly as
// createPemesanan already does, so the same capacity check and
// JamJadwal-not-before-TransDate validation (pengiriman-jadwal.ts) apply
// here too — nothing about this path bypasses either rule.
export async function reschedulePemesanan(input: ReschedulePemesananInput): Promise<{ jadwalId: number }> {
  const current = await getCurrentAssignment(input.salesOrderId);
  if (current) {
    await removeSalesOrderFromJadwal(current.jadwalId, input.salesOrderId);
  }

  const jadwalId = await createJadwalDraft({
    armadaId: input.armadaId,
    jamJadwal: input.deliveryDateTime,
    salesOrderIds: [input.salesOrderId],
  });

  if (input.salesmanId) {
    await updateJadwalDriverTime(jadwalId, {
      jamJadwal: input.deliveryDateTime,
      salesmanId: input.salesmanId,
    });
  }

  return { jadwalId };
}
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts src/lib/queries/pemesanan.ts
git commit -m "Add removeSalesOrderFromJadwal, getCurrentAssignment, reschedulePemesanan"
```

---

### Task 9: Ubah Pemesanan — server actions

**Files:**
- Modify: `src/app/(dashboard)/pemesanan/actions.ts`

**Interfaces:**
- Produces: `getCurrentAssignmentAction(salesOrderId: string): Promise<CurrentAssignment | null>`, `reschedulePemesananAction(input: ReschedulePemesananInput): Promise<{ jadwalId: number }>`.

- [ ] **Step 1: Rewrite `src/app/(dashboard)/pemesanan/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import {
  createPemesanan,
  reschedulePemesanan,
  type CreatePemesananInput,
  type CreatePemesananResult,
  type ReschedulePemesananInput,
} from "@/lib/queries/pemesanan";
import { getCurrentAssignment, type CurrentAssignment } from "@/lib/queries/pengiriman-jadwal";

export async function createPemesananAction(input: CreatePemesananInput): Promise<CreatePemesananResult> {
  const result = await createPemesanan(input);
  revalidatePath("/pemesanan");
  revalidatePath("/delivery");
  return result;
}

export async function reschedulePemesananAction(input: ReschedulePemesananInput): Promise<{ jadwalId: number }> {
  const result = await reschedulePemesanan(input);
  revalidatePath("/pemesanan");
  revalidatePath("/delivery");
  return result;
}

// Read-only — no revalidatePath needed, fetched on demand when the "Ubah
// Pemesanan" dialog opens.
export async function getCurrentAssignmentAction(salesOrderId: string): Promise<CurrentAssignment | null> {
  return getCurrentAssignment(salesOrderId);
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/pemesanan/actions.ts"
git commit -m "Add Ubah Pemesanan server actions"
```

---

### Task 10: "Ubah Pemesanan" dialog component

**Files:**
- Create: `src/components/dashboard/ubah-pemesanan-dialog.tsx`

**Interfaces:**
- Consumes: `getCurrentAssignmentAction`, `reschedulePemesananAction` from Task 9 (`@/app/(dashboard)/pemesanan/actions`); `type ArmadaRow` (existing, `@/lib/queries/armada`); `type DriverOption` (existing, `@/lib/queries/delivery`).
- Produces: `UbahPemesananTarget { salesOrderId: string; customerName: string; wilayah: string; qty: number }`, `UbahPemesananDialog({ target, onOpenChange, armadaList, drivers }: { target: UbahPemesananTarget | null; onOpenChange: (open: boolean) => void; armadaList: ArmadaRow[]; drivers: DriverOption[] })`. Controlled the same way `RouteValidationDialog` is (`target === null` means closed) — not self-contained, since two different pages need to trigger it.

- [ ] **Step 1: Write `src/components/dashboard/ubah-pemesanan-dialog.tsx`**

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ArmadaRow } from "@/lib/queries/armada";
import type { DriverOption } from "@/lib/queries/delivery";
import { getCurrentAssignmentAction, reschedulePemesananAction } from "@/app/(dashboard)/pemesanan/actions";

const UNSET = "__unset__";

export interface UbahPemesananTarget {
  salesOrderId: string;
  customerName: string;
  wilayah: string;
  qty: number;
}

// Controlled by the caller (target === null means closed), same pattern as
// RouteValidationDialog — two different pages (Papan Pengiriman's stop
// list, the Pemesanan list) both need to open this, so it can't own its
// own trigger the way PemesananFormDialog does.
export function UbahPemesananDialog({
  target,
  onOpenChange,
  armadaList,
  drivers,
}: {
  target: UbahPemesananTarget | null;
  onOpenChange: (open: boolean) => void;
  armadaList: ArmadaRow[];
  drivers: DriverOption[];
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("08:00");
  const [armadaId, setArmadaId] = useState<string>(UNSET);
  const [salesmanId, setSalesmanId] = useState<string>(UNSET);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!target) return;
    setLoading(true);
    setError(null);
    getCurrentAssignmentAction(target.salesOrderId)
      .then((assignment) => {
        if (assignment) {
          const d = new Date(assignment.jamJadwal);
          setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
          setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
          setArmadaId(String(assignment.armadaId));
          setSalesmanId(assignment.salesmanId ?? UNSET);
        } else {
          setDate("");
          setTime("08:00");
          setArmadaId(UNSET);
          setSalesmanId(UNSET);
        }
      })
      .finally(() => setLoading(false));
  }, [target]);

  const canSubmit = !!target && !!date && armadaId !== UNSET;

  function handleSubmit() {
    if (!target || !canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        await reschedulePemesananAction({
          salesOrderId: target.salesOrderId,
          armadaId: Number(armadaId),
          deliveryDateTime: new Date(`${date}T${time}:00`),
          salesmanId: salesmanId === UNSET ? null : salesmanId,
        });
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal mengubah pemesanan.");
      }
    });
  }

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ubah Pemesanan</DialogTitle>
          <DialogDescription>
            Ganti armada, waktu, atau driver untuk pesanan ini saja — tidak memengaruhi SO lain pada keberangkatan yang
            sama.
          </DialogDescription>
        </DialogHeader>

        {target && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              <p className="font-medium">{target.customerName}</p>
              <p className="text-muted-foreground">
                {target.wilayah} &middot; {target.qty} kantong
              </p>
            </div>

            {loading ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Memuat...</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ubah-tanggal" className="sr-only">
                      Tanggal Kirim
                    </Label>
                    <Input id="ubah-tanggal" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ubah-jam" className="sr-only">
                      Jam
                    </Label>
                    <Input id="ubah-jam" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label className="sr-only">Armada</Label>
                    <Select value={armadaId} onValueChange={(v) => setArmadaId(v ?? UNSET)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Pilih armada">
                          {(v: string) =>
                            v === UNSET ? "Pilih armada" : (armadaList.find((a) => String(a.ArmadaID) === v)?.Nama ?? "Pilih armada")
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {armadaList.map((a) => (
                          <SelectItem key={a.ArmadaID} value={String(a.ArmadaID)} disabled={a.Status !== "Baik"}>
                            {a.Nama} {a.Status !== "Baik" && `(${a.Status})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="sr-only">Driver</Label>
                    <Select value={salesmanId} onValueChange={(v) => setSalesmanId(v ?? UNSET)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Belum ditentukan">
                          {(v: string) =>
                            v === UNSET ? "Belum ditentukan" : (drivers.find((d) => d.SalesmanID === v)?.Name ?? "Belum ditentukan")
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNSET}>Belum ditentukan</SelectItem>
                        {drivers.map((d) => (
                          <SelectItem key={d.SalesmanID} value={d.SalesmanID}>
                            {d.Name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {error && <p className="text-xs text-destructive">{error}</p>}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button disabled={!canSubmit || pending || loading} onClick={handleSubmit}>
            {pending ? "Menyimpan..." : "Simpan Perubahan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/ubah-pemesanan-dialog.tsx
git commit -m "Add Ubah Pemesanan dialog"
```

---

### Task 11: Wire "Ubah Pemesanan" entry points

**Files:**
- Modify: `src/components/dashboard/route-validation-dialog.tsx`
- Modify: `src/components/dashboard/pengiriman-board.tsx`
- Modify: `src/components/dashboard/pemesanan-list.tsx`
- Modify: `src/app/(dashboard)/pemesanan/page.tsx`

**Interfaces:**
- Consumes: `UbahPemesananDialog`, `type UbahPemesananTarget` from Task 10.

- [ ] **Step 1: Make `SortableStopRow` clickable in `src/components/dashboard/route-validation-dialog.tsx`**

Find:
```tsx
function SortableStopRow({ detail, index }: { detail: JadwalDetailRow; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: detail.JadwalDetailID,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 border-b bg-card px-3 py-2 text-sm last:border-b-0",
        isDragging && "z-10 opacity-70 shadow-lg"
      )}
    >
      <button type="button" {...attributes} {...listeners} className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing">
        <GripVertical className="size-4" />
      </button>
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{detail.CustomerName}</p>
        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <MapPin className="size-3 shrink-0" />
          {detail.Wilayah}
          {detail.Kecamatan ? ` | ${detail.Kecamatan}` : ""}
        </p>
      </div>
      <span className="shrink-0 tabular-nums text-muted-foreground">{detail.Qty} kantong</span>
      {detail.Latitude == null && (
        <Badge variant="outline" className="shrink-0 border-destructive/30 text-[10px] text-destructive">
          Tanpa lokasi
        </Badge>
      )}
    </div>
  );
}
```

Change to (the name/wilayah block becomes its own clickable button — the drag handle keeps its own separate listeners, so dragging and clicking-to-edit stay independent, same separation the row already has between the grip handle and the rest of the row):
```tsx
function SortableStopRow({
  detail,
  index,
  onEdit,
}: {
  detail: JadwalDetailRow;
  index: number;
  onEdit: (detail: JadwalDetailRow) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: detail.JadwalDetailID,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 border-b bg-card px-3 py-2 text-sm last:border-b-0",
        isDragging && "z-10 opacity-70 shadow-lg"
      )}
    >
      <button type="button" {...attributes} {...listeners} className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing">
        <GripVertical className="size-4" />
      </button>
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
        {index + 1}
      </span>
      <button type="button" onClick={() => onEdit(detail)} className="min-w-0 flex-1 text-left hover:underline">
        <p className="truncate font-medium">{detail.CustomerName}</p>
        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <MapPin className="size-3 shrink-0" />
          {detail.Wilayah}
          {detail.Kecamatan ? ` | ${detail.Kecamatan}` : ""}
        </p>
      </button>
      <span className="shrink-0 tabular-nums text-muted-foreground">{detail.Qty} kantong</span>
      {detail.Latitude == null && (
        <Badge variant="outline" className="shrink-0 border-destructive/30 text-[10px] text-destructive">
          Tanpa lokasi
        </Badge>
      )}
    </div>
  );
}
```

Add a new prop to `RouteValidationDialog` itself. Find:
```ts
  onOpenChange: (open: boolean) => void;
  // Fired after a successful "Batalkan Draft" so the caller can close this
  // dialog (it has no Jadwal left to show once deleted).
  onDeleted?: () => void;
}) {
```

Change to:
```ts
  onOpenChange: (open: boolean) => void;
  // Fired after a successful "Batalkan Draft" so the caller can close this
  // dialog (it has no Jadwal left to show once deleted).
  onDeleted?: () => void;
  // Fired when a stop is clicked — the caller owns closing this dialog and
  // opening UbahPemesananDialog itself (avoids nesting a second Dialog
  // inside this one, same "close one, open the other" pattern already
  // established by ArmadaManager's list-dialog-to-form-dialog handoff).
  onEditSalesOrder: (detail: JadwalDetailRow) => void;
}) {
```

Find where `SortableStopRow` is rendered:
```tsx
                    {order.map((d, i) => (
                      <SortableStopRow key={d.JadwalDetailID} detail={d} index={i} />
                    ))}
```

Change to:
```tsx
                    {order.map((d, i) => (
                      <SortableStopRow key={d.JadwalDetailID} detail={d} index={i} onEdit={onEditSalesOrder} />
                    ))}
```

- [ ] **Step 2: Lift the "editing SO" state into `PengirimanBoard` in `src/components/dashboard/pengiriman-board.tsx`**

Add the import:
```ts
import { UbahPemesananDialog, type UbahPemesananTarget } from "@/components/dashboard/ubah-pemesanan-dialog";
```

Find:
```ts
  const [detailJadwalId, setDetailJadwalId] = useState<number | null>(null);
  const [createArmadaId, setCreateArmadaId] = useState<number | null>(null);
```

Change to:
```ts
  const [detailJadwalId, setDetailJadwalId] = useState<number | null>(null);
  const [createArmadaId, setCreateArmadaId] = useState<number | null>(null);
  const [editingSalesOrder, setEditingSalesOrder] = useState<UbahPemesananTarget | null>(null);
```

Find:
```tsx
      <RouteValidationDialog
        jadwal={openJadwal}
        businessDate={businessDate}
        drivers={drivers}
        konsumsiBBM={openArmada?.KonsumsiBBM ?? null}
        kapasitasMaks={openArmada?.KapasitasMaks ?? null}
        jenisBBM={openArmada?.JenisBBM ?? null}
        biayaBBMPerLiter={openArmada?.BiayaBBMPerLiter ?? null}
        onOpenChange={(open) => !open && setDetailJadwalId(null)}
        onDeleted={() => setDetailJadwalId(null)}
      />
      <CreateJadwalDialog
        open={createArmadaId != null}
        onOpenChange={(open) => !open && setCreateArmadaId(null)}
        armadaId={createArmadaId}
        businessDate={businessDate}
        kapasitasMaks={createArmada?.KapasitasMaks ?? null}
      />
    </Card>
  );
}
```

Change to:
```tsx
      <RouteValidationDialog
        jadwal={openJadwal}
        businessDate={businessDate}
        drivers={drivers}
        konsumsiBBM={openArmada?.KonsumsiBBM ?? null}
        kapasitasMaks={openArmada?.KapasitasMaks ?? null}
        jenisBBM={openArmada?.JenisBBM ?? null}
        biayaBBMPerLiter={openArmada?.BiayaBBMPerLiter ?? null}
        onOpenChange={(open) => !open && setDetailJadwalId(null)}
        onDeleted={() => setDetailJadwalId(null)}
        onEditSalesOrder={(detail) => {
          setDetailJadwalId(null);
          setEditingSalesOrder({
            salesOrderId: detail.SalesOrderID,
            customerName: detail.CustomerName,
            wilayah: detail.Wilayah,
            qty: detail.Qty,
          });
        }}
      />
      <CreateJadwalDialog
        open={createArmadaId != null}
        onOpenChange={(open) => !open && setCreateArmadaId(null)}
        armadaId={createArmadaId}
        businessDate={businessDate}
        kapasitasMaks={createArmada?.KapasitasMaks ?? null}
      />
      <UbahPemesananDialog
        target={editingSalesOrder}
        onOpenChange={(open) => !open && setEditingSalesOrder(null)}
        armadaList={armada}
        drivers={drivers}
      />
    </Card>
  );
}
```

- [ ] **Step 3: Convert `src/components/dashboard/pemesanan-list.tsx` to a client component with an "Ubah" action**

Rewrite the whole file:

```tsx
"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatRupiah } from "@/lib/format";
import type { SalesOrderListRow, SalesOrderStatus } from "@/lib/queries/pemesanan";
import type { ArmadaRow } from "@/lib/queries/armada";
import type { DriverOption } from "@/lib/queries/delivery";
import { UbahPemesananDialog, type UbahPemesananTarget } from "@/components/dashboard/ubah-pemesanan-dialog";

const STATUS_VARIANT: Record<SalesOrderStatus, "outline" | "secondary" | "default"> = {
  "Belum Dijadwalkan": "outline",
  Draft: "secondary",
  Terbit: "default",
};

export function PemesananList({
  rows,
  armadaList,
  drivers,
}: {
  rows: SalesOrderListRow[];
  armadaList: ArmadaRow[];
  drivers: DriverOption[];
}) {
  const [editingTarget, setEditingTarget] = useState<UbahPemesananTarget | null>(null);

  return (
    <>
      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No. Voucher</TableHead>
              <TableHead>Tanggal</TableHead>
              <TableHead>Mitra</TableHead>
              <TableHead>Wilayah</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Jatuh Tempo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.SalesOrderID}>
                <TableCell className="font-medium">{r.VoucherNo}</TableCell>
                <TableCell>{formatDate(r.TransDate)}</TableCell>
                <TableCell>{r.CustomerName}</TableCell>
                <TableCell>{r.Wilayah}</TableCell>
                <TableCell className="text-right tabular-nums">{r.Qty}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRupiah(r.Amount)}</TableCell>
                <TableCell>{r.DueDate ? formatDate(r.DueDate) : "-"}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[r.Status]}>{r.Status}</Badge>
                </TableCell>
                <TableCell>
                  {r.Status !== "Terbit" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() =>
                        setEditingTarget({
                          salesOrderId: r.SalesOrderID,
                          customerName: r.CustomerName,
                          wilayah: r.Wilayah,
                          qty: r.Qty,
                        })
                      }
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  Tidak ada Sales Order pada rentang ini.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <UbahPemesananDialog
        target={editingTarget}
        onOpenChange={(open) => !open && setEditingTarget(null)}
        armadaList={armadaList}
        drivers={drivers}
      />
    </>
  );
}
```

(The "Ubah" action is hidden for `Status === "Terbit"` rows — a Terbit SO already has a real `DeliveryOrder`; reassigning its driver/vehicle is the existing Papan Pengiriman "Simpan" path, not this one, matching `getCurrentAssignment`'s own Draft-only scope from Task 8.)

- [ ] **Step 4: Pass `armadaList`/`drivers` from `src/app/(dashboard)/pemesanan/page.tsx`**

Find:
```tsx
      <PemesananList rows={rows} />
```

Change to:
```tsx
      <PemesananList rows={rows} armadaList={armadaList} drivers={drivers} />
```

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/route-validation-dialog.tsx src/components/dashboard/pengiriman-board.tsx src/components/dashboard/pemesanan-list.tsx "src/app/(dashboard)/pemesanan/page.tsx"
git commit -m "Wire Ubah Pemesanan into Validasi Rute stops and the Pemesanan list"
```

---

### Task 12: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 0 TypeScript errors, 0 lint errors, build succeeds — in particular, confirm no server-only module leaks into the client bundle via `armada.ts` (the exact bug class that already hit this codebase once via `ARMADA_STATUS`; Task 3/4 deliberately route `FuelType`/`FUEL_TYPES` through the client-safe `armada-fuel.ts` to avoid a repeat).

- [ ] **Step 2: Manual browser walkthrough — JamJadwal validation**

On `/pemesanan`, attempt to create a Pemesanan with a delivery date before today's business date (try typing an earlier date directly into the date input even though `min` should block the picker) — confirm either the picker rejects it or, if it's forced through, the server throws the "tidak boleh sebelum waktu pemesanan" error and no SO/Jadwal is created.
On `/delivery`'s Papan Pengiriman, open "+ Keberangkatan Baru" on an Armada, pick an available SO, set a departure time earlier than that SO's own order time — confirm the error surfaces and no Draft is created.

- [ ] **Step 3: Manual browser walkthrough — Armada fuel/tax fields**

On `/delivery`, Papan Pengiriman tab, "Kelola Armada" → edit an existing Armada: fill in Jenis BBM, Biaya BBM/Liter, Pajak 5 Tahunan, Biaya Pajak 5 Tahunan, save — confirm they persist after reload (reopen the edit form, values still present).

- [ ] **Step 4: Manual browser walkthrough — board stats and route/BBM detail**

Confirm the armada row's Kapasitas/Kantong/Jarak stats render correctly (Jarak starts at 0/blank until a real "Berangkat" happens). Create a Draft with real located stops, click it, confirm Jenis BBM and Total Biaya BBM show in Validasi Rute once a route is computed (using an Armada that now has Jenis BBM/Biaya BBM/Liter/KonsumsiBBM filled in from Step 3). Click "Berangkat", confirm `JarakKM` persisted (re-open the Jadwal or re-check the board) and the armada's "Jarak" stat for the day increased by that amount.

- [ ] **Step 5: Manual browser walkthrough — Ubah Pemesanan**

Create a Pemesanan bundling scenario: use "Tambahkan" or create a Draft with 2+ SOs on one Armada. Open Validasi Rute, click one stop — confirm "Ubah Pemesanan" opens (Validasi Rute itself closes first, no dialog stacking), pre-filled with the correct current armada/time/driver. Change the Armada and time, save — confirm: the edited SO now appears on the NEW armada's row at the new time as its own Draft, and the ORIGINAL Draft still shows its remaining SO(s) unaffected. Repeat for a single-SO Draft — confirm the original (now-empty) Draft disappears from the board entirely after the move. Also open "Ubah Pemesanan" from the `/pemesanan` list's own "Ubah" icon for a `Belum Dijadwalkan` row — confirm it opens blank (no prior assignment) and scheduling it for the first time from there works.

- [ ] **Step 6: Regression spot-check**

Confirm the existing "Tambahkan", "Batalkan Draft", "Simpan" (driver/time), and drag-to-reschedule flows on Papan Pengiriman still work exactly as before (Task 1's new validation should never trigger for a value that was already valid before this plan). Confirm `/mitra`, `/pemasaran`, `/transaksi` still load without errors.

- [ ] **Step 7: Record progress**

Append a summary of this plan's completion to `.superpowers/sdd/progress.md`, following the same format as the prior entries in that file.
