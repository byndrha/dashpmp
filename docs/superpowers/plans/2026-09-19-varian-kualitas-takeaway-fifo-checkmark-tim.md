# Varian Kualitas 5KG/10KG, Penautan TakeAway-FIFO, dan 3 Ikon Centang Validasi Tim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan field Varian (10kg/5kg) ke Cek Kualitas, hubungkan alur TakeAway ke stok Kualitas/Pallet secara FIFO saat Selesai Muat, lalu tampilkan 3 ikon centang validasi (Kualitas semua mesin / Pallet lengkap / Muatan) di kotak huruf Tim pada kalender Jadwal Tim Produksi.

**Architecture:** Perubahan skema MSSQL dijalankan langsung lewat script sekali-pakai (tidak ada framework migrasi di repo ini). Query/tipe di `src/lib/queries/*` diperluas dulu (fondasi), baru actions.ts dan komponen UI menyusul. TakeAway FIFO adalah fungsi baru yang dipanggil dari dalam transaksi SQL yang sudah ada di `takeAwaySelesaiMuat`, bukan alur terpisah.

**Tech Stack:** Next.js 16 App Router, TypeScript, `mssql` (tedious) via `getPool()`, Tailwind, `tsx` untuk menjalankan script sekali-pakai terhadap DB live.

**Spec:** [docs/superpowers/specs/2026-09-19-varian-kualitas-takeaway-fifo-checkmark-tim-design.md](../specs/2026-09-19-varian-kualitas-takeaway-fifo-checkmark-tim-design.md)

## Global Constraints

- Semua UI dan pesan error berbahasa Indonesia.
- Konversi 5KG→10KG-ekivalen selalu `qty / 2.0`, hanya di lapisan tampilan/agregasi — data mentah (`Qty10KG` pada baris `Variant='5kg'`) tetap jumlah kantong 5KG asli, tidak pernah disimpan sudah terkonversi.
- Nilai kolom `Variant` (baik di `DashboardProduksiKualitas` maupun yang sudah ada di `DashboardTakeAwayMuatan`) memakai casing **lowercase** `"10kg"` / `"5kg"` — sama persis dengan `KantongVariant` (`src/lib/queries/sales-order.ts`), supaya kedua tabel bisa dibandingkan langsung tanpa mapping/konversi casing.
- Data `DashboardProduksiKualitas` historis (sebelum kolom `Variant` ada) dianggap `'10kg'` — dilakukan lewat `DEFAULT` constraint saat `ALTER TABLE`, bukan `UPDATE` terpisah.
- Varian `5kg` TIDAK PERNAH masuk ke `DashboardProduksiBatch` (pallet) — ini aturan bisnis permanen, bukan sekadar kondisi awal.
- Pengurangan stok TakeAway terjadi di **Selesai Muat** (bukan Mulai Muat), di dalam transaksi SQL yang sama dengan pembuatan DeliveryOrder/SalesInvoice yang sudah ada.
- FIFO Kualitas-belum-dipallet: **terbaru dulu** (`ORDER BY TanggalLabel DESC, Waktu DESC`). FIFO Pallet/Batch: **tertua dulu** (`ORDER BY TanggalLabel ASC, JamPanen ASC`) — dua arah yang berbeda, jangan disamakan.
- Tidak ada framework/folder migrasi di repo ini — perubahan skema dijalankan lewat script `scripts/_scratch_*.ts` sekali jalan (via `npx tsx`), diverifikasi live, lalu **dihapus** (tidak pernah di-commit) — konvensi yang sudah berlaku di seluruh sesi kerja repo ini.
- Tidak ada test suite otomatis di repo ini. Setiap task diverifikasi dengan `npx tsc --noEmit`, `npx eslint <file berubah>`, script scratch DB untuk logika query/transaksi, dan klik-coba langsung di browser (Browser pane) untuk perubahan UI.

---

## File Structure

**Skema (dijalankan lalu dihapus, tidak masuk daftar file permanen):**
- `scripts/_scratch_schema_varian_takeaway.ts` — `ALTER TABLE DashboardProduksiKualitas ADD Variant`, `CREATE TABLE DashboardTakeAwayAlokasi`.

**Query & tipe (diperluas):**
- `src/lib/queries/produksi-kualitas.ts` — tambah `Variant` ke `KualitasRow`/`CreateKualitasInput`, `SisaAlokasi` ikut mengurangi `DashboardTakeAwayAlokasi`.
- `src/lib/queries/produksi-riwayat-detail.ts` — tambah `variant` ke `RiwayatKualitasEntry`, `sisaBelumDialokasikan` ikut mengurangi `DashboardTakeAwayAlokasi`, statistik header dipecah per varian.
- `src/lib/queries/produksi-korelasi-penjualan.ts` — tambah `totalProduksi5KG`/`totalProduksiGabungan` ke `KorelasiShiftRow`/`KorelasiProduksiPenjualanData`.
- `src/lib/korelasi-format.ts` — `KorelasiRingkasan` tambah field 5KG/gabungan.

**Query & tipe (baru):**
- `src/lib/queries/takeaway-alokasi.ts` — `allocateTakeAwayStock` (algoritma FIFO), dipanggil dari `takeaway-muatan.ts`.
- `src/lib/queries/produksi-validasi-tim.ts` — `getValidasiBulan` (data 3 centang).

**Modifikasi lain:**
- `src/lib/queries/takeaway-muatan.ts` — `takeAwaySelesaiMuat` memanggil `allocateTakeAwayStock` di dalam transaksi yang sudah ada.
- `src/app/mkesindo/produksi/actions.ts` — action baru untuk `getValidasiBulan`; `createKualitasAction` diteruskan `variant`.
- `src/components/produksi-app/kualitas-view.tsx` — form tambah pilihan Varian, `KualitasCard` menampilkan badge varian.
- `src/components/produksi/korelasi-produksi-penjualan-panel.tsx` — kotak ringkasan + tabel menampilkan split 10KG/5KG/Gabungan.
- `src/components/produksi/riwayat-shift-group-card.tsx` — badge varian per entri, statistik header dipecah.
- `src/components/produksi/jadwal-tim-bulanan.tsx` — Ringkasan per-tanggal dipecah per varian; `TimBadge` mendapat 3 titik centang (Opsi A) + data validasi bulan + `page.tsx` meneruskannya.
- `src/app/mkesindo/(dashboard)/produksi/page.tsx` — panggil `getValidasiBulan` di samping `getJadwalBulan`, teruskan ke `JadwalDanRiwayatProduksi`/`JadwalTimBulanan`.
- `src/components/produksi/jadwal-dan-riwayat-produksi.tsx` — teruskan prop validasi bulan ke `JadwalTimBulanan`.

---

### Task 1: Skema — kolom Variant & tabel DashboardTakeAwayAlokasi

**Files:**
- Create (sementara, dihapus di Step 4): `scripts/_scratch_schema_varian_takeaway.ts`

**Interfaces:**
- Produces: kolom `DashboardProduksiKualitas.Variant VARCHAR(8) NOT NULL DEFAULT '10kg'`; tabel `DashboardTakeAwayAlokasi(TakeAwayAlokasiID, TakeAwayMuatanID, SumberTipe, KualitasID, BatchID, Qty, CreatedDate)`.

- [ ] **Step 1: Tulis script skema**

```typescript
// scripts/_scratch_schema_varian_takeaway.ts
import { getPool } from "@/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('DashboardProduksiKualitas') AND name = 'Variant'
    )
    BEGIN
      ALTER TABLE DashboardProduksiKualitas
        ADD Variant VARCHAR(8) NOT NULL CONSTRAINT DF_DashboardProduksiKualitas_Variant DEFAULT '10kg';
    END
  `);
  console.log("Kolom Variant OK.");

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DashboardTakeAwayAlokasi')
    BEGIN
      CREATE TABLE DashboardTakeAwayAlokasi (
        TakeAwayAlokasiID INT IDENTITY PRIMARY KEY,
        TakeAwayMuatanID INT NOT NULL REFERENCES DashboardTakeAwayMuatan(TakeAwayMuatanID),
        SumberTipe VARCHAR(10) NOT NULL,
        KualitasID INT NULL REFERENCES DashboardProduksiKualitas(KualitasID),
        BatchID INT NULL REFERENCES DashboardProduksiBatch(BatchID),
        Qty INT NOT NULL,
        CreatedDate DATETIME NOT NULL DEFAULT GETDATE()
      );
    END
  `);
  console.log("Tabel DashboardTakeAwayAlokasi OK.");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Jalankan script terhadap DB live**

Run: `npx tsx scripts/_scratch_schema_varian_takeaway.ts`
Expected: Mencetak `Kolom Variant OK.` lalu `Tabel DashboardTakeAwayAlokasi OK.`, exit code 0. Kalau `@/lib/db` tidak ter-resolve oleh `tsx` (path alias), ganti importnya jadi relatif: `import { getPool } from "../src/lib/db";`.

- [ ] **Step 3: Verifikasi live lewat query manual**

Jalankan (bisa lewat script sementara yang sama atau tool SQL manapun yang tersedia di sesi):
```sql
SELECT TOP 3 KualitasID, Variant FROM DashboardProduksiKualitas ORDER BY KualitasID DESC;
SELECT * FROM DashboardTakeAwayAlokasi;
```
Expected: kolom `Variant` muncul berisi `'10kg'` untuk baris lama; `DashboardTakeAwayAlokasi` ada dan kosong.

- [ ] **Step 4: Hapus script sekali-pakai (tidak di-commit)**

```bash
rm scripts/_scratch_schema_varian_takeaway.ts
```

- [ ] **Step 5: Commit (tidak ada file kode yang berubah di step ini — lewati commit, lanjut ke Task 2)**

Tidak ada `git commit` untuk task ini — perubahan skema tidak meninggalkan jejak file. Task 2 akan jadi commit pertama yang membawa skema ini menjadi berguna.

---

### Task 2: Varian Kualitas end-to-end (query, action, form, tampilan riwayat produksi-app)

**Files:**
- Modify: `src/lib/queries/produksi-kualitas.ts`
- Modify: `src/app/mkesindo/produksi/actions.ts:319-331` (`createKualitasAction`)
- Modify: `src/components/produksi-app/kualitas-view.tsx`

**Interfaces:**
- Consumes: kolom `Variant` dari Task 1.
- Produces: `KualitasRow.variant: "10kg" | "5kg"`, `CreateKualitasInput.variant: "10kg" | "5kg"` — dipakai Task 5/6/7/8/9 berikutnya untuk membedakan 10kg vs 5kg.

- [ ] **Step 1: Tambah `Variant` ke tipe & query `produksi-kualitas.ts`**

Ubah `src/lib/queries/produksi-kualitas.ts`:

```typescript
import { getPool, sql } from "@/lib/db";
import type { KantongVariant } from "@/lib/queries/sales-order";

export interface KualitasRow {
  KualitasID: number;
  TanggalLabel: string;
  Waktu: string;
  Shift: 1 | 2 | 3;
  MesinID: number;
  MesinNama: string;
  Variant: KantongVariant;
  CekKejernihan: boolean;
  CekUkuranBentuk: boolean;
  Qty10KG: number | null;
  DiameterDalamMm: number | null;
  Catatan: string | null;
  FotoPath: string | null;
  FotoBeratKemasanPath: string | null;
  CreatedByUserID: string;
  CreatedDate: string;
  SisaAlokasi: number | null;
}

export async function getKualitasRiwayat(limit = 50): Promise<KualitasRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("limit", sql.Int, limit).query(`
      SELECT TOP (@limit) k.KualitasID, k.TanggalLabel, k.Waktu, k.Shift, k.MesinID, m.Nama AS MesinNama,
             k.Variant, k.CekKejernihan, k.CekUkuranBentuk, k.Qty10KG, k.DiameterDalamMm, k.Catatan, k.FotoPath,
             k.FotoBeratKemasanPath, k.CreatedByUserID, k.CreatedDate,
             ISNULL(alok.TotalTeralokasi, 0) AS TotalTeralokasi
      FROM DashboardProduksiKualitas k
      LEFT JOIN DashboardProduksiMesin m ON m.MesinID = k.MesinID
      OUTER APPLY (
        SELECT
          ISNULL((SELECT SUM(b.Qty10KG) FROM DashboardProduksiBatch b WHERE b.KualitasID = k.KualitasID AND b.IsDeleted = 0), 0) +
          ISNULL((SELECT SUM(ta.Qty) FROM DashboardTakeAwayAlokasi ta WHERE ta.KualitasID = k.KualitasID AND ta.SumberTipe = 'KUALITAS'), 0)
          AS TotalTeralokasi
      ) alok
      ORDER BY k.CreatedDate DESC
    `);
  return (
    result.recordset as (Omit<KualitasRow, "TanggalLabel" | "CreatedDate" | "SisaAlokasi"> & {
      TanggalLabel: Date;
      CreatedDate: Date;
      TotalTeralokasi: number;
    })[]
  ).map((r) => ({
    ...r,
    TanggalLabel: r.TanggalLabel.toISOString().slice(0, 10),
    CreatedDate: r.CreatedDate.toISOString(),
    SisaAlokasi: r.Qty10KG == null ? null : Math.max(0, r.Qty10KG - r.TotalTeralokasi),
  }));
}

export interface CreateKualitasInput {
  tanggalLabel: string;
  waktu: string;
  shift: 1 | 2 | 3;
  mesinId: number;
  variant: KantongVariant;
  cekKejernihan: boolean;
  cekUkuranBentuk: boolean;
  qty10KG: number;
  diameterDalamMm: number | null;
  catatan: string | null;
  fotoPath: string | null;
  fotoBeratKemasanPath: string | null;
  dicatatOlehUserId: string;
}

export async function createKualitas(input: CreateKualitasInput): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("tanggalLabel", sql.Date, input.tanggalLabel)
    .input("waktu", sql.VarChar(5), input.waktu)
    .input("shift", sql.TinyInt, input.shift)
    .input("mesinId", sql.Int, input.mesinId)
    .input("variant", sql.VarChar(8), input.variant)
    .input("cekKejernihan", sql.Bit, input.cekKejernihan)
    .input("cekUkuranBentuk", sql.Bit, input.cekUkuranBentuk)
    .input("qty10KG", sql.Int, input.qty10KG)
    .input("diameterDalamMm", sql.Decimal(5, 1), input.diameterDalamMm)
    .input("catatan", sql.NVarChar(500), input.catatan)
    .input("fotoPath", sql.VarChar(256), input.fotoPath)
    .input("fotoBeratKemasanPath", sql.VarChar(256), input.fotoBeratKemasanPath)
    .input("userId", sql.VarChar(16), input.dicatatOlehUserId).query(`
      INSERT INTO DashboardProduksiKualitas
        (TanggalLabel, Waktu, Shift, MesinID, Variant, CekKejernihan, CekUkuranBentuk, Qty10KG, DiameterDalamMm, Catatan, FotoPath, FotoBeratKemasanPath, CreatedByUserID)
      OUTPUT INSERTED.KualitasID
      VALUES
        (@tanggalLabel, @waktu, @shift, @mesinId, @variant, @cekKejernihan, @cekUkuranBentuk, @qty10KG, @diameterDalamMm, @catatan, @fotoPath, @fotoBeratKemasanPath, @userId)
    `);
  return (result.recordset[0] as { KualitasID: number }).KualitasID;
}
```

(`OUTER APPLY` tanpa korelasi eksplisit tetap valid T-SQL karena subquery di dalamnya sendiri sudah berkorelasi ke `k.KualitasID`.)

- [ ] **Step 2: Perbarui `createKualitasAction`**

Di `src/app/mkesindo/produksi/actions.ts:319-331`, `Omit<CreateKualitasInput, "dicatatOlehUserId">` otomatis ikut membawa `variant` karena sudah bagian dari `CreateKualitasInput` — tidak ada perubahan kode diperlukan di sini selain memastikan validasi tetap jalan. Tambahkan satu baris validasi:

```typescript
export async function createKualitasAction(
  input: Omit<CreateKualitasInput, "dicatatOlehUserId">
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    if (!input.mesinId) throw new AppError("Pilih mesin yang dipakai.");
    if (!input.waktu) throw new AppError("Isi waktu pemeriksaan.");
    if (input.variant !== "10kg" && input.variant !== "5kg") throw new AppError("Pilih varian 10kg atau 5kg.");
    if (!input.qty10KG || input.qty10KG <= 0) throw new AppError("Isi QTY Kantong Es.");
    const kualitasId = await createKualitas({ ...input, dicatatOlehUserId: session.user.id });
    revalidatePath("/mkesindo/produksi-app");
    return kualitasId;
  });
}
```

- [ ] **Step 3: Tambah pilihan Varian di form `kualitas-view.tsx`**

Tambah state dan import di bagian atas `TambahKualitasDialog`:

```typescript
import type { KantongVariant } from "@/lib/queries/sales-order";
```

```typescript
const [variant, setVariant] = useState<KantongVariant>("10kg");
```

Reset di `reset()` (cari fungsi `reset` yang sudah memanggil `setDiameterDalamMm("")` dkk — tambahkan satu baris `setVariant("10kg");` di situ).

Sisipkan blok pilihan Varian tepat setelah blok tombol Shift (`</div>` penutup `<div className="col-span-2 grid grid-cols-3">...SHIFT_OPTIONS...</div>`) dan sebelum grid pemilihan Mesin:

```tsx
<div className="grid grid-cols-2 gap-2">
  <Button type="button" variant={variant === "10kg" ? "default" : "outline"} onClick={() => setVariant("10kg")}>
    10 KG
  </Button>
  <Button type="button" variant={variant === "5kg" ? "default" : "outline"} onClick={() => setVariant("5kg")}>
    5 KG
  </Button>
</div>
```

Ubah label field qty (baris `<label ...>QTY 10 KG Kantong Es</label>`) jadi dinamis:

```tsx
<label className="text-xs font-medium text-muted-foreground">
  QTY Kantong Es ({variant === "10kg" ? "10 KG" : "5 KG"})
</label>
```

Teruskan `variant` di `handleSubmit`'s `createKualitasAction({...})` call (tambahkan `variant,` di object literal-nya).

- [ ] **Step 4: Tampilkan badge Varian di `KualitasCard`**

Di `KualitasCard` (fungsi yang sama di file ini), ubah baris qty jadi menyertakan varian, dan tambahkan badge di baris checklist:

```tsx
<div className="mt-2 flex flex-wrap gap-1.5">
  <span className="rounded px-2 py-0.5 text-[11px] font-medium bg-sky-500/15 text-sky-600">
    {kualitas.Variant === "10kg" ? "10 KG" : "5 KG"}
  </span>
  {items.map((i) => (
    // ...unchanged...
  ))}
</div>
```

Dan baris qty:

```tsx
{kualitas.Qty10KG != null &&
  `QTY: ${kualitas.Qty10KG} kantong ${kualitas.Variant === "10kg" ? "10kg" : "5kg"} (sisa ${kualitas.SisaAlokasi})`}
```

- [ ] **Step 5: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/produksi-kualitas.ts src/app/mkesindo/produksi/actions.ts src/components/produksi-app/kualitas-view.tsx`
Expected: tidak ada error.

- [ ] **Step 6: Verifikasi live di browser**

Buka `/mkesindo/produksi-app` tab Kualitas, buat satu entri baru dengan varian 5 KG, satu lagi dengan 10 KG. Pastikan keduanya muncul di daftar riwayat dengan badge varian yang benar dan label QTY yang sesuai.

- [ ] **Step 7: Commit**

```bash
git add src/lib/queries/produksi-kualitas.ts src/app/mkesindo/produksi/actions.ts src/components/produksi-app/kualitas-view.tsx
git commit -m "feat: tambah varian 10kg/5kg pada Cek Kualitas produksi"
```

---

### Task 3: Fungsi FIFO `allocateTakeAwayStock`

**Files:**
- Create: `src/lib/queries/takeaway-alokasi.ts`

**Interfaces:**
- Consumes: `sql.Transaction` yang sudah dibuka pemanggil (dari `takeaway-muatan.ts`, Task 4), `KantongVariant` dari `sales-order.ts`.
- Produces: `allocateTakeAwayStock(transaction: sql.Transaction, takeAwayMuatanId: number, variant: KantongVariant, qtyDibutuhkan: number): Promise<void>` — throw `AppError` kalau stok tidak cukup (transaksi di-rollback oleh pemanggil).

- [ ] **Step 1: Tulis fungsi FIFO**

```typescript
// src/lib/queries/takeaway-alokasi.ts
import sql from "mssql";
import { AppError } from "@/lib/action-result";
import type { KantongVariant } from "@/lib/queries/sales-order";

// Mengurangi stok yang tepat untuk satu TakeAwayMuatan saat Selesai Muat --
// urutan sumber: (1) DashboardProduksiKualitas varian SAMA yang belum
// dipallet, TERBARU dulu; (2) khusus varian 10kg kalau masih kurang,
// DashboardProduksiBatch (pallet), TERTUA dulu -- 5kg tidak pernah sampai
// ke sumber ini karena pallet tidak pernah berisi 5kg. Menulis jejak ke
// DashboardTakeAwayAlokasi untuk tiap sumber yang disentuh. Lihat spec
// docs/superpowers/specs/2026-09-19-varian-kualitas-takeaway-fifo-checkmark-tim-design.md
// Bagian 3.
export async function allocateTakeAwayStock(
  transaction: sql.Transaction,
  takeAwayMuatanId: number,
  variant: KantongVariant,
  qtyDibutuhkan: number
): Promise<void> {
  let sisaDibutuhkan = qtyDibutuhkan;

  // Sumber 1: Kualitas varian sama, belum dipallet, terbaru dulu.
  // WITH (UPDLOCK, HOLDLOCK) mengunci baris yang dibaca sampai transaksi
  // ini commit/rollback -- dua TakeAway konkuren tidak bisa berebut sisa
  // yang sama, pola sama seperti lock di createBatch (produksi-warehouse.ts).
  const kualitasResult = await new sql.Request(transaction).input("variant", sql.VarChar(8), variant).query(`
    SELECT k.KualitasID, k.Qty10KG,
           k.Qty10KG
             - ISNULL((SELECT SUM(b.Qty10KG) FROM DashboardProduksiBatch b WITH (UPDLOCK, HOLDLOCK) WHERE b.KualitasID = k.KualitasID AND b.IsDeleted = 0), 0)
             - ISNULL((SELECT SUM(ta.Qty) FROM DashboardTakeAwayAlokasi ta WITH (UPDLOCK, HOLDLOCK) WHERE ta.KualitasID = k.KualitasID AND ta.SumberTipe = 'KUALITAS'), 0)
             AS Sisa
    FROM DashboardProduksiKualitas k WITH (UPDLOCK, HOLDLOCK)
    WHERE k.Variant = @variant AND k.Qty10KG IS NOT NULL
    ORDER BY k.TanggalLabel DESC, k.Waktu DESC
  `);

  for (const row of kualitasResult.recordset as { KualitasID: number; Sisa: number }[]) {
    if (sisaDibutuhkan <= 0) break;
    const sisa = Math.max(0, row.Sisa);
    if (sisa <= 0) continue;
    const ambil = Math.min(sisa, sisaDibutuhkan);
    await new sql.Request(transaction)
      .input("takeAwayMuatanId", sql.Int, takeAwayMuatanId)
      .input("kualitasId", sql.Int, row.KualitasID)
      .input("qty", sql.Int, ambil).query(`
        INSERT INTO DashboardTakeAwayAlokasi (TakeAwayMuatanID, SumberTipe, KualitasID, Qty)
        VALUES (@takeAwayMuatanId, 'KUALITAS', @kualitasId, @qty)
      `);
    sisaDibutuhkan -= ambil;
  }

  // Sumber 2: HANYA varian 10kg, kalau masih kurang -- Pallet, tertua dulu.
  if (sisaDibutuhkan > 0 && variant === "10kg") {
    const batchResult = await new sql.Request(transaction).query(`
      SELECT BatchID, SisaQty10KG
      FROM DashboardProduksiBatch WITH (UPDLOCK, HOLDLOCK)
      WHERE IsDeleted = 0 AND SisaQty10KG > 0
      ORDER BY TanggalLabel ASC, JamPanen ASC
    `);

    for (const row of batchResult.recordset as { BatchID: number; SisaQty10KG: number }[]) {
      if (sisaDibutuhkan <= 0) break;
      const ambil = Math.min(row.SisaQty10KG, sisaDibutuhkan);
      const claim = await new sql.Request(transaction)
        .input("batchId", sql.Int, row.BatchID)
        .input("qty", sql.Int, ambil).query(`
          UPDATE DashboardProduksiBatch
          SET SisaQty10KG = SisaQty10KG - @qty, ModifiedDate = GETDATE()
          OUTPUT INSERTED.SisaQty10KG
          WHERE BatchID = @batchId AND SisaQty10KG >= @qty
        `);
      if (claim.recordset.length === 0) continue; // batch keburu diambil transaksi lain, coba batch berikutnya
      await new sql.Request(transaction)
        .input("takeAwayMuatanId", sql.Int, takeAwayMuatanId)
        .input("batchId", sql.Int, row.BatchID)
        .input("qty", sql.Int, ambil).query(`
          INSERT INTO DashboardTakeAwayAlokasi (TakeAwayMuatanID, SumberTipe, BatchID, Qty)
          VALUES (@takeAwayMuatanId, 'BATCH', @batchId, @qty)
        `);
      sisaDibutuhkan -= ambil;
    }
  }

  if (sisaDibutuhkan > 0) {
    throw new AppError("Stok tidak cukup untuk menyelesaikan TakeAway ini.");
  }
}
```

- [ ] **Step 2: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/takeaway-alokasi.ts`
Expected: tidak ada error.

- [ ] **Step 3: Verifikasi logika lewat script scratch terhadap DB live**

Tulis `scripts/_scratch_test_fifo.ts` sementara yang membuka `getPool()`, membuka `new sql.Transaction(pool)`, memanggil `allocateTakeAwayStock(transaction, <TakeAwayMuatanID uji yang benar-benar ada>, "10kg", <qty kecil, mis. 1>)`, lalu `transaction.rollback()` di akhir (JANGAN commit -- ini murni uji baca+lock, bukan untuk benar-benar mengubah data). Cetak isi `DashboardTakeAwayAlokasi` yang HENDAK ditulis (log sebelum insert, atau baca ulang di transaksi yang sama sebelum rollback) untuk memastikan sumbernya masuk akal (Kualitas dulu, baru Batch kalau kurang). Hapus script ini setelah selesai (tidak di-commit).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/takeaway-alokasi.ts
git commit -m "feat: tambah fungsi FIFO alokasi stok TakeAway dari Kualitas/Pallet"
```

---

### Task 4: Integrasikan FIFO ke `takeAwaySelesaiMuat`

**Files:**
- Modify: `src/lib/queries/takeaway-muatan.ts:227-434` (`takeAwaySelesaiMuat`)

**Interfaces:**
- Consumes: `allocateTakeAwayStock` (Task 3).
- Produces: `takeAwaySelesaiMuat` sekarang menolak (throw `AppError`) kalau stok tidak cukup, sebelum dokumen DO/SI dibuat.

- [ ] **Step 1: Ganti seluruh fungsi `takeAwaySelesaiMuat` supaya berjalan dalam satu transaksi dan memanggil `allocateTakeAwayStock`**

Ganti SELURUH isi fungsi `takeAwaySelesaiMuat` (baris 227-434 saat ini, dari `export async function takeAwaySelesaiMuat` sampai penutup `}` fungsi ini) dengan versi berikut. Ini modifikasi dari fungsi yang sudah ada: query pembuatan dokumen (`soResult`, `sodResult`, INSERT `DeliveryOrder`/`DeliveryOrderDetail`/`SalesInvoice`/`SalesInvoiceDetail`, UPDATE `SalesOrder`/`DeliveryOrder`/`DashboardTakeAwayMuatan`) TETAP SAMA PERSIS isinya, hanya setiap `pool.request()` diganti `new sql.Request(transaction)`, dan blok `catch` lama yang menghapus baris secara manual dihapus (rollback transaksi sudah membatalkan semuanya sekaligus):

```typescript
export async function takeAwaySelesaiMuat(
  takeAwayMuatanId: number,
  dicatatOlehAkunId: number
): Promise<TakeAwaySelesaiMuatResult> {
  const pool = await getPool();

  const muatanResult = await pool
    .request()
    .input("id", sql.Int, takeAwayMuatanId)
    .query(
      `SELECT SalesOrderID, Variant, QtyDipesan, JamMulaiMuat, JamSelesaiMuat FROM DashboardTakeAwayMuatan WHERE TakeAwayMuatanID = @id AND IsDeleted = 0`
    );
  const muatan = muatanResult.recordset[0] as
    | { SalesOrderID: string; Variant: KantongVariant; QtyDipesan: number; JamMulaiMuat: Date | null; JamSelesaiMuat: Date | null }
    | undefined;
  if (!muatan) throw new AppError("Order TakeAway ini tidak ditemukan.");
  if (!muatan.JamMulaiMuat) throw new AppError("Mulai Muat belum dilakukan untuk order ini.");
  if (muatan.JamSelesaiMuat) throw new AppError("Order TakeAway ini sudah selesai dimuat.");

  const salesOrderId = muatan.SalesOrderID;

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await allocateTakeAwayStock(transaction, takeAwayMuatanId, muatan.Variant, muatan.QtyDipesan);

    const soResult = await new sql.Request(transaction)
      .input("soId", sql.VarChar(16), salesOrderId)
      .query(`SELECT BusinessPartnerID, DueDate, TermOfPaymentID FROM SalesOrder WHERE SalesOrderID = @soId`);
    const so = soResult.recordset[0] as { BusinessPartnerID: string; DueDate: Date; TermOfPaymentID: string } | undefined;
    if (!so) throw new AppError("Sales Order tidak ditemukan.");

    const sodResult = await new sql.Request(transaction)
      .input("soId", sql.VarChar(16), salesOrderId)
      .query(`SELECT SalesOrderDetailID, ItemID, Name, Qty, Unit, Price, Amount FROM SalesOrderDetail WHERE SalesOrderID = @soId`);
    const soDetails = sodResult.recordset as {
      SalesOrderDetailID: string;
      ItemID: string;
      Name: string;
      Qty: number;
      Unit: string;
      Price: number;
      Amount: number;
    }[];
    const totalAmount = soDetails.reduce((sum, d) => sum + d.Amount, 0);

    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const deliveryOrderId = await nextDeliveryOrderId(pool);
    const doVoucherSeq = await nextDOVoucherSeq(pool, yearMonth);
    const doVoucherNo = `MKE/DO/${doVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
    await new sql.Request(transaction)
      .input("id", sql.VarChar(16), deliveryOrderId)
      .input("voucherNo", sql.VarChar(128), doVoucherNo)
      .input("branchId", sql.VarChar(16), BRANCH_ID)
      .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
      .input("bpId", sql.VarChar(16), so.BusinessPartnerID)
      .input("soId", sql.VarChar(16), salesOrderId)
      .input("salesmanId", sql.VarChar(16), TAKEAWAY_SALESMAN_ID)
      .input("transDate", sql.DateTime, getNaiveWibTransDate())
      .input("dueDate", sql.DateTime, so.DueDate).query(`
        INSERT INTO DeliveryOrder
          (DeliveryOrderID, VoucherNo, TransDate, BranchID, DepartmentID, BusinessPartnerID, Notes, SalesOrderID,
           IsClosed, ExpeditionID, VehicleNo, AddressDelivery, IsDeleted, ModifiedDate, PIC, ShippingNo,
           BusinessPartnerLocationID, IsInvoiced, CurrencyID, Rate, StatusForm, SalesmanID, OverLimit,
           ReferenceNo, DueDate, ProjectID, AddressDeliveryID, IsDOReturn)
        VALUES
          (@id, @voucherNo, @transDate, @branchId, @departmentId, @bpId, '', @soId,
           0, '', '', '', 0, GETDATE(), '', NULL,
           NULL, 0, '', 1, 1, @salesmanId, 0,
           '', @dueDate, '', '', NULL)
      `);

    for (const sod of soDetails) {
      const detailId = await nextDeliveryOrderDetailId(pool);
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), detailId)
        .input("doId", sql.VarChar(16), deliveryOrderId)
        .input("itemId", sql.VarChar(160), sod.ItemID)
        .input("name", sql.VarChar(160), sod.Name)
        .input("qty", sql.Decimal(23, 4), sod.Qty)
        .input("unit", sql.VarChar(8), sod.Unit)
        .input("price", sql.Decimal(23, 4), sod.Price)
        .input("amount", sql.Decimal(23, 4), sod.Amount)
        .input("soDetailId", sql.VarChar(16), sod.SalesOrderDetailID).query(`
          INSERT INTO DeliveryOrderDetail
            (DeliveryOrderDetailID, DeliveryOrderID, ItemID, Qty, Unit, UnitRatio, Ratio, Price, Disc, DiscValue,
             DiscRp, Amount, Delivered, Name, Outstanding, Description, Cashback, SalesOrderDetailID)
          VALUES
            (@id, @doId, @itemId, @qty, @unit, @qty, 1, @price, 0, NULL,
             0, @amount, @qty, @name, @qty, NULL, 0, @soDetailId)
        `);
    }

    const salesInvoiceId = await nextSalesInvoiceId(pool);
    const siVoucherSeq = await nextSIVoucherSeq(pool, yearMonth);
    const siVoucherNo = `MKE/SI/${siVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
    await new sql.Request(transaction)
      .input("id", sql.VarChar(16), salesInvoiceId)
      .input("voucherNo", sql.VarChar(128), siVoucherNo)
      .input("dueDate", sql.DateTime, so.DueDate)
      .input("termOfPaymentId", sql.VarChar(16), so.TermOfPaymentID)
      .input("soId", sql.VarChar(16), salesOrderId)
      .input("doId", sql.VarChar(16), `'${deliveryOrderId}'`)
      .input("bpId", sql.VarChar(16), so.BusinessPartnerID)
      .input("branchId", sql.VarChar(16), BRANCH_ID)
      .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
      .input("amount", sql.Decimal(23, 4), totalAmount)
      .input("transDate", sql.DateTime, getNaiveWibTransDate())
      .input("salesmanId", sql.VarChar(16), TAKEAWAY_SALESMAN_ID).query(`
        INSERT INTO SalesInvoice
          (SalesInvoiceID, VoucherNo, ReferenceNo, TaxNo, TransDate, DueDate, Notes, TermOfPaymentID,
           SalesOrderID, DeliveryOrderID, SalesDepositID, BusinessPartnerID, BranchID, DepartmentID,
           Amount, Disc, DiscValue, DiscRp, Tax, TaxValue, Netto, BankID, Paid, Deposit, PaidDate,
           IsClosed, IsDeleted, ModifiedDate, Rate, CurrencyID, IsAccountReceiveable, StatusForm,
           SalesmanID, ServiceTax, ServiceTaxValue, Visitor, IsTX, PromotionID, IsPerforma,
           DiscRpBefore, ProjectID, IsExported, BillOfQuantityID)
        VALUES
          (@id, @voucherNo, '', '', @transDate, @dueDate, '', @termOfPaymentId,
           @soId, @doId, '', @bpId, @branchId, @departmentId,
           @amount, 0, 0, 0, 0, 0, @amount, '', 0, 0, NULL,
           0, 0, GETDATE(), 1, '', 0, 1,
           @salesmanId, 0, 0, 0, 0, '', 0,
           0, '', 0, '')
      `);

    for (const sod of soDetails) {
      const detailId = await nextSalesInvoiceDetailId(pool);
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), detailId)
        .input("siId", sql.VarChar(16), salesInvoiceId)
        .input("itemId", sql.VarChar(160), sod.ItemID)
        .input("name", sql.VarChar(160), sod.Name)
        .input("qty", sql.Decimal(23, 4), sod.Qty)
        .input("unit", sql.VarChar(8), sod.Unit)
        .input("price", sql.Decimal(23, 4), sod.Price)
        .input("amount", sql.Decimal(23, 4), sod.Amount).query(`
          INSERT INTO SalesInvoiceDetail
            (SalesInvoiceDetailID, SalesInvoiceID, ItemID, Qty, Unit, Ratio, UnitRatio, Price, Disc, DiscValue,
             DiscRp, Amount, Name, Value, Netto, Description, WaiterName, Cashback, Total)
          VALUES
            (@id, @siId, @itemId, @qty, @unit, 1, 1, @price, 0, 0,
             0, @amount, @name, @amount, @amount, '', '', 0, NULL)
        `);
    }

    await new sql.Request(transaction)
      .input("soId", sql.VarChar(16), salesOrderId)
      .query(`UPDATE SalesOrder SET IsClosed = 1, IsInvoiced = 1, ModifiedDate = GETDATE() WHERE SalesOrderID = @soId`);
    await new sql.Request(transaction)
      .input("doId", sql.VarChar(16), deliveryOrderId)
      .query(`UPDATE DeliveryOrder SET IsClosed = 1, IsInvoiced = 1, ModifiedDate = GETDATE() WHERE DeliveryOrderID = @doId`);

    await new sql.Request(transaction)
      .input("id", sql.Int, takeAwayMuatanId)
      .input("akunId", sql.Int, dicatatOlehAkunId)
      .input("doId", sql.VarChar(16), deliveryOrderId)
      .input("siId", sql.VarChar(16), salesInvoiceId).query(`
        UPDATE DashboardTakeAwayMuatan
        SET JamSelesaiMuat = GETDATE(), QtyDimuat = QtyDipesan, DicatatOlehAkunID = @akunId,
            DeliveryOrderID = @doId, SalesInvoiceID = @siId
        WHERE TakeAwayMuatanID = @id
      `);

    await transaction.commit();
    return { deliveryOrderId, salesInvoiceId };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
```

`nextDeliveryOrderId`/`nextDOVoucherSeq`/`nextSalesInvoiceId`/`nextSIVoucherSeq`/`nextDeliveryOrderDetailId`/`nextSalesInvoiceDetailId` (fungsi-fungsi helper di atas `takeAwaySelesaiMuat` di file yang sama) tetap dipanggil dengan `pool` biasa (bukan `transaction`) -- fungsi-fungsi itu hanya membaca `MAX(...)` untuk generate ID berikutnya, bukan bagian dari perubahan data yang perlu atomic, sama seperti kode aslinya sebelum perubahan ini.

Perlu import baru di bagian atas file: `import { allocateTakeAwayStock } from "@/lib/queries/takeaway-alokasi";`

- [ ] **Step 2: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/takeaway-muatan.ts`
Expected: tidak ada error.

- [ ] **Step 3: Verifikasi live**

Di `/mkesindo/produksi-app` tab TakeAway (atau alur checkout TakeAway yang ada), buat satu TakeAway varian 10kg dengan qty kecil, Mulai Muat, lalu Selesai Muat. Konfirmasi: (a) DO/SI benar-benar terbuat seperti sebelumnya, (b) baris baru muncul di `DashboardTakeAwayAlokasi` menunjuk ke Kualitas/Batch yang masuk akal, (c) `SisaAlokasi` Kualitas terkait di tab Kualitas berkurang sesuai. Uji juga skenario gagal: buat TakeAway dengan qty yang sengaja melebihi seluruh stok (Kualitas+Pallet) yang ada, pastikan Selesai Muat gagal dengan pesan "Stok tidak cukup..." dan TIDAK ada DO/SI/baris Alokasi yang tertinggal.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/takeaway-muatan.ts
git commit -m "feat: TakeAway Selesai Muat kini mengurangi stok Kualitas/Pallet via FIFO"
```

---

### Task 5: `SisaAlokasi`/`SisaBelumDialokasikan` di Riwayat Produksi ikut TakeAway

**Files:**
- Modify: `src/lib/queries/produksi-riwayat-detail.ts`

**Interfaces:**
- Consumes: `DashboardTakeAwayAlokasi` (Task 1), `Variant` (Task 2).
- Produces: `RiwayatKualitasEntry` tambah field `variant: "10kg" | "5kg"`; `sisaBelumDialokasikan` sudah memperhitungkan alokasi TakeAway.

- [ ] **Step 1: Tambah `variant` ke query & interface**

Di `getRiwayatProduksiDetail`, tambahkan `k.Variant` ke `SELECT` query Kualitas, dan tambahkan `variant: KantongVariant;` ke interface `RiwayatKualitasEntry` (import `KantongVariant` dari `@/lib/queries/sales-order`). Set `variant: r.Variant` saat membangun tiap entry (di dalam loop `for (const r of kualitasRows)`), dan tambahkan `Variant: KantongVariant;` ke tipe `KualitasRecordsetRow`.

- [ ] **Step 2: Tambahkan alokasi TakeAway ke perhitungan sisa**

Tambahkan satu query baru (mirip pola `batchResult` yang sudah ada) tepat setelah blok `batchResult`:

```typescript
const takeAwayByKualitasId = new Map<number, number>();
if (kualitasIds.length > 0) {
  const takeAwayResult = await pool.request().query(`
    SELECT KualitasID, SUM(Qty) AS TotalQty
    FROM DashboardTakeAwayAlokasi
    WHERE SumberTipe = 'KUALITAS' AND KualitasID IN (${kualitasIds.join(",")})
    GROUP BY KualitasID
  `);
  for (const r of takeAwayResult.recordset as { KualitasID: number; TotalQty: number }[]) {
    takeAwayByKualitasId.set(r.KualitasID, r.TotalQty);
  }
}
```

Ubah baris `const totalTeralokasi = alokasiPallet.reduce(...)` jadi ikut menjumlahkan TakeAway:

```typescript
const alokasiPallet = alokasiByKualitasId.get(r.KualitasID) ?? [];
const totalTeralokasi =
  alokasiPallet.reduce((sum, a) => sum + a.qty10KG, 0) + (takeAwayByKualitasId.get(r.KualitasID) ?? 0);
```

- [ ] **Step 3: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/produksi-riwayat-detail.ts`
Expected: tidak ada error.

- [ ] **Step 4: Verifikasi live**

Buka `/mkesindo/produksi`, cari entri Riwayat Produksi yang KualitasID-nya baru saja dipakai TakeAway di Task 4 Step 3. "Sisa belum dipallet" untuk entri itu harus sudah berkurang sesuai qty TakeAway yang diambil dari situ.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/produksi-riwayat-detail.ts
git commit -m "fix: Sisa Belum Dipallet di Riwayat Produksi ikut kurangi alokasi TakeAway"
```

---

### Task 6: Split 10KG/5KG/Gabungan di panel Korelasi Produksi-Penjualan

**Files:**
- Modify: `src/lib/queries/produksi-korelasi-penjualan.ts`
- Modify: `src/lib/korelasi-format.ts`
- Modify: `src/components/produksi/korelasi-produksi-penjualan-panel.tsx`

**Interfaces:**
- Consumes: `Variant` (Task 2).
- Produces: `KorelasiShiftRow` tambah `totalProduksi5KG: number`; `KorelasiRingkasan` tambah `totalProduksi5KG: number` dan `totalProduksiGabungan: number`.

- [ ] **Step 1: Query total 5KG per shift**

Tambahkan fungsi baru di `produksi-korelasi-penjualan.ts`, sejajar `getTotalDOForShift`:

```typescript
// Total kantong 5KG hasil Cek Kualitas (BUKAN dari DashboardProduksiBatch --
// varian 5kg tidak pernah masuk pallet, jadi tidak ikut hitungan Total
// Produksi lama yang bersumber dari Batch). Angka MENTAH (jumlah kantong
// 5kg asli, belum dikonversi) -- konversi ke ekivalen 10kg terjadi di
// pemanggil, sesuai Global Constraints spec.
async function getTotalProduksi5KGForShift(tanggalUsaha: string, shift: ShiftNumber): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("tanggalLabel", sql.Date, tanggalUsaha)
    .input("shift", sql.TinyInt, shift).query(`
      SELECT ISNULL(SUM(Qty10KG), 0) AS Total
      FROM DashboardProduksiKualitas
      WHERE TanggalLabel = @tanggalLabel AND Shift = @shift AND Variant = '5kg' AND Qty10KG IS NOT NULL
    `);
  return (result.recordset[0] as { Total: number }).Total;
}
```

Tambahkan `totalProduksi5KG: number;` ke `KorelasiShiftRow`, dan di dalam loop `for (const shift of SHIFT_ORDER)` pada `getKorelasiProduksiPenjualan`, tambahkan `getTotalProduksi5KGForShift(tanggalUsaha, shift)` ke `Promise.all` yang sudah ada (destructure hasilnya sebagai `totalProduksi5KG`), dan sertakan di object `rows.push({...})`.

- [ ] **Step 2: `computeKorelasiRingkasan` ikut hitung 5KG + gabungan**

Di `src/lib/korelasi-format.ts`, tambahkan ke `KorelasiRingkasan`:

```typescript
export interface KorelasiRingkasan {
  totalProduksi: number;
  totalProduksi5KG: number;
  totalProduksiGabungan: number;
  totalDO: number;
  sisaStok: number;
  totalRetur: number;
  penjualanPercent: number | null;
  returPercent: number | null;
  costEstimasi: number;
}
```

Di `computeKorelasiRingkasan`, tambahkan:

```typescript
const totalProduksi5KG = data.rows.reduce((sum, r) => sum + r.totalProduksi5KG, 0);
const totalProduksiGabungan = totalProduksi + totalProduksi5KG / 2;
```

dan sertakan `totalProduksi5KG, totalProduksiGabungan` di object return.

- [ ] **Step 3: Tampilkan split di panel**

Di `korelasi-produksi-penjualan-panel.tsx`, ubah baris ringkasan "Produksi" (yang sekarang `{ label: "Produksi", value: formatQty(totalProduksi) }`) jadi 3 baris terpisah dalam grid yang sama:

```typescript
const totalProduksi5KG = data.rows.reduce((sum, r) => sum + r.totalProduksi5KG, 0);
const totalProduksiGabungan = totalProduksi + totalProduksi5KG / 2;
```

```typescript
const ringkasanBaris1: { label: string; value: ReactNode }[] = [
  { label: "Produksi 10KG", value: formatQty(totalProduksi) },
  { label: "Produksi 5KG", value: formatQty(totalProduksi5KG) },
  { label: "Gabungan", value: formatQty(totalProduksiGabungan) },
  { label: "Terkirim", value: formatQty(totalDO) },
  { label: "Sisa (Stok)", value: formatQty(sisaStok) },
  { label: "Retur", value: formatQty(totalRetur) },
];
```

(Grid `grid-cols-4` di JSX yang membungkus `ringkasanBaris1.map` diubah jadi `grid-cols-3 sm:grid-cols-6` supaya 6 kotak tetap rapi.)

Di tabel Metrik/Shift bawah, tambahkan satu baris metrik baru sejajar `{ label: "Produksi", ... }` yang sudah ada:

```typescript
{ label: "Produksi 5KG", render: (p) => (p.row ? formatQty(p.row.totalProduksi5KG) : "—") },
```

- [ ] **Step 4: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/produksi-korelasi-penjualan.ts src/lib/korelasi-format.ts src/components/produksi/korelasi-produksi-penjualan-panel.tsx`
Expected: tidak ada error.

- [ ] **Step 5: Verifikasi live**

Buka `/mkesindo/produksi`, panel Korelasi Produksi-Penjualan menampilkan kotak "Produksi 10KG / Produksi 5KG / Gabungan" dan baris "Produksi 5KG" di tabel. Bandingkan angka Produksi 5KG dengan entri Kualitas 5KG yang dibuat di Task 2 Step 6 pada tanggal/shift yang sama.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/produksi-korelasi-penjualan.ts src/lib/korelasi-format.ts src/components/produksi/korelasi-produksi-penjualan-panel.tsx
git commit -m "feat: tampilkan split Produksi 10KG/5KG/Gabungan di panel Korelasi Produksi-Penjualan"
```

---

### Task 7: Badge Varian & statistik header split di Riwayat Produksi

**Files:**
- Modify: `src/components/produksi/riwayat-shift-group-card.tsx`
- Modify: `src/lib/queries/produksi-riwayat-detail.ts` (statistik header `RiwayatHeaderStats`)

**Interfaces:**
- Consumes: `RiwayatKualitasEntry.variant` (Task 5).
- Produces: `RiwayatHeaderStats` tambah `totalProduksi5KG: number` dan `totalProduksiGabungan: number`.

- [ ] **Step 1: Tambah statistik 5KG/gabungan di `RiwayatHeaderStats`**

Di `produksi-riwayat-detail.ts`, tambahkan ke interface:

```typescript
export interface RiwayatHeaderStats {
  stokAwal: number;
  totalProduksi: number;
  totalProduksi5KG: number;
  totalProduksiGabungan: number;
  masukPallet: number;
  terkirim: number;
  sisaStokAkhir: number;
  sisaStokAkhirFinal: boolean;
  retur: number;
}
```

Di dalam `Promise.all(...map(async (group) => {...}))`, `totalProduksi` yang sudah ada (`group.entries.reduce((sum, e) => sum + (e.qty10KG ?? 0), 0)`) TETAP menjumlahkan SEMUA entri tanpa peduli varian (angka mentah per-varian dicampur) -- ganti jadi dipecah:

```typescript
const totalProduksi = group.entries.filter((e) => e.variant === "10kg").reduce((sum, e) => sum + (e.qty10KG ?? 0), 0);
const totalProduksi5KG = group.entries.filter((e) => e.variant === "5kg").reduce((sum, e) => sum + (e.qty10KG ?? 0), 0);
const totalProduksiGabungan = totalProduksi + totalProduksi5KG / 2;
```

dan sertakan `totalProduksi5KG, totalProduksiGabungan` di object `stats` yang di-return.

**Catatan penting:** `masukPallet` (sudah ada, dari `alokasiPallet`) otomatis sudah HANYA 10kg (karena `alokasiPallet` hanya pernah terisi untuk entri 10kg -- 5kg tidak pernah punya baris Batch) -- tidak perlu diubah.

- [ ] **Step 2: Tampilkan varian & split di kartu**

Di `riwayat-shift-group-card.tsx`, tambahkan badge varian di tiap baris entri (sebelum `CekBadge` Kejernihan):

```tsx
<span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-600">
  {e.variant === "10kg" ? "10 KG" : "5 KG"}
</span>
```

Di header grup, tambahkan 2 `<span>` baru sejajar `Produksi` yang sudah ada:

```tsx
<span>
  Produksi 5KG <b className="text-foreground tabular-nums">{formatQty(group.stats.totalProduksi5KG)}</b>
</span>
<span>
  Gabungan <b className="text-foreground tabular-nums">{formatQty(group.stats.totalProduksiGabungan)}</b>
</span>
```

- [ ] **Step 3: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/components/produksi/riwayat-shift-group-card.tsx src/lib/queries/produksi-riwayat-detail.ts`
Expected: tidak ada error.

- [ ] **Step 4: Verifikasi live**

Buka Riwayat Produksi, cari grup yang berisi entri 5kg dari Task 2 Step 6 -- pastikan badge "5 KG" muncul di baris entrinya, dan header grup menampilkan "Produksi 5KG" serta "Gabungan" dengan angka yang benar.

- [ ] **Step 5: Commit**

```bash
git add src/components/produksi/riwayat-shift-group-card.tsx src/lib/queries/produksi-riwayat-detail.ts
git commit -m "feat: tampilkan varian dan split 10KG/5KG/Gabungan di Riwayat Produksi"
```

---

### Task 8: Split varian di Ringkasan per-tanggal (toggle kalender)

**Files:**
- Modify: `src/components/produksi/jadwal-tim-bulanan.tsx`
- Modify: `src/lib/queries/produksi-korelasi-penjualan.ts` (`getKorelasiRingkasanBulan` sudah otomatis ikut kalau `computeKorelasiRingkasan`/`KorelasiRingkasan` sudah diperbarui di Task 6 -- tidak ada perubahan tambahan di file ini untuk task ini)

**Interfaces:**
- Consumes: `KorelasiRingkasan.totalProduksi5KG`/`totalProduksiGabungan` (Task 6).

- [ ] **Step 1: Tambah 2 baris di blok ringkasan kalender**

Di `jadwal-tim-bulanan.tsx`, cari blok render ringkasan per kotak tanggal (`{showRingkasan && !isFuture && ringkasan && (...)}`), ubah baris `<span>Produksi: {formatQty(ringkasan.totalProduksi)}</span>` yang sudah ada jadi 3 baris:

```tsx
<span>Produksi 10KG: {formatQty(ringkasan.totalProduksi)}</span>
<span>Produksi 5KG: {formatQty(ringkasan.totalProduksi5KG)}</span>
<span>Gabungan: {formatQty(ringkasan.totalProduksiGabungan)}</span>
```

(Baris `Terkirim`, `Sisa (Stok)`, `Retur`, `Penjualan`, `Indeks Retur`, `Cost` yang sudah ada TIDAK berubah -- sumbernya bukan dari Kualitas per-varian.)

- [ ] **Step 2: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/components/produksi/jadwal-tim-bulanan.tsx`
Expected: tidak ada error.

- [ ] **Step 3: Verifikasi live**

Nyalakan toggle Ringkasan di kalender, buka tanggal yang punya entri Kualitas 5kg -- pastikan 3 baris Produksi (10KG/5KG/Gabungan) muncul dengan angka yang benar, konsisten dengan panel Korelasi (Task 6).

- [ ] **Step 4: Commit**

```bash
git add src/components/produksi/jadwal-tim-bulanan.tsx
git commit -m "feat: pecah baris Produksi jadi 10KG/5KG/Gabungan di Ringkasan kalender"
```

---

### Task 9: Query `getValidasiBulan` (data 3 centang)

**Files:**
- Create: `src/lib/queries/produksi-validasi-tim.ts`
- Modify: `src/app/mkesindo/produksi/actions.ts`

**Interfaces:**
- Consumes: `getShiftWindow`/`naiveWibToUtcInstant` (report-shift.ts, business-date.ts), `Variant` (Task 2), `DashboardTakeAwayAlokasi`/`DashboardTakeAwayMuatan`.
- Produces: `ValidasiShift { kualitas: { lengkap: boolean; detail: string }; pallet: { lengkap: boolean; detail: string }; muatan: { lengkap: boolean; detail: string } }`; `getValidasiBulan(tahun: number, bulan: number): Promise<Record<string, ValidasiShift>>` (key = `"YYYY-MM-DD|shift"`); `getValidasiBulanAction(tahun, bulan): Promise<ActionResult<Record<string, ValidasiShift>>>`.

- [ ] **Step 1: Tulis `produksi-validasi-tim.ts`**

```typescript
// src/lib/queries/produksi-validasi-tim.ts
import { getPool, sql } from "@/lib/db";
import { getShiftWindow, type ShiftNumber } from "@/lib/report-shift";
import { naiveWibToUtcInstant } from "@/lib/business-date";

export interface ValidasiShiftItem {
  lengkap: boolean;
  detail: string;
}

export interface ValidasiShift {
  kualitas: ValidasiShiftItem;
  pallet: ValidasiShiftItem;
  muatan: ValidasiShiftItem;
}

const SHIFT_LIST: ShiftNumber[] = [1, 2, 3];

// 3 validasi per (TanggalUsaha, Shift) untuk SATU bulan kalender sekaligus
// -- dipakai 3 titik centang di kotak huruf Tim, jadwal-tim-bulanan.tsx.
// Bukan per-Tim (Kualitas/Batch/Pengiriman tidak menyimpan TimID), murni
// menandai KELENGKAPAN shift itu sendiri -- lihat spec Bagian 4.
export async function getValidasiBulan(tahun: number, bulan: number): Promise<Record<string, ValidasiShift>> {
  const pool = await getPool();
  const awal = new Date(Date.UTC(tahun, bulan - 1, 1));
  const akhir = new Date(Date.UTC(tahun, bulan, 1));

  const [mesinAktifResult, kualitasResult, sisaKualitasResult, pengirimanResult, takeAwayResult] = await Promise.all([
    pool.request().query(`SELECT MesinID FROM DashboardProduksiMesin WHERE Status = 'AKTIF'`),
    pool
      .request()
      .input("awal", sql.Date, awal)
      .input("akhir", sql.Date, akhir).query(`
        SELECT DISTINCT TanggalLabel, Shift, MesinID
        FROM DashboardProduksiKualitas
        WHERE TanggalLabel >= @awal AND TanggalLabel < @akhir
      `),
    pool
      .request()
      .input("awal", sql.Date, awal)
      .input("akhir", sql.Date, akhir).query(`
        SELECT k.TanggalLabel, k.Shift, k.KualitasID, k.Qty10KG,
               ISNULL((SELECT SUM(b.Qty10KG) FROM DashboardProduksiBatch b WHERE b.KualitasID = k.KualitasID AND b.IsDeleted = 0), 0) +
               ISNULL((SELECT SUM(ta.Qty) FROM DashboardTakeAwayAlokasi ta WHERE ta.KualitasID = k.KualitasID AND ta.SumberTipe = 'KUALITAS'), 0)
               AS TotalTeralokasi
        FROM DashboardProduksiKualitas k
        WHERE k.TanggalLabel >= @awal AND k.TanggalLabel < @akhir AND k.Variant = '10kg' AND k.Qty10KG IS NOT NULL
      `),
    pool
      .request()
      .input("start", sql.DateTime, naiveWibToUtcInstant(new Date(Date.UTC(tahun, bulan - 1, 1, 0, 0, 0))))
      .input("end", sql.DateTime, naiveWibToUtcInstant(new Date(Date.UTC(tahun, bulan, 2, 0, 0, 0)))).query(`
        SELECT JamSelesaiMuat FROM DashboardPengirimanJadwal WHERE JamSelesaiMuat BETWEEN @start AND @end
      `),
    pool
      .request()
      .input("start", sql.DateTime, naiveWibToUtcInstant(new Date(Date.UTC(tahun, bulan - 1, 1, 0, 0, 0))))
      .input("end", sql.DateTime, naiveWibToUtcInstant(new Date(Date.UTC(tahun, bulan, 2, 0, 0, 0)))).query(`
        SELECT JamSelesaiMuat FROM DashboardTakeAwayMuatan WHERE JamSelesaiMuat BETWEEN @start AND @end
      `),
  ]);

  const mesinAktifIds = new Set((mesinAktifResult.recordset as { MesinID: number }[]).map((r) => r.MesinID));

  // Centang 1: per (tanggal, shift) -> Set MesinID yang sudah dicek.
  const mesinDicekByShift = new Map<string, Set<number>>();
  for (const r of kualitasResult.recordset as { TanggalLabel: Date; Shift: ShiftNumber; MesinID: number }[]) {
    const key = `${r.TanggalLabel.toISOString().slice(0, 10)}|${r.Shift}`;
    if (!mesinDicekByShift.has(key)) mesinDicekByShift.set(key, new Set());
    mesinDicekByShift.get(key)!.add(r.MesinID);
  }

  // Centang 2: per (tanggal, shift) -> apakah ADA entri 10kg dengan sisa > 0.
  const adaSisaByShift = new Map<string, boolean>();
  const adaEntri10KGByShift = new Set<string>();
  for (const r of sisaKualitasResult.recordset as { TanggalLabel: Date; Shift: ShiftNumber; Qty10KG: number; TotalTeralokasi: number }[]) {
    const key = `${r.TanggalLabel.toISOString().slice(0, 10)}|${r.Shift}`;
    adaEntri10KGByShift.add(key);
    const sisa = Math.max(0, r.Qty10KG - r.TotalTeralokasi);
    if (sisa > 0) adaSisaByShift.set(key, true);
  }

  // Centang 3: kumpulkan semua JamSelesaiMuat (armada + TakeAway), cocokkan
  // ke jendela shift tiap hari dalam bulan ini.
  const semuaJamSelesai: Date[] = [
    ...(pengirimanResult.recordset as { JamSelesaiMuat: Date }[]).map((r) => r.JamSelesaiMuat),
    ...(takeAwayResult.recordset as { JamSelesaiMuat: Date }[]).map((r) => r.JamSelesaiMuat),
  ];

  const hasil: Record<string, ValidasiShift> = {};
  const daysInMonth = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const tanggalUsaha = new Date(Date.UTC(tahun, bulan - 1, day)).toISOString().slice(0, 10);
    for (const shift of SHIFT_LIST) {
      const key = `${tanggalUsaha}|${shift}`;
      const mesinDicek = mesinDicekByShift.get(key) ?? new Set<number>();
      const mesinBelum = [...mesinAktifIds].filter((id) => !mesinDicek.has(id));

      const adaEntri10KG = adaEntri10KGByShift.has(key);
      const adaSisa = adaSisaByShift.get(key) ?? false;

      const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
      const window = getShiftWindow(businessDate, shift, "work");
      const startUtc = naiveWibToUtcInstant(window.start);
      const endUtc = naiveWibToUtcInstant(window.end);
      const adaMuatan = semuaJamSelesai.some((t) => t >= startUtc && t <= endUtc);

      hasil[key] = {
        kualitas: {
          lengkap: mesinBelum.length === 0,
          detail:
            mesinBelum.length === 0
              ? "Semua mesin aktif sudah dicek."
              : `${mesinAktifIds.size - mesinBelum.length} dari ${mesinAktifIds.size} mesin sudah dicek.`,
        },
        pallet: {
          lengkap: !adaEntri10KG || !adaSisa,
          detail: !adaEntri10KG ? "Belum ada hasil panen 10KG." : adaSisa ? "Masih ada sisa belum dipallet." : "Semua sudah masuk pallet.",
        },
        muatan: {
          lengkap: adaMuatan,
          detail: adaMuatan ? "Sudah ada Selesai Muat pada shift ini." : "Belum ada Selesai Muat pada shift ini.",
        },
      };
    }
  }
  return hasil;
}
```

- [ ] **Step 2: Tambah action**

Di `src/app/mkesindo/produksi/actions.ts`, tambahkan:

```typescript
import { getValidasiBulan, type ValidasiShift } from "@/lib/queries/produksi-validasi-tim";

export async function getValidasiBulanAction(tahun: number, bulan: number): Promise<ActionResult<Record<string, ValidasiShift>>> {
  return runAction(async () => {
    await requireProduksiView();
    return getValidasiBulan(tahun, bulan);
  });
}
```

- [ ] **Step 3: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/produksi-validasi-tim.ts src/app/mkesindo/produksi/actions.ts`
Expected: tidak ada error.

- [ ] **Step 4: Verifikasi lewat script scratch**

Tulis script sementara yang memanggil `getValidasiBulan(tahun, bulan)` untuk bulan berjalan, `console.log(JSON.stringify(hasil, null, 2))`, cek manual satu-dua tanggal yang datanya sudah diketahui (mis. tanggal yang dipakai Task 2/4 sebelumnya) untuk memastikan `lengkap`/`detail` masuk akal. Hapus script setelah selesai.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/produksi-validasi-tim.ts src/app/mkesindo/produksi/actions.ts
git commit -m "feat: tambah query getValidasiBulan untuk 3 validasi shift produksi"
```

---

### Task 10: UI 3 ikon centang (Opsi A) di `TimBadge`

**Files:**
- Modify: `src/components/produksi/jadwal-tim-bulanan.tsx`
- Modify: `src/app/mkesindo/(dashboard)/produksi/page.tsx`
- Modify: `src/components/produksi/jadwal-dan-riwayat-produksi.tsx`

**Interfaces:**
- Consumes: `getValidasiBulanAction`, `ValidasiShift` (Task 9).
- Produces: `JadwalTimBulanan` menerima prop baru `validasiBulan: Record<string, ValidasiShift>`.

- [ ] **Step 1: `page.tsx` memanggil `getValidasiBulanAction` dan meneruskannya**

Di `src/app/mkesindo/(dashboard)/produksi/page.tsx`, tambahkan `getValidasiBulanAction(tahunAwal, bulanAwal)` ke `Promise.all` yang sudah memuat `getJadwalBulan`, simpan sebagai `validasiBulanResult`, lalu:

```typescript
const validasiBulanAwal = validasiBulanResult.success ? validasiBulanResult.data : {};
```

Import `getValidasiBulanAction` dari `@/app/mkesindo/produksi/actions` (sudah diekspor Task 9). Teruskan `validasiBulanAwal={validasiBulanAwal}` ke `<JadwalDanRiwayatProduksi .../>` (nama prop harus persis `validasiBulanAwal`, sesuai yang didefinisikan Step 2 di bawah).

- [ ] **Step 2: `jadwal-dan-riwayat-produksi.tsx` menyimpan & meneruskan `validasiBulan`, memuat ulang saat bulan berganti**

Ganti isi `jadwal-dan-riwayat-produksi.tsx` jadi:

```tsx
"use client";

import { useState } from "react";
import { formatDate } from "@/lib/format";
import { JadwalTimBulanan } from "@/components/produksi/jadwal-tim-bulanan";
import { RiwayatProduksi } from "@/components/produksi/riwayat-produksi";
import { getValidasiBulanAction } from "@/app/mkesindo/produksi/actions";
import type { JadwalTimRow } from "@/lib/queries/jadwal-tim-produksi";
import type { TimRow, AnggotaTimRow } from "@/lib/queries/tim-produksi";
import type { StafOperasionalOption } from "@/lib/queries/akun";
import type { RiwayatShiftGroup } from "@/lib/queries/produksi-riwayat-detail";
import type { ValidasiShift } from "@/lib/queries/produksi-validasi-tim";

export function JadwalDanRiwayatProduksi({
  tahunAwal,
  bulanAwal,
  jadwalAwal,
  timList,
  anggotaList,
  produksiAkunOptions,
  tanggalUsahaHariIni,
  riwayatGrup,
  validasiBulanAwal,
}: {
  tahunAwal: number;
  bulanAwal: number;
  jadwalAwal: JadwalTimRow[];
  timList: TimRow[];
  anggotaList: AnggotaTimRow[];
  produksiAkunOptions: StafOperasionalOption[];
  tanggalUsahaHariIni: string;
  riwayatGrup: RiwayatShiftGroup[];
  validasiBulanAwal: Record<string, ValidasiShift>;
}) {
  const [tanggalFilter, setTanggalFilter] = useState<string | null>(null);
  const [validasiBulan, setValidasiBulan] = useState(validasiBulanAwal);

  function handleTanggalClick(tanggalUsaha: string) {
    setTanggalFilter((prev) => (prev === tanggalUsaha ? null : tanggalUsaha));
  }

  // Dipanggil JadwalTimBulanan (lewat muatBulan) tiap kali navigasi bulan
  // Periode Roster -- validasiBulan awal cuma untuk bulan pertama yang
  // dirender server, jadi harus dimuat ulang supaya titik centang tetap
  // benar setelah pindah bulan.
  function handleBulanBerubah(tahun: number, bulan: number) {
    getValidasiBulanAction(tahun, bulan).then((result) => {
      if (result.success) setValidasiBulan(result.data);
    });
  }

  const riwayatTertampil = tanggalFilter ? riwayatGrup.filter((g) => g.tanggalUsaha === tanggalFilter) : riwayatGrup;

  return (
    <>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Jadwal Tim Produksi</h2>
        <JadwalTimBulanan
          tahunAwal={tahunAwal}
          bulanAwal={bulanAwal}
          jadwalAwal={jadwalAwal}
          timList={timList}
          anggotaList={anggotaList}
          produksiAkunOptions={produksiAkunOptions}
          tanggalUsahaHariIni={tanggalUsahaHariIni}
          tanggalTerpilih={tanggalFilter}
          onTanggalClick={handleTanggalClick}
          validasiBulan={validasiBulan}
          onBulanBerubah={handleBulanBerubah}
        />
      </section>
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Riwayat Produksi</h2>
          {tanggalFilter && (
            <button
              type="button"
              onClick={() => setTanggalFilter(null)}
              className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-600 hover:bg-violet-500/25"
            >
              Difilter: {formatDate(tanggalFilter)} × klik untuk reset
            </button>
          )}
        </div>
        <RiwayatProduksi riwayatGrup={riwayatTertampil} />
      </section>
    </>
  );
}
```

(Satu-satunya bagian yang berubah dari versi sebelumnya: prop baru `validasiBulanAwal`, state `validasiBulan`, fungsi `handleBulanBerubah`, dan dua prop tambahan `validasiBulan`/`onBulanBerubah` diteruskan ke `JadwalTimBulanan`. Bagian `riwayatTertampil`, JSX section Riwayat Produksi, dan filter tanggal TIDAK berubah.)

- [ ] **Step 3: `JadwalTimBulanan` menerima prop, `TimBadge` menampilkan 3 titik**

Tambahkan `validasiBulan: Record<string, ValidasiShift>` dan `onBulanBerubah?: (tahun: number, bulan: number) => void` ke props `JadwalTimBulanan` (destructured function parameters DAN tipe objeknya).

`muatBulan` saat ini:

```typescript
function muatBulan(nextTahun: number, nextBulan: number) {
  setTahun(nextTahun);
  setBulan(nextBulan);
  setLoading(true);
  getJadwalBulanAction(nextTahun, nextBulan).then((result) => {
    if (result.success) setJadwal(result.data);
    setLoading(false);
  });
}
```

Ubah jadi:

```typescript
function muatBulan(nextTahun: number, nextBulan: number) {
  setTahun(nextTahun);
  setBulan(nextBulan);
  setLoading(true);
  onBulanBerubah?.(nextTahun, nextBulan);
  getJadwalBulanAction(nextTahun, nextBulan).then((result) => {
    if (result.success) setJadwal(result.data);
    setLoading(false);
  });
}
```

Satu-satunya pemanggilan `<TimBadge>` (di dalam `SHIFT_URUTAN_KALENDER.map`, blok render kalender) saat ini:

```tsx
<TimBadge
  key={shift}
  tanggalUsaha={cell.tanggalUsaha}
  tim={tim}
  timIdx={timIdx}
  entry={entry}
  disabled={!cell.inMonth}
/>
```

Tambahkan satu prop:

```tsx
<TimBadge
  key={shift}
  tanggalUsaha={cell.tanggalUsaha}
  tim={tim}
  timIdx={timIdx}
  entry={entry}
  disabled={!cell.inMonth}
  validasi={validasiBulan[`${cell.tanggalUsaha}|${shift}`]}
/>
```

Ubah `TimBadge` (definisinya, dekat komponen `BadgeKosongPopoverShift`) untuk menerima dan menampilkan 3 titik centang:

```tsx
function TimBadge({
  tanggalUsaha,
  tim,
  timIdx,
  entry,
  disabled,
  validasi,
}: {
  tanggalUsaha: string;
  tim: TimRow;
  timIdx: number;
  entry: JadwalTimRow | undefined;
  disabled: boolean;
  validasi: ValidasiShift | undefined;
}) {
  // ...kode drag/drop yang sudah ada TIDAK berubah...

  if (!entry) {
    return <div className="size-7" />;
  }

  return (
    <button
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      {...listeners}
      {...attributes}
      type="button"
      disabled={disabled}
      title={`${tim.nama} — Shift ${entry.shift}`}
      className={cn("relative flex flex-col items-center gap-0.5", isDragging && "z-20 opacity-50")}
    >
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded text-xs font-bold text-white",
          TIM_COLORS[timIdx % TIM_COLORS.length],
          isOver && "ring-2 ring-offset-1 ring-offset-background ring-primary"
        )}
      >
        {timLetter(tim.nama)}
      </span>
      <span className={cn("text-[10px] font-semibold", TIM_TEXT_COLORS[timIdx % TIM_TEXT_COLORS.length])}>S{entry.shift}</span>
      {validasi && (
        <span className="pointer-events-none absolute -top-1 right-[-2px] flex gap-[3px]">
          <span
            title={`Cek Kualitas: ${validasi.kualitas.detail}`}
            className={cn(
              "size-[9px] rounded-full ring-[1.5px] ring-background",
              validasi.kualitas.lengkap ? "bg-emerald-500" : "bg-muted-foreground/40"
            )}
          />
          <span
            title={`Input Pallet: ${validasi.pallet.detail}`}
            className={cn(
              "size-[9px] rounded-full ring-[1.5px] ring-background",
              validasi.pallet.lengkap ? "bg-emerald-500" : "bg-muted-foreground/40"
            )}
          />
          <span
            title={`Mulai Muat: ${validasi.muatan.detail}`}
            className={cn(
              "size-[9px] rounded-full ring-[1.5px] ring-background",
              validasi.muatan.lengkap ? "bg-emerald-500" : "bg-muted-foreground/40"
            )}
          />
        </span>
      )}
    </button>
  );
}
```

Import `type { ValidasiShift } from "@/lib/queries/produksi-validasi-tim";` di `jadwal-tim-bulanan.tsx`.

- [ ] **Step 4: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/components/produksi/jadwal-tim-bulanan.tsx src/components/produksi/jadwal-dan-riwayat-produksi.tsx "src/app/mkesindo/(dashboard)/produksi/page.tsx"`
Expected: tidak ada error.

- [ ] **Step 5: Verifikasi live di browser**

Buka `/mkesindo/produksi`, kalender Jadwal Tim Produksi menampilkan 3 titik kecil di pojok kanan-atas tiap kotak huruf Tim. Hover tiap titik untuk memastikan tooltip muncul dengan detail yang masuk akal. Cari tanggal/shift yang dipakai Task 2/4/7 (yang datanya sudah lengkap) -- pastikan ketiga titik hijau di situ. Ganti bulan kalender (navigasi Periode Roster), pastikan titik-titik ikut termuat ulang untuk bulan baru tanpa error.

- [ ] **Step 6: Commit**

```bash
git add src/components/produksi/jadwal-tim-bulanan.tsx src/components/produksi/jadwal-dan-riwayat-produksi.tsx "src/app/mkesindo/(dashboard)/produksi/page.tsx"
git commit -m "feat: tampilkan 3 ikon centang validasi (Kualitas/Pallet/Muatan) di kotak Tim kalender"
```

---

## Self-Review Notes

- **Cakupan spec:** Bagian 1 (Task 1-2), Bagian 2 (Task 6-8), Bagian 3 (Task 1, 3-5), Bagian 4 (Task 9-10) -- semua bagian spec punya task yang mengimplementasikannya.
- **Konsistensi tipe:** `ValidasiShift`/`ValidasiShiftItem` (Task 9) dipakai identik di Task 10. `KorelasiRingkasan` (Task 6) dipakai identik oleh `getKorelasiRingkasanBulan` (sudah ada sebelum plan ini, otomatis ikut berubah lewat `computeKorelasiRingkasan`) dan Task 8. `RiwayatKualitasEntry.variant`/`RiwayatHeaderStats` (Task 5/7) konsisten dipakai di `riwayat-shift-group-card.tsx`.
- **Urutan task menghormati dependensi:** skema (1) sebelum semua pemakainya; Variant end-to-end (2) sebelum FIFO (3) yang membacanya; FIFO (3) sebelum diintegrasikan (4); integrasi (4) sebelum SisaAlokasi ikut menghitungnya (5); split tampilan (6-8) bisa paralel setelah (2) selesai; validasi (9) butuh (2) dan (5) untuk akurat; UI centang (10) butuh (9).
