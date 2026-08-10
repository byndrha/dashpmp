# Estimasi Durasi Bongkar & Waktu Konfirmasi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the round-up-to-block bongkar-duration formula with linear interpolation over new reference points, add a fixed 3-menit-per-stop driver-app confirmation time to every duration calculation that already uses bongkar time, and show a time breakdown in the Validasi Rute dialog's route summary.

**Architecture:** A pure TS function (`estimateDeliveryMinutes`) and a new sibling constant (`CONFIRMATION_MINUTES_PER_STOP`) in `src/lib/delivery-duration.ts` remain the single source of truth. Three consumers are updated to use both: `route-estimate.ts` (Draft trip estimate), `pengiriman-jadwal.ts` (SQL `StopDuration` CTE mirror + two TS call sites: `estimateBusyMinutes`, `checkArmadaConflict`), and `route-validation-dialog.tsx` (UI). No new tables, no new interfaces, no signature changes to any exported function.

**Tech Stack:** Next.js/TypeScript, MSSQL (raw SQL via `mssql` package), React (existing dialog component). No test framework is configured in this repo (no `jest`/`vitest`, no `*.test.ts` files outside `node_modules`) — verification for pure functions uses a throwaway `tsx` script (deleted before commit), and the rest relies on `tsc --noEmit`, `eslint`, and live browser verification, matching how every prior plan in this codebase has verified its work.

## Global Constraints

- Titik acuan interpolasi (kantong → menit): 0→0, 5→1, 10→3, 15→5, 20→7, 25→10, 30→13, 35→16, 40→20. Di atas 40: flat +5 menit per 5 kantong (slope konstan 1 menit/kantong, garis lurus lanjutan dari (40,20)).
- Untuk qty bukan kelipatan 5: interpolasi linear antara dua titik acuan terdekat.
- Hasil `estimateDeliveryMinutes` dibulatkan ke 1 angka desimal: `Math.round(x * 10) / 10` di TS, `ROUND(x, 1)` di SQL — supaya TS dan SQL selalu identik (pembagi 5 tidak eksak di floating-point biner, tidak seperti pembagi 2 pada formula lama).
- `CONFIRMATION_MINUTES_PER_STOP = 3` adalah konstanta terpisah dari `estimateDeliveryMinutes` (bukan digabung ke dalamnya), dan ikut masuk ke **semua** kalkulasi yang sudah memakai `estimateDeliveryMinutes` per stop: `estimateTripMinutes`, `estimateBusyMinutes`, `checkArmadaConflict`, dan `StopDuration` CTE.
- Baris "~X menit" per stop di `route-validation-dialog.tsx` (baris 121, `SortableStopRow`) **tidak berubah** — tetap murni durasi bongkar, tanpa +3.
- Baris ringkasan rute di `route-validation-dialog.tsx` menampilkan rincian "Tempuh X + Bongkar Y + Konfirmasi Z = Total menit", dibulatkan ke bilangan bulat untuk tampilan (tidak memengaruhi nilai desimal yang dipakai di kalkulasi lain).
- Referensi lengkap: [2026-08-10-estimasi-durasi-bongkar-interpolasi-design.md](../specs/2026-08-10-estimasi-durasi-bongkar-interpolasi-design.md).

---

### Task 1: `delivery-duration.ts` — formula interpolasi + konstanta konfirmasi

**Files:**
- Modify: `src/lib/delivery-duration.ts` (seluruh file, 14 baris → diganti total)

**Interfaces:**
- Produces: `estimateDeliveryMinutes(qtyKantong: number): number` (signature tidak berubah, isi berubah total) dan `export const CONFIRMATION_MINUTES_PER_STOP = 3` (baru) — keduanya dipakai oleh Task 2, 3, 4.

- [ ] **Step 1: Ganti seluruh isi file**

Isi baru `src/lib/delivery-duration.ts`:

```ts
// Estimated on-site delivery duration per stop, based on kantong qty.
// Piecewise-linear interpolation between known reference points, then a
// flat 1-menit/kantong slope beyond 40 (5 menit per 5-kantong block).
// Rounded to 1 decimal to avoid binary-float artifacts from the /5 steps
// (unlike the old /2 steps, 1/5 has no exact binary representation).
export function estimateDeliveryMinutes(qtyKantong: number): number {
  const q = qtyKantong;
  let result: number;
  if (q <= 0) result = 0;
  else if (q <= 5) result = q / 5;
  else if (q <= 10) result = 1 + (2 * (q - 5)) / 5;
  else if (q <= 15) result = 3 + (2 * (q - 10)) / 5;
  else if (q <= 20) result = 5 + (2 * (q - 15)) / 5;
  else if (q <= 25) result = 7 + (3 * (q - 20)) / 5;
  else if (q <= 30) result = 10 + (3 * (q - 25)) / 5;
  else if (q <= 35) result = 13 + (3 * (q - 30)) / 5;
  else if (q <= 40) result = 16 + (4 * (q - 35)) / 5;
  else result = q - 20;
  return Math.round(result * 10) / 10;
}

// Fixed time per stop for the driver to fill delivery-confirmation data in
// driver-app (proof photos, confirm-received/retur) — happens on-site,
// after bongkar, before the truck can move to the next stop. Kept as its
// own constant (not folded into estimateDeliveryMinutes) so the two
// components can still be shown separately and tuned independently.
export const CONFIRMATION_MINUTES_PER_STOP = 3;
```

- [ ] **Step 2: Verifikasi nilai lewat script sementara**

Buat file sementara `verify-tmp.ts` di root repo (JANGAN di-commit, dihapus di Step 3):

```ts
import { estimateDeliveryMinutes, CONFIRMATION_MINUTES_PER_STOP } from "./src/lib/delivery-duration";

const cases: [number, number][] = [
  [0, 0], [5, 1], [10, 3], [15, 5], [20, 7], [25, 10], [30, 13], [35, 16], [40, 20],
  [45, 25], [60, 40],
  [3, 0.6], [7, 1.8], [23, 8.8], [38, 18.4],
  [-5, 0],
];

let failed = false;
for (const [qty, expected] of cases) {
  const actual = estimateDeliveryMinutes(qty);
  const ok = Math.abs(actual - expected) < 1e-9;
  console.log(`${ok ? "OK" : "FAIL"} estimateDeliveryMinutes(${qty}) = ${actual} (expected ${expected})`);
  if (!ok) failed = true;
}
console.log(`CONFIRMATION_MINUTES_PER_STOP = ${CONFIRMATION_MINUTES_PER_STOP} (expected 3)`);
if (CONFIRMATION_MINUTES_PER_STOP !== 3) failed = true;
if (failed) process.exit(1);
```

Run: `npx tsx verify-tmp.ts`
Expected: setiap baris `OK`, exit code 0.

- [ ] **Step 3: Hapus script sementara**

```bash
rm verify-tmp.ts
```

(Di PowerShell: `Remove-Item verify-tmp.ts`)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: tidak ada error baru dari `delivery-duration.ts` (proyek mungkin sudah punya error pre-existing di file lain — pastikan tidak ada error baru yang disebabkan perubahan ini).

- [ ] **Step 5: Commit**

```bash
git add src/lib/delivery-duration.ts
git commit -m "feat: linear-interpolation bongkar formula + confirmation-time constant"
```

---

### Task 2: `route-estimate.ts` — pakai CONFIRMATION_MINUTES_PER_STOP

**Files:**
- Modify: `src/lib/route-estimate.ts:1` (import), `src/lib/route-estimate.ts:47-48` (`estimateTripMinutes`)

**Interfaces:**
- Consumes: `estimateDeliveryMinutes`, `CONFIRMATION_MINUTES_PER_STOP` dari Task 1.
- Produces: `estimateTripMinutes` signature tidak berubah, nilai kembalian ikut naik 3 menit × jumlah stop.

- [ ] **Step 1: Update import**

Ganti baris 1:
```ts
import { estimateDeliveryMinutes } from "@/lib/delivery-duration";
```
menjadi:
```ts
import { estimateDeliveryMinutes, CONFIRMATION_MINUTES_PER_STOP } from "@/lib/delivery-duration";
```

- [ ] **Step 2: Update `estimateTripMinutes`**

Ganti baris 47-48 (isi function `estimateTripMinutes`, baris `const bongkarMinutes = ...`):

```ts
export function estimateTripMinutes(pabrik: LatLng, orderedStops: (LatLng & { qty: number })[]): number {
  const bongkarMinutes = orderedStops.reduce(
    (sum, s) => sum + estimateDeliveryMinutes(s.qty) + CONFIRMATION_MINUTES_PER_STOP,
    0
  );
  const travelMinutes = estimateTravelMinutes(
    pabrik,
    orderedStops.map((s) => ({ lat: s.lat, lng: s.lng }))
  );
  return bongkarMinutes + travelMinutes;
}
```

Baris komentar di atas function (baris 43-46, "Full estimated busy duration...") tetap relevan — cukup tambahkan satu klausa singkat mengenai konfirmasi:

```ts
// Full estimated busy duration for a trip — on-site bongkar time at every
// stop (estimateDeliveryMinutes) plus a fixed CONFIRMATION_MINUTES_PER_STOP
// per stop for driver-app confirmation data entry, plus the travel estimate
// above. `qty` null skips that stop's bongkar contribution (treated as 0),
// matching estimateDeliveryMinutes(0) — confirmation time still applies.
```

- [ ] **Step 3: Verifikasi lewat script sementara**

Buat `verify-tmp.ts` di root repo:

```ts
import { estimateTripMinutes } from "./src/lib/route-estimate";

const pabrik = { lat: 0, lng: 0 };
// 2 stops, both at pabrik's location (distance 0) so travel time is
// isolated to 0 and only the bongkar+confirmation math is exercised.
const stops = [
  { lat: 0, lng: 0, qty: 5 },   // estimateDeliveryMinutes(5) = 1
  { lat: 0, lng: 0, qty: 10 },  // estimateDeliveryMinutes(10) = 3
];
const result = estimateTripMinutes(pabrik, stops);
const expected = 1 + 3 + 3 * 2; // bongkar (1+3) + confirmation (3 per stop * 2 stops)
console.log(`estimateTripMinutes = ${result} (expected ${expected})`);
if (Math.abs(result - expected) > 1e-9) process.exit(1);
console.log("OK");
```

Run: `npx tsx verify-tmp.ts`
Expected: `estimateTripMinutes = 10 (expected 10)` lalu `OK`, exit code 0.

- [ ] **Step 4: Hapus script sementara**

```bash
rm verify-tmp.ts
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: tidak ada error baru.

- [ ] **Step 6: Commit**

```bash
git add src/lib/route-estimate.ts
git commit -m "feat: fold confirmation time into Draft trip duration estimate"
```

---

### Task 3: `pengiriman-jadwal.ts` — SQL CTE + estimateBusyMinutes + checkArmadaConflict

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts:6` (import), `:111-139` (SQL comment + `StopDuration` CTE), `:712` (`estimateBusyMinutes`), `:829` (`checkArmadaConflict`)

**Interfaces:**
- Consumes: `estimateDeliveryMinutes`, `CONFIRMATION_MINUTES_PER_STOP` dari Task 1.
- Produces: `getPengirimanBoard`, `estimateBusyMinutes`, `checkArmadaConflict` — signature tidak berubah untuk ketiganya, nilai durasi yang dikembalikan berubah.

- [ ] **Step 1: Update import (baris 6)**

Ganti:
```ts
import { estimateDeliveryMinutes } from "@/lib/delivery-duration";
```
menjadi:
```ts
import { estimateDeliveryMinutes, CONFIRMATION_MINUTES_PER_STOP } from "@/lib/delivery-duration";
```

- [ ] **Step 2: Update komentar SQL + `StopDuration` CTE (baris ~111-139)**

Ganti seluruh blok berikut (komentar SQL sampai penutup `StopDuration`):

```sql
        -- StopDuration estimates each stop's on-site delivery time from its
        -- own kantong qty — mirrors estimateDeliveryMinutes in
        -- delivery-duration.ts exactly (qty<=5: 5 min; 5<qty<=40: 5 + 2.5
        -- min per 5-kantong block past the first; qty>40: 22.5 min, the
        -- value at exactly 40, + 10 min per 5-kantong block past 40) — and
        -- sums it per JadwalID, so a Jadwal's timeline card width reflects
        -- the total time its stops need. Needs its own per-stop
        -- (JadwalDetailID) grouping first — applying the formula to the
        -- Jadwal's already-combined TotalKantong instead would treat e.g.
        -- two 3-kantong stops as one 6-kantong block.
        WITH StopQty AS (
            SELECT jd.JadwalID, jd.JadwalDetailID,
                   ISNULL(SUM(CASE WHEN sod.Name LIKE '%5 KG%' THEN sod.Qty / 2.0 ELSE sod.Qty END), 0) AS Qty
            FROM DashboardPengirimanJadwalDetail jd
            LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
            WHERE jd.IsDeleted = 0
            GROUP BY jd.JadwalID, jd.JadwalDetailID
        ),
        StopDuration AS (
            SELECT JadwalID,
                   SUM(CASE
                     WHEN Qty <= 0 THEN 0
                     WHEN Qty <= 5 THEN 5
                     WHEN Qty <= 40 THEN 5 + 2.5 * CEILING((Qty - 5) / 5.0)
                     ELSE 22.5 + 10 * CEILING((Qty - 40) / 5.0)
                   END) AS EstimasiDurasiMenit
            FROM StopQty
            GROUP BY JadwalID
        )
```

menjadi:

```sql
        -- StopDuration estimates each stop's on-site time (bongkar +
        -- driver-app confirmation) from its own kantong qty, then sums it
        -- per JadwalID so a Jadwal's timeline card width reflects the total
        -- time its stops need. The CASE mirrors estimateDeliveryMinutes in
        -- delivery-duration.ts exactly: piecewise-linear interpolation
        -- between reference points 0->0, 5->1, 10->3, 15->5, 20->7, 25->10,
        -- 30->13, 35->16, 40->20 (menit), then a flat 1-menit/kantong slope
        -- past 40. The "+ 3" mirrors CONFIRMATION_MINUTES_PER_STOP (same
        -- file) — fixed per-stop time for driver-app confirmation data
        -- entry, added outside the interpolation. ROUND(...,1) matches the
        -- TS side's rounding to avoid binary-float drift from the /5 steps.
        -- Needs its own per-stop (JadwalDetailID) grouping first — applying
        -- the formula to the Jadwal's already-combined TotalKantong instead
        -- would treat e.g. two 3-kantong stops as one 6-kantong block.
        WITH StopQty AS (
            SELECT jd.JadwalID, jd.JadwalDetailID,
                   ISNULL(SUM(CASE WHEN sod.Name LIKE '%5 KG%' THEN sod.Qty / 2.0 ELSE sod.Qty END), 0) AS Qty
            FROM DashboardPengirimanJadwalDetail jd
            LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
            WHERE jd.IsDeleted = 0
            GROUP BY jd.JadwalID, jd.JadwalDetailID
        ),
        StopDuration AS (
            SELECT JadwalID,
                   SUM(ROUND(CASE
                     WHEN Qty <= 0 THEN 0
                     WHEN Qty <= 5 THEN Qty / 5.0
                     WHEN Qty <= 10 THEN 1 + 2 * (Qty - 5) / 5.0
                     WHEN Qty <= 15 THEN 3 + 2 * (Qty - 10) / 5.0
                     WHEN Qty <= 20 THEN 5 + 2 * (Qty - 15) / 5.0
                     WHEN Qty <= 25 THEN 7 + 3 * (Qty - 20) / 5.0
                     WHEN Qty <= 30 THEN 10 + 3 * (Qty - 25) / 5.0
                     WHEN Qty <= 35 THEN 13 + 3 * (Qty - 30) / 5.0
                     WHEN Qty <= 40 THEN 16 + 4 * (Qty - 35) / 5.0
                     ELSE Qty - 20
                   END, 1) + 3) AS EstimasiDurasiMenit
            FROM StopQty
            GROUP BY JadwalID
        )
```

(Catatan untuk implementer: baris `SELECT j.JadwalID, ...` dan sisanya SESUDAH `StopDuration` yang menutup di baris 139 pada berkas asli TIDAK disentuh — hanya isi CTE dan komentar di atasnya yang diganti.)

- [ ] **Step 3: Update `estimateBusyMinutes` (baris 712)**

Ganti:
```ts
    bongkarMinutes += estimateDeliveryMinutes(loc?.qty ?? 0);
```
menjadi:
```ts
    bongkarMinutes += estimateDeliveryMinutes(loc?.qty ?? 0) + CONFIRMATION_MINUTES_PER_STOP;
```

- [ ] **Step 4: Update `checkArmadaConflict` (baris 829)**

Ganti:
```ts
  const candidateEnd = new Date(candidateStart.getTime() + estimateDeliveryMinutes(candidateQty) * 60 * 1000);
```
menjadi:
```ts
  const candidateEnd = new Date(
    candidateStart.getTime() + (estimateDeliveryMinutes(candidateQty) + CONFIRMATION_MINUTES_PER_STOP) * 60 * 1000
  );
```

Komentar di atas function (baris 812-819, dimulai "candidateEnd is a deliberate approximation") tetap valid apa adanya — tidak perlu diubah, karena masih menjelaskan alasan tidak memakai `estimateBusyMinutes` penuh (bukan tentang formula bongkar itu sendiri).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: tidak ada error baru.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts
git commit -m "feat: interpolated bongkar formula + confirmation time in board SQL and conflict checks"
```

---

### Task 4: `route-validation-dialog.tsx` — rincian total waktu di ringkasan rute

**Files:**
- Modify: `src/components/dashboard/route-validation-dialog.tsx:30` (import), `:762` area (tambah 2 derived values, pola sama seperti `totalFuelLiters`/`totalFuelCost` di baris 762-780), `:1235-1238` (JSX ringkasan rute)

**Interfaces:**
- Consumes: `estimateDeliveryMinutes`, `CONFIRMATION_MINUTES_PER_STOP` dari Task 1; state lokal `order: JadwalDetailRow[]` (baris 215) dan `route: MultiPointRoute | null` (baris 227) yang sudah ada di komponen ini.

- [ ] **Step 1: Update import (baris 30)**

Ganti:
```ts
import { estimateDeliveryMinutes } from "@/lib/delivery-duration";
```
menjadi:
```ts
import { estimateDeliveryMinutes, CONFIRMATION_MINUTES_PER_STOP } from "@/lib/delivery-duration";
```

- [ ] **Step 2: Tambah derived values (setelah `extraFuelCost` useMemo, baris 775-780)**

Cari blok ini (sudah ada, JANGAN diubah, hanya jadi penanda lokasi tempat menyisipkan kode baru setelahnya):
```ts
  const extraFuelCost = useMemo(() => {
    if (route == null || konsumsiBBM == null || biayaBBMPerLiter == null) return null;
    const segments = Math.floor(route.distanceKm / 5);
    const costPer5Km = 5 * konsumsiBBM * biayaBBMPerLiter;
    return Math.round(segments * costPer5Km);
  }, [route, konsumsiBBM, biayaBBMPerLiter]);
```

Tepat setelah blok itu (sebelum baris kosong yang mengikutinya), tambahkan:

```ts
  // Aggregate bongkar time across every stop in the current order — the
  // per-stop "~X menit" label (SortableStopRow) shows this same function's
  // result for one stop; this is the sum across all of them, feeding the
  // route summary's time breakdown below.
  const bongkarTotalMenit = useMemo(() => {
    return order.reduce((sum, o) => sum + estimateDeliveryMinutes(o.Qty), 0);
  }, [order]);
  const konfirmasiTotalMenit = order.length * CONFIRMATION_MINUTES_PER_STOP;
```

- [ ] **Step 3: Update JSX ringkasan rute (baris 1235-1238)**

Ganti:
```tsx
                <span className="flex items-center gap-1">
                  <Clock className="size-3.5 text-muted-foreground" />
                  {route.durationMinutes} menit
                </span>
```
menjadi:
```tsx
                <span className="flex items-center gap-1">
                  <Clock className="size-3.5 text-muted-foreground" />
                  Tempuh {route.durationMinutes} + Bongkar {Math.round(bongkarTotalMenit)} + Konfirmasi{" "}
                  {konfirmasiTotalMenit} = {Math.round(route.durationMinutes + bongkarTotalMenit + konfirmasiTotalMenit)}{" "}
                  menit
                </span>
```

(Blok ini berada di dalam `{route && ( ... )}` yang sudah ada di baris 1229 — `route.durationMinutes` di sini sudah type-safe non-null tanpa perlu pengecekan tambahan, persis seperti pemakaian `route.distanceKm` tepat di atasnya.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: tidak ada error baru.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: tidak ada error/warning baru dari file yang diubah.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/route-validation-dialog.tsx
git commit -m "feat: show Tempuh + Bongkar + Konfirmasi breakdown in Validasi Rute summary"
```

---

### Task 5: Full verification pass

**Files:** Tidak ada file diubah — hanya verifikasi.

- [ ] **Step 1: Typecheck seluruh proyek**

Run: `npx tsc --noEmit`
Expected: bersih (atau sama persis dengan baseline sebelum Task 1, tidak ada error baru).

- [ ] **Step 2: Lint seluruh proyek**

Run: `npm run lint`
Expected: bersih (atau sama persis dengan baseline).

- [ ] **Step 3: Live browser verification — Papan Pengiriman**

1. Jalankan dev server (`preview_start` dengan config `next dev` yang sudah ada di `.claude/launch.json`, atau jika belum ada, tambahkan konfigurasi standar Next.js).
2. Login sebagai akun yang punya akses ke `/mkesindo/delivery` (Papan Pengiriman).
3. Cari sebuah Jadwal Draft dengan beberapa stop kantong kecil (mis. 5-10 kantong) — bandingkan lebar kartunya secara kasar sebelum/sesudah (seharusnya lebih sempit dari sebelumnya untuk qty kecil, karena formula baru menghasilkan durasi lebih pendek untuk qty di bawah ~40, ditambah 3 menit/stop).
4. Buka dialog Validasi Rute pada Jadwal tersebut, pastikan tidak ada error di console.

- [ ] **Step 4: Live browser verification — Validasi Rute dialog**

1. Di dialog Validasi Rute yang sama, periksa label "~X menit" di setiap baris stop — catat angkanya untuk 2-3 stop dengan qty berbeda.
2. Hitung manual `estimateDeliveryMinutes(qty)` untuk qty yang sama (lihat tabel titik acuan di spec), pastikan cocok dengan yang tampil.
3. Setelah rute berhasil dihitung (baris ringkasan muncul dengan ikon jam), pastikan formatnya "Tempuh X + Bongkar Y + Konfirmasi Z = Total menit" dan `Y` (Bongkar) mendekati jumlah semua label "~X menit" per stop yang dicatat di langkah 1 (dibulatkan), `Z` (Konfirmasi) = 3 × jumlah stop, dan `Total` = `X + Y + Z` (dibulatkan).
4. `read_console_messages` — pastikan tidak ada error baru terkait perubahan ini.

- [ ] **Step 5: Commit (jika ada perubahan residual dari perbaikan verifikasi)**

Jika Step 1-4 memicu perbaikan kecil, commit terpisah dengan pesan yang menjelaskan perbaikannya. Jika semua sudah bersih dari Task 1-4, tidak perlu commit tambahan di sini.
