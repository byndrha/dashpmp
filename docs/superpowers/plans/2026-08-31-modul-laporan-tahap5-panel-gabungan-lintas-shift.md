# Modul Laporan Tahap 5 (Panel Gabungan Lintas Shift) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan tab kelima (dan terakhir) "Ringkasan Lintas Shift" di `/mkesindo/laporan` yang menggabungkan Tahap 1-4 jadi satu Kartu Detail Shift + Grafik Tren, murni agregasi dari fungsi query yang sudah ada.

**Architecture:** Satu fungsi kombinasi baru menarik data dari 4 fungsi query Tahap 1-4 yang sudah ada (`getStokBahanBakuHistory`, `getAktivitasRiwayat`, `getAktivitasMuatanDistribusi`, `getKasKecilHistory`) plus SATU fungsi SQL baru (kantong-ekivalen Produksi versi bulanan-massal, karena yang sudah ada — `getQtyRecapForShift` — hanya untuk satu shift), digabung jadi satu baris ringkas per `(TanggalUsaha, Shift)` di JavaScript (bukan SQL JOIN lintas 4 sumber, karena sumbernya independen). UI baru pakai `recharts` (sudah jadi dependency) lewat komponen chart generik baru, mengikuti pola `src/components/charts/simple-bar-chart.tsx` yang sudah ada.

**Tech Stack:** Next.js Server Actions, MSSQL (`mssql` via `src/lib/db.ts`), React, `recharts`.

**Spec:** [docs/superpowers/specs/2026-08-31-modul-laporan-tahap5-panel-gabungan-lintas-shift-design.md](../specs/2026-08-31-modul-laporan-tahap5-panel-gabungan-lintas-shift-design.md)

## Global Constraints

- **Tidak ada tabel database baru** — seluruhnya dihitung saat baca.
- **100% read-only** — tidak ada input manual, tidak ada perbedaan `canEdit`/`canView`.
- Skor Kelengkapan (0-3) hanya menghitung Bahan Baku, Produksi, Kas Kecil — Muatan Distribusi TIDAK ikut skor (tidak ada konsep input manual di sana), tapi KPI-nya tetap tampil.
- Bahan Baku dianggap lengkap kalau ketiga `JenisBarang` (Plastik10KG, Plastik5KG, IkatKabel) sudah punya baris shift itu.
- Urutan kronologis dalam satu TanggalUsaha: Shift 2 → Shift 3 → Shift 1 (bukan urutan angka).
- Tidak ada tautan cepat dari kartu detail ke tab lain (YAGNI).
- Bahasa UI: Indonesia. MKEsindo saja.
- Tidak ada framework test otomatis di repo ini — verifikasi tiap task pakai `npx tsc --noEmit`, `npx eslint`, dan untuk kode yang menyentuh DB, script sekali-jalan (`npx tsx scratch-*.ts`) dijalankan ke database live lalu dihapus setelah dipakai.

---

### Task 1: Query — `laporan-ringkasan-lintas-shift.ts`

**Files:**
- Create: `src/lib/queries/laporan-ringkasan-lintas-shift.ts`

**Interfaces:**
- Consumes: `getPool`/`sql` dari `src/lib/db.ts`; `getReportShift`/`ShiftNumber` dari `src/lib/report-shift.ts`; `getStokBahanBakuHistory` dari `src/lib/queries/stok-bahan-baku.ts`; `JENIS_BARANG_LIST`/`JenisBarang` dari `src/lib/stok-bahan-baku-shared.ts`; `getAktivitasRiwayat` dari `src/lib/queries/aktivitas-produksi.ts`; `hitungTotalDenda` dari `src/lib/aktivitas-produksi-shared.ts`; `getAktivitasMuatanDistribusi` dari `src/lib/queries/laporan-muatan-distribusi.ts`; `getKasKecilHistory` dari `src/lib/queries/kas-kecil.ts`.
- Produces (dipakai Task 3, 4):
  - `KantongEkivalenProduksiRow { tanggalUsaha: string; shift: ShiftNumber; totalKantongEkivalen: number }`
  - `getKantongEkivalenProduksiPerBulan(tahun: number, bulan: number): Promise<KantongEkivalenProduksiRow[]>`
  - `BahanBakuPerJenisRingkasan { jenisBarang: JenisBarang; sisaGudangAkhir: number; sisaInventoriAkhir: number; stokMasukInventoriOperasional: number }`
  - `RingkasanShiftRow { tanggalUsaha: string; shift: ShiftNumber; skorKelengkapan: number; bahanBakuLengkap: boolean; bahanBakuPerJenis: BahanBakuPerJenisRingkasan[]; bahanBakuKantongEkivalenMasuk: number; produksiLengkap: boolean; produksiTimId: number | null; produksiStafOperasionalAkunId: number | null; produksiTotalKantongEkivalen: number; produksiTotalDenda: number; muatanJumlahMuat: number; muatanTotalKantongEkivalen: number; muatanJumlahKendala: number; kasKecilLengkap: boolean; kasKecilKasMasuk: number; kasKecilTotalPengeluaran: number; kasKecilSaldoAkhir: number }`
  - `getRingkasanLintasShift(tahun: number, bulan: number): Promise<RingkasanShiftRow[]>`

- [ ] **Step 1: Tulis `src/lib/queries/laporan-ringkasan-lintas-shift.ts`**

```ts
import { getPool, sql } from "@/lib/db";
import { getReportShift, type ShiftNumber } from "@/lib/report-shift";
import { getStokBahanBakuHistory } from "@/lib/queries/stok-bahan-baku";
import { JENIS_BARANG_LIST, type JenisBarang } from "@/lib/stok-bahan-baku-shared";
import { getAktivitasRiwayat } from "@/lib/queries/aktivitas-produksi";
import { hitungTotalDenda } from "@/lib/aktivitas-produksi-shared";
import { getAktivitasMuatanDistribusi } from "@/lib/queries/laporan-muatan-distribusi";
import { getKasKecilHistory } from "@/lib/queries/kas-kecil";

export interface KantongEkivalenProduksiRow {
  tanggalUsaha: string;
  shift: ShiftNumber;
  totalKantongEkivalen: number;
}

// Bulk, whole-month version of getQtyRecapForShift's kantong-ekivalen
// formula (aktivitas-produksi.ts) -- that function only computes ONE
// shift at a time, this computes every shift in a month in 2 queries
// instead of up to ~90 round trips. 10KG groups directly on
// DashboardProduksiBatch's own stored TanggalLabel/Shift columns (no
// bucketing arithmetic needed -- matches getQtyRecapForShift's own
// approach exactly, TanggalLabel is already a stored label, not a raw
// timestamp). 5KG needs the same WIB-offset shift-bucketing SQL already
// established in laporan-muatan-distribusi.ts (Tahap 3) -- duplicated
// here rather than imported, matching that file's own precedent of
// duplicating its shared SQL text within itself rather than creating
// cross-file coupling for a few lines of SQL.
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

export async function getKantongEkivalenProduksiPerBulan(tahun: number, bulan: number): Promise<KantongEkivalenProduksiRow[]> {
  const pool = await getPool();
  const awalBulan = new Date(Date.UTC(tahun, bulan - 1, 1));
  const akhirBulan = new Date(Date.UTC(tahun, bulan, 1));

  const batchResult = await pool
    .request()
    .input("awalBulan", sql.Date, awalBulan)
    .input("akhirBulan", sql.Date, akhirBulan).query(`
      SELECT TanggalLabel, Shift, SUM(Qty10KG) AS Total10KG
      FROM DashboardProduksiBatch
      WHERE IsDeleted = 0 AND TanggalLabel >= @awalBulan AND TanggalLabel < @akhirBulan
      GROUP BY TanggalLabel, Shift
    `);

  // Coarse pre-filter pada JamSelesaiMuat -- murni performa, korektnya
  // datang dari WHERE pada TanggalUsaha hasil hitung SQL di bawah, sama
  // pola seperti laporan-muatan-distribusi.ts.
  const awalMuat = new Date(awalBulan.getTime() - 2 * 24 * 60 * 60 * 1000);
  const akhirMuat = new Date(akhirBulan.getTime() + 1 * 24 * 60 * 60 * 1000);
  const jadwalResult = await pool
    .request()
    .input("awalMuat", sql.DateTime, awalMuat)
    .input("akhirMuat", sql.DateTime, akhirMuat)
    .input("awalBulan", sql.Date, awalBulan)
    .input("akhirBulan", sql.Date, akhirBulan).query(`
      WITH JadwalShift AS (
        SELECT
          j.Qty5KGDimuat,
          ${TANGGAL_USAHA_CASE} AS TanggalUsaha,
          ${SHIFT_CASE} AS Shift
        FROM DashboardPengirimanJadwal j
        WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL
          AND j.JamSelesaiMuat >= @awalMuat AND j.JamSelesaiMuat < @akhirMuat
      )
      SELECT TanggalUsaha, Shift, SUM(Qty5KGDimuat) AS Total5KG
      FROM JadwalShift
      WHERE TanggalUsaha >= @awalBulan AND TanggalUsaha < @akhirBulan
      GROUP BY TanggalUsaha, Shift
    `);

  const map = new Map<string, { tanggalUsaha: string; shift: ShiftNumber; total10KG: number; total5KG: number }>();
  const keyOf = (tanggalUsaha: string, shift: number) => `${tanggalUsaha}|${shift}`;

  for (const row of batchResult.recordset as { TanggalLabel: Date; Shift: number; Total10KG: number }[]) {
    const tanggalUsaha = row.TanggalLabel.toISOString().slice(0, 10);
    const shift = row.Shift as ShiftNumber;
    const key = keyOf(tanggalUsaha, shift);
    const entry = map.get(key) ?? { tanggalUsaha, shift, total10KG: 0, total5KG: 0 };
    entry.total10KG += row.Total10KG;
    map.set(key, entry);
  }
  for (const row of jadwalResult.recordset as { TanggalUsaha: Date; Shift: number; Total5KG: number }[]) {
    const tanggalUsaha = row.TanggalUsaha.toISOString().slice(0, 10);
    const shift = row.Shift as ShiftNumber;
    const key = keyOf(tanggalUsaha, shift);
    const entry = map.get(key) ?? { tanggalUsaha, shift, total10KG: 0, total5KG: 0 };
    entry.total5KG += row.Total5KG;
    map.set(key, entry);
  }

  return Array.from(map.values()).map((v) => ({
    tanggalUsaha: v.tanggalUsaha,
    shift: v.shift,
    totalKantongEkivalen: v.total10KG + v.total5KG / 2,
  }));
}

export interface BahanBakuPerJenisRingkasan {
  jenisBarang: JenisBarang;
  sisaGudangAkhir: number;
  sisaInventoriAkhir: number;
  stokMasukInventoriOperasional: number;
}

export interface RingkasanShiftRow {
  tanggalUsaha: string;
  shift: ShiftNumber;
  skorKelengkapan: number; // 0-3: Bahan Baku + Produksi + Kas Kecil saja
  bahanBakuLengkap: boolean;
  bahanBakuPerJenis: BahanBakuPerJenisRingkasan[];
  bahanBakuKantongEkivalenMasuk: number;
  produksiLengkap: boolean;
  produksiTimId: number | null;
  produksiStafOperasionalAkunId: number | null;
  produksiTotalKantongEkivalen: number;
  produksiTotalDenda: number;
  muatanJumlahMuat: number;
  muatanTotalKantongEkivalen: number;
  muatanJumlahKendala: number;
  kasKecilLengkap: boolean;
  kasKecilKasMasuk: number;
  kasKecilTotalPengeluaran: number;
  kasKecilSaldoAkhir: number;
}

function keyOf(tanggalUsaha: string, shift: number): string {
  return `${tanggalUsaha}|${shift}`;
}

// Menggabungkan Tahap 1/2/3/4 jadi satu baris per (TanggalUsaha, Shift).
// Bahan Baku/Produksi/Kas Kecil "lengkap" ditentukan murni dari APAKAH
// barisnya muncul di riwayat masing-masing (ketiga fungsi sumber hanya
// mengembalikan baris yang BENAR-BENAR ada di DB, tidak pernah
// mensintesis baris kosong) -- tidak perlu query terpisah untuk cek
// "sudah diisi atau belum".
export async function getRingkasanLintasShift(tahun: number, bulan: number): Promise<RingkasanShiftRow[]> {
  const { shift: shiftBerjalan, businessDate: businessDateBerjalan } = getReportShift("work");
  const tanggalUsahaBerjalan = businessDateBerjalan.toISOString().slice(0, 10);

  const [bahanBakuHistory, aktivitasRiwayat, kantongEkivalenProduksi, muatanDistribusi, kasKecilHistory] = await Promise.all([
    getStokBahanBakuHistory(400),
    getAktivitasRiwayat(120),
    getKantongEkivalenProduksiPerBulan(tahun, bulan),
    getAktivitasMuatanDistribusi(tahun, bulan),
    getKasKecilHistory(120),
  ]);

  const awalBulan = `${tahun}-${String(bulan).padStart(2, "0")}-01`;
  const akhirBulan = new Date(Date.UTC(tahun, bulan, 1)).toISOString().slice(0, 10);
  const dalamBulan = (tanggalUsaha: string) => tanggalUsaha >= awalBulan && tanggalUsaha < akhirBulan;

  const bahanBakuBulanIni = bahanBakuHistory.filter((r) => dalamBulan(r.tanggalUsaha));
  const aktivitasBulanIni = aktivitasRiwayat.filter((r) => dalamBulan(r.tanggalUsaha));
  const kasKecilBulanIni = kasKecilHistory.filter((r) => dalamBulan(r.tanggalUsaha));

  const bahanBakuPerShift = new Map<string, BahanBakuPerJenisRingkasan[]>();
  for (const r of bahanBakuBulanIni) {
    const key = keyOf(r.tanggalUsaha, r.shift);
    const list = bahanBakuPerShift.get(key) ?? [];
    list.push({
      jenisBarang: r.jenisBarang,
      sisaGudangAkhir: r.sisaGudangAkhir,
      sisaInventoriAkhir: r.sisaInventoriAkhir,
      stokMasukInventoriOperasional: r.stokMasukInventoriOperasional,
    });
    bahanBakuPerShift.set(key, list);
  }

  const aktivitasPerShift = new Map(aktivitasBulanIni.map((r) => [keyOf(r.tanggalUsaha, r.shift), r]));
  const kantongProduksiPerShift = new Map(kantongEkivalenProduksi.map((r) => [keyOf(r.tanggalUsaha, r.shift), r]));
  const kasKecilPerShift = new Map(kasKecilBulanIni.map((r) => [keyOf(r.tanggalUsaha, r.shift), r]));

  const muatanPerShift = new Map<string, { jumlahMuat: number; totalKantongEkivalen: number; jumlahKendala: number }>();
  for (const r of muatanDistribusi) {
    const key = keyOf(r.tanggalUsaha, r.shift);
    const entry = muatanPerShift.get(key) ?? { jumlahMuat: 0, totalKantongEkivalen: 0, jumlahKendala: 0 };
    entry.jumlahMuat += r.jumlahMuat;
    entry.totalKantongEkivalen += r.totalKantongEkivalen;
    entry.jumlahKendala += r.jumlahKendala;
    muatanPerShift.set(key, entry);
  }

  // Union semua (TanggalUsaha, Shift) yang muncul di mana pun, DITAMBAH
  // shift yang sedang berjalan sekarang (supaya Kartu Detail Shift --
  // spec Bagian 2 -- selalu punya baris untuk ditampilkan meski shift itu
  // baru dan belum ada data sama sekali di tahap manapun).
  const semuaKey = new Set<string>([
    ...bahanBakuPerShift.keys(),
    ...aktivitasPerShift.keys(),
    ...kantongProduksiPerShift.keys(),
    ...muatanPerShift.keys(),
    ...kasKecilPerShift.keys(),
  ]);
  if (dalamBulan(tanggalUsahaBerjalan)) {
    semuaKey.add(keyOf(tanggalUsahaBerjalan, shiftBerjalan));
  }

  const rows: RingkasanShiftRow[] = Array.from(semuaKey).map((key) => {
    const [tanggalUsaha, shiftStr] = key.split("|");
    const shift = Number(shiftStr) as ShiftNumber;

    const bahanBakuPerJenis = bahanBakuPerShift.get(key) ?? [];
    const bahanBakuLengkap = bahanBakuPerJenis.length === JENIS_BARANG_LIST.length;
    const masuk10 = bahanBakuPerJenis.find((b) => b.jenisBarang === "Plastik10KG")?.stokMasukInventoriOperasional ?? 0;
    const masuk5 = bahanBakuPerJenis.find((b) => b.jenisBarang === "Plastik5KG")?.stokMasukInventoriOperasional ?? 0;
    const bahanBakuKantongEkivalenMasuk = masuk10 + masuk5 / 2;

    const aktivitas = aktivitasPerShift.get(key);
    const produksiLengkap = aktivitas != null;
    const kantongProduksi = kantongProduksiPerShift.get(key);
    const muatan = muatanPerShift.get(key) ?? { jumlahMuat: 0, totalKantongEkivalen: 0, jumlahKendala: 0 };
    const kasKecil = kasKecilPerShift.get(key);
    const kasKecilLengkap = kasKecil != null;

    const skorKelengkapan = (bahanBakuLengkap ? 1 : 0) + (produksiLengkap ? 1 : 0) + (kasKecilLengkap ? 1 : 0);

    return {
      tanggalUsaha,
      shift,
      skorKelengkapan,
      bahanBakuLengkap,
      bahanBakuPerJenis,
      bahanBakuKantongEkivalenMasuk,
      produksiLengkap,
      produksiTimId: aktivitas?.timId ?? null,
      produksiStafOperasionalAkunId: aktivitas?.stafOperasionalAkunId ?? null,
      produksiTotalKantongEkivalen: kantongProduksi?.totalKantongEkivalen ?? 0,
      produksiTotalDenda: aktivitas ? hitungTotalDenda(aktivitas.pecahKemasanQty, aktivitas.esJatuhQty) : 0,
      muatanJumlahMuat: muatan.jumlahMuat,
      muatanTotalKantongEkivalen: muatan.totalKantongEkivalen,
      muatanJumlahKendala: muatan.jumlahKendala,
      kasKecilLengkap,
      kasKecilKasMasuk: kasKecil?.kasMasuk ?? 0,
      kasKecilTotalPengeluaran: kasKecil?.totalPengeluaran ?? 0,
      kasKecilSaldoAkhir: kasKecil?.saldoAkhir ?? 0,
    };
  });

  // Kronologis Shift 2 -> 3 -> 1 dalam satu TanggalUsaha (lihat Global
  // Constraints) -- bukan ORDER BY Shift mentah.
  const shiftRank: Record<ShiftNumber, number> = { 2: 1, 3: 2, 1: 3 };
  rows.sort((a, b) => {
    if (a.tanggalUsaha !== b.tanggalUsaha) return a.tanggalUsaha.localeCompare(b.tanggalUsaha);
    return shiftRank[a.shift] - shiftRank[b.shift];
  });

  return rows;
}
```

- [ ] **Step 2: Verifikasi lewat script sekali-jalan ke DB live**

Buat file sementara `scratch-test-ringkasan.ts`:

```ts
import "dotenv/config";
import { getRingkasanLintasShift } from "./src/lib/queries/laporan-ringkasan-lintas-shift";

async function main() {
  const now = new Date();
  const rows = await getRingkasanLintasShift(now.getFullYear(), now.getMonth() + 1);
  console.log(`Baris: ${rows.length}`);
  console.log(JSON.stringify(rows.slice(-5), null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx scratch-test-ringkasan.ts`
Expected: tidak error, mencetak jumlah baris (minimal 1, karena shift berjalan selalu ditambahkan) dan sampel 5 baris terakhir. Cek manual: `skorKelengkapan` antara 0-3, `produksiTotalKantongEkivalen`/`muatanJumlahMuat`/`kasKecilSaldoAkhir` masuk akal (bandingkan dengan angka yang sudah terverifikasi di Tahap 2/3/4 untuk tanggal/shift yang sama, kalau ada). Kalau bulan berjalan datanya tipis, ubah `now` ke bulan yang diketahui punya data lengkap di semua tahap (Agustus 2026, dari verifikasi Tahap 1-4 sebelumnya) dan jalankan ulang.

Hapus `scratch-test-ringkasan.ts` setelah verifikasi selesai.

- [ ] **Step 3: Verifikasi build**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/laporan-ringkasan-lintas-shift.ts`
Expected: tidak ada error.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/laporan-ringkasan-lintas-shift.ts
git commit -m "feat: add Ringkasan Lintas Shift aggregation query for Modul Laporan Tahap 5"
```

---

### Task 2: Komponen Chart — `SimpleLineChart`

**Files:**
- Create: `src/components/charts/simple-line-chart.tsx`

**Interfaces:**
- Consumes: `recharts` (`Line`, `LineChart`, `CartesianGrid`, `ResponsiveContainer`, `Tooltip`, `XAxis`, `YAxis`).
- Produces (dipakai Task 3): `LineDatum { name: string; value: number }`, `SimpleLineChart({ data, color?, height?, valueFormatter? })`.

- [ ] **Step 1: Tulis `src/components/charts/simple-line-chart.tsx`**

```tsx
"use client";

import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface LineDatum {
  name: string;
  value: number;
}

export function SimpleLineChart({
  data,
  color = "var(--chart-1)",
  height = 200,
  valueFormatter = (v: number) => v.toLocaleString("id-ID"),
}: {
  data: LineDatum[];
  color?: string;
  height?: number;
  valueFormatter?: (value: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={40}
          tickFormatter={(v) => new Intl.NumberFormat("id-ID", { notation: "compact" }).format(v)}
        />
        <Tooltip
          formatter={(value) => valueFormatter(Number(value))}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            color: "var(--popover-foreground)",
            fontSize: 12,
          }}
          labelStyle={{ color: "var(--muted-foreground)" }}
        />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Verifikasi build**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/components/charts/simple-line-chart.tsx`
Expected: tidak ada error.

- [ ] **Step 3: Commit**

```bash
git add src/components/charts/simple-line-chart.tsx
git commit -m "feat: add reusable SimpleLineChart component"
```

---

### Task 3: UI — Kartu Detail Shift, Grafik Tren & Wiring

**Files:**
- Create: `src/components/dashboard/laporan-ringkasan-lintas-shift.tsx`
- Modify: `src/app/mkesindo/(dashboard)/laporan/actions.ts`
- Modify: `src/components/dashboard/laporan-tab-shell.tsx`
- Modify: `src/app/mkesindo/(dashboard)/laporan/page.tsx`

**Interfaces:**
- Consumes: `RingkasanShiftRow`/`getRingkasanLintasShift` (Task 1), `SimpleLineChart`/`LineDatum` (Task 2), `getAllTim`/`TimRow` dari `src/lib/queries/tim-produksi.ts`, `requireModuleAccess`/`canAccessAllPT` dari `src/lib/require-access.ts`, `runAction`/`ActionResult` dari `src/lib/action-result.ts`, `JENIS_BARANG_LABEL` dari `src/lib/stok-bahan-baku-shared.ts`, `formatDate` dari `src/lib/format.ts`.
- Produces: `getRingkasanLintasShiftAction(tahun, bulan): Promise<ActionResult<RingkasanShiftRow[]>>`, komponen `LaporanRingkasanLintasShift({ tahunAwal, bulanAwal, rowsAwal, namaMap, timNamaMap })`. Both the action and the component are added in this SAME task (unlike a cross-task dependency) so the build never goes through an intermediate broken state — write the action (Step 2) before verifying the component's build (Step 5), not after.

- [ ] **Step 1: Tulis `src/components/dashboard/laporan-ringkasan-lintas-shift.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { SimpleLineChart } from "@/components/charts/simple-line-chart";
import { getRingkasanLintasShiftAction } from "@/app/mkesindo/(dashboard)/laporan/actions";
import type { RingkasanShiftRow } from "@/lib/queries/laporan-ringkasan-lintas-shift";
import { JENIS_BARANG_LABEL } from "@/lib/stok-bahan-baku-shared";

const BULAN_NAMA = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function formatRupiah(n: number): string {
  return `Rp${n.toLocaleString("id-ID")}`;
}

function skorWarna(skor: number): string {
  if (skor === 3) return "text-emerald-600";
  if (skor === 0) return "text-destructive";
  return "text-amber-600";
}

export function LaporanRingkasanLintasShift({
  tahunAwal,
  bulanAwal,
  rowsAwal,
  namaMap,
  timNamaMap,
}: {
  tahunAwal: number;
  bulanAwal: number;
  rowsAwal: RingkasanShiftRow[];
  namaMap: Record<number, string>;
  timNamaMap: Record<number, string>;
}) {
  const [tahun, setTahun] = useState(tahunAwal);
  const [bulan, setBulan] = useState(bulanAwal);
  const [rows, setRows] = useState(rowsAwal);
  const [loading, setLoading] = useState(false);
  // Index ke `rows` untuk Kartu Detail Shift -- default baris TERAKHIR
  // (shift paling baru) dari bulan yang sedang dimuat. Navigasi shift
  // yang melewati ujung bulan yang dimuat adalah no-op -- ganti bulan
  // dulu lewat navigasi Grafik Tren untuk mengakses shift di bulan lain.
  const [selectedIndex, setSelectedIndex] = useState(rowsAwal.length - 1);

  useEffect(() => {
    if (tahun === tahunAwal && bulan === bulanAwal) {
      setRows(rowsAwal);
      setSelectedIndex(rowsAwal.length - 1);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getRingkasanLintasShiftAction(tahun, bulan).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setRows(result.data);
        setSelectedIndex(result.data.length - 1);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tahun, bulan, tahunAwal, bulanAwal, rowsAwal]);

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

  function gantiShift(delta: number) {
    setSelectedIndex((prev) => Math.max(0, Math.min(rows.length - 1, prev + delta)));
  }

  const selected: RingkasanShiftRow | undefined = rows[selectedIndex];

  const skorTrendData = rows.map((r) => ({ name: `${formatDate(r.tanggalUsaha)} S${r.shift}`, value: r.skorKelengkapan }));
  const produksiTrendData = rows.map((r) => ({ name: `${formatDate(r.tanggalUsaha)} S${r.shift}`, value: r.produksiTotalKantongEkivalen }));
  const muatanTrendData = rows.map((r) => ({ name: `${formatDate(r.tanggalUsaha)} S${r.shift}`, value: r.muatanJumlahMuat }));
  const kasKecilTrendData = rows.map((r) => ({ name: `${formatDate(r.tanggalUsaha)} S${r.shift}`, value: r.kasKecilSaldoAkhir }));
  const bahanBakuTrendData = rows.map((r) => ({ name: `${formatDate(r.tanggalUsaha)} S${r.shift}`, value: r.bahanBakuKantongEkivalenMasuk }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Kartu Detail Shift</h2>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => gantiShift(-1)} disabled={selectedIndex <= 0}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => gantiShift(1)} disabled={selectedIndex >= rows.length - 1}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
        {!selected ? (
          <p className="text-xs text-muted-foreground">Belum ada data bulan ini.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">
                {formatDate(selected.tanggalUsaha)} — Shift {selected.shift}
              </p>
              <p className={`text-lg font-bold ${skorWarna(selected.skorKelengkapan)}`}>{selected.skorKelengkapan}/3 lengkap</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Bahan Baku {selected.bahanBakuLengkap ? "✓" : "✗"}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-xs">
                  {selected.bahanBakuPerJenis.map((b) => (
                    <div key={b.jenisBarang} className="flex justify-between">
                      <span className="text-muted-foreground">{JENIS_BARANG_LABEL[b.jenisBarang]}</span>
                      <span className="tabular-nums">
                        G:{b.sisaGudangAkhir.toLocaleString("id-ID")} / I:{b.sisaInventoriAkhir.toLocaleString("id-ID")}
                      </span>
                    </div>
                  ))}
                  {selected.bahanBakuPerJenis.length === 0 && <p className="text-muted-foreground">Belum diisi.</p>}
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Produksi {selected.produksiLengkap ? "✓" : "✗"}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tim Bertugas</span>
                    <span>{selected.produksiTimId ? (timNamaMap[selected.produksiTimId] ?? "?") : "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Staf Operasional</span>
                    <span>{selected.produksiStafOperasionalAkunId ? (namaMap[selected.produksiStafOperasionalAkunId] ?? "?") : "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Kantong Ekivalen</span>
                    <span className="tabular-nums">{selected.produksiTotalKantongEkivalen.toLocaleString("id-ID")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Denda</span>
                    <span className="tabular-nums">{formatRupiah(selected.produksiTotalDenda)}</span>
                  </div>
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Muatan Distribusi</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Jumlah Muat</span>
                    <span className="tabular-nums">{selected.muatanJumlahMuat}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Kantong Ekivalen</span>
                    <span className="tabular-nums">{selected.muatanTotalKantongEkivalen.toLocaleString("id-ID")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Kendala</span>
                    <span className="tabular-nums">{selected.muatanJumlahKendala}</span>
                  </div>
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Kas Kecil {selected.kasKecilLengkap ? "✓" : "✗"}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Kas Masuk</span>
                    <span className="tabular-nums">{formatRupiah(selected.kasKecilKasMasuk)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Pengeluaran</span>
                    <span className="tabular-nums">{formatRupiah(selected.kasKecilTotalPengeluaran)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Saldo Akhir</span>
                    <span className="tabular-nums">{formatRupiah(selected.kasKecilSaldoAkhir)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Grafik Tren</h2>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => gantiBulan(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <p className="min-w-28 text-center text-sm font-medium">
              {BULAN_NAMA[bulan - 1]} {tahun}
            </p>
            <Button variant="outline" size="icon" onClick={() => gantiBulan(1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
        {loading ? (
          <p className="text-xs text-muted-foreground">Memuat...</p>
        ) : (
          <div className="flex flex-col gap-4">
            <Card size="sm">
              <CardHeader>
                <CardTitle className="text-sm">Skor Kelengkapan (0-3)</CardTitle>
              </CardHeader>
              <CardContent>
                <SimpleLineChart data={skorTrendData} color="var(--chart-1)" valueFormatter={(v) => `${v}/3`} />
              </CardContent>
            </Card>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Kantong Ekivalen Produksi</CardTitle>
                </CardHeader>
                <CardContent>
                  <SimpleLineChart data={produksiTrendData} color="var(--chart-2)" height={160} />
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Jumlah Muat Distribusi</CardTitle>
                </CardHeader>
                <CardContent>
                  <SimpleLineChart data={muatanTrendData} color="var(--chart-3)" height={160} />
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Saldo Akhir Kas Kecil</CardTitle>
                </CardHeader>
                <CardContent>
                  <SimpleLineChart data={kasKecilTrendData} color="var(--chart-4)" height={160} valueFormatter={formatRupiah} />
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Kantong Ekivalen Masuk Bahan Baku</CardTitle>
                </CardHeader>
                <CardContent>
                  <SimpleLineChart data={bahanBakuTrendData} color="var(--chart-5)" height={160} />
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Tambah action di `src/app/mkesindo/(dashboard)/laporan/actions.ts`**

Tambah import setelah baris `import { setSaldoAwalKasKecil, upsertKasMasuk, tambahPengeluaran, hapusPengeluaran } from "@/lib/queries/kas-kecil";`:

```ts
import { getRingkasanLintasShift, type RingkasanShiftRow } from "@/lib/queries/laporan-ringkasan-lintas-shift";
```

Tambah fungsi baru di akhir file:

```ts
export async function getRingkasanLintasShiftAction(tahun: number, bulan: number): Promise<ActionResult<RingkasanShiftRow[]>> {
  return runAction(async () => {
    await requireModuleAccess("laporan");
    return getRingkasanLintasShift(tahun, bulan);
  });
}
```

- [ ] **Step 3: Wiring `src/components/dashboard/laporan-tab-shell.tsx`**

Tambah import:

```tsx
import { LaporanRingkasanLintasShift } from "@/components/dashboard/laporan-ringkasan-lintas-shift";
import type { RingkasanShiftRow } from "@/lib/queries/laporan-ringkasan-lintas-shift";
```

Ubah `LaporanTab` type:

```tsx
type LaporanTab = "stok-bahan-baku" | "aktivitas-produksi" | "aktivitas-muatan-distribusi" | "keuangan-operasional" | "ringkasan-lintas-shift";
```

Tambah props baru ke `LaporanTabShell` (di samping semua props Tahap 1-4 yang sudah ada — JANGAN hapus satu pun):

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
  kasKecilCurrent,
  kasKecilInitialRow,
  kasKecilInitialHistory,
  kasKecilInitialSaldoAwal,
  ringkasanTahunAwal,
  ringkasanBulanAwal,
  ringkasanRowsAwal,
  timNamaMap,
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
  kasKecilCurrent: CurrentShiftKasKecilInfo;
  kasKecilInitialRow: KasKecilShiftRow;
  kasKecilInitialHistory: KasKecilShiftRow[];
  kasKecilInitialSaldoAwal: number;
  ringkasanTahunAwal: number;
  ringkasanBulanAwal: number;
  ringkasanRowsAwal: RingkasanShiftRow[];
  timNamaMap: Record<number, string>;
}) {
  const [tab, setTab] = useState<LaporanTab>("stok-bahan-baku");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
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
        <Button size="sm" variant={tab === "keuangan-operasional" ? "default" : "outline"} onClick={() => setTab("keuangan-operasional")}>
          Keuangan Operasional
        </Button>
        <Button size="sm" variant={tab === "ringkasan-lintas-shift" ? "default" : "outline"} onClick={() => setTab("ringkasan-lintas-shift")}>
          Ringkasan Lintas Shift
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
      <div className={cn(tab !== "keuangan-operasional" && "hidden")}>
        <LaporanKasKecil
          canEdit={canEdit}
          canEditSaldoAwal={canEditSaldoAwal}
          current={kasKecilCurrent}
          initialRow={kasKecilInitialRow}
          initialHistory={kasKecilInitialHistory}
          initialSaldoAwal={kasKecilInitialSaldoAwal}
          namaMap={namaMap}
        />
      </div>
      <div className={cn(tab !== "ringkasan-lintas-shift" && "hidden")}>
        <LaporanRingkasanLintasShift
          tahunAwal={ringkasanTahunAwal}
          bulanAwal={ringkasanBulanAwal}
          rowsAwal={ringkasanRowsAwal}
          namaMap={namaMap}
          timNamaMap={timNamaMap}
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
import { getSaldoAwalKasKecil, getKasKecilHistory, getCurrentShiftKasKecil } from "@/lib/queries/kas-kecil";
import { getRingkasanLintasShift } from "@/lib/queries/laporan-ringkasan-lintas-shift";
import { getAllTim } from "@/lib/queries/tim-produksi";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { getReportShift } from "@/lib/report-shift";
import { LaporanTabShell } from "@/components/dashboard/laporan-tab-shell";

export const metadata: Metadata = { title: "Laporan" };

export default async function LaporanPage() {
  const session = await requireModuleAccess("laporan");
  const canEdit = canAccessAllPT(session.user) || !!session.user.permissions.laporan?.canEdit;
  const canEditSaldoAwal = canAccessAllPT(session.user);

  const { businessDate } = getReportShift("work");
  const tahunAwal = businessDate.getUTCFullYear();
  const bulanAwal = businessDate.getUTCMonth() + 1;

  const [
    { current, rows },
    history,
    saldoAwal,
    aktivitasRiwayat,
    muatanDistribusiRowsAwal,
    kasKecilSaldoAwal,
    kasKecilHistory,
    kasKecilCurrentShift,
    ringkasanRowsAwal,
    timList,
  ] = await Promise.all([
    getCurrentShiftRows(),
    getStokBahanBakuHistory(),
    getSaldoAwal(),
    getAktivitasRiwayat(),
    getAktivitasMuatanDistribusi(tahunAwal, bulanAwal),
    getSaldoAwalKasKecil(),
    getKasKecilHistory(),
    getCurrentShiftKasKecil(),
    getRingkasanLintasShift(tahunAwal, bulanAwal),
    getAllTim(),
  ]);

  const akunIds = [
    ...[...rows, ...history].flatMap((r) => [r.operasionalAkunId, r.produksiAkunId]),
    ...aktivitasRiwayat.map((r) => r.stafOperasionalAkunId),
    ...kasKecilHistory.map((r) => r.diisiOlehAkunId),
    ...ringkasanRowsAwal.map((r) => r.produksiStafOperasionalAkunId),
  ].filter((id): id is number => id != null);
  const namaMap = await getAkunNamaMap(akunIds);
  const timNamaMap = Object.fromEntries(timList.map((t) => [t.timId, t.nama]));

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
        muatanDistribusiTahunAwal={tahunAwal}
        muatanDistribusiBulanAwal={bulanAwal}
        muatanDistribusiRowsAwal={muatanDistribusiRowsAwal}
        kasKecilCurrent={kasKecilCurrentShift.current}
        kasKecilInitialRow={kasKecilCurrentShift.row}
        kasKecilInitialHistory={kasKecilHistory}
        kasKecilInitialSaldoAwal={kasKecilSaldoAwal}
        ringkasanTahunAwal={tahunAwal}
        ringkasanBulanAwal={bulanAwal}
        ringkasanRowsAwal={ringkasanRowsAwal}
        timNamaMap={timNamaMap}
      />
    </div>
  );
}
```

Catatan: variabel `muatanDistribusiTahunAwal`/`muatanDistribusiBulanAwal` yang sudah ada sebelumnya diganti nama jadi `tahunAwal`/`bulanAwal` (dipakai bersama oleh Muatan Distribusi DAN Ringkasan Lintas Shift, karena keduanya kebetulan sama-sama "bulan berjalan saat halaman dimuat") — nilai yang dikirim ke prop `muatanDistribusiTahunAwal`/`muatanDistribusiBulanAwal` pada `LaporanTabShell` tetap sama seperti sebelumnya, hanya nama variabel lokalnya yang berubah.

- [ ] **Step 5: Verifikasi build & manual**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint "src/app/mkesindo/(dashboard)/laporan/actions.ts" src/components/dashboard/laporan-tab-shell.tsx "src/app/mkesindo/(dashboard)/laporan/page.tsx"`
Expected: tidak ada error.

Buka `/mkesindo/laporan`, klik tab "Ringkasan Lintas Shift". Konfirmasi Kartu Detail Shift tampil untuk shift berjalan (skor kelengkapan + 4 sub-kartu), navigasi mundur/maju shift bekerja dalam bulan yang dimuat, dan Grafik Tren (1 grafik skor + 4 grafik mini) tampil di bawahnya dengan navigasi bulan bekerja. Konfirmasi 4 tab lain (Stok Bahan Baku, Aktivitas Produksi, Aktivitas Muatan Distribusi, Keuangan Operasional) masih berfungsi normal seperti sebelumnya.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/laporan-ringkasan-lintas-shift.tsx "src/app/mkesindo/(dashboard)/laporan/actions.ts" src/components/dashboard/laporan-tab-shell.tsx "src/app/mkesindo/(dashboard)/laporan/page.tsx"
git commit -m "feat: add Ringkasan Lintas Shift tab to /mkesindo/laporan"
```
