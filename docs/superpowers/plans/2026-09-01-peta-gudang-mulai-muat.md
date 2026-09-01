# Penyatuan "Mulai Muat" ke Peta Stok Es Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move pallet selection and quantity input for "Mulai Muat" from a text-based pallet-code list (Pengiriman tab) into a tap-on-map picking mode on the Stok Es warehouse view, triggered from the existing 3-slot "Area Muat" dock cards.

**Architecture:** A new custom hook (`usePalletAmbilStok`) owns the entire picking-session state (batch list, per-position allocation, qty5kg, confirm flow) and is always called unconditionally inside `WarehouseView` (React hook rules), guarded internally by whether a Jadwal is actively being picked. Two new presentational pieces consume it: a per-cell `Popover` wrapping `WarehouseCell` for tapping a pallet, and a sticky bottom panel for the running total + qty5kg + Selesai Muat/Batal. `WarehouseCell` gains two small optional props (`disabled`, `highlighted`) with no behavior change when omitted. The old `AlokasiScreen`/`IsiMuatanScreen` flow is removed from `kartu-pengiriman-list.tsx` only after the new flow is fully wired, so the app is never left without a way to load a delivery.

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript, React 19 client components, `@base-ui/react`-based `Popover`/`Dialog`.

**Spec:** `docs/superpowers/specs/2026-09-01-peta-gudang-mulai-muat-design.md`

## Global Constraints

- `JAM_AMBANG_MENDEKATI_KEBERANGKATAN` (2 hours) and the 3-slot Area Muat dock mechanism are unchanged — this plan only adds interactivity to what's already there.
- `produksiStartMuatAction`, `produksiSelesaiMuatAction`, `getBatchAktifForAlokasiAction`, `getJadwalDetailForProduksiAction` (all in `src/app/mkesindo/produksi/actions.ts`) are reused exactly as they exist today — no server-layer changes anywhere in this plan.
- A pallet position with multiple active batches (`JumlahBatchAktif > 1`) shows ONE combined qty10kg input in the picker — the split across that position's individual `BatchID`s (oldest batch first) happens client-side before calling `produksiSelesaiMuatAction`, via a new pure function `splitAlokasiFifo`.
- Empty pallet cells are non-interactive only while a picking session is active (`pickingJadwal != null`) — outside picking mode, tapping any cell (filled or empty) keeps its current behavior (view detail / add production) unchanged.
- Only one picking session can be active at a time — the other 2 Area Muat dock cards become non-interactive while one is in progress.
- `src/components/produksi-app/warehouse-view.tsx` is explicitly authorized to be extended for this feature (user's own standing "don't touch" instruction from earlier this session was lifted specifically for this work) — stay tightly within what this plan describes, do not restructure unrelated parts of the file (zone navigation, `TambahProduksiDialog` flow, `RiwayatPosisiList` all stay as-is).
- This repo has no automated test suite (no `"test"` script in `package.json`, no jest/vitest). Verification per task: `npx tsc --noEmit`, `npm run lint`, manual browser verification via this session's preview tooling, and — for the one piece of genuinely new logic (`splitAlokasiFifo`) — a disposable `npx tsx` scratch script exercising a few concrete cases, deleted after use (this repo's established convention).

---

### Task 1: Wire real Kartu Pengiriman data into the warehouse tab

The Area Muat dock cards currently always render empty (yellow-hatched) in production, because `WarehouseView` is rendered with no `jadwal` prop at all — `jadwalMendekat` is always `[]`. This task fixes that independently of the picking-mode work, and is valuable and testable on its own.

**Files:**
- Modify: `src/components/produksi-app/produksi-tab-shell.tsx`
- Modify: `src/app/mkesindo/produksi-app/(tabs)/warehouse/page.tsx`

**Interfaces:**
- Consumes: `getDraftJadwalForProduksiAction()` (already imported in produksi-tab-shell.tsx for the "kartu-pengiriman" tab; reused here for an independent fetch since tabs are lazy-loaded on first visit and "warehouse" may be visited before "kartu-pengiriman" ever is), `getDraftJadwalForProduksi()` (already exported from `@/lib/queries/produksi-muatan`, used server-side).
- Produces: `ProduksiTabShell`'s new `initialWarehouseJadwal?: DraftJadwalForProduksi[]` prop — no other task depends on this directly (Task 2 reads `warehouseJadwal` state, which this task creates).

- [ ] **Step 1: Add the `warehouseJadwal` state and its own fetch in `produksi-tab-shell.tsx`**

Add `initialWarehouseJadwal` to the props destructuring and type:
```ts
  initialWarehouseJadwal,
```
```ts
  initialWarehouseJadwal?: DraftJadwalForProduksi[];
```
(insert both alongside the existing `initialWarehouse`/`initialMesin` lines)

Add the state declaration alongside the existing `warehouse`/`mesin` state:
```ts
  const [warehouseJadwal, setWarehouseJadwal] = useState<DraftJadwalForProduksi[] | null>(initialWarehouseJadwal ?? null);
```

Change `refreshWarehouse` so completing a pick-and-load also refreshes this list:
```ts
  function refreshWarehouse() {
    setWarehouse(null);
    setWarehouseJadwal(null);
  }
```

Add a fetch block inside the `useEffect`'s `load()` function, directly after the existing `activeTab === "warehouse" && takeAwayPending === null` block:
```ts
      if (activeTab === "warehouse" && warehouseJadwal === null) {
        setLoadingTab("warehouse");
        const result = await getDraftJadwalForProduksiAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setWarehouseJadwal(result.data);
        setLoadingTab(null);
      }
```

Add `warehouseJadwal` to the `useEffect`'s dependency array:
```ts
  }, [activeTab, kartuPengiriman, riwayat, warehouse, mesin, takeAwayPending, warehouseJadwal, kualitas, bahanBaku, aktivitasProduksi]);
```

- [ ] **Step 2: Pass the data into `WarehouseView` and gate the render on it**

Change:
```tsx
        {visited.has("warehouse") && warehouse && mesin && takeAwayPending && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "warehouse" && "hidden")}>
            <WarehouseView posisi={warehouse} onAfterTambah={refreshWarehouse} />
            <TakeAwayMuatanList
              initialPending={takeAwayPending}
              fetchSelesaiList={getTakeAwayMuatanSelesaiAction}
              onAfterMuat={refreshTakeAway}
            />
          </div>
        )}
```
to:
```tsx
        {visited.has("warehouse") && warehouse && mesin && takeAwayPending && warehouseJadwal && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "warehouse" && "hidden")}>
            <WarehouseView
              posisi={warehouse}
              jadwal={warehouseJadwal}
              onAfterTambah={refreshWarehouse}
              onAfterMuat={() => {
                refreshWarehouse();
                refreshKartuPengiriman();
              }}
            />
            <TakeAwayMuatanList
              initialPending={takeAwayPending}
              fetchSelesaiList={getTakeAwayMuatanSelesaiAction}
              onAfterMuat={refreshTakeAway}
            />
          </div>
        )}
```

Note: `WarehouseView`'s new `onAfterMuat` prop doesn't exist yet — it's added in Task 2. This step's change compiles once Task 2 lands; until then `tsc` will report a missing prop here, which is expected and gets fixed by Task 2, not this task (this plan's tasks land in order, so this is never actually seen mid-development if executed top to bottom).

- [ ] **Step 3: Fetch the data server-side in `warehouse/page.tsx`**

Change:
```tsx
import type { Metadata } from "next";
import { requireProduksi } from "@/lib/require-access";
import { getWarehouseMap } from "@/lib/queries/produksi-warehouse";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getUserById } from "@/lib/queries/akun";
import { getTakeAwayMuatanPending } from "@/lib/queries/takeaway-muatan";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export const metadata: Metadata = { title: "Stok Es" };

export default async function ProduksiAppWarehousePage() {
  const session = await requireProduksi();
  const [posisi, mesinList, profile, takeAwayPending] = await Promise.all([
    getWarehouseMap(),
    getMesinList(),
    getUserById(Number(session.user.id)),
    getTakeAwayMuatanPending(),
  ]);

  return (
    <ProduksiTabShell
      initialTab="warehouse"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialWarehouse={posisi}
      initialMesin={mesinList}
      initialTakeAwayPending={takeAwayPending}
    />
  );
}
```
to:
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

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: errors only about `WarehouseView`'s missing `jadwal`/`onAfterMuat` prop types (since `WarehouseView` itself isn't updated until Task 2) — no errors in `produksi-tab-shell.tsx` or `warehouse/page.tsx` themselves.

- [ ] **Step 5: Commit**

```bash
git add src/components/produksi-app/produksi-tab-shell.tsx "src/app/mkesindo/produksi-app/(tabs)/warehouse/page.tsx"
git commit -m "feat: wire real Kartu Pengiriman data into the warehouse tab's Area Muat docks"
```

---

### Task 2: Pallet-picking session — hook, popover, floating panel, WarehouseCell modes, WarehouseView wiring

This is the core of the feature. All pieces below land together because none is independently testable in isolation (the hook has no UI without the popover/panel; the popover/panel have no data without the hook; `WarehouseCell`'s new props have no visible effect without `WarehouseView` using them).

**Files:**
- Create: `src/components/produksi-app/pallet-ambil-panel.tsx`
- Modify: `src/components/produksi/warehouse-cell.tsx`
- Modify: `src/components/produksi-app/warehouse-view.tsx`

**Interfaces:**
- Consumes: `warehouseJadwal` prop plumbing from Task 1; `BatchAktifRow` (`src/lib/queries/produksi-warehouse.ts`: `{BatchID, PosisiID, Kode, SisaQty10KG, TanggalLabel, JamPanen}`); `JadwalDetailRow` (`src/lib/queries/pengiriman-jadwal.ts`); `DraftJadwalForProduksi` (`src/lib/queries/produksi-muatan.ts`); `PalletPosisiRow` (`src/lib/queries/produksi-warehouse.ts`); `produksiStartMuatAction`, `produksiSelesaiMuatAction`, `getBatchAktifForAlokasiAction`, `getJadwalDetailForProduksiAction` (`src/app/mkesindo/produksi/actions.ts`, all pre-existing, unchanged).
- Produces:
  - `splitAlokasiFifo(posisiId: number, qtyDiminta: number, batchList: BatchAktifRow[]): { batchId: number; qty10KG: number }[]` (exported pure function)
  - `usePalletAmbilStok(jadwal: DraftJadwalForProduksi | null, onDone: () => void)` (exported hook) — return shape used by both new presentational components and consumed directly by `WarehouseView`.
  - `PalletCellAmbilPopover({ kode, row, pallet, open, onOpenChange })` (exported component)
  - `FloatingAmbilPanel({ jadwal, pallet, onBatal })` (exported component)
  - `WarehouseCell`'s new optional props `disabled?: boolean` and `highlighted?: boolean` — Task 3 doesn't touch this file, but any other future consumer of `WarehouseCell` keeps working unchanged (both default to `false`).
  - `WarehouseView`'s new required prop `onAfterMuat: () => void` (Task 1 already wires this from the caller side) and optional `jadwal` behavior is unchanged in shape (still `DraftJadwalForProduksi[]`, default `[]`).

- [ ] **Step 1: Add the `disabled`/`highlighted` props to `WarehouseCell`**

Change `src/components/produksi/warehouse-cell.tsx` from:
```tsx
export function WarehouseCell({
  kode,
  row,
  onClick,
}: {
  kode: string;
  row: PalletPosisiRow | undefined;
  onClick?: (row: PalletPosisiRow | undefined) => void;
}) {
  const terisi = (row?.JumlahBatchAktif ?? 0) > 0;
  return (
    <button
      type="button"
      onClick={() => onClick?.(row)}
      className={cn(
        "relative flex size-[55px] shrink-0 flex-col items-center justify-center rounded-md text-xs font-semibold leading-tight",
        terisi ? ageClass(row!.TanggalLabelTertua, row!.JamPanenTertua) : "bg-muted text-muted-foreground"
      )}
    >
      <span>{kode}</span>
      {terisi && <span className="text-[9px] font-normal opacity-90">{row!.TotalSisaQty10KG}</span>}
      {(row?.JumlahBatchAktif ?? 0) > 1 && (
        <span className="absolute -right-1 -top-1 rounded-full bg-foreground px-1 text-[8px] font-bold text-background">
          ×{row!.JumlahBatchAktif}
        </span>
      )}
    </button>
  );
}
```
to:
```tsx
export function WarehouseCell({
  kode,
  row,
  onClick,
  disabled = false,
  highlighted = false,
}: {
  kode: string;
  row: PalletPosisiRow | undefined;
  onClick?: (row: PalletPosisiRow | undefined) => void;
  // Mode ambil stok: kotak kosong dinonaktifkan sepenuhnya (mode ini murni
  // untuk mengambil, bukan menambah stok) -- lihat pallet-ambil-panel.tsx.
  disabled?: boolean;
  // Mode ambil stok: menandai pallet FIFO-terdepan hasil
  // getBatchAktifForAlokasiAction ("ambil di sini dulu").
  highlighted?: boolean;
}) {
  const terisi = (row?.JumlahBatchAktif ?? 0) > 0;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick?.(row)}
      className={cn(
        "relative flex size-[55px] shrink-0 flex-col items-center justify-center rounded-md text-xs font-semibold leading-tight",
        terisi ? ageClass(row!.TanggalLabelTertua, row!.JamPanenTertua) : "bg-muted text-muted-foreground",
        disabled && "opacity-40",
        highlighted && "ring-2 ring-offset-1 ring-sky-500"
      )}
    >
      <span>{kode}</span>
      {terisi && <span className="text-[9px] font-normal opacity-90">{row!.TotalSisaQty10KG}</span>}
      {(row?.JumlahBatchAktif ?? 0) > 1 && (
        <span className="absolute -right-1 -top-1 rounded-full bg-foreground px-1 text-[8px] font-bold text-background">
          ×{row!.JumlahBatchAktif}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Create `pallet-ambil-panel.tsx` — pure function + hook**

Create `src/components/produksi-app/pallet-ambil-panel.tsx` with this content (more added in the next steps — write this part first):

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WarehouseCell } from "@/components/produksi/warehouse-cell";
import {
  produksiSelesaiMuatAction,
  getBatchAktifForAlokasiAction,
  getJadwalDetailForProduksiAction,
} from "@/app/mkesindo/produksi/actions";
import type { DraftJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import type { BatchAktifRow, PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
import type { JadwalDetailRow } from "@/lib/queries/pengiriman-jadwal";

// Satu pallet FISIK (satu PosisiID) bisa punya lebih dari satu batch aktif
// (badge "×N" di WarehouseCell) -- popover hanya menampilkan SATU angka
// gabungan untuk posisi itu (sesuai kenyataan fisik yang dilihat operator),
// fungsi ini yang membagi angka itu ke batch-batch di posisi tersebut
// secara FIFO (batch termalam duluan) sebelum dikirim ke
// produksiSelesaiMuatAction (yang tetap menerima daftar per-BatchID).
export function splitAlokasiFifo(
  posisiId: number,
  qtyDiminta: number,
  batchList: BatchAktifRow[]
): { batchId: number; qty10KG: number }[] {
  const batchesDiPosisi = batchList
    .filter((b) => b.PosisiID === posisiId)
    .sort((a, b) => {
      const tanggalA = new Date(a.TanggalLabel).toISOString().slice(0, 10);
      const tanggalB = new Date(b.TanggalLabel).toISOString().slice(0, 10);
      const waktuA = new Date(`${tanggalA}T${a.JamPanen}`).getTime();
      const waktuB = new Date(`${tanggalB}T${b.JamPanen}`).getTime();
      return waktuA - waktuB;
    });

  const hasil: { batchId: number; qty10KG: number }[] = [];
  let sisaDiminta = qtyDiminta;
  for (const batch of batchesDiPosisi) {
    if (sisaDiminta <= 0) break;
    const ambil = Math.min(sisaDiminta, batch.SisaQty10KG);
    if (ambil > 0) {
      hasil.push({ batchId: batch.BatchID, qty10KG: ambil });
      sisaDiminta -= ambil;
    }
  }
  return hasil;
}

interface AlokasiPosisiState {
  [posisiId: number]: number;
}

// Dipanggil TANPA SYARAT di WarehouseView (aturan Hooks React), dijaga di
// dalam sendiri lewat null-check `jadwal` -- supaya WarehouseView tidak
// perlu memanggil hook ini secara kondisional. Setiap kali `jadwal` berganti
// identitas (termasuk dari ada -> null saat sesi ditutup), seluruh state
// sesi di-reset -- WarehouseView sendiri tidak remount di antara sesi.
export function usePalletAmbilStok(jadwal: DraftJadwalForProduksi | null, onDone: () => void) {
  const [batchList, setBatchList] = useState<BatchAktifRow[] | null>(null);
  const [alokasiPosisi, setAlokasiPosisi] = useState<AlokasiPosisiState>({});
  const [qty5Dimuat, setQty5Dimuat] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmDetail, setConfirmDetail] = useState<JadwalDetailRow[] | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  useEffect(() => {
    setBatchList(null);
    setAlokasiPosisi({});
    setQty5Dimuat(jadwal ? String(jadwal.Qty5KGDibutuhkan) : "0");
    setError(null);
    setConfirmDetail(null);
    if (!jadwal) return;
    getBatchAktifForAlokasiAction().then((result) => {
      if (result.success) setBatchList(result.data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jadwal?.JadwalID]);

  const sisaPerPosisi = new Map<number, number>();
  for (const b of batchList ?? []) {
    sisaPerPosisi.set(b.PosisiID, (sisaPerPosisi.get(b.PosisiID) ?? 0) + b.SisaQty10KG);
  }
  const fifoFrontPosisiId = batchList && batchList.length > 0 ? batchList[0].PosisiID : null;

  const totalQty10 = Object.values(alokasiPosisi).reduce((sum, q) => sum + q, 0);
  const qty5Num = Number(qty5Dimuat) || 0;
  const cukup = jadwal != null && totalQty10 >= jadwal.Qty10KGDibutuhkan && qty5Num >= jadwal.Qty5KGDibutuhkan;

  function setAmbilUntukPosisi(posisiId: number, value: number) {
    const max = sisaPerPosisi.get(posisiId) ?? 0;
    setAlokasiPosisi((prev) => ({ ...prev, [posisiId]: Math.min(Math.max(0, value), max) }));
  }

  function handleOpenConfirm() {
    if (!jadwal) return;
    setError(null);
    setConfirmLoading(true);
    getJadwalDetailForProduksiAction(jadwal.JadwalID).then((result) => {
      setConfirmLoading(false);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setConfirmDetail(result.data);
    });
  }

  function handleConfirmYa() {
    if (!jadwal || !batchList) return;
    const alokasiList = Object.entries(alokasiPosisi).flatMap(([posisiId, qty]) =>
      qty > 0 ? splitAlokasiFifo(Number(posisiId), qty, batchList) : []
    );
    startTransition(async () => {
      const result = await produksiSelesaiMuatAction({
        jadwalId: jadwal.JadwalID,
        alokasi: alokasiList,
        qty5KGDimuat: qty5Num,
      });
      if (!result.success) {
        setConfirmDetail(null);
        setError(result.error);
        return;
      }
      onDone();
    });
  }

  return {
    batchList,
    sisaPerPosisi,
    fifoFrontPosisiId,
    alokasiPosisi,
    qty5Dimuat,
    setQty5Dimuat,
    totalQty10,
    cukup,
    error,
    pending,
    confirmDetail,
    confirmLoading,
    setAmbilUntukPosisi,
    handleOpenConfirm,
    handleConfirmYa,
    closeConfirm: () => setConfirmDetail(null),
  };
}
```

- [ ] **Step 3: Add `PalletCellAmbilPopover` and `FloatingAmbilPanel` to the same file**

Append to `src/components/produksi-app/pallet-ambil-panel.tsx`:

```tsx
export function PalletCellAmbilPopover({
  kode,
  row,
  pallet,
  open,
  onOpenChange,
}: {
  kode: string;
  row: PalletPosisiRow | undefined;
  pallet: ReturnType<typeof usePalletAmbilStok>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const terisi = (row?.JumlahBatchAktif ?? 0) > 0;
  if (!terisi || !row) {
    return <WarehouseCell kode={kode} row={row} disabled />;
  }

  const posisiId = row.PosisiID;
  const max = pallet.sisaPerPosisi.get(posisiId) ?? 0;
  const nilai = pallet.alokasiPosisi[posisiId] ?? 0;
  const highlighted = pallet.fifoFrontPosisiId === posisiId;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <WarehouseCell kode={kode} row={row} highlighted={highlighted} onClick={() => onOpenChange(true)} />
      </PopoverTrigger>
      <PopoverContent className="w-48">
        <p className="text-xs font-medium">
          Pallet {kode}
          {highlighted && <span className="ml-1 text-amber-600">· Paling lama</span>}
        </p>
        <p className="text-xs text-muted-foreground">Sisa: {max} kantong 10kg</p>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={nilai || ""}
            placeholder="0"
            onChange={(e) => pallet.setAmbilUntukPosisi(posisiId, Number(e.target.value))}
            className="h-8"
          />
          <Button size="sm" onClick={() => onOpenChange(false)}>
            OK
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FloatingAmbilPanel({
  jadwal,
  pallet,
  onBatal,
}: {
  jadwal: DraftJadwalForProduksi;
  pallet: ReturnType<typeof usePalletAmbilStok>;
  onBatal: () => void;
}) {
  return (
    <div className="sticky bottom-0 left-0 right-0 z-20 flex flex-col gap-2 border-t border-border bg-background p-3 shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
      <p className="text-sm font-semibold">{jadwal.ArmadaNama}</p>
      <p className="text-xs text-muted-foreground">
        Sudah dialokasikan: {pallet.totalQty10} / {jadwal.Qty10KGDibutuhkan} kantong 10kg
      </p>
      <div>
        <label className="text-xs font-medium text-muted-foreground">Qty 5kg dimuat (tanpa pallet, langsung)</label>
        <Input type="number" value={pallet.qty5Dimuat} onChange={(e) => pallet.setQty5Dimuat(e.target.value)} className="mt-1 h-8" />
      </div>
      {pallet.error && <p className="text-xs text-destructive">{pallet.error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={onBatal}>
          Batal
        </Button>
        <Button size="sm" className="flex-1" disabled={!pallet.cukup || pallet.confirmLoading} onClick={pallet.handleOpenConfirm}>
          {pallet.confirmLoading ? "Memuat..." : "Selesai Muat"}
        </Button>
      </div>

      <Dialog open={pallet.confirmDetail != null} onOpenChange={(open) => !open && !pallet.pending && pallet.closeConfirm()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Selesaikan Muat?</DialogTitle>
          </DialogHeader>
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            <p className="text-sm text-muted-foreground">
              Muatan akan dikunci dan Surat Jalan/Invoice diterbitkan untuk tujuan berikut:
            </p>
            {pallet.confirmDetail?.map((d) => (
              <div key={d.JadwalDetailID} className="rounded-md border border-border p-2 text-sm">
                <p className="font-medium">{d.CustomerName}</p>
                <p className="text-xs text-muted-foreground">
                  {d.Qty10KG} kantong 10kg, {d.Qty5KG} kantong 5kg
                </p>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={pallet.pending} onClick={pallet.closeConfirm}>
              Tidak
            </Button>
            <Button disabled={pallet.pending} onClick={pallet.handleConfirmYa}>
              {pallet.pending ? "Memproses..." : "Ya, Selesai Muat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Wire everything into `warehouse-view.tsx`**

Add to the import block:
```tsx
import { useEffect, useRef, useState, useTransition } from "react";
```
(adds `useTransition` to the existing React import)

```tsx
import { DialogFooter } from "@/components/ui/dialog";
```
(add `DialogFooter` to the existing `Dialog, DialogContent, DialogHeader, DialogTitle` import line — merge into one import statement)

```tsx
import { produksiStartMuatAction } from "@/app/mkesindo/produksi/actions";
import { usePalletAmbilStok, PalletCellAmbilPopover, FloatingAmbilPanel } from "@/components/produksi-app/pallet-ambil-panel";
```

Change `WarehouseView`'s props signature from:
```tsx
export function WarehouseView({
  posisi,
  jadwal = [],
  onAfterTambah,
}: {
  posisi: PalletPosisiRow[];
  jadwal?: DraftJadwalForProduksi[];
  onAfterTambah: () => void;
}) {
```
to:
```tsx
export function WarehouseView({
  posisi,
  jadwal = [],
  onAfterTambah,
  onAfterMuat,
}: {
  posisi: PalletPosisiRow[];
  jadwal?: DraftJadwalForProduksi[];
  onAfterTambah: () => void;
  // Dipanggil setelah satu sesi ambil-stok selesai (Selesai Muat sukses) --
  // pemanggil me-refresh baik posisi pallet maupun daftar Kartu Pengiriman.
  onAfterMuat: () => void;
}) {
```

Add new state directly after the existing `now`/`setNow` block:
```tsx
  const [pickingJadwal, setPickingJadwal] = useState<DraftJadwalForProduksi | null>(null);
  const [openPopoverKode, setOpenPopoverKode] = useState<string | null>(null);
  const [confirmMulaiJadwal, setConfirmMulaiJadwal] = useState<DraftJadwalForProduksi | null>(null);
  const [mulaiError, setMulaiError] = useState<string | null>(null);
  const [mulaiPending, startMulaiTransition] = useTransition();

  const pallet = usePalletAmbilStok(pickingJadwal, () => {
    setPickingJadwal(null);
    setOpenPopoverKode(null);
    onAfterMuat();
  });

  function handleTruckCardClick(j: DraftJadwalForProduksi) {
    if (j.JamMulaiMuat != null) {
      setPickingJadwal(j);
      return;
    }
    setConfirmMulaiJadwal(j);
  }

  function handleMulaiYa() {
    if (!confirmMulaiJadwal) return;
    setMulaiError(null);
    startMulaiTransition(async () => {
      const result = await produksiStartMuatAction(confirmMulaiJadwal.JadwalID);
      if (!result.success) {
        setMulaiError(result.error);
        return;
      }
      setPickingJadwal(confirmMulaiJadwal);
      setConfirmMulaiJadwal(null);
    });
  }
```

Change the pallet-cell rendering loop from:
```tsx
                              {row.map((kode) => (
                                <WarehouseCell key={kode} kode={kode} row={byKode.get(kode)} onClick={handleCellClick} />
                              ))}
```
to:
```tsx
                              {row.map((kode) =>
                                pickingJadwal != null ? (
                                  <PalletCellAmbilPopover
                                    key={kode}
                                    kode={kode}
                                    row={byKode.get(kode)}
                                    pallet={pallet}
                                    open={openPopoverKode === kode}
                                    onOpenChange={(open) => setOpenPopoverKode(open ? kode : null)}
                                  />
                                ) : (
                                  <WarehouseCell key={kode} kode={kode} row={byKode.get(kode)} onClick={handleCellClick} />
                                )
                              )}
```

Change the zone-Utara truck-dock render from:
```tsx
                  {zone.id === "U" && <TruckDockColumn jadwal={jadwalMendekat} now={now} />}
```
to:
```tsx
                  {zone.id === "U" && (
                    <TruckDockColumn
                      jadwal={jadwalMendekat}
                      now={now}
                      pickingActiveId={pickingJadwal?.JadwalID ?? null}
                      onSelect={handleTruckCardClick}
                    />
                  )}
```

Add the floating panel + Mulai Muat confirm dialog directly before the closing `</div>` of the component's top-level return (right after the existing `<KartuPengirimanMendekatPanel .../>` line, still inside the outer wrapping `<div className="flex flex-col gap-3 p-4">`, but the floating panel itself uses `sticky bottom-0` so it visually pins regardless of where in the JSX tree it's placed):
```tsx
      {pickingJadwal && (
        <FloatingAmbilPanel
          jadwal={pickingJadwal}
          pallet={pallet}
          onBatal={() => {
            setPickingJadwal(null);
            setOpenPopoverKode(null);
          }}
        />
      )}

      <Dialog open={confirmMulaiJadwal != null} onOpenChange={(open) => !open && !mulaiPending && setConfirmMulaiJadwal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mulai Muat — {confirmMulaiJadwal?.ArmadaNama}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            Dibutuhkan: {confirmMulaiJadwal?.Qty10KGDibutuhkan} kantong 10kg, {confirmMulaiJadwal?.Qty5KGDibutuhkan} kantong 5kg
          </p>
          {mulaiError && <p className="text-sm text-destructive">{mulaiError}</p>}
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={mulaiPending} onClick={() => setConfirmMulaiJadwal(null)}>
              Batal
            </Button>
            <Button disabled={mulaiPending} onClick={handleMulaiYa}>
              {mulaiPending ? "Memproses..." : "Ya, Mulai Muat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 5: Make `TruckDockColumn`/`TruckCard` clickable and respect the "one session at a time" rule**

Change `TruckDockColumn` from:
```tsx
function TruckDockColumn({ jadwal, now }: { jadwal: DraftJadwalForProduksi[]; now: Date }) {
  const slots: Array<DraftJadwalForProduksi | null> = [0, 1, 2].map((i) => jadwal[i] ?? null);

  return (
    <div className="grid grid-rows-3 gap-2">
      {slots.map((j, i) => (
        <div key={j?.JadwalID ?? `dermaga-kosong-${i}`} className="flex items-center">
          <TruckCard jadwal={j} now={now} />
        </div>
      ))}
    </div>
  );
}
```
to:
```tsx
function TruckDockColumn({
  jadwal,
  now,
  pickingActiveId,
  onSelect,
}: {
  jadwal: DraftJadwalForProduksi[];
  now: Date;
  // JadwalID sesi ambil-stok yang sedang berjalan (null kalau tidak ada
  // sesi aktif) -- dermaga LAIN selain yang aktif dinonaktifkan sementara,
  // mencegah dua sesi ambil-stok berjalan tumpang tindih.
  pickingActiveId: number | null;
  onSelect: (jadwal: DraftJadwalForProduksi) => void;
}) {
  const slots: Array<DraftJadwalForProduksi | null> = [0, 1, 2].map((i) => jadwal[i] ?? null);

  return (
    <div className="grid grid-rows-3 gap-2">
      {slots.map((j, i) => (
        <div key={j?.JadwalID ?? `dermaga-kosong-${i}`} className="flex items-center">
          <TruckCard
            jadwal={j}
            now={now}
            onClick={j ? () => onSelect(j) : undefined}
            disabled={pickingActiveId != null && j?.JadwalID !== pickingActiveId}
          />
        </div>
      ))}
    </div>
  );
}
```

Change `TruckCard` from:
```tsx
function TruckCard({ jadwal, now }: { jadwal: DraftJadwalForProduksi | null; now: Date }) {
  const isKosong = jadwal == null;
  const diffMs = jadwal ? new Date(jadwal.JamJadwal).getTime() - now.getTime() : 0;
  const terlambat = !isKosong && diffMs < 0;
  const sedangDimuat = jadwal?.JamMulaiMuat != null;
```
to:
```tsx
function TruckCard({
  jadwal,
  now,
  onClick,
  disabled = false,
}: {
  jadwal: DraftJadwalForProduksi | null;
  now: Date;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const isKosong = jadwal == null;
  const diffMs = jadwal ? new Date(jadwal.JamJadwal).getTime() - now.getTime() : 0;
  const terlambat = !isKosong && diffMs < 0;
  const sedangDimuat = jadwal?.JamMulaiMuat != null;
```

Change the returned element from a plain `<div ...>` to a clickable `<button type="button">`:
```tsx
  return (
    <div
      style={{
        height: TRUCK_HEIGHT_PX,
        width: TRUCK_WIDTH_PX,
        backgroundImage: `repeating-linear-gradient(135deg, ${hatchColor} 0px, ${hatchColor} ${hatchThickness}, transparent ${hatchThickness}, transparent 8px)`,
      }}
      className={cn(
        "relative flex shrink-0 items-center gap-2 overflow-hidden rounded-md border px-2 py-1",
        isKosong
          ? "border-dashed border-border/60 opacity-50"
          : terlambat
          ? "border-red-600/40"
          : sedangDimuat
          ? "border-amber-500/50"
          : "border-sky-500/40"
      )}
      title={isKosong ? "Belum ada jadwal keberangkatan mendekat" : jadwal.ArmadaNama}
    >
```
to:
```tsx
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isKosong || disabled}
      style={{
        height: TRUCK_HEIGHT_PX,
        width: TRUCK_WIDTH_PX,
        backgroundImage: `repeating-linear-gradient(135deg, ${hatchColor} 0px, ${hatchColor} ${hatchThickness}, transparent ${hatchThickness}, transparent 8px)`,
      }}
      className={cn(
        "relative flex shrink-0 items-center gap-2 overflow-hidden rounded-md border px-2 py-1 text-left",
        isKosong
          ? "border-dashed border-border/60 opacity-50"
          : terlambat
          ? "border-red-600/40"
          : sedangDimuat
          ? "border-amber-500/50"
          : "border-sky-500/40",
        disabled && !isKosong && "opacity-30"
      )}
      title={isKosong ? "Belum ada jadwal keberangkatan mendekat" : jadwal.ArmadaNama}
    >
```

And change the matching closing tag at the end of the function from `</div>` to `</button>` (the very last line of `TruckCard`, right after the `<Truck .../>` icon).

- [ ] **Step 6: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean across all 3 files (and Task 1's files, whose earlier expected-error is now resolved since `WarehouseView`'s `onAfterMuat` prop exists).

- [ ] **Step 7: Manual browser verification**

Start the dev server, open `/mkesindo/produksi-app` (logged in as an `isProduksi` account), go to the Stok Es tab. If a real Kartu Pengiriman is within 2 hours of departure, confirm:
- It overlays the Area Muat dock's hatching (unchanged from before this task).
- Tapping it (if `JamMulaiMuat` not yet set) shows the "Mulai Muat — {Armada}?" confirmation dialog; confirming enters picking mode.
- Empty pallet cells are dimmed and unclickable; the FIFO-front pallet has a visible ring highlight.
- Tapping a filled pallet cell opens a popover with a qty input; entering a number and pressing OK updates the running total in the bottom sticky panel.
- The other 2 Area Muat docks are dimmed while this session is active.
- Pressing "Batal" exits picking mode without finishing; tapping the same dock card again re-enters picking mode directly (no "Mulai Muat" dialog this time).

If no real Kartu Pengiriman is currently within 2 hours to test with live, note this in the report — full end-to-end confirmation (including a real `produksiSelesaiMuatAction` completion) is Task 4's job.

- [ ] **Step 8: Commit**

```bash
git add src/components/produksi-app/pallet-ambil-panel.tsx src/components/produksi/warehouse-cell.tsx src/components/produksi-app/warehouse-view.tsx
git commit -m "feat: add tap-on-map pallet picking to the Stok Es Area Muat docks"
```

---

### Task 3: Remove the old Mulai Muat flow from the Pengiriman tab

**Files:**
- Modify: `src/components/produksi-app/kartu-pengiriman-list.tsx`

**Interfaces:**
- Consumes: nothing new — this task only removes code.
- Produces: `KartuPengirimanList`'s public props/behavior are otherwise unchanged (`QuickSelesaiDialog`'s "Selesai Muat cepat" keeps working exactly as before).

- [ ] **Step 1: Remove the card's tap-to-select interactivity and the `IsiMuatanScreen` render branch**

Change:
```tsx
export function KartuPengirimanList({
  initialJadwal,
  fetchSelesaiList,
  emptyMessage = "Tidak ada Kartu Pengiriman yang perlu diisi muatan saat ini.",
  onAfterMuat,
}: {
  initialJadwal: DraftJadwalForProduksi[];
  fetchSelesaiList: () => Promise<ActionResult<SelesaiMuatJadwalForProduksi[]>>;
  emptyMessage?: string;
  onAfterMuat: () => void;
}) {
  const [jadwalList, setJadwalList] = useState(initialJadwal);
  const [selected, setSelected] = useState<DraftJadwalForProduksi | null>(null);
  const [quickJadwal, setQuickJadwal] = useState<DraftJadwalForProduksi | null>(null);
  const [selesaiList, setSelesaiList] = useState<SelesaiMuatJadwalForProduksi[] | null>(null);

  function refreshSelesaiList() {
    fetchSelesaiList().then((result) => {
      if (result.success) setSelesaiList(result.data);
    });
  }

  useEffect(() => {
    refreshSelesaiList();
    // Only ever meant to fire once on mount — fetchSelesaiList is a stable
    // action reference for this component instance's whole lifetime (the
    // Pengiriman and Riwayat tabs each mount their own instance with a
    // different, but never-changing, action prop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDone(jadwalId: number) {
    setJadwalList((prev) => prev.filter((j) => j.JadwalID !== jadwalId));
    setSelected(null);
    refreshSelesaiList();
    onAfterMuat();
  }

  function handleQuickDone(jadwalId: number) {
    setJadwalList((prev) => prev.filter((j) => j.JadwalID !== jadwalId));
    setQuickJadwal(null);
    refreshSelesaiList();
    onAfterMuat();
  }

  if (selected) {
    return (
      <IsiMuatanScreen
        jadwal={selected}
        onBack={() => setSelected(null)}
        onDone={() => handleDone(selected.JadwalID)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {jadwalList.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        jadwalList.map((jadwal) => (
          <div key={jadwal.JadwalID} className="relative rounded-lg border border-border p-3">
            <button type="button" onClick={() => setSelected(jadwal)} className="block w-full pr-24 text-left">
              <p className="font-semibold">{jadwal.ArmadaNama}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(jadwal.JamJadwal).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                {" • "}
                {new Date(jadwal.JamJadwal).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className="mt-1 text-sm">
                Dibutuhkan: {jadwal.Qty10KGDibutuhkan} kantong 10kg, {jadwal.Qty5KGDibutuhkan} kantong 5kg
              </p>
            </button>
            <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  setQuickJadwal(jadwal);
                }}
              >
                Selesai Muat
              </Button>
              {jadwal.JamMulaiMuat != null && (
                <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600">
                  Sedang dimuat
                </span>
              )}
            </div>
          </div>
        ))
      )}
```
to:
```tsx
export function KartuPengirimanList({
  initialJadwal,
  fetchSelesaiList,
  emptyMessage = "Tidak ada Kartu Pengiriman yang perlu diisi muatan saat ini.",
  onAfterMuat,
}: {
  initialJadwal: DraftJadwalForProduksi[];
  fetchSelesaiList: () => Promise<ActionResult<SelesaiMuatJadwalForProduksi[]>>;
  emptyMessage?: string;
  onAfterMuat: () => void;
}) {
  const [jadwalList, setJadwalList] = useState(initialJadwal);
  const [quickJadwal, setQuickJadwal] = useState<DraftJadwalForProduksi | null>(null);
  const [selesaiList, setSelesaiList] = useState<SelesaiMuatJadwalForProduksi[] | null>(null);

  function refreshSelesaiList() {
    fetchSelesaiList().then((result) => {
      if (result.success) setSelesaiList(result.data);
    });
  }

  useEffect(() => {
    refreshSelesaiList();
    // Only ever meant to fire once on mount — fetchSelesaiList is a stable
    // action reference for this component instance's whole lifetime (the
    // Pengiriman and Riwayat tabs each mount their own instance with a
    // different, but never-changing, action prop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleQuickDone(jadwalId: number) {
    setJadwalList((prev) => prev.filter((j) => j.JadwalID !== jadwalId));
    setQuickJadwal(null);
    refreshSelesaiList();
    onAfterMuat();
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {jadwalList.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        jadwalList.map((jadwal) => (
          <div key={jadwal.JadwalID} className="relative rounded-lg border border-border p-3">
            <div className="block w-full pr-24 text-left">
              <p className="font-semibold">{jadwal.ArmadaNama}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(jadwal.JamJadwal).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                {" • "}
                {new Date(jadwal.JamJadwal).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className="mt-1 text-sm">
                Dibutuhkan: {jadwal.Qty10KGDibutuhkan} kantong 10kg, {jadwal.Qty5KGDibutuhkan} kantong 5kg
              </p>
            </div>
            <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setQuickJadwal(jadwal)}
              >
                Selesai Muat
              </Button>
              {jadwal.JamMulaiMuat != null && (
                <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600">
                  Sedang dimuat
                </span>
              )}
            </div>
          </div>
        ))
      )}
```

(the rest of the function body — the `selesaiList` rendering block and `<QuickSelesaiDialog .../>` — is unchanged; only the `handleDone`/`selected` state, the `if (selected) return <IsiMuatanScreen .../>` branch, and the card's outer `<button onClick>` wrapper are removed, per the diff above)

- [ ] **Step 2: Delete `IsiMuatanScreen` and `AlokasiScreen`, and their now-unused imports**

Delete the entire `IsiMuatanScreen` function and the entire `AlokasiScreen` function from the file (everything from `// Step 1/2 gate: a Jadwal already resumed...` through the end of `AlokasiScreen`'s closing `}`).

Change the import block from:
```tsx
import {
  getBatchAktifForAlokasiAction,
  produksiStartMuatAction,
  produksiSelesaiMuatAction,
  produksiSelesaiMuatManualAction,
  getJadwalDetailForProduksiAction,
} from "@/app/mkesindo/produksi/actions";
import type { ActionResult } from "@/lib/action-result";
import type { DraftJadwalForProduksi, SelesaiMuatJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import type { BatchAktifRow } from "@/lib/queries/produksi-warehouse";
import type { JadwalDetailRow } from "@/lib/queries/pengiriman-jadwal";
```
to:
```tsx
import { produksiSelesaiMuatManualAction, getJadwalDetailForProduksiAction } from "@/app/mkesindo/produksi/actions";
import type { ActionResult } from "@/lib/action-result";
import type { DraftJadwalForProduksi, SelesaiMuatJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import type { JadwalDetailRow } from "@/lib/queries/pengiriman-jadwal";
```

(`getJadwalDetailForProduksiAction` and `JadwalDetailRow` stay — `QuickSelesaiDialog` still uses both; `getBatchAktifForAlokasiAction`, `produksiStartMuatAction`, `BatchAktifRow` are removed since only `AlokasiScreen`/`IsiMuatanScreen` used them)

- [ ] **Step 3: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 4: Manual browser verification**

Open the Pengiriman tab in `/mkesindo/produksi-app`. Confirm tapping a card does nothing (no screen opens), "Sedang dimuat" badge still shows when relevant, and the "Selesai Muat" quick button still opens `QuickSelesaiDialog` and completes successfully as before.

- [ ] **Step 5: Commit**

```bash
git add src/components/produksi-app/kartu-pengiriman-list.tsx
git commit -m "refactor: remove the old text-based Mulai Muat flow from the Pengiriman tab"
```

---

### Task 4: End-to-end manual verification

This app has no automated test suite — this task verifies the complete feature by using it, and separately sanity-checks the one piece of genuinely new pure logic (`splitAlokasiFifo`) with concrete examples.

**Files:** none (verification only).

- [ ] **Step 1: Verify `splitAlokasiFifo` with a scratch script**

Create `scripts/scratch-verify-split-alokasi-fifo.ts`:

```ts
import { splitAlokasiFifo } from "../src/components/produksi-app/pallet-ambil-panel";

const batchList = [
  { BatchID: 1, PosisiID: 100, Kode: "U1A", SisaQty10KG: 20, TanggalLabel: new Date("2026-08-25"), JamPanen: "06:00" },
  { BatchID: 2, PosisiID: 100, Kode: "U1A", SisaQty10KG: 15, TanggalLabel: new Date("2026-08-27"), JamPanen: "06:00" },
  { BatchID: 3, PosisiID: 200, Kode: "U2A", SisaQty10KG: 30, TanggalLabel: new Date("2026-08-20"), JamPanen: "06:00" },
];

// Kasus 1: minta lebih dari batch tertua saja (20), harus ambil sisanya dari batch kedua.
const kasus1 = splitAlokasiFifo(100, 25, batchList);
console.log("Kasus 1 (minta 25 dari posisi dgn 2 batch, 20+15):", kasus1);
console.assert(JSON.stringify(kasus1) === JSON.stringify([{ batchId: 1, qty10KG: 20 }, { batchId: 2, qty10KG: 5 }]), "FAIL kasus 1");

// Kasus 2: minta pas sama dengan batch tertua saja.
const kasus2 = splitAlokasiFifo(100, 20, batchList);
console.log("Kasus 2 (minta 20, pas batch tertua):", kasus2);
console.assert(JSON.stringify(kasus2) === JSON.stringify([{ batchId: 1, qty10KG: 20 }]), "FAIL kasus 2");

// Kasus 3: minta lebih dari total yang tersedia di posisi itu (35 > 20+15=35 pas, lalu coba 40 > 35).
const kasus3 = splitAlokasiFifo(100, 40, batchList);
console.log("Kasus 3 (minta 40, tersedia cuma 35):", kasus3);
console.assert(JSON.stringify(kasus3) === JSON.stringify([{ batchId: 1, qty10KG: 20 }, { batchId: 2, qty10KG: 15 }]), "FAIL kasus 3");

// Kasus 4: posisi berbeda tidak ikut terambil.
const kasus4 = splitAlokasiFifo(200, 10, batchList);
console.log("Kasus 4 (posisi lain, tidak ikut posisi 100):", kasus4);
console.assert(JSON.stringify(kasus4) === JSON.stringify([{ batchId: 3, qty10KG: 10 }]), "FAIL kasus 4");

console.log("Selesai — cek di atas apakah ada baris 'Assertion failed' dari console.assert.");
```

Run: `npx tsx scripts/scratch-verify-split-alokasi-fifo.ts`
Expected: 4 result lines, no "Assertion failed" messages from any of the `console.assert` calls.

Then delete the scratch script:
```bash
rm scripts/scratch-verify-split-alokasi-fifo.ts
```

- [ ] **Step 2: Full worked-example browser verification**

With a real (or freshly-scheduled-for-testing) Kartu Pengiriman inside the 2-hour Area Muat window:
1. Tap the dock card, confirm "Mulai Muat", enter picking mode.
2. Tap 2 different filled pallets, allocate quantities via the popover on each, confirm the bottom panel's running total updates correctly after each.
3. Fill in the qty5kg field.
4. Once `cukup`, tap "Selesai Muat", confirm the destination dialog, confirm "Ya".
5. Confirm the dock returns to empty (or shows the next Kartu Pengiriman if one is queued) and the allocated pallets' `SisaQty10KG` decreased by the correct amounts when reopening the Stok Es tab.
6. Confirm the Pengiriman tab's list no longer shows this Kartu Pengiriman as pending (it moved to "Sudah Selesai Muat").

- [ ] **Step 3: Report results**

No commit for this task — it's verification only. If any step fails, return to the relevant earlier task, fix the root cause, and re-run this task's steps from the top.
