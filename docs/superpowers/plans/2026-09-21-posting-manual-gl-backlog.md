# Posting Manual GeneralLedger untuk Backlog SI/DO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memungkinkan dashpmp memposting manual entri `GeneralLedger` (MKEsindo, MSSQL) untuk backlog `SalesInvoice`/`DeliveryOrder` asal-dashpmp yang gagal ter-posting otomatis oleh ERP sejak 12 September 2026, lengkap dengan jejak audit (trackback), lewat kartu "Kesehatan Posting GL" yang sudah ada di `/mkesindo/pnl`.

**Architecture:** Satu modul baru (`src/lib/queries/gl-posting-backfill.ts`) mereplikasi persis mekanisme akuntansi ERP (biaya = Qty × rata-rata bulanan per item dari tabel `ItemAverage`, akun tujuan dipetakan otomatis dari data GL historis) untuk menghasilkan baris GL yang balance per dokumen. Dua Server Action baru (preview read-only, lalu posting sungguhan) dipanggil dari tombol "Proses" per baris tanggal di kartu Kesehatan Posting GL, diproses satu tanggal per klik.

**Tech Stack:** Next.js 16 App Router, `mssql` (paket `sql`), pola `ActionResult`/`runAction`/`AppError`, shadcn/ui Dialog/Table.

**Spec:** docs/superpowers/specs/2026-09-21-posting-manual-gl-backlog-design.md

## Global Constraints

- Semua UI dan pesan berbahasa Indonesia.
- Akses dibatasi `requireManagerKeAtas()` (dari `src/lib/require-access.ts`) — sama gerbang dengan fitur kode ambil-alih, tidak ada flag baru.
- Hanya memproses dokumen asal-dashpmp (terhubung ke `DashboardPengirimanJadwalDetail.SalesInvoiceID`/`DeliveryOrderID` ATAU `DashboardTakeAwayMuatan.SalesInvoiceID`/`DeliveryOrderID`) — dokumen asal-ERP tidak pernah disentuh.
- Hanya `SalesInvoice`+`DeliveryOrder`. `SalesReturn` di luar cakupan plan ini.
- Setiap dokumen diposting dalam satu transaksi MSSQL sendiri (`new sql.Transaction(pool)`), atomik, idempoten — dicek ulang di dalam transaksi sebelum insert bahwa `VoucherNo`+`Type` itu belum punya baris GL.
- Dokumen dengan `ItemAverage` tidak ditemukan (bukan bernilai 0 — baris tidak ada sama sekali) untuk (ItemID, Year, Month) WAJIB di-skip dengan alasan eksplisit.
- Dokumen dengan ItemID yang tidak pernah muncul di data GL sebelum 12 Sep 2026 (tidak ada histori pemetaan akun) WAJIB di-skip dengan alasan eksplisit.
- Field ERP yang maknanya tidak diketahui dashpmp (`IsExported`, dll) tidak boleh ditulis oleh fitur ini.
- `SalesInvoice` tidak boleh diposting kalau `DeliveryOrder` induknya (via `SalesInvoice.DeliveryOrderID`) belum punya baris GL `Type='DELIVERYORDER'` sama sekali — supaya akun `1399 Goods In Transit` tidak pernah di-credit oleh SI tanpa pernah di-debit oleh DO pasangannya.
- Tidak ada framework migrasi — tabel baru dibuat lewat script `scripts/_scratch_*.ts` sekali jalan, dihapus setelah dipakai, tidak pernah di-commit.
- Tidak ada test suite otomatis — verifikasi via `npx tsc --noEmit`, `npx eslint`, skrip scratch DB live (dihapus setelah dipakai), dan uji browser untuk alur UI.

## Review Focus

- **SalesInvoice diposting sebelum DeliveryOrder induknya** — kalau tidak dicegah, `1399 Goods In Transit` di-credit oleh SI tanpa pernah di-debit oleh DO, saldo akun itu jadi salah permanen. Orang yang wajar berharap SI tidak pernah bisa diposting duluan tanpa DO induknya.
- **Dokumen sudah sebagian ter-posting** (mis. DO sudah ter-GL oleh ERP tapi SI belum, atau sebaliknya) — fitur ini harus mendeteksi per-`Type` secara independen dan hanya memposting bagian yang benar-benar belum ada, tidak menduplikasi bagian yang sudah ada.
- **`ItemAverage.Average = 0` (baris ada, nilainya nol — item bonus/promosi yang sah) vs baris `ItemAverage` tidak ada sama sekali** — keduanya harus dibedakan tegas; yang pertama valid diposting dengan biaya 0, yang kedua wajib di-skip. Fallback `?? 0` yang naif akan mencampur keduanya secara diam-diam.
- **Klik "Proses" dua kali berturut-turut (atau dua tab) untuk tanggal yang sama** — pengecekan idempoten harus benar-benar atomik di dalam transaksi (bukan dicek sekali di awal lalu diasumsikan tetap valid), supaya tidak ada baris GL dobel.
- **Insert baris GL berhasil tapi insert baris audit trail gagal (atau sebaliknya)** — keduanya WAJIB berada dalam transaksi MSSQL yang sama, supaya GeneralLedger dan tabel audit tidak pernah bisa berbeda catatan untuk dokumen yang sama.

---

### Task 1: Skema tabel audit trail (MSSQL)

**Files:**
- Create (sementara, dihapus setelah dipakai, TIDAK di-commit): `scripts/_scratch_gl_backfill_schema.ts`

**Interfaces:**
- Produces: tabel `DashboardGLPostingBackfill` dan `DashboardGLPostingBackfillDetail` di database MSSQL MKEsindo (dipakai oleh Task 3).

- [ ] **Step 1: Tulis script DDL**

```typescript
import { getPool } from "@/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    CREATE TABLE DashboardGLPostingBackfill (
      BackfillID INT IDENTITY(1,1) PRIMARY KEY,
      VoucherNo VARCHAR(64) NOT NULL,
      DocType VARCHAR(20) NOT NULL,
      DocumentID VARCHAR(16) NOT NULL,
      TransDate DATETIME NOT NULL,
      DipostingOlehAkunID INT NOT NULL,
      DipostingPada DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  await pool.request().query(`
    CREATE TABLE DashboardGLPostingBackfillDetail (
      DetailID INT IDENTITY(1,1) PRIMARY KEY,
      BackfillID INT NOT NULL FOREIGN KEY REFERENCES DashboardGLPostingBackfill(BackfillID),
      GeneralLedgerID VARCHAR(16) NOT NULL,
      AccountNo VARCHAR(20) NOT NULL,
      Debit DECIMAL(18,6) NOT NULL,
      Credit DECIMAL(18,6) NOT NULL
    )
  `);

  console.log("Tabel DashboardGLPostingBackfill dan DashboardGLPostingBackfillDetail berhasil dibuat.");
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Jalankan**

Run: `npx tsx --env-file=.env scripts/_scratch_gl_backfill_schema.ts`
Expected: log sukses, tidak ada error.

- [ ] **Step 3: Verifikasi live**

Jalankan query terpisah (`SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME IN ('DashboardGLPostingBackfill','DashboardGLPostingBackfillDetail')`) lewat script scratch sekali pakai lain, konfirmasi kedua tabel dan kolomnya sesuai di atas. Hapus script itu setelah selesai.

- [ ] **Step 4: Hapus script schema**

Hapus `scripts/_scratch_gl_backfill_schema.ts` — jangan pernah di-commit (`git status` harus bersih dari file ini).

---

### Task 2: Deteksi backlog & perhitungan GL (read-only)

**Files:**
- Create: `src/lib/queries/gl-posting-backfill.ts`

**Interfaces:**
- Consumes: `getPool`, `sql` dari `@/lib/db`.
- Produces (dipakai Task 3 dan Task 4):
  - `type DocType = "SALESINVOICE" | "DELIVERYORDER"`
  - `interface GLLine { accountNo: string; debit: number; credit: number }`
  - `interface ComputedDoc { voucherNo: string; docType: DocType; documentId: string; transDate: Date; branchId: string; departmentId: string; businessPartnerId: string | null; currencyId: string; rate: number; lines: GLLine[] }`
  - `interface BacklogSkip { voucherNo: string; docType: DocType; documentId: string; alasan: string }`
  - `interface BacklogPreview { tanggal: string; postable: ComputedDoc[]; skipped: BacklogSkip[]; totalPerAkun: { accountNo: string; debit: number; credit: number }[] }`
  - `async function computeBacklogForDate(tanggal: string): Promise<BacklogPreview>`

- [ ] **Step 1: Tulis fungsi pemetaan akun per ItemID (live, dari data historis sebelum 12 Sep)**

```typescript
import { getPool, sql } from "@/lib/db";

export type DocType = "SALESINVOICE" | "DELIVERYORDER";

export interface GLLine {
  accountNo: string;
  debit: number;
  credit: number;
}

export interface ComputedDoc {
  voucherNo: string;
  docType: DocType;
  documentId: string;
  transDate: Date;
  branchId: string;
  departmentId: string;
  businessPartnerId: string | null;
  currencyId: string;
  rate: number;
  lines: GLLine[];
}

export interface BacklogSkip {
  voucherNo: string;
  docType: DocType;
  documentId: string;
  alasan: string;
}

export interface BacklogPreview {
  tanggal: string;
  postable: ComputedDoc[];
  skipped: BacklogSkip[];
  totalPerAkun: { accountNo: string; debit: number; credit: number }[];
}

interface ItemAccountMapping {
  pendapatanAccountNo: string;
  hppAccountNo: string;
  persediaanAccountNo: string;
}

// Tanggal collapse mekanisme sync dashpmp->ERP (lihat spec & memori
// gl-posting-backlog-do-si-sept12) -- data GL sebelum tanggal ini dianggap
// benar dan dipakai sebagai sumber kebenaran untuk membangun pemetaan akun.
const BATAS_DATA_NORMAL = "2026-09-12";

// Dibangun LIVE tiap dipanggil (bukan tabel statis) -- lihat spec Bagian 1.
// Dibatasi ke voucher SATU-JENIS-ITEM saja (semua baris detail dokumen itu
// ItemID yang sama) supaya atribusi item->akun tidak ambigu, karena GL
// mengagregasi baris multi-item yang berbagi akun menjadi satu baris.
async function buildItemAccountMapping(pool: sql.ConnectionPool): Promise<Map<string, ItemAccountMapping>> {
  const pendapatanHpp = await pool.request().input("batas", sql.Date, BATAS_DATA_NORMAL).query(`
    SELECT sid.ItemID,
           MAX(CASE WHEN coa.AccountNo LIKE '4%' THEN coa.AccountNo END) AS PendapatanAccountNo,
           MAX(CASE WHEN coa.AccountNo LIKE '5%' THEN coa.AccountNo END) AS HppAccountNo
    FROM SalesInvoice si
    JOIN SalesInvoiceDetail sid ON sid.SalesInvoiceID = si.SalesInvoiceID
    JOIN GeneralLedger gl ON gl.VoucherNo = si.VoucherNo AND gl.[Type] = 'SALESINVOICE'
    JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE si.TransDate < @batas AND si.IsDeleted = 0
      AND (coa.AccountNo LIKE '4%' OR coa.AccountNo LIKE '5%')
      AND NOT EXISTS (
        SELECT 1 FROM SalesInvoiceDetail sid2
        WHERE sid2.SalesInvoiceID = si.SalesInvoiceID AND sid2.ItemID <> sid.ItemID
      )
    GROUP BY sid.ItemID
  `);

  const persediaan = await pool.request().input("batas", sql.Date, BATAS_DATA_NORMAL).query(`
    SELECT dod.ItemID, MAX(coa.AccountNo) AS PersediaanAccountNo
    FROM DeliveryOrder do1
    JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do1.DeliveryOrderID
    JOIN GeneralLedger gl ON gl.VoucherNo = do1.VoucherNo AND gl.[Type] = 'DELIVERYORDER'
    JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE do1.TransDate < @batas AND do1.IsDeleted = 0 AND coa.AccountNo LIKE '14%'
      AND NOT EXISTS (
        SELECT 1 FROM DeliveryOrderDetail dod2
        WHERE dod2.DeliveryOrderID = do1.DeliveryOrderID AND dod2.ItemID <> dod.ItemID
      )
    GROUP BY dod.ItemID
  `);

  const persediaanMap = new Map<string, string>(
    (persediaan.recordset as { ItemID: string; PersediaanAccountNo: string }[]).map((r) => [
      r.ItemID,
      r.PersediaanAccountNo,
    ])
  );

  const mapping = new Map<string, ItemAccountMapping>();
  for (const row of pendapatanHpp.recordset as {
    ItemID: string;
    PendapatanAccountNo: string | null;
    HppAccountNo: string | null;
  }[]) {
    const persediaanAccountNo = persediaanMap.get(row.ItemID);
    if (!row.PendapatanAccountNo || !row.HppAccountNo || !persediaanAccountNo) continue;
    mapping.set(row.ItemID, {
      pendapatanAccountNo: row.PendapatanAccountNo,
      hppAccountNo: row.HppAccountNo,
      persediaanAccountNo,
    });
  }
  return mapping;
}
```

- [ ] **Step 2: Tulis lookup `ItemAverage` (bedakan "0" vs "tidak ada")**

```typescript
// null berarti baris ItemAverage TIDAK ADA (bukan bernilai 0) -- pemanggil
// wajib skip dokumen, tidak boleh fallback ke 0. Lihat Review Focus.
async function getItemAverage(
  pool: sql.ConnectionPool,
  itemId: string,
  year: number,
  month: number
): Promise<number | null> {
  const result = await pool
    .request()
    .input("itemId", sql.VarChar(16), itemId)
    .input("year", sql.Int, year)
    .input("month", sql.Int, month)
    .query(`SELECT TOP 1 Average FROM ItemAverage WHERE ItemID = @itemId AND Year = @year AND Month = @month AND IsDeleted = 0`);
  const row = result.recordset[0] as { Average: number } | undefined;
  return row ? row.Average : null;
}
```

- [ ] **Step 3: Tulis deteksi backlog per tanggal (asal-dashpmp, belum ter-GL)**

```typescript
interface DokumenBacklog {
  voucherNo: string;
  documentId: string;
  transDate: Date;
  branchId: string;
  departmentId: string;
  businessPartnerId: string | null;
  currencyId: string;
  rate: number;
  deliveryOrderId: string | null; // hanya relevan untuk SalesInvoice
}

async function cariBacklogSalesInvoice(pool: sql.ConnectionPool, tanggal: string): Promise<DokumenBacklog[]> {
  const result = await pool.request().input("tanggal", sql.Date, tanggal).query(`
    SELECT si.VoucherNo, si.SalesInvoiceID AS DocumentID, si.TransDate, si.BranchID, si.DepartmentID,
           si.BusinessPartnerID, si.CurrencyID, si.Rate, si.DeliveryOrderID
    FROM SalesInvoice si
    LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.SalesInvoiceID = si.SalesInvoiceID AND jd.IsDeleted = 0
    LEFT JOIN DashboardTakeAwayMuatan ta ON ta.SalesInvoiceID = si.SalesInvoiceID
    LEFT JOIN GeneralLedger gl ON gl.VoucherNo = si.VoucherNo AND gl.[Type] = 'SALESINVOICE'
    WHERE CAST(si.TransDate AS DATE) = @tanggal AND si.IsDeleted = 0
      AND (jd.SalesInvoiceID IS NOT NULL OR ta.SalesInvoiceID IS NOT NULL)
      AND gl.VoucherNo IS NULL
  `);
  return (result.recordset as any[]).map((r) => ({
    voucherNo: r.VoucherNo,
    documentId: r.DocumentID,
    transDate: r.TransDate,
    branchId: r.BranchID,
    departmentId: r.DepartmentID,
    businessPartnerId: r.BusinessPartnerID,
    currencyId: r.CurrencyID,
    rate: r.Rate,
    deliveryOrderId: r.DeliveryOrderID ? String(r.DeliveryOrderID).replace(/'/g, "") : null,
  }));
}

async function cariBacklogDeliveryOrder(pool: sql.ConnectionPool, tanggal: string): Promise<DokumenBacklog[]> {
  const result = await pool.request().input("tanggal", sql.Date, tanggal).query(`
    SELECT do1.VoucherNo, do1.DeliveryOrderID AS DocumentID, do1.TransDate, do1.BranchID, do1.DepartmentID,
           do1.BusinessPartnerID, do1.CurrencyID, do1.Rate
    FROM DeliveryOrder do1
    LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.DeliveryOrderID = do1.DeliveryOrderID AND jd.IsDeleted = 0
    LEFT JOIN DashboardTakeAwayMuatan ta ON ta.DeliveryOrderID = do1.DeliveryOrderID
    LEFT JOIN GeneralLedger gl ON gl.VoucherNo = do1.VoucherNo AND gl.[Type] = 'DELIVERYORDER'
    WHERE CAST(do1.TransDate AS DATE) = @tanggal AND do1.IsDeleted = 0
      AND (jd.DeliveryOrderID IS NOT NULL OR ta.DeliveryOrderID IS NOT NULL)
      AND gl.VoucherNo IS NULL
  `);
  return (result.recordset as any[]).map((r) => ({
    voucherNo: r.VoucherNo,
    documentId: r.DocumentID,
    transDate: r.TransDate,
    branchId: r.BranchID,
    departmentId: r.DepartmentID,
    businessPartnerId: r.BusinessPartnerID,
    currencyId: r.CurrencyID,
    rate: r.Rate,
    deliveryOrderId: null,
  }));
}

// Dokumen dianggap "SUDAH punya GL" kalau ADA baris GL untuk VoucherNo+Type
// itu -- termasuk yang diposting fitur ini sendiri pada run sebelumnya, jadi
// query ini sekaligus idempoten lintas-run tanpa perlu tabel status terpisah.
async function doPunyaGL(pool: sql.ConnectionPool, voucherNo: string): Promise<boolean> {
  const result = await pool
    .request()
    .input("v", sql.VarChar(64), voucherNo)
    .query(`SELECT TOP 1 1 AS ada FROM GeneralLedger WHERE VoucherNo = @v AND [Type] = 'DELIVERYORDER'`);
  return result.recordset.length > 0;
}
```

- [ ] **Step 4: Tulis perhitungan baris GL per dokumen (item -> akun -> agregasi)**

```typescript
async function hitungGLDeliveryOrder(
  pool: sql.ConnectionPool,
  doc: DokumenBacklog,
  mapping: Map<string, ItemAccountMapping>
): Promise<{ lines: GLLine[] } | { alasan: string }> {
  const detail = await pool
    .request()
    .input("id", sql.VarChar(16), doc.documentId)
    .query(`SELECT ItemID, Qty FROM DeliveryOrderDetail WHERE DeliveryOrderID = @id`);

  let totalBiaya = 0;
  const kreditPerAkun = new Map<string, number>();
  const tahun = doc.transDate.getUTCFullYear();
  const bulan = doc.transDate.getUTCMonth() + 1;

  for (const row of detail.recordset as { ItemID: string; Qty: number }[]) {
    const akun = mapping.get(row.ItemID);
    if (!akun) return { alasan: `Item ${row.ItemID} tidak punya histori pemetaan akun sebelum 12 Sep 2026` };

    const average = await getItemAverage(pool, row.ItemID, tahun, bulan);
    if (average === null) {
      return { alasan: `Item ${row.ItemID} tidak punya data ItemAverage untuk ${bulan}/${tahun}` };
    }

    const biaya = row.Qty * average;
    totalBiaya += biaya;
    kreditPerAkun.set(akun.persediaanAccountNo, (kreditPerAkun.get(akun.persediaanAccountNo) ?? 0) + biaya);
  }

  const lines: GLLine[] = [{ accountNo: "1399", debit: totalBiaya, credit: 0 }];
  for (const [accountNo, jumlah] of kreditPerAkun) {
    lines.push({ accountNo, debit: 0, credit: jumlah });
  }
  return { lines };
}

async function hitungGLSalesInvoice(
  pool: sql.ConnectionPool,
  doc: DokumenBacklog,
  mapping: Map<string, ItemAccountMapping>
): Promise<{ lines: GLLine[] } | { alasan: string }> {
  if (!doc.deliveryOrderId) return { alasan: "SalesInvoice tidak punya DeliveryOrderID induk" };
  // Catatan: pengecekan "DO induk sudah ter-GL atau belum" dilakukan di
  // computeBacklogForDate (Step 5), BUKAN di sini -- fungsi ini murni
  // menghitung baris GL dari detail item, dipanggil hanya setelah
  // computeBacklogForDate memastikan DO induknya sudah/akan ter-posting.

  const detail = await pool
    .request()
    .input("id", sql.VarChar(16), doc.documentId)
    .query(`SELECT ItemID, Qty, Amount FROM SalesInvoiceDetail WHERE SalesInvoiceID = @id`);

  let totalBiaya = 0;
  let totalPendapatan = 0;
  const kreditPendapatanPerAkun = new Map<string, number>();
  const debitHppPerAkun = new Map<string, number>();
  const tahun = doc.transDate.getUTCFullYear();
  const bulan = doc.transDate.getUTCMonth() + 1;

  for (const row of detail.recordset as { ItemID: string; Qty: number; Amount: number }[]) {
    const akun = mapping.get(row.ItemID);
    if (!akun) return { alasan: `Item ${row.ItemID} tidak punya histori pemetaan akun sebelum 12 Sep 2026` };

    const average = await getItemAverage(pool, row.ItemID, tahun, bulan);
    if (average === null) {
      return { alasan: `Item ${row.ItemID} tidak punya data ItemAverage untuk ${bulan}/${tahun}` };
    }

    const biaya = row.Qty * average;
    totalBiaya += biaya;
    totalPendapatan += row.Amount;
    kreditPendapatanPerAkun.set(
      akun.pendapatanAccountNo,
      (kreditPendapatanPerAkun.get(akun.pendapatanAccountNo) ?? 0) + row.Amount
    );
    debitHppPerAkun.set(akun.hppAccountNo, (debitHppPerAkun.get(akun.hppAccountNo) ?? 0) + biaya);
  }

  const lines: GLLine[] = [
    { accountNo: "1301", debit: totalPendapatan, credit: 0 },
    { accountNo: "1399", debit: 0, credit: totalBiaya },
  ];
  for (const [accountNo, jumlah] of kreditPendapatanPerAkun) lines.push({ accountNo, debit: 0, credit: jumlah });
  for (const [accountNo, jumlah] of debitHppPerAkun) lines.push({ accountNo, debit: jumlah, credit: 0 });
  return { lines };
}
```

- [ ] **Step 5: Rakit `computeBacklogForDate` (termasuk pengecekan DO induk untuk tiap SI)**

```typescript
export async function computeBacklogForDate(tanggal: string): Promise<BacklogPreview> {
  const pool = await getPool();
  const mapping = await buildItemAccountMapping(pool);

  const postable: ComputedDoc[] = [];
  const skipped: BacklogSkip[] = [];

  const doBacklog = await cariBacklogDeliveryOrder(pool, tanggal);
  for (const doc of doBacklog) {
    const hasil = await hitungGLDeliveryOrder(pool, doc, mapping);
    if ("alasan" in hasil) {
      skipped.push({ voucherNo: doc.voucherNo, docType: "DELIVERYORDER", documentId: doc.documentId, alasan: hasil.alasan });
      continue;
    }
    postable.push({
      voucherNo: doc.voucherNo,
      docType: "DELIVERYORDER",
      documentId: doc.documentId,
      transDate: doc.transDate,
      branchId: doc.branchId,
      departmentId: doc.departmentId,
      businessPartnerId: doc.businessPartnerId,
      currencyId: doc.currencyId,
      rate: doc.rate,
      lines: hasil.lines,
    });
  }

  const siBacklog = await cariBacklogSalesInvoice(pool, tanggal);
  for (const doc of siBacklog) {
    if (!doc.deliveryOrderId) {
      skipped.push({ voucherNo: doc.voucherNo, docType: "SALESINVOICE", documentId: doc.documentId, alasan: "Tidak punya DeliveryOrderID induk" });
      continue;
    }
    const doInduk = await pool
      .request()
      .input("id", sql.VarChar(16), doc.deliveryOrderId)
      .query(`SELECT VoucherNo FROM DeliveryOrder WHERE DeliveryOrderID = @id`);
    const doVoucherNo = (doInduk.recordset[0] as { VoucherNo: string } | undefined)?.VoucherNo;
    const dipostingDiRunIni = postable.some((p) => p.docType === "DELIVERYORDER" && p.voucherNo === doVoucherNo);
    const sudahPunyaGL = doVoucherNo ? await doPunyaGL(pool, doVoucherNo) : false;
    if (!dipostingDiRunIni && !sudahPunyaGL) {
      skipped.push({
        voucherNo: doc.voucherNo,
        docType: "SALESINVOICE",
        documentId: doc.documentId,
        alasan: "DeliveryOrder induk belum ter-posting -- proses tanggal DO induknya dulu",
      });
      continue;
    }

    const hasil = await hitungGLSalesInvoice(pool, doc, mapping);
    if ("alasan" in hasil) {
      skipped.push({ voucherNo: doc.voucherNo, docType: "SALESINVOICE", documentId: doc.documentId, alasan: hasil.alasan });
      continue;
    }
    postable.push({
      voucherNo: doc.voucherNo,
      docType: "SALESINVOICE",
      documentId: doc.documentId,
      transDate: doc.transDate,
      branchId: doc.branchId,
      departmentId: doc.departmentId,
      businessPartnerId: doc.businessPartnerId,
      currencyId: doc.currencyId,
      rate: doc.rate,
      lines: hasil.lines,
    });
  }

  const totalMap = new Map<string, { debit: number; credit: number }>();
  for (const doc of postable) {
    for (const line of doc.lines) {
      const existing = totalMap.get(line.accountNo) ?? { debit: 0, credit: 0 };
      totalMap.set(line.accountNo, { debit: existing.debit + line.debit, credit: existing.credit + line.credit });
    }
  }

  return {
    tanggal,
    postable,
    skipped,
    totalPerAkun: Array.from(totalMap, ([accountNo, v]) => ({ accountNo, ...v })),
  };
}
```

- [ ] **Step 6: WAJIB — Validasi algoritma & Review Focus terhadap data historis yang sudah benar**

Tulis SATU script scratch (dihapus setelah dipakai) yang menjalankan 4 pengecekan berikut terhadap `computeBacklogForDate` dan fungsi-fungsi pendukungnya (export sementara `hitungGLDeliveryOrder`/`hitungGLSalesInvoice`/`getItemAverage`/`cariBacklogSalesInvoice`/`cariBacklogDeliveryOrder` untuk keperluan uji ini kalau belum ter-export):

1. **Kecocokan formula (validasi wajib dari spec)**: ambil 20 dokumen ACAK dari tanggal 1-11 September 2026 (sudah benar ter-posting ERP), jalankan `hitungGLDeliveryOrder`/`hitungGLSalesInvoice` terhadapnya, bandingkan `lines` hasil hitungan dengan baris `GeneralLedger` asli untuk `VoucherNo` yang sama (per akun, Debit dan Credit harus sama persis sampai desimal). PERBAIKI ALGORITMA kalau ada yang tidak cocok -- jangan lanjut ke Task 3 dengan ketidakcocokan yang belum dijelaskan.
2. **Deteksi per-Type independen (Review Focus)**: panggil `cariBacklogSalesInvoice`/`cariBacklogDeliveryOrder` untuk SALAH SATU tanggal normal (mis. 10 September 2026, yang sudah 100% ter-posting ERP). Harus mengembalikan array KOSONG untuk keduanya -- membuktikan dokumen yang sudah punya GL (di kedua Type) tidak pernah dianggap backlog.
3. **DO induk belum ter-posting -> SI wajib skip (Review Focus)**: panggil `computeBacklogForDate` untuk salah satu tanggal backlog nyata (mis. 12 September 2026). Ambil satu VoucherNo SalesInvoice dari hasil `skipped` yang alasannya "DeliveryOrder induk belum ter-posting..." -- verifikasi manual (query terpisah) bahwa DeliveryOrder induknya MEMANG belum punya baris GL DAN tidak ikut di `postable` pada run yang sama. Verifikasi juga arah sebaliknya: ambil satu VoucherNo SalesInvoice yang MASUK ke `postable`, konfirmasi DeliveryOrder induknya ADA di `postable` (docType DELIVERYORDER) pada run yang sama.
4. **ItemAverage 0 vs tidak ada (Review Focus)**: cari satu kombinasi (ItemID, Year, Month) di tabel `ItemAverage` dengan `Average = 0` (query `SELECT TOP 1 ItemID, Year, Month FROM ItemAverage WHERE Average = 0 AND IsDeleted = 0`) -- kalau ada, panggil `getItemAverage` dengan kombinasi itu dan verifikasi hasilnya `0` (angka), BUKAN `null`. Lalu panggil `getItemAverage` dengan kombinasi (ItemID, Year, Month) yang dipastikan tidak ada barisnya sama sekali (mis. ItemID acak + Year 1999), verifikasi hasilnya `null`. Kalau tidak ada baris `Average = 0` di data nyata, catat itu di laporan dan lewati sub-cek ini (bukan kegagalan, cuma tidak ada data untuk mengujinya).

Run: `npx tsx --env-file=.env scripts/_scratch_validasi_gl_backfill.ts`
Expected: pengecekan 1 lulus 20/20; pengecekan 2 lulus (array kosong keduanya); pengecekan 3 lulus (kedua arah terverifikasi); pengecekan 4 lulus atau dilewati dgn catatan eksplisit.

Hapus script validasi setelah lulus, dan hapus juga export sementara yang dibuat semata untuk pengujian ini kalau tidak dipakai kode produksi (`computeBacklogForDate` tetap satu-satunya export publik yang dibutuhkan Task 3/4).

- [ ] **Step 7: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error baru.

Run: `npx eslint src/lib/queries/gl-posting-backfill.ts`
Expected: tidak ada error.

- [ ] **Step 8: Commit**

```bash
git add src/lib/queries/gl-posting-backfill.ts
git commit -m "feat: hitung backlog GL SI/DO yang belum ter-posting (read-only)"
```

---

### Task 3: Posting sungguhan (write, transaksional, idempoten, dengan trackback)

**Files:**
- Modify: `src/lib/queries/gl-posting-backfill.ts`

**Interfaces:**
- Consumes: `computeBacklogForDate`, `ComputedDoc`, `DocType` dari Task 2.
- Produces (dipakai Task 4):
  - `interface BacklogPostResultItem { voucherNo: string; docType: DocType; status: "POSTED" | "GAGAL"; alasan?: string }`
  - `interface BacklogPostResult { tanggal: string; hasilPerDokumen: BacklogPostResultItem[]; skipped: BacklogSkip[]; jumlahPosted: number; jumlahGagal: number }`
  - `async function postBacklogForDate(tanggal: string, dipostingOlehAkunId: number): Promise<BacklogPostResult>`

- [ ] **Step 1: Tulis helper ID sekuensial & lookup ChartOfAccountID**

```typescript
async function nextGeneralLedgerId(poolOrTx: sql.ConnectionPool | sql.Transaction): Promise<string> {
  const result = await poolOrTx.request().query(`SELECT MAX(TRY_CAST(ID AS INT)) AS MaxID FROM GeneralLedger`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

const chartOfAccountIdCache = new Map<string, string>();
async function getChartOfAccountId(poolOrTx: sql.ConnectionPool | sql.Transaction, accountNo: string): Promise<string> {
  const cached = chartOfAccountIdCache.get(accountNo);
  if (cached) return cached;
  const result = await poolOrTx
    .request()
    .input("accountNo", sql.VarChar(20), accountNo)
    .query(`SELECT TOP 1 ChartOfAccountID FROM ChartOfAccount WHERE AccountNo = @accountNo`);
  const row = result.recordset[0] as { ChartOfAccountID: string } | undefined;
  if (!row) throw new AppError(`ChartOfAccountID untuk akun ${accountNo} tidak ditemukan`);
  chartOfAccountIdCache.set(accountNo, row.ChartOfAccountID);
  return row.ChartOfAccountID;
}
```

Tambahkan import `AppError` dari `@/lib/action-result` di bagian atas file.

- [ ] **Step 2: Tulis fungsi posting satu dokumen (transaksi sendiri, idempoten)**

```typescript
export interface BacklogPostResultItem {
  voucherNo: string;
  docType: DocType;
  status: "POSTED" | "GAGAL";
  alasan?: string;
}

async function postSatuDokumen(
  pool: sql.ConnectionPool,
  doc: ComputedDoc,
  dipostingOlehAkunId: number,
  tanggalProses: string
): Promise<BacklogPostResultItem> {
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const cekUlang = await new sql.Request(transaction)
      .input("v", sql.VarChar(64), doc.voucherNo)
      .input("t", sql.VarChar(20), doc.docType)
      .query(`SELECT TOP 1 1 AS ada FROM GeneralLedger WITH (UPDLOCK, HOLDLOCK) WHERE VoucherNo = @v AND [Type] = @t`);
    if (cekUlang.recordset.length > 0) {
      await transaction.rollback();
      return { voucherNo: doc.voucherNo, docType: doc.docType, status: "GAGAL", alasan: "Sudah ter-posting (terdeteksi ulang saat commit)" };
    }

    const glId = await nextGeneralLedgerId(transaction);
    const memo = `[DASHPMP-BACKFILL] ${tanggalProses}`;
    const insertHeader = await new sql.Request(transaction)
      .input("voucherNo", sql.VarChar(64), doc.voucherNo)
      .input("docType", sql.VarChar(20), doc.docType)
      .input("documentId", sql.VarChar(16), doc.documentId)
      .input("transDate", sql.DateTime, doc.transDate)
      .input("akunId", sql.Int, dipostingOlehAkunId)
      .query(`
        INSERT INTO DashboardGLPostingBackfill (VoucherNo, DocType, DocumentID, TransDate, DipostingOlehAkunID)
        OUTPUT INSERTED.BackfillID
        VALUES (@voucherNo, @docType, @documentId, @transDate, @akunId)
      `);
    const backfillId = (insertHeader.recordset[0] as { BackfillID: number }).BackfillID;

    for (const line of doc.lines) {
      const chartOfAccountId = await getChartOfAccountId(transaction, line.accountNo);
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), glId)
        .input("branchId", sql.VarChar(16), doc.branchId)
        .input("departmentId", sql.VarChar(16), doc.departmentId)
        .input("voucherNo", sql.VarChar(64), doc.voucherNo)
        .input("transDate", sql.DateTime, doc.transDate)
        .input("docType", sql.VarChar(20), doc.docType)
        .input("chartOfAccountId", sql.VarChar(16), chartOfAccountId)
        .input("debit", sql.Decimal(18, 6), line.debit)
        .input("credit", sql.Decimal(18, 6), line.credit)
        .input("memo", sql.VarChar(255), memo)
        .input("businessPartnerId", sql.VarChar(16), doc.businessPartnerId)
        .input("currencyId", sql.VarChar(16), doc.currencyId)
        .input("rate", sql.Decimal(18, 6), doc.rate)
        .query(`
          INSERT INTO GeneralLedger
            (ID, BranchID, DepartmentID, VoucherNo, TransDate, [Type], ChartOfAccountID, Debit, Credit, Memo, BusinessPartnerID, CurrencyID, Rate)
          VALUES
            (@id, @branchId, @departmentId, @voucherNo, @transDate, @docType, @chartOfAccountId, @debit, @credit, @memo, @businessPartnerId, @currencyId, @rate)
        `);

      await new sql.Request(transaction)
        .input("backfillId", sql.Int, backfillId)
        .input("glId", sql.VarChar(16), glId)
        .input("accountNo", sql.VarChar(20), line.accountNo)
        .input("debit", sql.Decimal(18, 6), line.debit)
        .input("credit", sql.Decimal(18, 6), line.credit)
        .query(`
          INSERT INTO DashboardGLPostingBackfillDetail (BackfillID, GeneralLedgerID, AccountNo, Debit, Credit)
          VALUES (@backfillId, @glId, @accountNo, @debit, @credit)
        `);
    }

    await transaction.commit();
    return { voucherNo: doc.voucherNo, docType: doc.docType, status: "POSTED" };
  } catch (err) {
    await transaction.rollback();
    // Pesan mentah dari driver MSSQL (nama tabel/kolom, detail constraint,
    // dsb) tidak boleh sampai ke UI -- log server-side, tampilkan pesan
    // Indonesia generik ke Manager (pola sama seperti AppError di
    // action-result.ts, yang justru dirancang mencegah kebocoran ini).
    console.error(`Gagal posting ${doc.docType} ${doc.voucherNo}:`, err);
    const alasan = "Terjadi kesalahan teknis saat menulis ke database -- lihat log server untuk detail.";
    return { voucherNo: doc.voucherNo, docType: doc.docType, status: "GAGAL", alasan };
  }
}
```

- [ ] **Step 3: Rakit `postBacklogForDate` (proses DO dulu, baru SI, per Global Constraints)**

```typescript
export interface BacklogPostResult {
  tanggal: string;
  hasilPerDokumen: BacklogPostResultItem[];
  skipped: BacklogSkip[];
  jumlahPosted: number;
  jumlahGagal: number;
}

export async function postBacklogForDate(tanggal: string, dipostingOlehAkunId: number): Promise<BacklogPostResult> {
  const pool = await getPool();
  // Dihitung ulang FRESH di sini (bukan menerima preview dari client) --
  // lihat spec: "tiap dokumen 1 transaksi sendiri" + mencegah state basi
  // antara preview dan submit.
  const rencana = await computeBacklogForDate(tanggal);
  const tanggalProses = new Date().toISOString().slice(0, 10);

  const urutan = [
    ...rencana.postable.filter((d) => d.docType === "DELIVERYORDER"),
    ...rencana.postable.filter((d) => d.docType === "SALESINVOICE"),
  ];

  const hasilPerDokumen: BacklogPostResultItem[] = [];
  for (const doc of urutan) {
    hasilPerDokumen.push(await postSatuDokumen(pool, doc, dipostingOlehAkunId, tanggalProses));
  }

  return {
    tanggal,
    hasilPerDokumen,
    skipped: rencana.skipped,
    jumlahPosted: hasilPerDokumen.filter((h) => h.status === "POSTED").length,
    jumlahGagal: hasilPerDokumen.filter((h) => h.status === "GAGAL").length,
  };
}
```

- [ ] **Step 4: Uji live idempoten & race (script scratch, dihapus setelah dipakai)**

Tulis `scripts/_scratch_uji_posting_backfill.ts` yang: (a) memanggil `postBacklogForDate` untuk SATU tanggal backlog nyata dengan hanya 1-2 dokumen (batasi manual dengan memilih tanggal kecil atau memfilter), verifikasi baris GL dan baris audit trail benar-benar tertulis dan balance; (b) memanggil `postBacklogForDate` KEDUA KALINYA untuk tanggal yang sama, verifikasi semua dokumen yang tadi POSTED sekarang tidak muncul lagi di `computeBacklogForDate` (sudah dianggap ter-GL) sehingga `postBacklogForDate` kedua menghasilkan 0 dokumen diproses; (c) `Promise.allSettled` dua panggilan `postSatuDokumen` BERSAMAAN untuk dokumen yang sama, verifikasi tepat satu yang `POSTED` dan satu `GAGAL` dengan alasan "Sudah ter-posting". Hapus semua data uji (baris GL, baris audit) yang dibuat sebagai bagian dari verifikasi ini setelah selesai — JANGAN tinggalkan residu di data produksi nyata kalau ini cuma untuk uji; kalau memakai dokumen backlog nyata, biarkan hasilnya (itu memang tujuannya), tapi laporkan dengan jelas VoucherNo mana yang benar-benar terpengaruh.

Run: `npx tsx --env-file=.env scripts/_scratch_uji_posting_backfill.ts`
Expected: (a) PASS baris GL balance & audit trail cocok; (b) PASS 0 dokumen di run kedua; (c) PASS race test 1 fulfilled/1 gagal.

- [ ] **Step 5: Verifikasi lewat pembacaan kode -- GL dan audit trail satu transaksi (Review Focus)**

Konfirmasi (code-reading, tidak perlu script tambahan -- menyambung langsung dari Step 4 di atas) bahwa di dalam `postSatuDokumen`: (a) insert `GeneralLedger` dan insert `DashboardGLPostingBackfillDetail` untuk SETIAP baris `doc.lines` sama-sama memakai `new sql.Request(transaction)` dari `transaction` yang SAMA persis dengan yang dipakai insert `DashboardGLPostingBackfill` (header) dan pengecekan idempoten di awal fungsi -- tidak ada satu pun query di dalam fungsi ini yang memakai `pool.request()` langsung (di luar `transaction`); (b) satu-satunya `transaction.commit()` ada di akhir, setelah SEMUA insert (GL + audit header + audit detail) selesai, dan satu-satunya `transaction.rollback()` ada di blok `catch` yang membungkus semuanya -- membuktikan kegagalan di titik mana pun (GL maupun audit) akan me-rollback keduanya, tidak pernah salah satu committed sendirian.

- [ ] **Step 6: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error baru.

Run: `npx eslint src/lib/queries/gl-posting-backfill.ts`
Expected: tidak ada error.

- [ ] **Step 7: Commit**

```bash
git add src/lib/queries/gl-posting-backfill.ts
git commit -m "feat: tulis backlog GL SI/DO transaksional dengan trackback audit"
```

---

### Task 4: Server Actions

**Files:**
- Modify: `src/app/mkesindo/(dashboard)/pnl/actions.ts`

**Interfaces:**
- Consumes: `computeBacklogForDate`, `postBacklogForDate`, `BacklogPreview`, `BacklogPostResult` dari Task 2/3; `requireManagerKeAtas` dari `@/lib/require-access`.
- Produces (dipakai Task 5):
  - `async function previewGLBacklogAction(tanggal: string): Promise<ActionResult<BacklogPreview>>`
  - `async function postGLBacklogAction(tanggal: string): Promise<ActionResult<BacklogPostResult>>`

- [ ] **Step 1: Tambah import**

```typescript
import { requireManagerKeAtas } from "@/lib/require-access";
import {
  computeBacklogForDate,
  postBacklogForDate,
  type BacklogPreview,
  type BacklogPostResult,
} from "@/lib/queries/gl-posting-backfill";
```

- [ ] **Step 2: Tambah kedua action di akhir file**

```typescript
export async function previewGLBacklogAction(tanggal: string): Promise<ActionResult<BacklogPreview>> {
  return runAction(async () => {
    await requireManagerKeAtas();
    return computeBacklogForDate(tanggal);
  });
}

export async function postGLBacklogAction(tanggal: string): Promise<ActionResult<BacklogPostResult>> {
  return runAction(async () => {
    const session = await requireManagerKeAtas();
    const result = await postBacklogForDate(tanggal, Number(session.user.id));
    revalidatePath("/mkesindo/pnl");
    return result;
  });
}
```

- [ ] **Step 3: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error baru.

Run: `npx eslint "src/app/mkesindo/(dashboard)/pnl/actions.ts"`
Expected: tidak ada error.

- [ ] **Step 4: Verifikasi gerbang akses lewat pembacaan kode**

Konfirmasi (code-reading, karena `auth()` tidak bisa dipanggil dari script scratch biasa -- keterbatasan lingkungan yang sudah berulang kali ditemui di repo ini) bahwa KEDUA action baru memanggil `requireManagerKeAtas()` sebagai baris PERTAMA di dalam `runAction`, sebelum operasi apa pun yang lain.

- [ ] **Step 5: Commit**

```bash
git add "src/app/mkesindo/(dashboard)/pnl/actions.ts"
git commit -m "feat: tambah Server Action preview & posting backlog GL"
```

---

### Task 5: UI -- tombol "Proses" per tanggal & dialog preview/konfirmasi

**Files:**
- Create: `src/components/dashboard/gl-posting-backfill-dialog.tsx`
- Modify: `src/components/dashboard/gl-posting-health-card.tsx`
- Modify: `src/app/mkesindo/(dashboard)/pnl/page.tsx`

**Interfaces:**
- Consumes: `previewGLBacklogAction`, `postGLBacklogAction` dari Task 4; `GLPostingHealthRow` dari `@/lib/queries/gl-posting-health` (sudah ada); `requireManagerKeAtas`-equivalent check di page.tsx (pola sama seperti `canAccessAllPT(session.user) || session.user.bolehGenerateKodeAmbilAlih` di `mkesindo/(dashboard)/layout.tsx`).
- Produces: `<GLPostingBackfillDialog>` komponen client baru; `GLPostingHealthCard` menerima prop baru `bolehProses: boolean`, `onPreview`, `onPost`.

- [ ] **Step 1: Tulis dialog preview -> konfirmasi -> hasil**

```typescript
"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatRupiah } from "@/lib/format";
import type { BacklogPreview, BacklogPostResult } from "@/lib/queries/gl-posting-backfill";
import type { ActionResult } from "@/lib/action-result";

interface Props {
  tanggal: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreview: (tanggal: string) => Promise<ActionResult<BacklogPreview>>;
  onPost: (tanggal: string) => Promise<ActionResult<BacklogPostResult>>;
  onSelesai: () => void;
}

export function GLPostingBackfillDialog({ tanggal, open, onOpenChange, onPreview, onPost, onSelesai }: Props) {
  const [preview, setPreview] = useState<BacklogPreview | null>(null);
  const [hasil, setHasil] = useState<BacklogPostResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function muatPreview() {
    setError(null);
    setPreview(null);
    setHasil(null);
    startTransition(async () => {
      const result = await onPreview(tanggal);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setPreview(result.data);
    });
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (next) muatPreview();
  }

  function konfirmasiPosting() {
    setError(null);
    startTransition(async () => {
      const result = await onPost(tanggal);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setHasil(result.data);
      onSelesai();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Proses Posting GL -- {tanggal}</DialogTitle>
          <DialogDescription>Posting manual backlog SalesInvoice/DeliveryOrder untuk tanggal ini.</DialogDescription>
        </DialogHeader>

        {pending && !preview && !hasil && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Memuat preview...
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {hasil && (
          <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium">Selesai: {hasil.jumlahPosted} berhasil, {hasil.jumlahGagal} gagal.</p>
            {hasil.hasilPerDokumen
              .filter((h) => h.status === "GAGAL")
              .map((h) => (
                <p key={`${h.docType}-${h.voucherNo}`} className="text-xs text-destructive">
                  {h.voucherNo} ({h.docType}): {h.alasan}
                </p>
              ))}
            <Button size="sm" onClick={() => onOpenChange(false)}>
              Tutup
            </Button>
          </div>
        )}

        {preview && !hasil && (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              <b>{preview.postable.length}</b> dokumen akan diposting, <b>{preview.skipped.length}</b> dilewati.
            </p>
            <div className="flex flex-col gap-1">
              {preview.totalPerAkun.map((t) => (
                <div key={t.accountNo} className="flex justify-between text-xs">
                  <span>{t.accountNo}</span>
                  <span className="tabular-nums">
                    D {formatRupiah(t.debit)} / K {formatRupiah(t.credit)}
                  </span>
                </div>
              ))}
            </div>
            {preview.skipped.length > 0 && (
              <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded border border-border p-2 text-xs text-muted-foreground">
                {preview.skipped.map((s) => (
                  <p key={`${s.docType}-${s.voucherNo}`}>
                    {s.voucherNo} ({s.docType}): {s.alasan}
                  </p>
                ))}
              </div>
            )}
            <Button size="sm" disabled={pending || preview.postable.length === 0} onClick={konfirmasiPosting}>
              {pending ? "Memproses..." : "Posting Sekarang"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Tambah tombol "Proses" per baris di `gl-posting-health-card.tsx`**

Ubah `GLPostingHealthCard` (`src/components/dashboard/gl-posting-health-card.tsx`) jadi Client Component (tambah `"use client";` di baris pertama) supaya bisa pegang state dialog. Tambahkan import dan props baru:

```typescript
"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDate, formatRupiah } from "@/lib/format";
import type { GLPostingHealthRow } from "@/lib/queries/gl-posting-health";
import type { BacklogPreview, BacklogPostResult } from "@/lib/queries/gl-posting-backfill";
import type { ActionResult } from "@/lib/action-result";
import { GLPostingBackfillDialog } from "@/components/dashboard/gl-posting-backfill-dialog";
```

(Baris `import { AlertTriangle, ChevronDown } from "lucide-react";` di file yang sudah ada digabung dengan import baru ini, jangan duplikat.)

Tambah props pada `GLPostingHealthCard`:

```typescript
interface GLPostingHealthCardProps {
  rows: GLPostingHealthRow[];
  bolehProses: boolean;
  onPreview: (tanggal: string) => Promise<ActionResult<BacklogPreview>>;
  onPost: (tanggal: string) => Promise<ActionResult<BacklogPostResult>>;
}

export function GLPostingHealthCard({ rows, bolehProses, onPreview, onPost }: GLPostingHealthCardProps) {
  const [tanggalDiproses, setTanggalDiproses] = useState<string | null>(null);
  // ...isi fungsi yang sudah ada (adaMasalah, totalSIDibuat, dst) tetap sama, tidak berubah...
```

Tambah kolom header baru di `<TableHeader>` (setelah kolom "DO Posted/Dibuat"):

```typescript
<TableHead className="h-7 px-1.5 text-right text-[10px]">Aksi</TableHead>
```

Tambah sel baru di tiap `<TableRow>` (setelah `RasioCell` untuk DO), dan render dialog sekali di akhir komponen (sebelum `</details>` penutup):

```typescript
<TableCell className="px-1.5 py-1.5 text-right">
  {bolehProses && rasioTone(r.siDibuat, r.siPosted) !== "ok" && (
    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setTanggalDiproses(r.tanggal)}>
      Proses
    </Button>
  )}
</TableCell>
```

Dan sebelum penutup `</details>` paling akhir:

```typescript
{tanggalDiproses && (
  <GLPostingBackfillDialog
    tanggal={tanggalDiproses}
    open={tanggalDiproses !== null}
    onOpenChange={(open) => !open && setTanggalDiproses(null)}
    onPreview={onPreview}
    onPost={onPost}
    onSelesai={() => {
      /* revalidatePath di postGLBacklogAction sudah memicu refresh data
         server -- tidak perlu aksi tambahan di sini. */
    }}
  />
)}
```

- [ ] **Step 3: Wire dari `pnl/page.tsx`**

Tambah import di `src/app/mkesindo/(dashboard)/pnl/page.tsx`:

```typescript
import { previewGLBacklogAction, postGLBacklogAction } from "@/app/mkesindo/(dashboard)/pnl/actions";
import { canAccessAllPT } from "@/lib/require-access";
```

(`saveCOABudgetAction`, dkk sudah diimpor dari file actions yang sama -- gabung ke dalam import yang sudah ada, jangan buat statement `import` kedua dari file yang sama.)

Di dalam `PnLPage`, setelah `const session = await requireModuleAccess("pnl");`, tambahkan (pola persis sama dengan gerbang tampil ikon kode ambil-alih di `mkesindo/(dashboard)/layout.tsx`):

```typescript
const bolehProsesGLBacklog = canAccessAllPT(session.user) || session.user.bolehGenerateKodeAmbilAlih;
```

Ubah pemanggilan `<GLPostingHealthCard rows={glPostingHealth} />` menjadi:

```typescript
<GLPostingHealthCard
  rows={glPostingHealth}
  bolehProses={bolehProsesGLBacklog}
  onPreview={previewGLBacklogAction}
  onPost={postGLBacklogAction}
/>
```

- [ ] **Step 4: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error baru.

Run: `npx eslint src/components/dashboard/gl-posting-backfill-dialog.tsx src/components/dashboard/gl-posting-health-card.tsx "src/app/mkesindo/(dashboard)/pnl/page.tsx"`
Expected: tidak ada error.

- [ ] **Step 5: Uji live di browser**

Jalankan `preview_start` dev server, buka `/mkesindo/pnl`, buka kartu "Kesehatan Posting GL", konfirmasi tombol "Proses" muncul di baris tanggal dengan backlog (untuk akun yang lolos `requireManagerKeAtas`). Klik salah satu tombol "Proses" pada tanggal dengan backlog PALING SEDIKIT dokumennya (cek tabel dulu, pilih tanggal dgn baris terkecil supaya uji baca-preview ini murah) -- verifikasi dialog preview menampilkan total per akun & daftar skip, LALU TUTUP DIALOG TANPA KLIK "Posting Sekarang" (jangan menulis data sungguhan hanya untuk uji tampilan, kecuali diminta eksplisit oleh Manager yang menjalankan task ini). Screenshot dialog preview sebagai bukti.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/gl-posting-backfill-dialog.tsx src/components/dashboard/gl-posting-health-card.tsx "src/app/mkesindo/(dashboard)/pnl/page.tsx"
git commit -m "feat: tombol Proses posting GL backlog per tanggal di kartu Kesehatan Posting GL"
```
