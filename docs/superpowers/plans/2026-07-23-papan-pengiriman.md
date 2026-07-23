# Papan Pengiriman (Kanban/Timeline Armada) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simple per-DO "Penugasan Armada & Driver" tab with a timeline board — one row per vehicle, departure cards positioned on a 24-hour axis, each departure bundling multiple Delivery Orders into one trip.

**Architecture:** Two new tables (`DashboardPengirimanJadwal` header + `DashboardPengirimanJadwalDetail` line items) alongside an expanded `DashboardArmada` (vehicle profile fields) and the existing `Salesman`-backed Driver identity. The board reuses the sticky-left + shared-horizontal-scroll technique already built for the Transaksi DO-per-Mitra panel, with `@dnd-kit/core` for drag-to-reschedule. Vehicle photos save to local disk (`public/uploads/armada/`).

**Tech Stack:** Next.js Server Components + Server Actions, raw parameterized `mssql` queries, `@dnd-kit/core` (new dependency), Node's `fs/promises` for local file writes.

## Global Constraints

- No automated test suite exists in this codebase — verification is `npx tsc --noEmit`, `npm run lint`, and manual browser checks.
- This board **replaces** the "Penugasan Armada & Driver" tab — `delivery-assignment-panel.tsx` is deleted, not kept alongside.
- When a DO joins a Jadwal, `DeliveryOrder.SalesmanID`/`VehicleNo` are still written via the existing `assignDeliveryDriver`/`assignDeliveryVehicle` (`src/lib/queries/delivery.ts`) so every other existing view keeps working unchanged.
- Vehicles with `Status !== "Baik"` cannot be selected when creating a new departure, but their row still renders on the board.
- Rescheduling works two ways — dragging the card, and editing the time in the detail dialog — both call the same `updateJadwalTimeAction`.
- `JamMulaiMuat`/`JamAktualBerangkat` are only ever set by a button press ("Mulai Muat" / "Berangkat") at the moment it happens — never manually typed.
- File uploads go to `public/uploads/armada/` on the server's own disk — no third-party storage service.
- Board timeline: 80px per hour (1920px total for a full day), each `JadwalCard` is a fixed 72px wide, positioned at `left = hourFraction * 80`. Dragging rounds to the nearest 15-minute increment (20px).
- Time values are constructed and read entirely client-side using plain `new Date(...)`/`.getHours()`/`.getMinutes()` (not the server-side WIB-offset math in `parseWibDateTimeLocal`) — this matches how `formatTime()`/`formatDate()` already display every other WIB timestamp in this app: trusting the viewing device's own local timezone (staff are physically in Indonesia). A `Date` constructed in the browser and passed straight into a Server Action keeps its correct underlying instant across that boundary — no manual UTC-offset arithmetic needed for this client-to-client round trip.

---

### Task 0: Database schema (controller-run, not delegated)

DDL against the live database — run directly by whoever is executing this plan, before starting Task 1.

- [ ] **Step 1: Run this DDL**

```sql
ALTER TABLE DashboardArmada ADD
  PlatNomor VARCHAR(20) NULL,
  Brand VARCHAR(64) NULL,
  Model VARCHAR(64) NULL,
  KonsumsiBBM DECIMAL(10,2) NULL,
  KapasitasMaks DECIMAL(23,4) NULL,
  Status VARCHAR(20) NOT NULL DEFAULT 'Baik',
  FotoPath VARCHAR(256) NULL;

CREATE TABLE DashboardPengirimanJadwal (
  JadwalID INT IDENTITY(1,1) PRIMARY KEY,
  ArmadaID INT NOT NULL,
  SalesmanID VARCHAR(16) NULL,
  JamJadwal DATETIME NOT NULL,
  JamMulaiMuat DATETIME NULL,
  JamAktualBerangkat DATETIME NULL,
  IsDeleted BIT NOT NULL DEFAULT 0,
  ModifiedDate DATETIME NOT NULL DEFAULT GETDATE()
);

CREATE TABLE DashboardPengirimanJadwalDetail (
  JadwalDetailID INT IDENTITY(1,1) PRIMARY KEY,
  JadwalID INT NOT NULL,
  DeliveryOrderID VARCHAR(16) NOT NULL,
  IsDeleted BIT NOT NULL DEFAULT 0
);
```

- [ ] **Step 2: Verify**

Confirm `DashboardArmada` has the 7 new columns, and both new tables exist with the columns above (via table-info tool or `INFORMATION_SCHEMA.COLUMNS`).

---

### Task 1: Expand `armada.ts` with vehicle profile fields

**Files:**
- Modify: `src/lib/queries/armada.ts` (full rewrite)

**Interfaces:**
- Produces: `ARMADA_STATUS = ["Baik", "Rusak", "Perbaikan", "Tertahan"] as const`, `ArmadaStatus`, `ArmadaRow { ArmadaID: number; Nama: string; PlatNomor: string | null; Brand: string | null; Model: string | null; KonsumsiBBM: number | null; KapasitasMaks: number | null; Status: ArmadaStatus; FotoPath: string | null }`, `ArmadaInput { nama: string; platNomor: string | null; brand: string | null; model: string | null; konsumsiBBM: number | null; kapasitasMaks: number | null; status: ArmadaStatus; fotoPath: string | null }`, `getArmadaList(): Promise<ArmadaRow[]>`, `createArmada(input: ArmadaInput): Promise<number>`, `updateArmada(id: number, input: ArmadaInput): Promise<void>`, `deleteArmada(id: number): Promise<void>`.
- **Breaking change from the prior phase:** `createArmada`/`updateArmada` now take `ArmadaInput` instead of a plain `nama: string`. Task 3 updates every caller.

- [ ] **Step 1: Rewrite `src/lib/queries/armada.ts`**

```ts
import { getPool, sql } from "@/lib/db";

export const ARMADA_STATUS = ["Baik", "Rusak", "Perbaikan", "Tertahan"] as const;
export type ArmadaStatus = (typeof ARMADA_STATUS)[number];

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
}

export async function getArmadaList(): Promise<ArmadaRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ArmadaID, Nama, PlatNomor, Brand, Model, KonsumsiBBM, KapasitasMaks, Status, FotoPath
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
    .input("fotoPath", sql.VarChar(256), input.fotoPath).query(`
      INSERT INTO DashboardArmada
        (Nama, PlatNomor, Brand, Model, KonsumsiBBM, KapasitasMaks, Status, FotoPath, IsDeleted, ModifiedDate)
      OUTPUT inserted.ArmadaID
      VALUES
        (@nama, @platNomor, @brand, @model, @konsumsiBBM, @kapasitasMaks, @status, @fotoPath, 0, GETDATE())
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
    .input("fotoPath", sql.VarChar(256), input.fotoPath).query(`
      UPDATE DashboardArmada SET
        Nama = @nama, PlatNomor = @platNomor, Brand = @brand, Model = @model,
        KonsumsiBBM = @konsumsiBBM, KapasitasMaks = @kapasitasMaks, Status = @status, FotoPath = @fotoPath,
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

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/app/(dashboard)/delivery/actions.ts` and `src/components/dashboard/armada-dialog.tsx` (both still call the old `nama: string` signature — Task 3 fixes both). No errors in `armada.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/armada.ts
git commit -m "Expand Armada with vehicle profile fields (plat, brand, status, etc.)"
```

---

### Task 2: Vehicle photo upload route

**Files:**
- Create: `src/app/api/upload/armada-foto/route.ts`
- Modify: `.gitignore` (append `public/uploads/`)

**Interfaces:**
- Produces: `POST /api/upload/armada-foto` — accepts `multipart/form-data` with a `file` field, returns `{ path: string }` (e.g. `{ "path": "/uploads/armada/1690000000-ab12cd.jpg" }`) on success, or `{ error: string }` with a 4xx status on failure.

- [ ] **Step 1: Write `src/app/api/upload/armada-foto/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { requireModuleAccess } from "@/lib/require-access";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  await requireModuleAccess("delivery");

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Format file harus JPG, PNG, atau WEBP" }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Ukuran file maksimal 5MB" }, { status: 400 });
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads", "armada");
  await mkdir(uploadDir, { recursive: true });

  const bytes = await file.arrayBuffer();
  await writeFile(path.join(uploadDir, fileName), Buffer.from(bytes));

  return NextResponse.json({ path: `/uploads/armada/${fileName}` });
}
```

- [ ] **Step 2: Append to `.gitignore`**

Add this line (uploaded files must never be committed):

```
public/uploads/
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no new errors from this route.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/upload/armada-foto/route.ts" .gitignore
git commit -m "Add local-disk photo upload route for Armada"
```

---

### Task 3: Rewrite Armada management UI for the full profile

**Files:**
- Modify: `src/components/dashboard/armada-dialog.tsx` (full rewrite)
- Modify: `src/app/(dashboard)/delivery/actions.ts:7-16` (update `createArmadaAction`/`updateArmadaAction` signatures)

**Interfaces:**
- Consumes: `ArmadaRow`, `ArmadaInput`, `ARMADA_STATUS`, `createArmada`, `updateArmada`, `deleteArmada` from Task 1.
- Produces: `createArmadaAction(input: ArmadaInput): Promise<number>`, `updateArmadaAction(id: number, input: ArmadaInput): Promise<void>` (signature change, same names) in `@/app/(dashboard)/delivery/actions`; `ArmadaManager({ armada: ArmadaRow[] })` (same export name, new internals) in `@/components/dashboard/armada-dialog`.

- [ ] **Step 1: Update `src/app/(dashboard)/delivery/actions.ts`**

Replace lines 1-16 (imports through `updateArmadaAction`) with:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createArmada, updateArmada, deleteArmada, type ArmadaInput } from "@/lib/queries/armada";
import { assignDeliveryDriver, assignDeliveryVehicle } from "@/lib/queries/delivery";

export async function createArmadaAction(input: ArmadaInput): Promise<number> {
  const id = await createArmada(input);
  revalidatePath("/delivery");
  return id;
}

export async function updateArmadaAction(id: number, input: ArmadaInput): Promise<void> {
  await updateArmada(id, input);
  revalidatePath("/delivery");
}
```

Leave `deleteArmadaAction`, `assignDeliveryDriverAction`, `assignDeliveryVehicleAction` exactly as they already are, below this block.

- [ ] **Step 2: Rewrite `src/components/dashboard/armada-dialog.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ARMADA_STATUS, type ArmadaRow, type ArmadaInput, type ArmadaStatus } from "@/lib/queries/armada";
import { createArmadaAction, updateArmadaAction, deleteArmadaAction } from "@/app/(dashboard)/delivery/actions";

const STATUS_BADGE: Record<ArmadaStatus, string> = {
  Baik: "bg-primary/15 text-primary",
  Rusak: "bg-destructive/15 text-destructive",
  Perbaikan: "bg-warning/15 text-warning",
  Tertahan: "bg-muted text-muted-foreground",
};

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

function ArmadaFormDialog({
  open,
  onOpenChange,
  initial,
  title,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ArmadaInput;
  title: string;
  onSubmit: (input: ArmadaInput) => void;
  pending: boolean;
}) {
  const [fotoPath, setFotoPath] = useState(initial.fotoPath);
  const [status, setStatus] = useState<ArmadaStatus>(initial.status);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/armada-foto", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengunggah foto");
      setFotoPath(data.path);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Gagal mengunggah foto");
    } finally {
      setUploading(false);
    }
  }

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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) {
          setFotoPath(initial.fotoPath);
          setStatus(initial.status);
          setUploadError(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Data kendaraan tersimpan langsung ke database MKEsindo.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="grid grid-cols-2 gap-3">
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="nama" className="sr-only">Nama Kendaraan</Label>
            <Input id="nama" name="nama" placeholder="Nama Kendaraan (mis. GrandMax 1972)" defaultValue={initial.nama} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="platNomor" className="sr-only">Plat Nomor</Label>
            <Input id="platNomor" name="platNomor" placeholder="Plat Nomor" defaultValue={initial.platNomor ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="sr-only">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus((v as ArmadaStatus) ?? "Baik")}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ARMADA_STATUS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand" className="sr-only">Brand</Label>
            <Input id="brand" name="brand" placeholder="Brand (mis. Daihatsu)" defaultValue={initial.brand ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model" className="sr-only">Model</Label>
            <Input id="model" name="model" placeholder="Model (mis. GrandMax)" defaultValue={initial.model ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="konsumsiBBM" className="sr-only">Konsumsi BBM (L/km)</Label>
            <Input
              id="konsumsiBBM"
              name="konsumsiBBM"
              type="number"
              step="0.01"
              placeholder="Konsumsi BBM (L/km)"
              defaultValue={initial.konsumsiBBM ?? ""}
            />
          </div>
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
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="foto" className="text-xs text-muted-foreground">
              Foto Armada
            </Label>
            <Input
              id="foto"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              disabled={uploading}
            />
            {uploading && <p className="text-xs text-muted-foreground">Mengunggah...</p>}
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
            {fotoPath && !uploading && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fotoPath} alt="Pratinjau foto armada" className="h-24 w-24 rounded-lg object-cover" />
            )}
          </div>
          <DialogFooter className="col-span-2">
            <Button type="submit" disabled={pending || uploading} className="ml-auto">
              {pending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// "Kelola Armada" list dialog and the add/edit form dialog never open at
// the same time (no nested Dialog-inside-Dialog) — opening the form closes
// the list first, and closing the form reopens the list.
export function ArmadaManager({ armada }: { armada: ArmadaRow[] }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ArmadaRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate(input: ArmadaInput) {
    setError(null);
    startTransition(async () => {
      try {
        await createArmadaAction(input);
        setCreating(false);
        setOpen(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan armada.");
      }
    });
  }

  function handleUpdate(input: ArmadaInput) {
    if (!editing) return;
    setError(null);
    startTransition(async () => {
      try {
        await updateArmadaAction(editing.ArmadaID, input);
        setEditing(null);
        setOpen(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan armada.");
      }
    });
  }

  function handleDelete(row: ArmadaRow) {
    if (!confirm(`Hapus armada "${row.Nama}"?`)) return;
    startTransition(async () => {
      try {
        await deleteArmadaAction(row.ArmadaID);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Gagal menghapus armada.");
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Kelola Armada
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kelola Armada</DialogTitle>
            <DialogDescription>Daftar kendaraan untuk Papan Pengiriman.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Button
              size="sm"
              className="self-end"
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
            >
              <Plus className="size-4" />
              Tambah Armada
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex flex-col divide-y rounded-lg border">
              {armada.map((a) => (
                <div key={a.ArmadaID} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.Nama}</p>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {a.PlatNomor ?? "-"}
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", STATUS_BADGE[a.Status])}>
                        {a.Status}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => {
                        setOpen(false);
                        setEditing(a);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => handleDelete(a)}>
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
              {armada.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">Belum ada armada.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ArmadaFormDialog
        open={creating}
        onOpenChange={(next) => {
          setCreating(next);
          if (!next) setOpen(true);
        }}
        initial={emptyForm()}
        title="Tambah Armada"
        onSubmit={handleCreate}
        pending={pending}
      />
      {editing && (
        <ArmadaFormDialog
          open={!!editing}
          onOpenChange={(next) => {
            if (!next) {
              setEditing(null);
              setOpen(true);
            }
          }}
          initial={rowToForm(editing)}
          title={`Edit Armada — ${editing.Nama}`}
          onSubmit={handleUpdate}
          pending={pending}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: clean, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/armada-dialog.tsx "src/app/(dashboard)/delivery/actions.ts"
git commit -m "Rewrite Armada management UI with full vehicle profile + photo upload"
```

---

### Task 4: Jadwal Keberangkatan query module

**Files:**
- Create: `src/lib/queries/pengiriman-jadwal.ts`

**Interfaces:**
- Consumes: `ArmadaRow`, `getArmadaList` from Task 1 (`@/lib/queries/armada`); `assignDeliveryDriver`, `assignDeliveryVehicle` (existing, `@/lib/queries/delivery`).
- Produces: `JadwalCard { JadwalID: number; ArmadaID: number; SalesmanID: string | null; DriverName: string | null; JamJadwal: string | Date; JamMulaiMuat: string | Date | null; JamAktualBerangkat: string | Date | null; TotalKantong: number; TotalDO: number }`, `getPengirimanBoard(businessDate: string): Promise<{ armada: ArmadaRow[]; jadwal: JadwalCard[] }>`; `JadwalDetailRow { DeliveryOrderID: string; CustomerName: string; Qty: number; Wilayah: string; Kecamatan: string | null; Alamat: string | null; MobileNo: string | null }`, `getJadwalDetail(jadwalId: number): Promise<JadwalDetailRow[]>`; `UnassignedDO { DeliveryOrderID: string; VoucherNo: string; CustomerName: string; Wilayah: string; Qty: number }`, `getUnassignedDeliveryOrders(businessDate: string): Promise<UnassignedDO[]>`; `createJadwal(input: { armadaId: number; salesmanId: string | null; jamJadwal: Date; deliveryOrderIds: string[] }): Promise<number>`; `updateJadwalTime(jadwalId: number, jamJadwal: Date): Promise<void>`; `startMuat(jadwalId: number): Promise<void>`; `startBerangkat(jadwalId: number): Promise<void>`.

- [ ] **Step 1: Write `src/lib/queries/pengiriman-jadwal.ts`**

```ts
import { getPool, sql } from "@/lib/db";
import { assignDeliveryDriver, assignDeliveryVehicle } from "@/lib/queries/delivery";
import { getArmadaList, type ArmadaRow } from "@/lib/queries/armada";

// Same 5KG-counts-as-half-a-kantong normalization already established in
// mitra-do.ts's KANTONG_QTY_EXPR, but against `Qty` (what's ordered/loaded)
// rather than `Delivered` — a departure is being planned/loaded, it hasn't
// necessarily been marked delivered yet.
const JADWAL_KANTONG_EXPR = `SUM(CASE WHEN dod.Name LIKE '%5 KG%' THEN dod.Qty / 2.0 ELSE dod.Qty END)`;

export interface JadwalCard {
  JadwalID: number;
  ArmadaID: number;
  SalesmanID: string | null;
  DriverName: string | null;
  JamJadwal: string | Date;
  JamMulaiMuat: string | Date | null;
  JamAktualBerangkat: string | Date | null;
  TotalKantong: number;
  TotalDO: number;
}

export async function getPengirimanBoard(businessDate: string): Promise<{ armada: ArmadaRow[]; jadwal: JadwalCard[] }> {
  const pool = await getPool();
  const [armada, jadwalResult] = await Promise.all([
    getArmadaList(),
    pool
      .request()
      .input("businessDate", sql.Date, businessDate).query(`
        SELECT
            j.JadwalID,
            j.ArmadaID,
            j.SalesmanID,
            sm.Name AS DriverName,
            j.JamJadwal,
            j.JamMulaiMuat,
            j.JamAktualBerangkat,
            ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS TotalKantong,
            COUNT(DISTINCT jd.DeliveryOrderID) AS TotalDO
        FROM DashboardPengirimanJadwal j
        LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
        LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
        LEFT JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = jd.DeliveryOrderID
        WHERE j.IsDeleted = 0
          AND j.JamJadwal >= @businessDate AND j.JamJadwal < DATEADD(DAY, 1, @businessDate)
        GROUP BY j.JadwalID, j.ArmadaID, j.SalesmanID, sm.Name, j.JamJadwal, j.JamMulaiMuat, j.JamAktualBerangkat
        ORDER BY j.JamJadwal
      `),
  ]);
  return { armada, jadwal: jadwalResult.recordset };
}

export interface JadwalDetailRow {
  DeliveryOrderID: string;
  CustomerName: string;
  Qty: number;
  Wilayah: string;
  Kecamatan: string | null;
  Alamat: string | null;
  MobileNo: string | null;
}

export async function getJadwalDetail(jadwalId: number): Promise<JadwalDetailRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId).query(`
      SELECT
          jd.DeliveryOrderID,
          bp.Name AS CustomerName,
          ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS Qty,
          ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          bp.NPWPAddress AS Kecamatan,
          bp.Address AS Alamat,
          bp.MobileNo
      FROM DashboardPengirimanJadwalDetail jd
      JOIN DeliveryOrder do_ ON do_.DeliveryOrderID = jd.DeliveryOrderID
      JOIN BusinessPartner bp ON bp.BusinessPartnerID = do_.BusinessPartnerID
      LEFT JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = jd.DeliveryOrderID
      WHERE jd.JadwalID = @jadwalId AND jd.IsDeleted = 0
      GROUP BY jd.DeliveryOrderID, bp.Name, bp.NPWPName, bp.NPWPAddress, bp.Address, bp.MobileNo
      ORDER BY bp.Name
    `);
  return result.recordset;
}

export interface UnassignedDO {
  DeliveryOrderID: string;
  VoucherNo: string;
  CustomerName: string;
  Wilayah: string;
  Qty: number;
}

export async function getUnassignedDeliveryOrders(businessDate: string): Promise<UnassignedDO[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessDate", sql.Date, businessDate).query(`
      SELECT
          do_.DeliveryOrderID,
          do_.VoucherNo,
          bp.Name AS CustomerName,
          ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS Qty
      FROM DeliveryOrder do_
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = do_.BusinessPartnerID
      LEFT JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
      WHERE do_.IsDeleted = 0
        AND do_.TransDate >= @businessDate AND do_.TransDate < DATEADD(DAY, 1, @businessDate)
        AND NOT EXISTS (
          SELECT 1 FROM DashboardPengirimanJadwalDetail jd
          WHERE jd.DeliveryOrderID = do_.DeliveryOrderID AND jd.IsDeleted = 0
        )
      GROUP BY do_.DeliveryOrderID, do_.VoucherNo, bp.Name, bp.NPWPName
      ORDER BY bp.Name
    `);
  return result.recordset;
}

export async function createJadwal(input: {
  armadaId: number;
  salesmanId: string | null;
  jamJadwal: Date;
  deliveryOrderIds: string[];
}): Promise<number> {
  const pool = await getPool();

  // VehicleNo (written to each DO below) stores the Armada's display name,
  // not its numeric ID — same convention assignDeliveryVehicle already
  // uses. Resolved here so callers only need to pass armadaId.
  const armadaResult = await pool
    .request()
    .input("armadaId", sql.Int, input.armadaId)
    .query(`SELECT Nama FROM DashboardArmada WHERE ArmadaID = @armadaId`);
  const armadaNama = (armadaResult.recordset[0] as { Nama: string } | undefined)?.Nama ?? null;

  const result = await pool
    .request()
    .input("armadaId", sql.Int, input.armadaId)
    .input("salesmanId", sql.VarChar(16), input.salesmanId)
    .input("jamJadwal", sql.DateTime, input.jamJadwal).query(`
      INSERT INTO DashboardPengirimanJadwal (ArmadaID, SalesmanID, JamJadwal, IsDeleted, ModifiedDate)
      OUTPUT inserted.JadwalID
      VALUES (@armadaId, @salesmanId, @jamJadwal, 0, GETDATE())
    `);
  const jadwalId = (result.recordset[0] as { JadwalID: number }).JadwalID;

  for (const doId of input.deliveryOrderIds) {
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .input("doId", sql.VarChar(16), doId)
      .query(`INSERT INTO DashboardPengirimanJadwalDetail (JadwalID, DeliveryOrderID, IsDeleted) VALUES (@jadwalId, @doId, 0)`);
    await assignDeliveryDriver(doId, input.salesmanId);
    await assignDeliveryVehicle(doId, armadaNama);
  }

  return jadwalId;
}

export async function updateJadwalTime(jadwalId: number, jamJadwal: Date): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("jamJadwal", sql.DateTime, jamJadwal)
    .query(`UPDATE DashboardPengirimanJadwal SET JamJadwal = @jamJadwal, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
}

export async function startMuat(jadwalId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`UPDATE DashboardPengirimanJadwal SET JamMulaiMuat = GETDATE(), ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
}

export async function startBerangkat(jadwalId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`UPDATE DashboardPengirimanJadwal SET JamAktualBerangkat = GETDATE(), ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean, 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts
git commit -m "Add Jadwal Keberangkatan query module"
```

---

### Task 5: Server actions for Jadwal Keberangkatan

**Files:**
- Modify: `src/app/(dashboard)/delivery/actions.ts` (append)

**Interfaces:**
- Consumes: `createJadwal`, `updateJadwalTime`, `startMuat`, `startBerangkat`, `getJadwalDetail`, `getUnassignedDeliveryOrders` from Task 4 (`@/lib/queries/pengiriman-jadwal`).
- Produces: `createJadwalAction(input: { armadaId: number; salesmanId: string | null; jamJadwal: Date; deliveryOrderIds: string[] }): Promise<number>`, `updateJadwalTimeAction(jadwalId: number, jamJadwal: Date): Promise<void>`, `startMuatAction(jadwalId: number): Promise<void>`, `startBerangkatAction(jadwalId: number): Promise<void>`, `getJadwalDetailAction(jadwalId: number): Promise<JadwalDetailRow[]>`, `getUnassignedDeliveryOrdersAction(businessDate: string): Promise<UnassignedDO[]>` — all in `@/app/(dashboard)/delivery/actions`.

- [ ] **Step 1: Append to `src/app/(dashboard)/delivery/actions.ts`**

Add this import alongside the existing ones at the top:

```ts
import {
  createJadwal,
  updateJadwalTime,
  startMuat,
  startBerangkat,
  getJadwalDetail,
  getUnassignedDeliveryOrders,
  type JadwalDetailRow,
  type UnassignedDO,
} from "@/lib/queries/pengiriman-jadwal";
```

Add these functions at the bottom of the file:

```ts
export async function createJadwalAction(input: {
  armadaId: number;
  salesmanId: string | null;
  jamJadwal: Date;
  deliveryOrderIds: string[];
}): Promise<number> {
  const id = await createJadwal(input);
  revalidatePath("/delivery");
  return id;
}

export async function updateJadwalTimeAction(jadwalId: number, jamJadwal: Date): Promise<void> {
  await updateJadwalTime(jadwalId, jamJadwal);
  revalidatePath("/delivery");
}

export async function startMuatAction(jadwalId: number): Promise<void> {
  await startMuat(jadwalId);
  revalidatePath("/delivery");
}

export async function startBerangkatAction(jadwalId: number): Promise<void> {
  await startBerangkat(jadwalId);
  revalidatePath("/delivery");
}

// Read-only — no revalidatePath needed, these just fetch data on demand
// when a dialog opens (fetching every Jadwal's detail / every date's
// unassigned DOs upfront in the page load would be wasteful).
export async function getJadwalDetailAction(jadwalId: number): Promise<JadwalDetailRow[]> {
  return getJadwalDetail(jadwalId);
}

export async function getUnassignedDeliveryOrdersAction(businessDate: string): Promise<UnassignedDO[]> {
  return getUnassignedDeliveryOrders(businessDate);
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean, 0 errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/delivery/actions.ts"
git commit -m "Add server actions for Jadwal Keberangkatan"
```

---

### Task 6: Papan Pengiriman board — layout, create-departure and detail dialogs

**Files:**
- Create: `src/components/dashboard/pengiriman-board.tsx`

**Interfaces:**
- Consumes: `ArmadaRow`, `ArmadaStatus` from Task 1; `JadwalCard`, `JadwalDetailRow`, `UnassignedDO` types from Task 4; `createJadwalAction`, `updateJadwalTimeAction`, `startMuatAction`, `startBerangkatAction`, `getJadwalDetailAction`, `getUnassignedDeliveryOrdersAction` from Task 5; `DriverOption` (existing, `@/lib/queries/delivery`); `ArmadaManager` from Task 3.
- Produces: `PengirimanBoard({ armada, jadwal, drivers, businessDate, todayISO })` component, default export... no — named export `PengirimanBoard`, consumed by Task 8's page rewrite.

- [ ] **Step 1: Write `src/components/dashboard/pengiriman-board.tsx`**

```tsx
"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Plus, Phone, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArmadaManager } from "@/components/dashboard/armada-dialog";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ArmadaRow } from "@/lib/queries/armada";
import type { JadwalCard as JadwalCardData, JadwalDetailRow, UnassignedDO } from "@/lib/queries/pengiriman-jadwal";
import type { DriverOption } from "@/lib/queries/delivery";
import {
  createJadwalAction,
  updateJadwalTimeAction,
  startMuatAction,
  startBerangkatAction,
  getJadwalDetailAction,
  getUnassignedDeliveryOrdersAction,
} from "@/app/(dashboard)/delivery/actions";

// 24-hour axis: 80px/hour = 1920px for a full day. Every position/sizing
// value below (ruler, cards, gridlines) is derived from this one constant.
const HOUR_WIDTH = 80;
const DAY_WIDTH = HOUR_WIDTH * 24;
const CARD_WIDTH = 72;

// Times are constructed/read entirely client-side with plain Date methods —
// matching how formatTime()/formatDate() already display every WIB
// timestamp elsewhere in this app (trusting the viewing device's own local
// timezone, since staff are physically in Indonesia). A Date built in the
// browser keeps its correct instant across the Server Action boundary, so
// no manual UTC-offset math (like parseWibDateTimeLocal) is needed here.
function hourFraction(value: string | Date): number {
  const d = new Date(value);
  return d.getHours() + d.getMinutes() / 60;
}

function combineDateAndTime(businessDate: string, timeHHMM: string): Date {
  return new Date(`${businessDate}T${timeHHMM}:00`);
}

function JadwalDetailDialog({
  jadwalId,
  jamJadwal,
  businessDate,
  onOpenChange,
}: {
  jadwalId: number | null;
  // Current scheduled time for the open card, so the time field starts
  // pre-filled — null while no card is open (dialog is closed).
  jamJadwal: string | Date | null;
  businessDate: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = useState<JadwalDetailRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState("00:00");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (jadwalId == null) {
      setDetail(null);
      return;
    }
    setLoading(true);
    getJadwalDetailAction(jadwalId)
      .then(setDetail)
      .finally(() => setLoading(false));
  }, [jadwalId]);

  useEffect(() => {
    if (jamJadwal == null) return;
    const d = new Date(jamJadwal);
    setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
  }, [jamJadwal]);

  function handleMuat() {
    if (jadwalId == null) return;
    startTransition(() => startMuatAction(jadwalId));
  }

  function handleBerangkat() {
    if (jadwalId == null) return;
    startTransition(() => startBerangkatAction(jadwalId));
  }

  function handleSaveTime() {
    if (jadwalId == null) return;
    startTransition(() => updateJadwalTimeAction(jadwalId, combineDateAndTime(businessDate, time)));
  }

  return (
    <Dialog open={jadwalId != null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Detail Keberangkatan</DialogTitle>
          <DialogDescription>Daftar DO yang ikut pada keberangkatan ini.</DialogDescription>
        </DialogHeader>
        {/* Second way to reschedule (alongside dragging the card on the
            board) — both call the same updateJadwalTimeAction. */}
        <div className="flex items-center gap-2">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
          <Button size="sm" variant="outline" disabled={pending} onClick={handleSaveTime}>
            Simpan Jam
          </Button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" disabled={pending} onClick={handleMuat}>
            Mulai Muat
          </Button>
          <Button size="sm" className="flex-1" disabled={pending} onClick={handleBerangkat}>
            Berangkat
          </Button>
        </div>
        <div className="flex max-h-80 flex-col divide-y overflow-y-auto rounded-lg border">
          {loading && <p className="py-6 text-center text-sm text-muted-foreground">Memuat...</p>}
          {!loading &&
            detail?.map((d) => (
              <div key={d.DeliveryOrderID} className="flex flex-col gap-1 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{d.CustomerName}</span>
                  <span className="tabular-nums text-muted-foreground">{d.Qty} kantong</span>
                </div>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="size-3" />
                  {d.Wilayah}
                  {d.Kecamatan ? ` | ${d.Kecamatan}` : ""}
                  {d.Alamat ? ` — ${d.Alamat}` : ""}
                </span>
                {d.MobileNo && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Phone className="size-3" />
                    {d.MobileNo}
                  </span>
                )}
              </div>
            ))}
          {!loading && detail?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada DO.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateJadwalDialog({
  open,
  onOpenChange,
  armadaId,
  businessDate,
  drivers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  armadaId: number | null;
  businessDate: string;
  drivers: DriverOption[];
}) {
  const [unassigned, setUnassigned] = useState<UnassignedDO[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [time, setTime] = useState("08:00");
  const [salesmanId, setSalesmanId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setTime("08:00");
    setSalesmanId("");
    setError(null);
    getUnassignedDeliveryOrdersAction(businessDate).then(setUnassigned);
  }, [open, businessDate]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit() {
    if (armadaId == null || selected.size === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        await createJadwalAction({
          armadaId,
          salesmanId: salesmanId || null,
          jamJadwal: combineDateAndTime(businessDate, time),
          deliveryOrderIds: [...selected],
        });
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal membuat keberangkatan.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keberangkatan Baru</DialogTitle>
          <DialogDescription>Pilih DO yang ikut pada keberangkatan ini.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
            <Select value={salesmanId} onValueChange={(v) => setSalesmanId(v ?? "")}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Driver">
                  {(v: string) => drivers.find((d) => d.SalesmanID === v)?.Name ?? "Pilih Driver"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {drivers.map((d) => (
                  <SelectItem key={d.SalesmanID} value={d.SalesmanID}>
                    {d.Name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex max-h-64 flex-col divide-y overflow-y-auto rounded-lg border">
            {unassigned.map((u) => (
              <button
                key={u.DeliveryOrderID}
                type="button"
                onClick={() => toggle(u.DeliveryOrderID)}
                className={cn(
                  "flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors",
                  selected.has(u.DeliveryOrderID) ? "bg-primary/10" : "hover:bg-muted"
                )}
              >
                <span className="min-w-0 truncate">
                  {u.CustomerName} <span className="text-xs text-muted-foreground">· {u.Wilayah}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{u.Qty} kantong</span>
              </button>
            ))}
            {unassigned.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada DO yang belum ditugaskan.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button disabled={pending || selected.size === 0 || armadaId == null} onClick={handleSubmit} className="ml-auto">
            {pending ? "Menyimpan..." : `Buat Keberangkatan (${selected.size} DO)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArmadaRowBoard({
  armada,
  jadwal,
  onCardClick,
  onCreateClick,
}: {
  armada: ArmadaRow;
  jadwal: JadwalCardData[];
  onCardClick: (jadwalId: number) => void;
  onCreateClick: (armadaId: number) => void;
}) {
  return (
    <div className="flex items-stretch">
      <div className="sticky left-0 z-10 flex w-56 shrink-0 flex-col gap-1.5 bg-card py-3 pr-3">
        <div className="flex items-center gap-2">
          {armada.FotoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={armada.FotoPath} alt={armada.Nama} className="size-10 shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground">
              Foto
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{armada.Nama}</p>
            <p className="truncate text-xs text-muted-foreground">{armada.PlatNomor ?? "-"}</p>
          </div>
        </div>
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
      <div className="relative border-l" style={{ width: DAY_WIDTH, height: 72 }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="absolute top-0 h-full border-r" style={{ left: h * HOUR_WIDTH, width: HOUR_WIDTH }} />
        ))}
        {jadwal.map((j) => (
          <button
            key={j.JadwalID}
            type="button"
            onClick={() => onCardClick(j.JadwalID)}
            className="absolute top-2 flex flex-col gap-0.5 rounded-md border border-primary/30 bg-primary/10 p-1.5 text-left text-[10px] shadow-sm"
            style={{ left: hourFraction(j.JamJadwal) * HOUR_WIDTH, width: CARD_WIDTH }}
          >
            <span className="font-semibold tabular-nums">{formatTime(j.JamJadwal)}</span>
            <span className="tabular-nums text-muted-foreground">{j.TotalKantong} kantong</span>
            <span className="tabular-nums text-muted-foreground">{j.TotalDO} DO</span>
            {j.JamAktualBerangkat && <span className="text-primary">Berangkat</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PengirimanBoard({
  armada,
  jadwal,
  drivers,
  businessDate,
  todayISO,
}: {
  armada: ArmadaRow[];
  jadwal: JadwalCardData[];
  drivers: DriverOption[];
  businessDate: string;
  todayISO: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const isToday = businessDate === todayISO;
  const [detailJadwalId, setDetailJadwalId] = useState<number | null>(null);
  const [createArmadaId, setCreateArmadaId] = useState<number | null>(null);

  const jadwalByArmada = useMemo(() => {
    const map = new Map<number, JadwalCardData[]>();
    for (const j of jadwal) {
      const list = map.get(j.ArmadaID) ?? [];
      list.push(j);
      map.set(j.ArmadaID, list);
    }
    return map;
  }, [jadwal]);

  // Vehicles with an upcoming (not yet departed) trip today float to the
  // top, ordered by how soon that trip leaves; vehicles with nothing
  // pending today sort after, alphabetically.
  const sortedArmada = useMemo(() => {
    function nextPendingHour(armadaId: number): number {
      const list = jadwalByArmada.get(armadaId) ?? [];
      const pending = list.filter((j) => !j.JamAktualBerangkat);
      if (pending.length === 0) return Infinity;
      return Math.min(...pending.map((j) => hourFraction(j.JamJadwal)));
    }
    return [...armada].sort((a, b) => {
      const diff = nextPendingHour(a.ArmadaID) - nextPendingHour(b.ArmadaID);
      return diff !== 0 ? diff : a.Nama.localeCompare(b.Nama);
    });
  }, [armada, jadwalByArmada]);

  function goToDate(newDate: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("pengirimanDate", newDate);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function shiftDate(deltaDays: number) {
    const d = new Date(businessDate);
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + deltaDays));
    goToDate(next.toISOString().slice(0, 10));
  }

  return (
    <Card className="relative">
      {isPending && (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-primary/15">
          <div className="h-full w-1/3 animate-indeterminate rounded-full bg-primary" />
        </div>
      )}
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="font-display">
            Papan Pengiriman {isToday ? "Hari Ini" : formatDate(businessDate)}
          </CardTitle>
          <CardDescription>{jadwal.length} keberangkatan terjadwal</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ArmadaManager armada={armada} />
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="size-8" disabled={isPending} onClick={() => shiftDate(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Input
              type="date"
              value={businessDate}
              max={todayISO}
              disabled={isPending}
              onChange={(e) => e.target.value && goToDate(e.target.value)}
              className="h-8 w-40 text-xs"
            />
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={isToday || isPending}
              onClick={() => shiftDate(1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {sortedArmada.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada armada. Tambah lewat "Kelola Armada".</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex flex-col divide-y">
              {sortedArmada.map((a) => (
                <ArmadaRowBoard
                  key={a.ArmadaID}
                  armada={a}
                  jadwal={jadwalByArmada.get(a.ArmadaID) ?? []}
                  onCardClick={setDetailJadwalId}
                  onCreateClick={setCreateArmadaId}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>

      <JadwalDetailDialog
        jadwalId={detailJadwalId}
        jamJadwal={jadwal.find((j) => j.JadwalID === detailJadwalId)?.JamJadwal ?? null}
        businessDate={businessDate}
        onOpenChange={(open) => !open && setDetailJadwalId(null)}
      />
      <CreateJadwalDialog
        open={createArmadaId != null}
        onOpenChange={(open) => !open && setCreateArmadaId(null)}
        armadaId={createArmadaId}
        businessDate={businessDate}
        drivers={drivers}
      />
    </Card>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean, 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/pengiriman-board.tsx
git commit -m "Add Papan Pengiriman board (24h timeline, create/detail dialogs)"
```

---

### Task 7: Drag-to-reschedule

**Files:**
- Modify: `src/components/dashboard/pengiriman-board.tsx` (add `@dnd-kit/core` wiring)
- Modify: `package.json` (new dependency)

**Interfaces:**
- Consumes: `updateJadwalTimeAction` from Task 5 (already imported in Task 6's file).
- No new exports — this task only changes `PengirimanBoard`'s internals.

- [ ] **Step 1: Install the dependency**

```bash
npm install @dnd-kit/core
```

- [ ] **Step 2: Wrap the board in a `DndContext` and make cards draggable**

In `src/components/dashboard/pengiriman-board.tsx`, add this import at the top:

```ts
import { DndContext, useDraggable, type DragEndEvent } from "@dnd-kit/core";
```

Replace the `<button>` inside `ArmadaRowBoard`'s `jadwal.map(...)` block with a new sub-component that wraps it in `useDraggable`. Add this component above `ArmadaRowBoard`:

```tsx
function DraggableJadwalCard({ jadwal: j, onCardClick }: { jadwal: JadwalCardData; onCardClick: (jadwalId: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `jadwal-${j.JadwalID}`,
    data: { jadwalId: j.JadwalID },
  });

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      onClick={() => !isDragging && onCardClick(j.JadwalID)}
      className={cn(
        "absolute top-2 flex flex-col gap-0.5 rounded-md border border-primary/30 bg-primary/10 p-1.5 text-left text-[10px] shadow-sm",
        isDragging && "z-20 opacity-70 shadow-lg"
      )}
      style={{
        left: hourFraction(j.JamJadwal) * HOUR_WIDTH,
        width: CARD_WIDTH,
        transform: transform ? `translateX(${transform.x}px)` : undefined,
      }}
    >
      <span className="font-semibold tabular-nums">{formatTime(j.JamJadwal)}</span>
      <span className="tabular-nums text-muted-foreground">{j.TotalKantong} kantong</span>
      <span className="tabular-nums text-muted-foreground">{j.TotalDO} DO</span>
      {j.JamAktualBerangkat && <span className="text-primary">Berangkat</span>}
    </button>
  );
}
```

Replace `ArmadaRowBoard`'s `{jadwal.map((j) => ( <button ...>...</button> ))}` block with:

```tsx
{jadwal.map((j) => (
  <DraggableJadwalCard key={j.JadwalID} jadwal={j} onCardClick={onCardClick} />
))}
```

- [ ] **Step 3: Handle drag end in `PengirimanBoard`**

Add this function inside `PengirimanBoard`, before the `return`:

```tsx
function handleDragEnd(event: DragEndEvent) {
  const jadwalId = event.active.data.current?.jadwalId as number | undefined;
  if (jadwalId == null || event.delta.x === 0) return;

  const current = jadwal.find((j) => j.JadwalID === jadwalId);
  if (!current) return;

  const currentHour = hourFraction(current.JamJadwal);
  const deltaHours = event.delta.x / HOUR_WIDTH;
  // Round to the nearest 15 minutes (0.25h), clamp to a valid day.
  const newHour = Math.min(23.75, Math.max(0, Math.round((currentHour + deltaHours) * 4) / 4));
  const hour = Math.floor(newHour);
  const minute = Math.round((newHour - hour) * 60);
  const newTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  startTransition(() => {
    updateJadwalTimeAction(jadwalId, combineDateAndTime(businessDate, newTime));
  });
}
```

Wrap the board's scrollable content (the `<div className="overflow-x-auto">...</div>` block inside `CardContent`) with `<DndContext onDragEnd={handleDragEnd}>...</DndContext>`:

```tsx
<DndContext onDragEnd={handleDragEnd}>
  <div className="overflow-x-auto">
    <div className="flex flex-col divide-y">
      {sortedArmada.map((a) => (
        <ArmadaRowBoard
          key={a.ArmadaID}
          armada={a}
          jadwal={jadwalByArmada.get(a.ArmadaID) ?? []}
          onCardClick={setDetailJadwalId}
          onCreateClick={setCreateArmadaId}
        />
      ))}
    </div>
  </div>
</DndContext>
```

- [ ] **Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: clean, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/pengiriman-board.tsx package.json package-lock.json
git commit -m "Add drag-to-reschedule for Jadwal Keberangkatan cards"
```

---

### Task 8: Wire the board into `/delivery`, remove the old assignment tab

**Files:**
- Modify: `src/components/dashboard/pengiriman-tabs.tsx`
- Modify: `src/app/(dashboard)/delivery/page.tsx` (full rewrite)
- Delete: `src/components/dashboard/delivery-assignment-panel.tsx`

**Interfaces:**
- Consumes: `PengirimanBoard` from Task 6/7; `getPengirimanBoard` from Task 4; `getDriverOptions`, `getOpenDeliveries` (existing, `@/lib/queries/delivery`); `getBusinessDateISO` (existing).

- [ ] **Step 1: Update `src/components/dashboard/pengiriman-tabs.tsx`**

Change the `TABS` array's second entry's label, and the prop name, from "penugasan"/"Penugasan Armada & Driver" to "papan"/"Papan Pengiriman":

```tsx
"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const TABS = [
  { value: "terbuka", label: "Pengiriman Terbuka" },
  { value: "papan", label: "Papan Pengiriman" },
] as const;

// Same pattern as piutang-tabs.tsx: pure client-side tab state, no URL
// param, no navigation on switch — both panels' data is already fetched
// upfront by the server page.
export function PengirimanTabs({
  terbukaPanel,
  papanPanel,
}: {
  terbukaPanel: React.ReactNode;
  papanPanel: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<string>("terbuka");

  return (
    <Tabs value={activeTab} onValueChange={(v) => typeof v === "string" && setActiveTab(v)}>
      <TabsList className="no-scrollbar w-full justify-start overflow-x-auto">
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="shrink-0">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="terbuka">{terbukaPanel}</TabsContent>
      <TabsContent value="papan">{papanPanel}</TabsContent>
    </Tabs>
  );
}
```

- [ ] **Step 2: Delete the old assignment panel**

```bash
rm "src/components/dashboard/delivery-assignment-panel.tsx"
```

- [ ] **Step 3: Rewrite `src/app/(dashboard)/delivery/page.tsx`**

```tsx
import { requireModuleAccess } from "@/lib/require-access";
import { getOpenDeliveries, getDriverOptions } from "@/lib/queries/delivery";
import { getPengirimanBoard } from "@/lib/queries/pengiriman-jadwal";
import { getWilayahList } from "@/lib/queries/wilayah";
import { getBusinessDateISO } from "@/lib/business-date";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { OpenDeliveriesPanel } from "@/components/dashboard/open-deliveries-panel";
import { PengirimanBoard } from "@/components/dashboard/pengiriman-board";
import { PengirimanTabs } from "@/components/dashboard/pengiriman-tabs";

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ wilayah?: string; pengirimanDate?: string }>;
}) {
  await requireModuleAccess("delivery");
  const params = await searchParams;
  // Wilayah only filters the "Pengiriman Terbuka" tab (getOpenDeliveries) —
  // the board is date-scoped instead and intentionally shows every wilayah
  // for that date.
  const wilayah = params.wilayah || undefined;

  const todayISO = getBusinessDateISO();
  const boardDate = params.pengirimanDate && params.pengirimanDate <= todayISO ? params.pengirimanDate : todayISO;

  const [rows, wilayahList, board, drivers] = await Promise.all([
    getOpenDeliveries(wilayah),
    getWilayahList(),
    getPengirimanBoard(boardDate),
    getDriverOptions(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Pengiriman</h1>
        <FilterBar wilayahList={wilayahList} showDateRange={false} />
      </div>

      <PengirimanTabs
        terbukaPanel={<OpenDeliveriesPanel rows={rows} />}
        papanPanel={
          <PengirimanBoard
            armada={board.armada}
            jadwal={board.jadwal}
            drivers={drivers}
            businessDate={boardDate}
            todayISO={todayISO}
          />
        }
      />
    </div>
  );
}
```

- [ ] **Step 4: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 TypeScript errors; lint 0 errors (warnings only in pre-existing unrelated files).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/pengiriman-tabs.tsx "src/app/(dashboard)/delivery/page.tsx"
git rm src/components/dashboard/delivery-assignment-panel.tsx
git commit -m "Replace Penugasan Armada & Driver tab with Papan Pengiriman board"
```

---

### Task 9: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 0 TypeScript errors, 0 lint errors, build succeeds.

- [ ] **Step 2: Manual browser walkthrough — Armada profile**

Navigate to `/delivery`, "Papan Pengiriman" tab, "Kelola Armada" → "Tambah Armada": fill every field including a photo upload, save, confirm the new row shows the photo thumbnail, plat nomor, and status badge on the board.

- [ ] **Step 3: Manual browser walkthrough — create + view a departure**

Click "+" on a vehicle row with Status "Baik" (confirm a non-"Baik" vehicle's "+" is disabled): pick 2+ DOs, a time, a driver, submit. Confirm the new card appears at roughly the right hour position, with correct Total Kantong/Total DO. Click the card: confirm the DO list detail shows Penerima/Jumlah/Wilayah/Kecamatan/Alamat/Telepon correctly, then click "Mulai Muat" then "Berangkat" and confirm the card reflects it.

- [ ] **Step 4: Manual browser walkthrough — reschedule**

Drag the card to a different hour; confirm it snaps to a 15-minute increment and the time updates. Reload the page and confirm it persisted. Then open the card's detail dialog, change the time via the "Simpan Jam" field instead, and confirm the card moves to match. Confirm the time shown in "Pengiriman Terbuka" tab's Kendaraan column for one of that departure's DOs now shows the assigned vehicle name.

- [ ] **Step 5: Manual browser walkthrough — row sorting**

Confirm vehicle rows reorder so the one with the soonest not-yet-departed trip is on top; confirm a vehicle whose only trip already has "Berangkat" pressed sinks below vehicles with pending trips.

- [ ] **Step 6: Confirm no regressions**

Spot-check `/transaksi` still loads (reads `DeliveryOrder`/`Salesman` too) — this task didn't change any read query those pages use, but confirm nothing chokes on the newly-active `VehicleNo`/`SalesmanID` writes.
