# Modul Penjualan & Piutang — Jenis Bisnis Es Balok Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build read-only Penjualan (sales) and Piutang (receivables) reporting pages for pmputra and pmpersada — the two "Es Balok" PTs — replacing their current placeholder pages, mirroring the existing Keuangan module's UX.

**Architecture:** One shared query module (`src/lib/queries/penjualan-piutang.ts`) parameterized by `kode` (`"pmputra"` | `"pmpersada"`), since `PMP_Pemesanan`/`ChartOfAccount` schema is identical across both PTs — unlike Keuangan's P&L, which needed per-PT files because account classifications differ. Two new shared UI panel components render the data; four thin page files (one per PT × module) wire guard + fetch + render, matching `keuangan/page.tsx`'s existing pattern exactly.

**Tech Stack:** Next.js 16 (App Router, Server Components only — no Server Actions needed, this module has zero mutations), MSSQL (`mssql`) via `getCompanyPool(kode, label)` for each PT's two live ERP databases.

**Spec:** `docs/superpowers/specs/2026-08-18-penjualan-piutang-es-balok-design.md`

## Global Constraints

- All Indonesian-language user-facing strings — no English UI text.
- No test runner exists in this project. Every task's verification is `npx tsc --noEmit` (zero errors) + `npx eslint <changed files>`; the final task additionally live-checks in the browser and cross-checks numbers against direct DB queries.
- Everything happens directly on the `main` branch. No worktree.
- **Fully read-only**: no Server Actions, no INSERT/UPDATE/DELETE anywhere in this plan, no form inputs. Every query is a plain `SELECT`.
- **Never use `PMP_Pemesanan`'s price columns** (`JumlahTotal`, `BalokKecilHarga`, `BalokBesarHarga`, `BalokKecilTotal`, `BalokBesarTotal`) for any Rupiah figure — confirmed via live cross-check (pmputra/utama April 2026: GL Pendapatan Rp 572.883.900 vs `SUM(JumlahTotal)` Rp 16.721.000 vs `SUM(Realisasi×Harga)` Rp 317.417.804 — none reconcile). Only `BalokKecilRealisasi`/`BalokBesarRealisasi` (physical kantong counts) from this table are reliable — already proven by the existing HPP Bersih feature.
- Kantong queries against `PMP_Pemesanan` always filter `Status = '3' AND ISNULL(IsVoid,0) = 0 AND ISNULL(IsDeleted,0) = 0` — same filter the existing `getMonthlyBalokRealisasi` (`hpp-bersih-pmputra.ts`) already uses.
- All Rupiah figures (Pendapatan, Piutang) come from `GeneralLedger`/`ChartOfAccount`, the same source the Keuangan module already trusts — never from `PMP_Pemesanan` or `PMP_Agen`.
- `PMP_Agen.PiutangSaatIni`/`TabunganSaatIni` are dead columns (confirmed: 0 across all 774 Agen rows in all 4 databases) — never read them for anything.
- **`PIUTANG_ACCOUNTS` account numbers are a working assumption**, not explicitly user-confirmed (picked as the largest-balance "Piutang..." account per PT+label during live exploration — see spec's Arsitektur section for the exact candidates and balances found). Task 7's live verification must re-surface these numbers and their live balances to the user for confirmation; treat this as the single most likely-to-be-wrong part of this plan.
- Reuse `getCompanyPool(kode, label)` (`src/lib/db-company.ts`) for every ERP database connection — never open a new connection mechanism.
- `months` arrays throughout are a **rolling 12-month window ending at the current month** (computed from `new Date()` at request time), not a fixed calendar year — do not reuse `HPPBersihPanel`'s year-navigation pattern, this module has no navigation UI at all.

---

## Task 1: `penjualan-piutang.ts` — Penjualan query functions

**Files:**
- Create: `src/lib/queries/penjualan-piutang.ts`

**Interfaces:**
- Consumes: `getCompanyPool(kode, label)` / `CompanyKoneksiLabel` from `@/lib/db-company` (unchanged, already used by every `-pmputra.ts`/`-pmpersada.ts` query file).
- Produces: `PenjualanTrendMonth`, `PenjualanTrendData` types; `getPenjualanTrend(kode: string): Promise<PenjualanTrendData>`; module-private `monthsWindow()` helper — Task 2 (same file) reuses `monthsWindow()`, Task 5 imports `getPenjualanTrend` + `PenjualanTrendData`.

- [ ] **Step 1: Create the file with the Penjualan half**

```ts
// src/lib/queries/penjualan-piutang.ts
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";

const MONTHS_BACK = 12;

// Rolling 12-month window ending at the current month (not a fixed
// calendar year, and not navigable -- this module has no year-picker UI,
// unlike HPPBersihPanel). `keys` gives the "yyyy-MM" key for every month in
// the window in order, so callers can build a dense array even for months
// with zero matching rows.
function monthsWindow(): { start: Date; end: Date; keys: string[] } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS_BACK - 1), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const keys: string[] = [];
  for (let i = 0; i < MONTHS_BACK; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return { start, end, keys };
}

export interface PenjualanTrendMonth {
  month: string; // "2026-01"
  kantongKecil: number;
  kantongBesar: number;
  kantongTotal: number;
  pendapatanRp: number; // GL, utama + logistik combined
}

export interface PenjualanTrendData {
  months: PenjualanTrendMonth[];
  totalKantong12Bulan: number;
  totalPendapatan12Bulan: number;
}

// Physical kantong counts from PMP_Pemesanan -- same table/filter as the
// existing getMonthlyBalokRealisasi (hpp-bersih-pmputra.ts), already proven
// reliable. Never read this table's price/Rupiah columns (see plan Global
// Constraints).
async function getKantongByMonth(
  kode: string,
  label: CompanyKoneksiLabel,
  start: Date,
  end: Date
): Promise<Map<string, { kecil: number; besar: number }>> {
  const pool = await getCompanyPool(kode, label);
  const result = await pool
    .request()
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end)
    .query(`
      SELECT CONVERT(varchar(7), Tanggal, 120) AS Bulan,
             SUM(ISNULL(BalokKecilRealisasi,0)) AS Kecil,
             SUM(ISNULL(BalokBesarRealisasi,0)) AS Besar
      FROM PMP_Pemesanan
      WHERE Status = '3' AND ISNULL(IsVoid,0) = 0 AND ISNULL(IsDeleted,0) = 0
        AND Tanggal >= @start AND Tanggal < @end
      GROUP BY CONVERT(varchar(7), Tanggal, 120)
    `);
  const map = new Map<string, { kecil: number; besar: number }>();
  for (const r of result.recordset as { Bulan: string; Kecil: number; Besar: number }[]) {
    map.set(r.Bulan, { kecil: r.Kecil, besar: r.Besar });
  }
  return map;
}

// Pendapatan (revenue, prefix-4 accounts) from GeneralLedger -- same source
// and Credit-Debit sign convention pnl.ts/pnl-pmputra.ts already use for
// this exact category (revenue accounts are credit-normal).
async function getPendapatanByMonth(
  kode: string,
  label: CompanyKoneksiLabel,
  start: Date,
  end: Date
): Promise<Map<string, number>> {
  const pool = await getCompanyPool(kode, label);
  const result = await pool
    .request()
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end)
    .query(`
      SELECT CONVERT(varchar(7), gl.TransDate, 120) AS Bulan,
             SUM(gl.Credit - gl.Debit) AS Pendapatan
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE LEFT(coa.AccountNo, 1) = '4'
        AND gl.TransDate >= @start AND gl.TransDate < @end
      GROUP BY CONVERT(varchar(7), gl.TransDate, 120)
    `);
  const map = new Map<string, number>();
  for (const r of result.recordset as { Bulan: string; Pendapatan: number }[]) {
    map.set(r.Bulan, r.Pendapatan);
  }
  return map;
}

export async function getPenjualanTrend(kode: string): Promise<PenjualanTrendData> {
  const { start, end, keys } = monthsWindow();

  const [kantongUtama, kantongLogistik, pendapatanUtama, pendapatanLogistik] = await Promise.all([
    getKantongByMonth(kode, "utama", start, end),
    getKantongByMonth(kode, "logistik", start, end),
    getPendapatanByMonth(kode, "utama", start, end),
    getPendapatanByMonth(kode, "logistik", start, end),
  ]);

  const months: PenjualanTrendMonth[] = keys.map((key) => {
    const kU = kantongUtama.get(key) ?? { kecil: 0, besar: 0 };
    const kL = kantongLogistik.get(key) ?? { kecil: 0, besar: 0 };
    const kantongKecil = kU.kecil + kL.kecil;
    const kantongBesar = kU.besar + kL.besar;
    const pendapatanRp = (pendapatanUtama.get(key) ?? 0) + (pendapatanLogistik.get(key) ?? 0);
    return { month: key, kantongKecil, kantongBesar, kantongTotal: kantongKecil + kantongBesar, pendapatanRp };
  });

  return {
    months,
    totalKantong12Bulan: months.reduce((sum, m) => sum + m.kantongTotal, 0),
    totalPendapatan12Bulan: months.reduce((sum, m) => sum + m.pendapatanRp, 0),
  };
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors (this task's own additions type-check; other files may still show errors from tasks not yet done — none should, since this is the first task).

Run: `npx eslint src/lib/queries/penjualan-piutang.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/penjualan-piutang.ts
git commit -m "feat: add getPenjualanTrend query for Es Balok Penjualan module"
```

---

## Task 2: `penjualan-piutang.ts` — Piutang query functions

**Files:**
- Modify: `src/lib/queries/penjualan-piutang.ts` (append to the file Task 1 created)

**Interfaces:**
- Consumes: `monthsWindow()`, `getCompanyPool`/`CompanyKoneksiLabel` (Task 1, same file).
- Produces: `PiutangTrendMonth`, `PiutangSummaryData` types; `getPiutangSummary(kode: string): Promise<PiutangSummaryData>` — consumed by Task 6.

- [ ] **Step 1: Append the Piutang half to the same file**

Add to the end of `src/lib/queries/penjualan-piutang.ts`:

```ts
export interface PiutangTrendMonth {
  month: string;
  piutangBaru: number; // GL Debit on the Piutang account this month
  piutangTertagih: number; // GL Credit on the Piutang account this month
  netMovement: number; // piutangBaru - piutangTertagih
}

export interface PiutangSummaryData {
  totalPiutangSaatIni: number; // GL balance as of today, utama + logistik
  totalPiutangUtama: number;
  totalPiutangLogistik: number;
  months: PiutangTrendMonth[];
}

// Working assumption from live-DB exploration (largest-balance "Piutang..."
// account per kode+label) -- NOT explicitly user-confirmed. See plan Global
// Constraints: Task 7 must re-surface these for confirmation.
const PIUTANG_ACCOUNTS: { kode: string; label: CompanyKoneksiLabel; accountNo: string }[] = [
  { kode: "pmputra", label: "utama", accountNo: "1115" }, // "Piutang Agen"
  { kode: "pmputra", label: "logistik", accountNo: "1111" }, // "Piutang Jasa Usaha"
  { kode: "pmpersada", label: "utama", accountNo: "1115" }, // "Piutang Agen"
  { kode: "pmpersada", label: "logistik", accountNo: "1111" }, // "Piutang Reguler"
];

function getPiutangAccountNo(kode: string, label: CompanyKoneksiLabel): string {
  const entry = PIUTANG_ACCOUNTS.find((a) => a.kode === kode && a.label === label);
  if (!entry) throw new Error(`No Piutang account configured for kode="${kode}" label="${label}"`);
  return entry.accountNo;
}

// Current balance (Debit-normal asset account) -- no date filter, matches
// balance-sheet-pmputra.ts's own "as of today" pattern for AsetLancar.
async function getPiutangBalance(kode: string, label: CompanyKoneksiLabel): Promise<number> {
  const pool = await getCompanyPool(kode, label);
  const accountNo = getPiutangAccountNo(kode, label);
  const result = await pool.request().input("accountNo", sql.VarChar(16), accountNo).query(`
    SELECT ISNULL(SUM(gl.Debit),0) AS TotalDebit, ISNULL(SUM(gl.Credit),0) AS TotalCredit
    FROM GeneralLedger gl
    JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE coa.AccountNo = @accountNo
  `);
  const r = result.recordset[0] as { TotalDebit: number; TotalCredit: number };
  return r.TotalDebit - r.TotalCredit;
}

async function getPiutangMovementByMonth(
  kode: string,
  label: CompanyKoneksiLabel,
  start: Date,
  end: Date
): Promise<Map<string, { baru: number; tertagih: number }>> {
  const pool = await getCompanyPool(kode, label);
  const accountNo = getPiutangAccountNo(kode, label);
  const result = await pool
    .request()
    .input("accountNo", sql.VarChar(16), accountNo)
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end)
    .query(`
      SELECT CONVERT(varchar(7), gl.TransDate, 120) AS Bulan,
             SUM(gl.Debit) AS Baru, SUM(gl.Credit) AS Tertagih
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE coa.AccountNo = @accountNo
        AND gl.TransDate >= @start AND gl.TransDate < @end
      GROUP BY CONVERT(varchar(7), gl.TransDate, 120)
    `);
  const map = new Map<string, { baru: number; tertagih: number }>();
  for (const r of result.recordset as { Bulan: string; Baru: number; Tertagih: number }[]) {
    map.set(r.Bulan, { baru: r.Baru, tertagih: r.Tertagih });
  }
  return map;
}

export async function getPiutangSummary(kode: string): Promise<PiutangSummaryData> {
  const { start, end, keys } = monthsWindow();

  const [totalPiutangUtama, totalPiutangLogistik, movementUtama, movementLogistik] = await Promise.all([
    getPiutangBalance(kode, "utama"),
    getPiutangBalance(kode, "logistik"),
    getPiutangMovementByMonth(kode, "utama", start, end),
    getPiutangMovementByMonth(kode, "logistik", start, end),
  ]);

  const months: PiutangTrendMonth[] = keys.map((key) => {
    const mU = movementUtama.get(key) ?? { baru: 0, tertagih: 0 };
    const mL = movementLogistik.get(key) ?? { baru: 0, tertagih: 0 };
    const piutangBaru = mU.baru + mL.baru;
    const piutangTertagih = mU.tertagih + mL.tertagih;
    return { month: key, piutangBaru, piutangTertagih, netMovement: piutangBaru - piutangTertagih };
  });

  return {
    totalPiutangSaatIni: totalPiutangUtama + totalPiutangLogistik,
    totalPiutangUtama,
    totalPiutangLogistik,
    months,
  };
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/queries/penjualan-piutang.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/penjualan-piutang.ts
git commit -m "feat: add getPiutangSummary query for Es Balok Piutang module"
```

---

## Task 3: `PenjualanTrendPanel` component

**Files:**
- Create: `src/components/dashboard/penjualan-trend-panel.tsx`

**Interfaces:**
- Consumes: `PenjualanTrendData` (Task 1, `@/lib/queries/penjualan-piutang`); `KpiCard` (`@/components/dashboard/kpi-card`, unchanged); `Table`/`TableBody`/`TableCell`/`TableHead`/`TableHeader`/`TableRow` (`@/components/ui/table`, unchanged); `Card`/`CardContent`/`CardHeader`/`CardTitle` (`@/components/ui/card`, unchanged); `formatRupiah` (`@/lib/format`, unchanged).
- Produces: `PenjualanTrendPanel({ data }: { data: PenjualanTrendData })` component — consumed by Task 5.

- [ ] **Step 1: Create the component**

```tsx
// src/components/dashboard/penjualan-trend-panel.tsx
import { ShoppingCart, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { formatRupiah } from "@/lib/format";
import type { PenjualanTrendData } from "@/lib/queries/penjualan-piutang";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  return `${MONTH_LABELS[Number(month) - 1]} ${year}`;
}

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

export function PenjualanTrendPanel({ data }: { data: PenjualanTrendData }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiCard
          label="Total Kantong (12 Bulan Terakhir)"
          value={formatQty(data.totalKantong12Bulan)}
          icon={ShoppingCart}
        />
        <KpiCard
          label="Total Pendapatan (12 Bulan Terakhir)"
          value={formatRupiah(data.totalPendapatan12Bulan)}
          icon={Wallet}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tren Penjualan Bulanan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bulan</TableHead>
                  <TableHead className="text-right">Kantong Kecil</TableHead>
                  <TableHead className="text-right">Kantong Besar</TableHead>
                  <TableHead className="text-right">Total Kantong</TableHead>
                  <TableHead className="text-right">Pendapatan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.months.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell>{formatMonthLabel(m.month)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(m.kantongKecil)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(m.kantongBesar)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatQty(m.kantongTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(m.pendapatanRp)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/components/dashboard/penjualan-trend-panel.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/penjualan-trend-panel.tsx
git commit -m "feat: add PenjualanTrendPanel component"
```

---

## Task 4: `PiutangSummaryPanel` component

**Files:**
- Create: `src/components/dashboard/piutang-summary-panel.tsx`

**Interfaces:**
- Consumes: `PiutangSummaryData` (Task 2, `@/lib/queries/penjualan-piutang`); same shared UI primitives as Task 3.
- Produces: `PiutangSummaryPanel({ data }: { data: PiutangSummaryData })` component — consumed by Task 6.

- [ ] **Step 1: Create the component**

```tsx
// src/components/dashboard/piutang-summary-panel.tsx
import { Landmark, Warehouse, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { formatRupiah } from "@/lib/format";
import type { PiutangSummaryData } from "@/lib/queries/penjualan-piutang";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  return `${MONTH_LABELS[Number(month) - 1]} ${year}`;
}

export function PiutangSummaryPanel({ data }: { data: PiutangSummaryData }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Total Piutang Saat Ini" value={formatRupiah(data.totalPiutangSaatIni)} icon={Landmark} />
        <KpiCard label="Piutang — Utama" value={formatRupiah(data.totalPiutangUtama)} icon={Warehouse} />
        <KpiCard label="Piutang — Logistik" value={formatRupiah(data.totalPiutangLogistik)} icon={Truck} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tren Pergerakan Piutang Bulanan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bulan</TableHead>
                  <TableHead className="text-right">Piutang Baru</TableHead>
                  <TableHead className="text-right">Tertagih</TableHead>
                  <TableHead className="text-right">Pergerakan Bersih</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.months.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell>{formatMonthLabel(m.month)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(m.piutangBaru)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(m.piutangTertagih)}</TableCell>
                    <TableCell
                      className={`text-right font-medium tabular-nums ${
                        m.netMovement >= 0 ? "text-destructive" : "text-primary"
                      }`}
                    >
                      {formatRupiah(m.netMovement)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/components/dashboard/piutang-summary-panel.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/piutang-summary-panel.tsx
git commit -m "feat: add PiutangSummaryPanel component"
```

---

## Task 5: Wire Penjualan pages (pmputra + pmpersada)

**Files:**
- Create: `src/app/pmputra/penjualan/page.tsx`
- Create: `src/app/pmpersada/(dashboard)/penjualan/page.tsx`

**Interfaces:**
- Consumes: `getPenjualanTrend` (Task 1), `PenjualanTrendPanel` (Task 3), `requirePmputra`/`requirePmpersada` (`@/lib/require-access`, unchanged).
- Produces: nothing consumed by later tasks — these are leaf pages.

Both files replace the `[modul]/page.tsx` placeholder for the `penjualan` slug: Next.js's static-segment routing serves a matching static route (`penjualan/page.tsx`) over the dynamic `[modul]/page.tsx` catch-all, so no sidebar or routing config change is needed — `PMPUTRA_MODULES`/`PMPERSADA_MODULES` already link to `/pmputra/penjualan` and `/pmpersada/penjualan`.

- [ ] **Step 1: Create the pmputra page**

```tsx
// src/app/pmputra/penjualan/page.tsx
import { getPenjualanTrend } from "@/lib/queries/penjualan-piutang";
import { requirePmputra } from "@/lib/require-access";
import { PenjualanTrendPanel } from "@/components/dashboard/penjualan-trend-panel";

export default async function PmputraPenjualanPage() {
  await requirePmputra();
  const data = await getPenjualanTrend("pmputra");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Penjualan</h1>
        <p className="text-sm text-muted-foreground">PT Prima Maesa Putra — Es Balok</p>
      </div>
      <PenjualanTrendPanel data={data} />
    </div>
  );
}
```

- [ ] **Step 2: Create the pmpersada page**

```tsx
// src/app/pmpersada/(dashboard)/penjualan/page.tsx
import { getPenjualanTrend } from "@/lib/queries/penjualan-piutang";
import { requirePmpersada } from "@/lib/require-access";
import { PenjualanTrendPanel } from "@/components/dashboard/penjualan-trend-panel";

export default async function PmpersadaPenjualanPage() {
  await requirePmpersada();
  const data = await getPenjualanTrend("pmpersada");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Penjualan</h1>
        <p className="text-sm text-muted-foreground">PT Putra Maesa Persada — Es Balok</p>
      </div>
      <PenjualanTrendPanel data={data} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/app/pmputra/penjualan/page.tsx "src/app/pmpersada/(dashboard)/penjualan/page.tsx"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/pmputra/penjualan/page.tsx "src/app/pmpersada/(dashboard)/penjualan/page.tsx"
git commit -m "feat: wire Penjualan pages for pmputra and pmpersada"
```

---

## Task 6: Wire Piutang pages (pmputra + pmpersada)

**Files:**
- Create: `src/app/pmputra/piutang/page.tsx`
- Create: `src/app/pmpersada/(dashboard)/piutang/page.tsx`

**Interfaces:**
- Consumes: `getPiutangSummary` (Task 2), `PiutangSummaryPanel` (Task 4), `requirePmputra`/`requirePmpersada` (unchanged).
- Produces: nothing consumed by later tasks — leaf pages.

- [ ] **Step 1: Create the pmputra page**

```tsx
// src/app/pmputra/piutang/page.tsx
import { getPiutangSummary } from "@/lib/queries/penjualan-piutang";
import { requirePmputra } from "@/lib/require-access";
import { PiutangSummaryPanel } from "@/components/dashboard/piutang-summary-panel";

export default async function PmputraPiutangPage() {
  await requirePmputra();
  const data = await getPiutangSummary("pmputra");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Piutang</h1>
        <p className="text-sm text-muted-foreground">PT Prima Maesa Putra — Es Balok</p>
      </div>
      <PiutangSummaryPanel data={data} />
    </div>
  );
}
```

- [ ] **Step 2: Create the pmpersada page**

```tsx
// src/app/pmpersada/(dashboard)/piutang/page.tsx
import { getPiutangSummary } from "@/lib/queries/penjualan-piutang";
import { requirePmpersada } from "@/lib/require-access";
import { PiutangSummaryPanel } from "@/components/dashboard/piutang-summary-panel";

export default async function PmpersadaPiutangPage() {
  await requirePmpersada();
  const data = await getPiutangSummary("pmpersada");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Piutang</h1>
        <p className="text-sm text-muted-foreground">PT Putra Maesa Persada — Es Balok</p>
      </div>
      <PiutangSummaryPanel data={data} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/app/pmputra/piutang/page.tsx "src/app/pmpersada/(dashboard)/piutang/page.tsx"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/pmputra/piutang/page.tsx "src/app/pmpersada/(dashboard)/piutang/page.tsx"
git commit -m "feat: wire Piutang pages for pmputra and pmpersada"
```

---

## Task 7: Full verification pass

**Files:** None — verification only, fix forward in the touched files above if something's found broken.

**Interfaces:** N/A.

- [ ] **Step 1: Whole-project typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in the project.

Run: `npx eslint src/lib/queries/penjualan-piutang.ts src/components/dashboard/penjualan-trend-panel.tsx src/components/dashboard/piutang-summary-panel.tsx src/app/pmputra/penjualan/page.tsx src/app/pmputra/piutang/page.tsx "src/app/pmpersada/(dashboard)/penjualan/page.tsx" "src/app/pmpersada/(dashboard)/piutang/page.tsx"`
Expected: no errors.

- [ ] **Step 2: Cross-check the PIUTANG_ACCOUNTS assumption live**

Write a disposable script (scratchpad dir, `npx tsx -r dotenv/config <script>.ts`) that imports `getCompanyPool` and, for each of the 4 `PIUTANG_ACCOUNTS` rows, queries `ChartOfAccount`/`GeneralLedger` directly for that `accountNo`'s `Description` and current balance (`SUM(Debit)-SUM(Credit)`, no date filter). Compare the output against `getPiutangSummary("pmputra")`/`getPiutangSummary("pmpersada")`'s `totalPiutangUtama`/`totalPiutangLogistik` — they must match exactly (same query, just independently re-run). This does not validate that "1115"/"1111" are the *correct* accounts to represent Piutang (that needs the user's confirmation — surface the account descriptions and balances in your report), only that the query layer computes what it claims to.

- [ ] **Step 3: Cross-check Penjualan kantong and Pendapatan against known-good sources**

For one recent month (e.g. current month so far, or last full month), independently query `PMP_Pemesanan` (same filter as `getKantongByMonth`) and compare its kantong totals against what `PenjualanTrendPanel` renders for that month. Separately, compare that month's `pendapatanRp` against the same month's "Pendapatan" figure already shown on `/pmputra/keuangan` (and `/pmpersada/keuangan`) for the equivalent date range — they read the same GL data via the same Credit-Debit convention, so they must agree.

- [ ] **Step 4: Live browser check — all 4 pages**

Start the dev server (if not already running) and, logged in as an account with cross-PT access (or the respective PT's own account):
- Navigate to `/pmputra/penjualan` — confirm the page renders (not the old placeholder), KPI cards show non-zero numbers, the 12-month table is populated, no console errors.
- Navigate to `/pmputra/piutang` — same checks, plus confirm `totalPiutangUtama`/`totalPiutangLogistik` sum to `totalPiutangSaatIni`.
- Navigate to `/pmpersada/penjualan` and `/pmpersada/piutang` — same checks.
- Confirm `/pmputra/keuangan` and `/pmpersada/keuangan` still render unchanged (regression check — this plan never touches those files, but confirm nothing else broke).

- [ ] **Step 5: Report and commit any fixes**

If Steps 2-4 find a discrepancy, fix it in the relevant file from Tasks 1-6 and re-run Steps 1-4 before considering this task done. If everything matches, no commit is needed for this task (verification-only, nothing changed) — unless a fix was required, in which case commit that fix separately:

```bash
git add <fixed files>
git commit -m "fix: <describe what verification caught>"
```
