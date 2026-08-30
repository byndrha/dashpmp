# Modul Laporan Tahap 3 (Aktivitas Muatan Distribusi) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan laporan read-only "Aktivitas Muatan Distribusi" di `/mkesindo/laporan` yang merekap aktivitas Driver (jumlah muat, qty terkirim, Kendala, BBM, Istirahat) per Driver per shift kerja, murni diagregasi dari data yang sudah ada — tanpa tabel database baru.

**Architecture:** Satu query baru menghitung shift setiap `DashboardPengirimanJadwal` yang selesai muat langsung di SQL (aritmetika WIB pada `JamSelesaiMuat`, kolom true-UTC yang sudah terkonfirmasi), lalu menggabungkan agregat pre-grouped dari `DashboardProduksiMuatanDetail`/`DashboardPengirimanKendala`/`DashboardPengirimanBBM`/`DashboardPengirimanIstirahat` (masing-masing di-GROUP BY JadwalID dulu untuk menghindari fan-out) sebelum di-GROUP BY akhir per (TanggalUsaha, Shift, SalesmanID). Tab baru di `LaporanTabShell` yang sudah ada menampilkan hasilnya sebagai tabel dengan navigasi bulan, mengikuti pola `JadwalTimBulanan` yang baru dibangun di plan sebelumnya.

**Tech Stack:** Next.js Server Actions, MSSQL (`mssql` via `src/lib/db.ts`), React.

**Spec:** [docs/superpowers/specs/2026-08-30-modul-laporan-tahap3-aktivitas-muatan-distribusi-design.md](../specs/2026-08-30-modul-laporan-tahap3-aktivitas-muatan-distribusi-design.md)

## Global Constraints

- **Tidak ada tabel database baru** — seluruh laporan dihitung saat baca.
- Cutoff **Kerja** (rollover 15:00 WIB), BUKAN cutoff Penjualan — sama seperti Tahap 1/2.
- `JamSelesaiMuat` sudah terkonfirmasi **true-UTC** (GETDATE() mentah) — semua tabel aktivitas turunan (`DashboardPengirimanKendala.WaktuLapor`, `DashboardPengirimanBBM.WaktuMasukSpbu`/`WaktuIsi`, `DashboardPengirimanIstirahat.WaktuMulai`/`WaktuSelesai`) TIDAK dipakai untuk menentukan shift — seluruh aktivitas turunan satu Jadwal ikut shift `JamSelesaiMuat` Jadwal itu (satu Jadwal = satu unit kerja utuh).
- Urutan kronologis dalam satu TanggalUsaha: Shift 2 → Shift 3 → Shift 1 (bukan urutan angka) — jangan pernah `ORDER BY Shift ASC` mentah.
- Bahasa UI: Indonesia.
- MKEsindo saja.
- Tidak ada framework test otomatis di repo ini — verifikasi tiap task pakai `npx tsc --noEmit`, `npx eslint`, dan untuk kode yang menyentuh DB, script sekali-jalan (`npx tsx scratch-*.ts`) dijalankan ke database live lalu dihapus setelah dipakai.

---

### Task 1: Query Agregasi — `laporan-muatan-distribusi.ts`

**Files:**
- Create: `src/lib/queries/laporan-muatan-distribusi.ts`

**Interfaces:**
- Consumes: `getPool`/`sql` dari `src/lib/db.ts`, `ShiftNumber` dari `src/lib/report-shift.ts` (tipe saja, tidak ada fungsi report-shift.ts yang dipanggil — lihat Step 1 untuk alasan bucketing shift dilakukan di SQL, bukan lewat `getShiftWindow`/`naiveWibToUtcInstant`).
- Produces (dipakai Task 2):
  - `KendalaPerJenis { jenisKendala: string; jumlah: number }`
  - `AktivitasMuatanDistribusiRow { tanggalUsaha: string; shift: ShiftNumber; salesmanId: string; driverName: string; jumlahMuat: number; totalQty10KG: number; totalQty5KG: number; totalKantongEkivalen: number; jumlahKendala: number; kendalaPerJenis: KendalaPerJenis[]; totalLiterBBM: number; totalNominalBBM: number; jumlahSesiIstirahat: number; totalDurasiIstirahatMenit: number }`
  - `getAktivitasMuatanDistribusi(tahun: number, bulan: number): Promise<AktivitasMuatanDistribusiRow[]>`

- [ ] **Step 1: Tulis `src/lib/queries/laporan-muatan-distribusi.ts`**

```ts
import { getPool, sql } from "@/lib/db";
import type { ShiftNumber } from "@/lib/report-shift";

export interface KendalaPerJenis {
  jenisKendala: string;
  jumlah: number;
}

export interface AktivitasMuatanDistribusiRow {
  tanggalUsaha: string;
  shift: ShiftNumber;
  salesmanId: string;
  driverName: string;
  jumlahMuat: number;
  totalQty10KG: number;
  totalQty5KG: number;
  totalKantongEkivalen: number;
  jumlahKendala: number;
  kendalaPerJenis: KendalaPerJenis[];
  totalLiterBBM: number;
  totalNominalBBM: number;
  jumlahSesiIstirahat: number;
  totalDurasiIstirahatMenit: number;
}

// Bucketing shift dihitung LANGSUNG di SQL (DATEADD(HOUR, 7, ...) pada
// JamSelesaiMuat, kolom true-UTC terkonfirmasi -- lihat spec Tahap 2
// Bagian 5), BUKAN via getShiftWindow/naiveWibToUtcInstant di JS --
// karena JamSelesaiMuat tidak pernah dibaca balik jadi objek Date JS untuk
// dimanipulasi, hanya dibandingkan/dikelompokkan di dalam SQL, menghindari
// ambiguitas bagaimana driver `mssql` merepresentasikan nilai DATETIME
// yang di-fetch. Logika CASE di bawah mencerminkan persis
// getShiftNumber/getBusinessDateWithRollover di report-shift.ts/
// business-date.ts (rollover hour 15 untuk "work"): Shift 3 untuk jam WIB
// >=23 atau <7, Shift 1 untuk <15, selain itu Shift 2; tanggal usaha maju
// 1 hari begitu jam WIB >= 15.
const JADWAL_SHIFT_FROM = `
  DashboardPengirimanJadwal j
  LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
`;

const SHIFT_CASE = `
  CASE
    WHEN DATEPART(HOUR, DATEADD(HOUR, 7, j.JamSelesaiMuat)) >= 23
      OR DATEPART(HOUR, DATEADD(HOUR, 7, j.JamSelesaiMuat)) < 7 THEN 3
    WHEN DATEPART(HOUR, DATEADD(HOUR, 7, j.JamSelesaiMuat)) < 15 THEN 1
    ELSE 2
  END
`;

const TANGGAL_USAHA_CASE = `
  CASE
    WHEN DATEPART(HOUR, DATEADD(HOUR, 7, j.JamSelesaiMuat)) >= 15
      THEN CAST(DATEADD(DAY, 1, DATEADD(HOUR, 7, j.JamSelesaiMuat)) AS DATE)
    ELSE CAST(DATEADD(HOUR, 7, j.JamSelesaiMuat) AS DATE)
  END
`;

// Urutan kronologis dalam satu TanggalUsaha adalah Shift 2 -> 3 -> 1
// (lihat Global Constraints), bukan urutan angka -- dipetakan ke rank
// 1/2/3 untuk ORDER BY.
const SHIFT_SORT_RANK = `CASE js.Shift WHEN 2 THEN 1 WHEN 3 THEN 2 WHEN 1 THEN 3 END`;

export async function getAktivitasMuatanDistribusi(tahun: number, bulan: number): Promise<AktivitasMuatanDistribusiRow[]> {
  const pool = await getPool();
  const awalBulan = new Date(Date.UTC(tahun, bulan - 1, 1));
  const akhirBulan = new Date(Date.UTC(tahun, bulan, 1));
  // Filter kasar pada JamSelesaiMuat -- murni untuk performa (membatasi
  // baris yang perlu di-scan), bukan sumber kebenaran shift. Kebenaran
  // datang dari WHERE pada TanggalUsaha hasil hitung SQL di bawah. Buffer
  // 2 hari di awal cukup menutupi kuirk "Shift 2 jatuh di tanggal
  // sebelumnya" (lihat getShiftWindow di report-shift.ts).
  const awalMuat = new Date(awalBulan.getTime() - 2 * 24 * 60 * 60 * 1000);
  const akhirMuat = new Date(akhirBulan.getTime() + 1 * 24 * 60 * 60 * 1000);

  const utamaResult = await pool
    .request()
    .input("awalMuat", sql.DateTime, awalMuat)
    .input("akhirMuat", sql.DateTime, akhirMuat)
    .input("awalBulan", sql.Date, awalBulan)
    .input("akhirBulan", sql.Date, akhirBulan).query(`
      WITH JadwalShift AS (
        SELECT
          j.JadwalID,
          j.SalesmanID,
          sm.Name AS DriverName,
          j.Qty5KGDimuat,
          ${TANGGAL_USAHA_CASE} AS TanggalUsaha,
          ${SHIFT_CASE} AS Shift
        FROM ${JADWAL_SHIFT_FROM}
        WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL
          AND j.JamSelesaiMuat >= @awalMuat AND j.JamSelesaiMuat < @akhirMuat
      ),
      Qty10PerJadwal AS (
        SELECT JadwalID, SUM(Qty10KGDiambil) AS TotalQty10KG
        FROM DashboardProduksiMuatanDetail
        GROUP BY JadwalID
      ),
      KendalaPerJadwal AS (
        SELECT JadwalID, COUNT(*) AS JumlahKendala
        FROM DashboardPengirimanKendala
        GROUP BY JadwalID
      ),
      BBMPerJadwal AS (
        SELECT JadwalID, SUM(Liter) AS TotalLiter, SUM(NominalAsli + NominalEkstra) AS TotalNominal
        FROM DashboardPengirimanBBM
        WHERE WaktuIsi IS NOT NULL
        GROUP BY JadwalID
      ),
      IstirahatPerJadwal AS (
        SELECT JadwalID, COUNT(*) AS JumlahSesi,
               SUM(DATEDIFF(MINUTE, WaktuMulai, ISNULL(WaktuSelesai, GETDATE()))) AS TotalDurasiMenit
        FROM DashboardPengirimanIstirahat
        GROUP BY JadwalID
      )
      SELECT
        js.TanggalUsaha,
        js.Shift,
        js.SalesmanID,
        js.DriverName,
        COUNT(*) AS JumlahMuat,
        ISNULL(SUM(q10.TotalQty10KG), 0) AS TotalQty10KG,
        ISNULL(SUM(js.Qty5KGDimuat), 0) AS TotalQty5KG,
        ISNULL(SUM(k.JumlahKendala), 0) AS JumlahKendala,
        ISNULL(SUM(b.TotalLiter), 0) AS TotalLiterBBM,
        ISNULL(SUM(b.TotalNominal), 0) AS TotalNominalBBM,
        ISNULL(SUM(i.JumlahSesi), 0) AS JumlahSesiIstirahat,
        ISNULL(SUM(i.TotalDurasiMenit), 0) AS TotalDurasiIstirahatMenit
      FROM JadwalShift js
      LEFT JOIN Qty10PerJadwal q10 ON q10.JadwalID = js.JadwalID
      LEFT JOIN KendalaPerJadwal k ON k.JadwalID = js.JadwalID
      LEFT JOIN BBMPerJadwal b ON b.JadwalID = js.JadwalID
      LEFT JOIN IstirahatPerJadwal i ON i.JadwalID = js.JadwalID
      WHERE js.TanggalUsaha >= @awalBulan AND js.TanggalUsaha < @akhirBulan
      GROUP BY js.TanggalUsaha, js.Shift, js.SalesmanID, js.DriverName
      ORDER BY js.TanggalUsaha, ${SHIFT_SORT_RANK}
    `);

  const kendalaResult = await pool
    .request()
    .input("awalMuat", sql.DateTime, awalMuat)
    .input("akhirMuat", sql.DateTime, akhirMuat)
    .input("awalBulan", sql.Date, awalBulan)
    .input("akhirBulan", sql.Date, akhirBulan).query(`
      WITH JadwalShift AS (
        SELECT
          j.JadwalID,
          j.SalesmanID,
          ${TANGGAL_USAHA_CASE} AS TanggalUsaha,
          ${SHIFT_CASE} AS Shift
        FROM ${JADWAL_SHIFT_FROM}
        WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL
          AND j.JamSelesaiMuat >= @awalMuat AND j.JamSelesaiMuat < @akhirMuat
      )
      SELECT js.TanggalUsaha, js.Shift, js.SalesmanID, k.JenisKendala, COUNT(*) AS Jumlah
      FROM JadwalShift js
      JOIN DashboardPengirimanKendala k ON k.JadwalID = js.JadwalID
      WHERE js.TanggalUsaha >= @awalBulan AND js.TanggalUsaha < @akhirBulan
      GROUP BY js.TanggalUsaha, js.Shift, js.SalesmanID, k.JenisKendala
    `);

  const kendalaMap = new Map<string, KendalaPerJenis[]>();
  for (const row of kendalaResult.recordset as {
    TanggalUsaha: Date;
    Shift: number;
    SalesmanID: string;
    JenisKendala: string;
    Jumlah: number;
  }[]) {
    const key = `${row.TanggalUsaha.toISOString().slice(0, 10)}-${row.Shift}-${row.SalesmanID}`;
    const list = kendalaMap.get(key) ?? [];
    list.push({ jenisKendala: row.JenisKendala, jumlah: row.Jumlah });
    kendalaMap.set(key, list);
  }

  return (
    utamaResult.recordset as {
      TanggalUsaha: Date;
      Shift: number;
      SalesmanID: string;
      DriverName: string | null;
      JumlahMuat: number;
      TotalQty10KG: number;
      TotalQty5KG: number;
      JumlahKendala: number;
      TotalLiterBBM: number;
      TotalNominalBBM: number;
      JumlahSesiIstirahat: number;
      TotalDurasiIstirahatMenit: number;
    }[]
  ).map((r) => {
    const tanggalUsaha = r.TanggalUsaha.toISOString().slice(0, 10);
    const key = `${tanggalUsaha}-${r.Shift}-${r.SalesmanID}`;
    return {
      tanggalUsaha,
      shift: r.Shift as ShiftNumber,
      salesmanId: r.SalesmanID,
      driverName: r.DriverName ?? "Tidak diketahui",
      jumlahMuat: r.JumlahMuat,
      totalQty10KG: r.TotalQty10KG,
      totalQty5KG: r.TotalQty5KG,
      totalKantongEkivalen: r.TotalQty10KG + r.TotalQty5KG / 2,
      jumlahKendala: r.JumlahKendala,
      kendalaPerJenis: kendalaMap.get(key) ?? [],
      totalLiterBBM: r.TotalLiterBBM,
      totalNominalBBM: r.TotalNominalBBM,
      jumlahSesiIstirahat: r.JumlahSesiIstirahat,
      totalDurasiIstirahatMenit: r.TotalDurasiIstirahatMenit,
    };
  });
}
```

- [ ] **Step 2: Verifikasi lewat script sekali-jalan ke DB live**

Buat file sementara `scratch-test-muatan-distribusi.ts` di root repo:

```ts
import "dotenv/config";
import { getAktivitasMuatanDistribusi } from "./src/lib/queries/laporan-muatan-distribusi";

async function main() {
  const now = new Date();
  const rows = await getAktivitasMuatanDistribusi(now.getFullYear(), now.getMonth() + 1);
  console.log(`Baris: ${rows.length}`);
  console.log(JSON.stringify(rows.slice(0, 5), null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx scratch-test-muatan-distribusi.ts`
Expected: tidak error, mencetak jumlah baris dan sampel data (bisa 0 baris kalau bulan berjalan belum ada Jadwal selesai muat — kalau begitu, ubah `now` di script jadi bulan yang diketahui punya data, jalankan lagi, konfirmasi baris muncul dengan angka yang masuk akal — jumlahMuat/qty/kendala tidak negatif, `tanggalUsaha`+`shift` sesuai ekspektasi).

Hapus `scratch-test-muatan-distribusi.ts` setelah verifikasi selesai (bukan bagian dari commit).

- [ ] **Step 3: Verifikasi build**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/laporan-muatan-distribusi.ts`
Expected: tidak ada error.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/laporan-muatan-distribusi.ts
git commit -m "feat: add Aktivitas Muatan Distribusi aggregation query"
```

---

### Task 2: UI — Tab Laporan & Navigasi Bulan

**Files:**
- Modify: `src/app/mkesindo/(dashboard)/laporan/actions.ts`
- Create: `src/components/dashboard/laporan-aktivitas-muatan-distribusi.tsx`
- Modify: `src/components/dashboard/laporan-tab-shell.tsx`
- Modify: `src/app/mkesindo/(dashboard)/laporan/page.tsx`

**Interfaces:**
- Consumes: `getAktivitasMuatanDistribusi`, `AktivitasMuatanDistribusiRow` (Task 1), `getReportShift` dari `src/lib/report-shift.ts`, `requireModuleAccess` dari `src/lib/require-access.ts`, `runAction`/`ActionResult` dari `src/lib/action-result.ts`, `formatDate` dari `src/lib/format.ts`.
- Produces: `getAktivitasMuatanDistribusiAction(tahun, bulan): Promise<ActionResult<AktivitasMuatanDistribusiRow[]>>`, komponen `LaporanAktivitasMuatanDistribusi`.

- [ ] **Step 1: Tambah action di `src/app/mkesindo/(dashboard)/laporan/actions.ts`**

Tambah import setelah baris `import { getAktivitasRiwayat, type AktivitasShiftInfo } from "@/lib/queries/aktivitas-produksi";`:

```ts
import { getAktivitasMuatanDistribusi, type AktivitasMuatanDistribusiRow } from "@/lib/queries/laporan-muatan-distribusi";
```

Tambah fungsi baru di akhir file:

```ts
export async function getAktivitasMuatanDistribusiAction(tahun: number, bulan: number): Promise<ActionResult<AktivitasMuatanDistribusiRow[]>> {
  return runAction(async () => {
    await requireModuleAccess("laporan");
    return getAktivitasMuatanDistribusi(tahun, bulan);
  });
}
```

- [ ] **Step 2: Buat `src/components/dashboard/laporan-aktivitas-muatan-distribusi.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { getAktivitasMuatanDistribusiAction } from "@/app/mkesindo/(dashboard)/laporan/actions";
import type { AktivitasMuatanDistribusiRow } from "@/lib/queries/laporan-muatan-distribusi";

const BULAN_NAMA = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

export function LaporanAktivitasMuatanDistribusi({
  tahunAwal,
  bulanAwal,
  rowsAwal,
}: {
  tahunAwal: number;
  bulanAwal: number;
  rowsAwal: AktivitasMuatanDistribusiRow[];
}) {
  const [tahun, setTahun] = useState(tahunAwal);
  const [bulan, setBulan] = useState(bulanAwal);
  const [rows, setRows] = useState(rowsAwal);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tahun === tahunAwal && bulan === bulanAwal) return;
    let cancelled = false;
    setLoading(true);
    getAktivitasMuatanDistribusiAction(tahun, bulan).then((result) => {
      if (cancelled) return;
      if (result.success) setRows(result.data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tahun, bulan, tahunAwal, bulanAwal]);

  function gantiBulan(delta: number) {
    let nextBulan = bulan + delta;
    let nextTahun = tahun;
    if (nextBulan < 1) {
      nextBulan = 12;
      nextTahun -= 1;
    } else if (nextBulan > 12) {
      nextBulan = 1;
      nextTahun += 1;
    }
    setBulan(nextBulan);
    setTahun(nextTahun);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="icon" onClick={() => gantiBulan(-1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <p className="text-sm font-semibold">
          {BULAN_NAMA[bulan - 1]} {tahun}
        </p>
        <Button variant="outline" size="icon" onClick={() => gantiBulan(1)}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Memuat...</p>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal Usaha</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead className="text-right">Jumlah Muat</TableHead>
                <TableHead className="text-right">Qty 10KG</TableHead>
                <TableHead className="text-right">Qty 5KG</TableHead>
                <TableHead className="text-right">Kantong Ekivalen</TableHead>
                <TableHead className="text-right">Kendala</TableHead>
                <TableHead className="text-right">BBM (L)</TableHead>
                <TableHead className="text-right">BBM (Rp)</TableHead>
                <TableHead className="text-right">Istirahat</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.tanggalUsaha}-${r.shift}-${r.salesmanId}`}>
                  <TableCell>{formatDate(r.tanggalUsaha)}</TableCell>
                  <TableCell>Shift {r.shift}</TableCell>
                  <TableCell>{r.driverName}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.jumlahMuat}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.totalQty10KG.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.totalQty5KG.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.totalKantongEkivalen.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.jumlahKendala > 0 ? `${r.jumlahKendala} (${r.kendalaPerJenis.map((k) => `${k.jenisKendala}: ${k.jumlah}`).join(", ")})` : 0}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.totalLiterBBM.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right tabular-nums">Rp{r.totalNominalBBM.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.jumlahSesiIstirahat} sesi ({r.totalDurasiIstirahatMenit} menit)
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                    Belum ada data.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wiring `src/components/dashboard/laporan-tab-shell.tsx`**

Tambah import:

```tsx
import { LaporanAktivitasMuatanDistribusi } from "@/components/dashboard/laporan-aktivitas-muatan-distribusi";
import type { AktivitasMuatanDistribusiRow } from "@/lib/queries/laporan-muatan-distribusi";
```

Ubah `LaporanTab` type:

```tsx
type LaporanTab = "stok-bahan-baku" | "aktivitas-produksi" | "aktivitas-muatan-distribusi";
```

Tambah props baru ke `LaporanTabShell`:

```tsx
export function LaporanTabShell({
  canEdit,
  canEditSaldoAwal,
  current,
  initialCurrentRows,
  initialHistory,
  initialSaldoAwal,
  namaMap,
  aktivitasRiwayat,
  muatanDistribusiTahunAwal,
  muatanDistribusiBulanAwal,
  muatanDistribusiRowsAwal,
}: {
  canEdit: boolean;
  canEditSaldoAwal: boolean;
  current: CurrentShiftInfo;
  initialCurrentRows: StokBahanBakuRow[];
  initialHistory: StokBahanBakuRow[];
  initialSaldoAwal: SaldoAwalRow[];
  namaMap: Record<number, string>;
  aktivitasRiwayat: AktivitasShiftInfo[];
  muatanDistribusiTahunAwal: number;
  muatanDistribusiBulanAwal: number;
  muatanDistribusiRowsAwal: AktivitasMuatanDistribusiRow[];
}) {
  const [tab, setTab] = useState<LaporanTab>("stok-bahan-baku");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button size="sm" variant={tab === "stok-bahan-baku" ? "default" : "outline"} onClick={() => setTab("stok-bahan-baku")}>
          Stok Bahan Baku
        </Button>
        <Button size="sm" variant={tab === "aktivitas-produksi" ? "default" : "outline"} onClick={() => setTab("aktivitas-produksi")}>
          Aktivitas Produksi
        </Button>
        <Button
          size="sm"
          variant={tab === "aktivitas-muatan-distribusi" ? "default" : "outline"}
          onClick={() => setTab("aktivitas-muatan-distribusi")}
        >
          Aktivitas Muatan Distribusi
        </Button>
      </div>
      <div className={cn(tab !== "stok-bahan-baku" && "hidden")}>
        <LaporanStokBahanBaku
          canEdit={canEdit}
          canEditSaldoAwal={canEditSaldoAwal}
          current={current}
          initialCurrentRows={initialCurrentRows}
          initialHistory={initialHistory}
          initialSaldoAwal={initialSaldoAwal}
          namaMap={namaMap}
        />
      </div>
      <div className={cn(tab !== "aktivitas-produksi" && "hidden")}>
        <LaporanAktivitasProduksi riwayat={aktivitasRiwayat} namaMap={namaMap} />
      </div>
      <div className={cn(tab !== "aktivitas-muatan-distribusi" && "hidden")}>
        <LaporanAktivitasMuatanDistribusi
          tahunAwal={muatanDistribusiTahunAwal}
          bulanAwal={muatanDistribusiBulanAwal}
          rowsAwal={muatanDistribusiRowsAwal}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wiring `src/app/mkesindo/(dashboard)/laporan/page.tsx`**

```tsx
import type { Metadata } from "next";
import { requireModuleAccess, canAccessAllPT } from "@/lib/require-access";
import { getCurrentShiftRows, getStokBahanBakuHistory, getSaldoAwal } from "@/lib/queries/stok-bahan-baku";
import { getAktivitasRiwayat } from "@/lib/queries/aktivitas-produksi";
import { getAktivitasMuatanDistribusi } from "@/lib/queries/laporan-muatan-distribusi";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { getReportShift } from "@/lib/report-shift";
import { LaporanTabShell } from "@/components/dashboard/laporan-tab-shell";

export const metadata: Metadata = { title: "Laporan" };

export default async function LaporanPage() {
  const session = await requireModuleAccess("laporan");
  const canEdit = canAccessAllPT(session.user) || !!session.user.permissions.laporan?.canEdit;
  const canEditSaldoAwal = canAccessAllPT(session.user);

  const { businessDate } = getReportShift("work");
  const muatanDistribusiTahunAwal = businessDate.getUTCFullYear();
  const muatanDistribusiBulanAwal = businessDate.getUTCMonth() + 1;

  const [{ current, rows }, history, saldoAwal, aktivitasRiwayat, muatanDistribusiRowsAwal] = await Promise.all([
    getCurrentShiftRows(),
    getStokBahanBakuHistory(),
    getSaldoAwal(),
    getAktivitasRiwayat(),
    getAktivitasMuatanDistribusi(muatanDistribusiTahunAwal, muatanDistribusiBulanAwal),
  ]);

  const akunIds = [
    ...[...rows, ...history].flatMap((r) => [r.operasionalAkunId, r.produksiAkunId]),
    ...aktivitasRiwayat.map((r) => r.stafOperasionalAkunId),
  ].filter((id): id is number => id != null);
  const namaMap = await getAkunNamaMap(akunIds);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Laporan</h1>
      <LaporanTabShell
        canEdit={canEdit}
        canEditSaldoAwal={canEditSaldoAwal}
        current={current}
        initialCurrentRows={rows}
        initialHistory={history}
        initialSaldoAwal={saldoAwal}
        namaMap={Object.fromEntries(namaMap)}
        aktivitasRiwayat={aktivitasRiwayat}
        muatanDistribusiTahunAwal={muatanDistribusiTahunAwal}
        muatanDistribusiBulanAwal={muatanDistribusiBulanAwal}
        muatanDistribusiRowsAwal={muatanDistribusiRowsAwal}
      />
    </div>
  );
}
```

- [ ] **Step 5: Verifikasi build & manual**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint "src/app/mkesindo/(dashboard)/laporan/actions.ts" src/components/dashboard/laporan-aktivitas-muatan-distribusi.tsx src/components/dashboard/laporan-tab-shell.tsx "src/app/mkesindo/(dashboard)/laporan/page.tsx"`
Expected: tidak ada error.

Buka `/mkesindo/laporan` sebagai akun dengan akses modul "laporan". Klik tab "Aktivitas Muatan Distribusi", konfirmasi tabel tampil (baris kosong wajar kalau bulan berjalan belum ada Jadwal selesai muat). Navigasi ke bulan sebelumnya yang diketahui punya data pengiriman selesai, konfirmasi baris muncul dengan angka yang masuk akal dan urutan kronologis (Shift 2 → 3 → 1 dalam satu tanggal).

- [ ] **Step 6: Commit**

```bash
git add "src/app/mkesindo/(dashboard)/laporan/actions.ts" src/components/dashboard/laporan-aktivitas-muatan-distribusi.tsx src/components/dashboard/laporan-tab-shell.tsx "src/app/mkesindo/(dashboard)/laporan/page.tsx"
git commit -m "feat: add Aktivitas Muatan Distribusi tab to /mkesindo/laporan"
```
