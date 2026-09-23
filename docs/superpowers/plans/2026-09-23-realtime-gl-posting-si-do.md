# Posting GL Real-Time untuk SalesInvoice/DeliveryOrder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SalesInvoice (SI) dan DeliveryOrder (DO) yang dibuat lewat dashpmp otomatis ter-posting ke `GeneralLedger` tepat saat dibuat, bukan menunggu tombol "Proses" manual di panel Kesehatan Posting GL.

**Architecture:** Ekstrak logika penghitungan jurnal & penulisan baris GL yang sudah ada di `gl-posting-backfill.ts` (dipakai backlog manual) menjadi fungsi bersama, tambah cache untuk pemetaan Item→Akun yang mahal dihitung, lalu panggil fungsi baru itu di 4 titik penciptaan dokumen. Panel Kesehatan Posting GL & tombol "Proses" TIDAK dihapus — tetap jaring pengaman untuk kasus skip/gagal.

**Tech Stack:** Next.js Server Actions, TypeScript, `mssql` (Tedious driver), SQL Server (`GeneralLedger`, `SalesInvoice`, `DeliveryOrder`).

**Spec:** [docs/superpowers/specs/2026-09-23-realtime-gl-posting-si-do-design.md](../specs/2026-09-23-realtime-gl-posting-si-do-design.md)

## Global Constraints

- Formula jurnal (akun, cara hitung HPP) TIDAK berubah — 100% mereplikasi `hitungGLDeliveryOrder`/`hitungGLSalesInvoice` yang sudah divalidasi.
- ID `GeneralLedger` & applock SELALU lewat `nextGeneralLedgerId`/`acquireGLPostingApplock` (resource `dashpmp_gl_backfill_posting`) — tidak ada jalur penulisan GL baru yang membuat mutex/ID generator sendiri.
- Posting GL real-time berjalan DI DALAM transaksi SQL yang sama dengan pembuatan DO/SI — bukan langkah terpisah setelah commit.
- Kegagalan posting GL (skip yang disengaja MAUPUN error DB nyata) TIDAK PERNAH membatalkan pembuatan dokumen — fungsi posting real-time menelan errornya sendiri dan mengembalikan status, tidak pernah throw ke pemanggil.
- Panel Kesehatan Posting GL & tombol "Proses" manual (`computeBacklogForDate`/`postBacklogForDate`) TIDAK dihapus atau diubah perilakunya dari sudut pandang pengguna.
- Repo ini TIDAK punya automated test suite — setiap task diverifikasi lewat `npx tsc --noEmit`, `npx eslint`, script scratch sekali-pakai ke database live (dihapus setelah dipakai, konvensi `scripts/_scratch_*.ts`), dan untuk task yang menyentuh UI, live browser click-through.

## Review Focus

- Item tanpa histori pemetaan akun (belum pernah muncul di GL sebelum 12 Sep 2026) → dokumen tetap dibuat, GL tidak terposting, tetap terdeteksi "belum posting" di panel Kesehatan Posting GL (Task 6).
- Item tanpa `ItemAverage` untuk (Year, Month) dokumen itu → sama seperti di atas (Task 6).
- SI yang DO induknya punya `SalesReturn` terkait → SI tetap dibuat tanpa GL, tetap terdeteksi backlog (Task 6).
- Dua dokumen dibuat nyaris bersamaan (concurrent) → applock yang sama harus mencegah dua dokumen berbeda mendapat GeneralLedger ID yang sama (Task 2, tes konkurensi).
- Refactor `postSatuDokumen` (dipakai tombol "Proses" manual) tidak boleh mengubah perilakunya sama sekali — perlu regression check eksplisit, bukan diasumsikan aman karena "cuma diekstrak" (Task 1).

---

### Task 1: Refactor `gl-posting-backfill.ts` — ekstrak helper bersama, cache pemetaan, widen tipe

**Files:**
- Modify: `src/lib/queries/gl-posting-backfill.ts`

**Interfaces:**
- Consumes: tidak ada (task pertama, murni refactor internal file yang sudah ada).
- Produces:
  - `export interface DokumenBacklog { voucherNo: string; documentId: string; transDate: Date; branchId: string; departmentId: string; businessPartnerId: string | null; currencyId: string; rate: number; deliveryOrderId: string | null }` (sebelumnya tidak diekspor).
  - `export async function getItemAccountMappingCached(poolOrTx: sql.ConnectionPool | sql.Transaction): Promise<Map<string, ItemAccountMapping>>` — cache in-memory, dihitung sekali.
  - `hitungGLDeliveryOrder`, `hitungGLSalesInvoice`, `getItemAverage`, `buildItemAccountMapping` — tipe parameter pertama diperluas ke `sql.ConnectionPool | sql.Transaction` (nama & urutan parameter TIDAK berubah).
  - `async function tulisBarisGL(transaction: sql.Transaction, doc: { voucherNo: string; docType: DocType; transDate: Date; branchId: string; departmentId: string; businessPartnerId: string | null; currencyId: string; rate: number; lines: GLLine[] }, memo: string): Promise<{ posted: true; glId: string } | { posted: false; alasan: string }>` (tidak diekspor — dipakai `postSatuDokumen` di file ini dan fungsi real-time di Task 2, keduanya di file yang sama).

- [ ] **Step 1: Ekspor `interface DokumenBacklog`**

Cari definisi `interface DokumenBacklog` (sekitar baris 194, tepat sebelum komentar panjang soal index `GeneralLedger`). Tambahkan `export`:

```typescript
export interface DokumenBacklog {
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
```

- [ ] **Step 2: Perluas tipe parameter pool di 4 fungsi**

Di `buildItemAccountMapping`, `getItemAverage`, `hitungGLDeliveryOrder`, `hitungGLSalesInvoice` — ganti tipe parameter pertama dari `pool: sql.ConnectionPool` menjadi `pool: sql.ConnectionPool | sql.Transaction`. Isi fungsi TIDAK berubah (semua sudah memanggil `pool.request()`, yang valid untuk kedua tipe — pola sama seperti `nextGeneralLedgerId` yang sudah ada di file ini).

Contoh untuk `buildItemAccountMapping`:
```typescript
async function buildItemAccountMapping(pool: sql.ConnectionPool | sql.Transaction): Promise<Map<string, ItemAccountMapping>> {
```

Contoh untuk `getItemAverage`:
```typescript
async function getItemAverage(
  pool: sql.ConnectionPool | sql.Transaction,
  itemId: string,
  year: number,
  month: number
): Promise<number | null> {
```

Contoh untuk `hitungGLDeliveryOrder`:
```typescript
async function hitungGLDeliveryOrder(
  pool: sql.ConnectionPool | sql.Transaction,
  doc: DokumenBacklog,
  mapping: Map<string, ItemAccountMapping>
): Promise<{ lines: GLLine[] } | { alasan: string }> {
```

Contoh untuk `hitungGLSalesInvoice`:
```typescript
async function hitungGLSalesInvoice(
  pool: sql.ConnectionPool | sql.Transaction,
  doc: DokumenBacklog,
  mapping: Map<string, ItemAccountMapping>
): Promise<{ lines: GLLine[] } | { alasan: string }> {
```

- [ ] **Step 3: Tambah cache pemetaan Item→Akun**

Tepat setelah definisi `buildItemAccountMapping` (setelah closing brace-nya, sebelum `getItemAverage`), tambahkan:

```typescript
// Pemetaan Item->Akun dibangun dari data historis SEBELUM tanggal tetap
// BATAS_DATA_NORMAL -- karena batasnya tetap (bukan "N hari terakhir"),
// hasilnya konstan selamanya, jadi aman di-cache in-memory selama proses
// server hidup. Dipakai jalur backlog manual (computeBacklogForDate) DAN
// jalur posting real-time (postDeliveryOrderRealtime/postSalesInvoiceRealtime
// di bawah) supaya keduanya selalu memakai mapping yang identik dan tidak
// menghitung ulang query mahal ini (beberapa scan+join atas GeneralLedger
// 1,9 juta+ baris) di setiap pembuatan dokumen.
let cachedItemAccountMapping: Map<string, ItemAccountMapping> | null = null;
export async function getItemAccountMappingCached(
  poolOrTx: sql.ConnectionPool | sql.Transaction
): Promise<Map<string, ItemAccountMapping>> {
  if (!cachedItemAccountMapping) {
    cachedItemAccountMapping = await buildItemAccountMapping(poolOrTx);
  }
  return cachedItemAccountMapping;
}
```

- [ ] **Step 4: Pakai cache di `computeBacklogForDate`**

Di `computeBacklogForDate`, ganti baris:
```typescript
  const mapping = await buildItemAccountMapping(pool);
```
menjadi:
```typescript
  const mapping = await getItemAccountMappingCached(pool);
```

- [ ] **Step 5: Ekstrak `tulisBarisGL` dari `postSatuDokumen`**

Tepat SEBELUM definisi `async function postSatuDokumen(...)`, tambahkan fungsi baru:

```typescript
// Bagian "tulis baris GeneralLedger" dari postSatuDokumen, diekstrak supaya
// dipakai bersama oleh backlog manual (postSatuDokumen, yang menambahkan
// audit trail DashboardGLPostingBackfill di atas ini) dan posting real-time
// (postDeliveryOrderRealtime/postSalesInvoiceRealtime di bawah, yang TIDAK
// menulis ke DashboardGLPostingBackfill -- tabel itu khusus audit "siapa
// mengklik Proses kapan", tidak relevan untuk dokumen yang ter-posting
// otomatis saat dibuat). Applock HARUS sudah diakuisisi oleh pemanggil
// sebelum memanggil ini (lihat acquireGLPostingApplock).
async function tulisBarisGL(
  transaction: sql.Transaction,
  doc: {
    voucherNo: string;
    docType: DocType;
    transDate: Date;
    branchId: string;
    departmentId: string;
    businessPartnerId: string | null;
    currencyId: string;
    rate: number;
    lines: GLLine[];
  },
  memo: string
): Promise<{ posted: true; glId: string } | { posted: false; alasan: string }> {
  const cekUlang = await new sql.Request(transaction)
    .input("v", sql.VarChar(64), doc.voucherNo)
    .input("t", sql.VarChar(20), doc.docType)
    .query(`SELECT TOP 1 1 AS ada FROM GeneralLedger WHERE VoucherNo = @v AND [Type] = @t`);
  if (cekUlang.recordset.length > 0) {
    return { posted: false, alasan: "Sudah ter-posting (terdeteksi ulang saat commit)" };
  }

  const glId = await nextGeneralLedgerId(transaction);
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
  }
  return { posted: true, glId };
}
```

- [ ] **Step 6: Ganti isi `postSatuDokumen` supaya memakai `tulisBarisGL`**

Ganti seluruh isi try-block `postSatuDokumen` (dari `await acquireGLPostingApplock(transaction);` sampai sebelum `await transaction.commit();`) menjadi:

```typescript
    // Applock DULUAN, sebelum query GeneralLedger apa pun -- lihat
    // acquireGLPostingApplock's own comment di atas.
    await acquireGLPostingApplock(transaction);

    const memo = `[DASHPMP-BACKFILL] ${tanggalProses}`;
    const hasilTulis = await tulisBarisGL(transaction, doc, memo);
    if (!hasilTulis.posted) {
      await transaction.rollback();
      return { voucherNo: doc.voucherNo, docType: doc.docType, status: "GAGAL", alasan: hasilTulis.alasan };
    }

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
      await new sql.Request(transaction)
        .input("backfillId", sql.Int, backfillId)
        .input("glId", sql.VarChar(16), hasilTulis.glId)
        .input("accountNo", sql.VarChar(20), line.accountNo)
        .input("debit", sql.Decimal(18, 6), line.debit)
        .input("credit", sql.Decimal(18, 6), line.credit)
        .query(`
          INSERT INTO DashboardGLPostingBackfillDetail (BackfillID, GeneralLedgerID, AccountNo, Debit, Credit)
          VALUES (@backfillId, @glId, @accountNo, @debit, @credit)
        `);
    }
```

Baris `await transaction.commit();` dan seterusnya (return + catch block) TIDAK berubah.

**PENTING:** `getChartOfAccountId` yang sebelumnya dipanggil langsung di loop `postSatuDokumen` sekarang dipanggil DI DALAM `tulisBarisGL` — pastikan tidak ada pemanggilan dobel yang tersisa di `postSatuDokumen` setelah edit ini (hapus loop lama yang memanggil `getChartOfAccountId` + INSERT `GeneralLedger` langsung, karena sudah pindah ke `tulisBarisGL`).

- [ ] **Step 7: Verifikasi tipe & lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "^\.next"
npx eslint "src/lib/queries/gl-posting-backfill.ts"
```

Expected: kosong (tidak ada error) untuk keduanya.

- [ ] **Step 8: Regression check tombol "Proses" manual lewat live browser**

Buka `/mkesindo/pnl`, buka panel "Kesehatan Posting GL", klik "Proses" pada satu tanggal yang masih ada backlog (kalau tidak ada backlog tersisa saat ini, cukup verifikasi klik "Proses" pada tanggal manapun menghasilkan pesan yang sama seperti sebelumnya — "Tidak ada dokumen untuk diposting" atau berhasil posting, BUKAN error baru). Cek `read_console_messages` untuk error yang berkaitan dengan file ini.

- [ ] **Step 9: Commit**

```bash
git add src/lib/queries/gl-posting-backfill.ts
git commit -m "refactor: ekstrak tulisBarisGL & cache pemetaan Item->Akun di gl-posting-backfill.ts"
```

---

### Task 2: Tambah `postDeliveryOrderRealtime`/`postSalesInvoiceRealtime`

**Files:**
- Modify: `src/lib/queries/gl-posting-backfill.ts`

**Interfaces:**
- Consumes: `DokumenBacklog` (Task 1), `getItemAccountMappingCached` (Task 1), `hitungGLDeliveryOrder`/`hitungGLSalesInvoice` (Task 1, tipe diperluas), `tulisBarisGL` (Task 1), `acquireGLPostingApplock` (sudah ada).
- Produces:
  - `export interface RealtimePostResult { posted: boolean; alasan?: string }`
  - `export async function postDeliveryOrderRealtime(transaction: sql.Transaction, doc: DokumenBacklog): Promise<RealtimePostResult>`
  - `export async function postSalesInvoiceRealtime(transaction: sql.Transaction, doc: DokumenBacklog): Promise<RealtimePostResult>`

- [ ] **Step 1: Tambahkan kedua fungsi di akhir file**

Tambahkan di akhir `src/lib/queries/gl-posting-backfill.ts` (setelah `postBacklogForDate` atau fungsi terakhir di file):

```typescript
export interface RealtimePostResult {
  posted: boolean;
  alasan?: string;
}

// Dipanggil tepat setelah DeliveryOrderDetail selesai ditulis, DI DALAM
// transaksi yang sama dengan pembuatan DO itu sendiri (lihat spec Bagian 3
// keputusan #1 & #2). TIDAK PERNAH throw -- kegagalan apa pun (skip yang
// disengaja seperti item tanpa histori mapping, ATAU error DB sungguhan)
// dikembalikan sebagai { posted: false, alasan }, supaya pemanggil tetap
// bisa lanjut commit transaksi pembuatan dokumennya tanpa GL. Dokumen yang
// gagal di sini tetap terdeteksi oleh panel Kesehatan Posting GL seperti
// biasa, siap diproses manual lewat tombol "Proses" kapan saja.
export async function postDeliveryOrderRealtime(
  transaction: sql.Transaction,
  doc: DokumenBacklog
): Promise<RealtimePostResult> {
  try {
    const mapping = await getItemAccountMappingCached(transaction);
    const hasil = await hitungGLDeliveryOrder(transaction, doc, mapping);
    if ("alasan" in hasil) return { posted: false, alasan: hasil.alasan };

    await acquireGLPostingApplock(transaction);
    const tulis = await tulisBarisGL(
      transaction,
      { ...doc, docType: "DELIVERYORDER", lines: hasil.lines },
      "[DASHPMP-REALTIME]"
    );
    return tulis.posted ? { posted: true } : { posted: false, alasan: tulis.alasan };
  } catch (err) {
    console.error(`Gagal posting GL real-time DELIVERYORDER ${doc.voucherNo}:`, err);
    return { posted: false, alasan: "Terjadi kesalahan teknis saat posting GL real-time -- lihat log server." };
  }
}

// Sama seperti postDeliveryOrderRealtime, untuk SalesInvoice. Pemanggil
// WAJIB mengisi doc.deliveryOrderId dengan DeliveryOrderID induk (dipakai
// hitungGLSalesInvoice untuk cek SalesReturn terkait) -- BUKAN VoucherNo
// DO induk, cukup ID mentahnya.
export async function postSalesInvoiceRealtime(
  transaction: sql.Transaction,
  doc: DokumenBacklog
): Promise<RealtimePostResult> {
  try {
    const mapping = await getItemAccountMappingCached(transaction);
    const hasil = await hitungGLSalesInvoice(transaction, doc, mapping);
    if ("alasan" in hasil) return { posted: false, alasan: hasil.alasan };

    await acquireGLPostingApplock(transaction);
    const tulis = await tulisBarisGL(
      transaction,
      { ...doc, docType: "SALESINVOICE", lines: hasil.lines },
      "[DASHPMP-REALTIME]"
    );
    return tulis.posted ? { posted: true } : { posted: false, alasan: tulis.alasan };
  } catch (err) {
    console.error(`Gagal posting GL real-time SALESINVOICE ${doc.voucherNo}:`, err);
    return { posted: false, alasan: "Terjadi kesalahan teknis saat posting GL real-time -- lihat log server." };
  }
}
```

**Catatan:** `hitungGLSalesInvoice` sendiri sudah melakukan query `SalesReturn` terkait DAN query `SalesInvoiceDetail` LEWAT parameter `poolOrTx` yang sama yang dilempar ke dalamnya (`transaction` di sini) -- karena tipe parameternya sudah diperluas di Task 1, ini otomatis membaca data yang BELUM commit di transaksi yang sama (baris `SalesInvoiceDetail` yang baru saja ditulis pemanggil), bukan snapshot lama. Ini WAJIB benar supaya jumlah baris GL cocok dengan detail yang baru dibuat.

- [ ] **Step 2: Verifikasi tipe & lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "^\.next"
npx eslint "src/lib/queries/gl-posting-backfill.ts"
```

Expected: kosong.

- [ ] **Step 3: Uji konkurensi lewat script scratch**

Buat `scripts/_scratch_test_concurrent_gl.ts`:

```typescript
// DRY-RUN check: memastikan applock benar2 menyerialkan dua pemanggilan
// nextGeneralLedgerId yang terjadi hampir bersamaan dari transaksi
// BERBEDA -- keduanya harus dapat ID yang BERBEDA, bukan sama. Dijalankan
// lalu keduanya di-ROLLBACK, tidak menulis apa pun permanen.
import "dotenv/config";
import { getPool, sql } from "../src/lib/db";
import { nextGeneralLedgerId, acquireGLPostingApplock } from "../src/lib/queries/gl-posting-backfill";

async function ambilIdDenganApplock(pool: sql.ConnectionPool): Promise<string> {
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  await acquireGLPostingApplock(transaction);
  const id = await nextGeneralLedgerId(transaction);
  await new Promise((r) => setTimeout(r, 200)); // simulasikan kerja di dalam applock
  await transaction.rollback();
  return id;
}

async function main() {
  const pool = await getPool();
  const [idA, idB] = await Promise.all([ambilIdDenganApplock(pool), ambilIdDenganApplock(pool)]);
  console.log("ID A:", idA, "ID B:", idB);
  if (idA === idB) {
    console.error("GAGAL: kedua panggilan konkuren mendapat ID yang SAMA -- applock tidak bekerja.");
    process.exit(1);
  }
  console.log("OK: applock menyerialkan generate ID dengan benar.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Jalankan:
```bash
npx tsx scripts/_scratch_test_concurrent_gl.ts
```

Expected: output "OK: applock menyerialkan generate ID dengan benar." (ID A dan ID B berbeda meski dipanggil bersamaan). Kalau gagal, JANGAN lanjut ke task berikutnya -- applock adalah prasyarat keselamatan untuk semua task setelah ini.

Hapus script setelah dipakai:
```bash
rm scripts/_scratch_test_concurrent_gl.ts
```

- [ ] **Step 4: Verifikasi jalur skip tidak throw (Review Focus: item tanpa mapping/ItemAverage, SI dengan SalesReturn terkait)**

Fungsi `postDeliveryOrderRealtime`/`postSalesInvoiceRealtime` HARUS mengembalikan `{ posted: false, alasan }` untuk kondisi skip yang sudah divalidasi formula (Bagian 2 spec) -- bukan throw. Buat `scripts/_scratch_test_skip_realtime.ts` untuk memverifikasi ini terhadap kasus skip NYATA yang sudah diketahui `computeBacklogForDate` (kalau ada), dijalankan dalam transaksi yang di-ROLLBACK supaya tidak menulis apa pun:

```typescript
import "dotenv/config";
import { getPool, sql } from "../src/lib/db";
import {
  computeBacklogForDate,
  postDeliveryOrderRealtime,
  postSalesInvoiceRealtime,
} from "../src/lib/queries/gl-posting-backfill";

async function main() {
  const pool = await getPool();
  // Ganti TANGGAL dengan tanggal mana pun yang diketahui masih ada
  // backlog saat ini (lihat panel Kesehatan Posting GL) -- kalau tidak
  // ada backlog tersisa sama sekali saat menjalankan ini, lewati step ini
  // dan catat di laporan task bahwa tidak ada kasus skip nyata untuk diuji
  // saat ini (bukan kegagalan -- lihat Step 5 di Task 6 untuk jalur
  // pelaporan itu).
  const preview = await computeBacklogForDate("GANTI-YYYY-MM-DD");
  if (preview.skipped.length === 0) {
    console.log("Tidak ada dokumen skip untuk tanggal ini -- coba tanggal lain atau lewati step ini.");
    process.exit(0);
  }
  const contoh = preview.skipped[0];
  console.log("Menguji kasus skip nyata:", contoh);

  const docResult =
    contoh.docType === "DELIVERYORDER"
      ? await pool.request().input("id", sql.VarChar(16), contoh.documentId).query(`
          SELECT DeliveryOrderID AS documentId, VoucherNo AS voucherNo, TransDate AS transDate, BranchID AS branchId,
                 DepartmentID AS departmentId, BusinessPartnerID AS businessPartnerId, CurrencyID AS currencyId, Rate AS rate
          FROM DeliveryOrder WHERE DeliveryOrderID = @id
        `)
      : await pool.request().input("id", sql.VarChar(16), contoh.documentId).query(`
          SELECT SalesInvoiceID AS documentId, VoucherNo AS voucherNo, TransDate AS transDate, BranchID AS branchId,
                 DepartmentID AS departmentId, BusinessPartnerID AS businessPartnerId, CurrencyID AS currencyId, Rate AS rate,
                 REPLACE(DeliveryOrderID, '''', '') AS deliveryOrderId
          FROM SalesInvoice WHERE SalesInvoiceID = @id
        `);
  const doc = docResult.recordset[0] as {
    documentId: string; voucherNo: string; transDate: Date; branchId: string; departmentId: string;
    businessPartnerId: string | null; currencyId: string; rate: number; deliveryOrderId?: string;
  };

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const hasil =
      contoh.docType === "DELIVERYORDER"
        ? await postDeliveryOrderRealtime(transaction, { ...doc, deliveryOrderId: null })
        : await postSalesInvoiceRealtime(transaction, { ...doc, deliveryOrderId: doc.deliveryOrderId ?? null });
    console.log("Hasil:", hasil);
    if (hasil.posted) {
      console.error("GAGAL: dokumen yang seharusnya di-skip malah ter-posting.");
      process.exit(1);
    }
    console.log("OK: dokumen skip dikembalikan sebagai { posted: false, alasan }, bukan throw.");
  } finally {
    await transaction.rollback();
  }
  process.exit(0);
}
main().catch((e) => { console.error("GAGAL (throw, seharusnya tidak):", e); process.exit(1); });
```

```bash
npx tsx scripts/_scratch_test_skip_realtime.ts
rm scripts/_scratch_test_skip_realtime.ts
```

Expected: "OK: dokumen skip dikembalikan sebagai { posted: false, alasan }, bukan throw." Kalau tidak ada backlog tersisa untuk diuji, catat di laporan task dan lanjut (bukan blocker).

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/gl-posting-backfill.ts
git commit -m "feat: tambah postDeliveryOrderRealtime/postSalesInvoiceRealtime untuk posting GL saat dokumen dibuat"
```

---

### Task 3: Hook posting real-time di `pengiriman-jadwal.ts` (alur pengiriman utama)

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts`

**Interfaces:**
- Consumes: `postDeliveryOrderRealtime`, `postSalesInvoiceRealtime` (Task 2).
- Produces: tidak ada interface baru — murni menambah pemanggilan di dua titik yang sudah ada (`selesaiMuat` untuk DO, `createSalesInvoiceForStop` untuk SI, dipakai 2 kali oleh `selesaiMuat`).

- [ ] **Step 1: Tambah import**

Di bagian atas `src/lib/queries/pengiriman-jadwal.ts`, tambahkan:

```typescript
import { postDeliveryOrderRealtime, postSalesInvoiceRealtime } from "@/lib/queries/gl-posting-backfill";
```

- [ ] **Step 2: Hook DO di `selesaiMuat` (branch DO baru, bukan branch merged-external)**

Cari blok ini di `selesaiMuat` (sekitar baris 2418-2444):

```typescript
      const deliveryOrderId = await nextDeliveryOrderId(transaction);
      const voucherSeq = await nextDOVoucherSeq(transaction, yearMonth);
      const voucherNo = `MKE/DO/${voucherSeq}/${yearMonth}/${DOC_SUFFIX}`;

      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), deliveryOrderId)
        .input("voucherNo", sql.VarChar(128), voucherNo)
        .input("branchId", sql.VarChar(16), BRANCH_ID)
        .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
        .input("bpId", sql.VarChar(16), so.BusinessPartnerID)
        .input("soId", sql.VarChar(16), detail.SalesOrderID)
        .input("vehicleNo", sql.VarChar(50), doVehicleNo)
        .input("expeditionId", sql.VarChar(16), doExpeditionId)
        .input("salesmanId", sql.VarChar(16), headerRow.SalesmanID)
        .input("transDate", sql.DateTime, getNaiveWibTransDate())
        .input("dueDate", sql.DateTime, so.DueDate).query(`
```

Ganti jadi (tambah `const transDate = ...` sebelum chain, ganti pemakaian `getNaiveWibTransDate()` di dalam chain jadi variabel):

```typescript
      const deliveryOrderId = await nextDeliveryOrderId(transaction);
      const voucherSeq = await nextDOVoucherSeq(transaction, yearMonth);
      const voucherNo = `MKE/DO/${voucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
      const doTransDate = getNaiveWibTransDate();

      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), deliveryOrderId)
        .input("voucherNo", sql.VarChar(128), voucherNo)
        .input("branchId", sql.VarChar(16), BRANCH_ID)
        .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
        .input("bpId", sql.VarChar(16), so.BusinessPartnerID)
        .input("soId", sql.VarChar(16), detail.SalesOrderID)
        .input("vehicleNo", sql.VarChar(50), doVehicleNo)
        .input("expeditionId", sql.VarChar(16), doExpeditionId)
        .input("salesmanId", sql.VarChar(16), headerRow.SalesmanID)
        .input("transDate", sql.DateTime, doTransDate)
        .input("dueDate", sql.DateTime, so.DueDate).query(`
```

Lalu cari akhir loop `DeliveryOrderDetail` (tepat setelah blok `for (const sod of soDetails) { ... }` yang meng-INSERT `DeliveryOrderDetail`, SEBELUM komentar `// DeliveryOrderID must be persisted before...`), tambahkan:

```typescript

      await postDeliveryOrderRealtime(transaction, {
        voucherNo,
        documentId: deliveryOrderId,
        transDate: doTransDate,
        branchId: BRANCH_ID,
        departmentId: DEPARTMENT_ID,
        businessPartnerId: so.BusinessPartnerID,
        currencyId: "",
        rate: 1,
        deliveryOrderId: null,
      });
```

- [ ] **Step 3: Hook SI di `createSalesInvoiceForStop`**

Cari awal fungsi (baris 2143 area) dan ubah `.input("transDate", sql.DateTime, getNaiveWibTransDate())` (baris ~2176) memakai variabel. Tepat sebelum blok `.input("id", sql.VarChar(16), salesInvoiceId) ... query(` yang meng-INSERT `SalesInvoice`, tambahkan definisi variabel:

```typescript
  const salesInvoiceId = await nextSalesInvoiceId(transaction);
  const siVoucherSeq = await nextSIVoucherSeq(transaction, params.yearMonth);
  const siVoucherNo = `MKE/SI/${siVoucherSeq}/${params.yearMonth}/${DOC_SUFFIX}`;
  const totalAmount = soDetails.reduce((sum, sod) => sum + sod.Amount, 0);
  const siTransDate = getNaiveWibTransDate();
  await new sql.Request(transaction)
```

Lalu di dalam `.input()` chain, ganti:
```typescript
    .input("transDate", sql.DateTime, getNaiveWibTransDate())
```
menjadi:
```typescript
    .input("transDate", sql.DateTime, siTransDate)
```

Lalu cari akhir loop `SalesInvoiceDetail` (tepat setelah blok `for (const sod of soDetails) { ... }` yang meng-INSERT `SalesInvoiceDetail`, SEBELUM baris `await new sql.Request(transaction).input("detailId", ...).query(\`UPDATE DashboardPengirimanJadwalDetail SET SalesInvoiceID...\`)`), tambahkan:

```typescript

  await postSalesInvoiceRealtime(transaction, {
    voucherNo: siVoucherNo,
    documentId: salesInvoiceId,
    transDate: siTransDate,
    branchId: BRANCH_ID,
    departmentId: DEPARTMENT_ID,
    businessPartnerId: so.BusinessPartnerID,
    currencyId: "",
    rate: 1,
    deliveryOrderId: params.deliveryOrderId,
  });
```

**Catatan penting:** `createSalesInvoiceForStop` dipanggil DUA kali di `selesaiMuat` — sekali untuk branch DO baru (baris ~2478, `deliveryOrderId` dari DO yang BARU dibuat & baru saja di-`postDeliveryOrderRealtime`), sekali untuk branch merged-external-DO (baris ~2384, `deliveryOrderId` dari `detail.DeliveryOrderID` yang SUDAH ADA sebelumnya, dibuat di luar dashpmp). Karena hook ditaruh DI DALAM `createSalesInvoiceForStop` sendiri (bukan di kedua call site `selesaiMuat`), kedua branch otomatis tercakup TANPA edit tambahan di `selesaiMuat` untuk SI. Untuk branch merged-external, `hitungGLSalesInvoice` akan mengecek `SalesReturn` & mapping seperti biasa terhadap DO yang sudah ada itu — kalau DO itu belum ter-GL (dibuat di ERP tapi entah kenapa belum posting), SI-nya akan ikut skip (`alasan` dari `hitungGLSalesInvoice`) karena formula tidak mengecek "parent sudah ter-GL" secara eksplisit di jalur real-time (beda dengan backlog manual yang mengecek `doIndukSudahPunyaGL`) -- INI PERILAKU YANG DITERIMA: kalau baris GL untuk DO itu belum ada, `getChartOfAccountId`/`tulisBarisGL` tetap akan berhasil menulis GL untuk SI (formula SI tidak butuh data GL milik DO, hanya butuh `SalesReturn` check & item mapping) -- SI dan DO adalah baris GL yang independen satu sama lain, jadi tidak masalah salah satu ter-posting duluan/belakangan/tidak sama sekali.

- [ ] **Step 4: Verifikasi tipe & lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "^\.next"
npx eslint "src/lib/queries/pengiriman-jadwal.ts"
```

Expected: kosong.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts
git commit -m "feat: posting GL real-time saat DeliveryOrder/SalesInvoice dibuat di alur pengiriman utama"
```

---

### Task 4: Hook posting real-time di `takeaway-muatan.ts`

**Files:**
- Modify: `src/lib/queries/takeaway-muatan.ts`

**Interfaces:**
- Consumes: `postDeliveryOrderRealtime`, `postSalesInvoiceRealtime` (Task 2).

- [ ] **Step 1: Tambah import**

```typescript
import { postDeliveryOrderRealtime, postSalesInvoiceRealtime } from "@/lib/queries/gl-posting-backfill";
```

- [ ] **Step 2: Extract `transDate` DO, hook setelah loop `DeliveryOrderDetail`**

Cari (sekitar baris 277-289):
```typescript
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
```

Ganti jadi:
```typescript
    const deliveryOrderId = await nextDeliveryOrderId(pool);
    const doVoucherSeq = await nextDOVoucherSeq(pool, yearMonth);
    const doVoucherNo = `MKE/DO/${doVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
    const doTransDate = getNaiveWibTransDate();
    await new sql.Request(transaction)
      .input("id", sql.VarChar(16), deliveryOrderId)
      .input("voucherNo", sql.VarChar(128), doVoucherNo)
      .input("branchId", sql.VarChar(16), BRANCH_ID)
      .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
      .input("bpId", sql.VarChar(16), so.BusinessPartnerID)
      .input("soId", sql.VarChar(16), salesOrderId)
      .input("salesmanId", sql.VarChar(16), TAKEAWAY_SALESMAN_ID)
      .input("transDate", sql.DateTime, doTransDate)
      .input("dueDate", sql.DateTime, so.DueDate).query(`
```

Cari akhir loop DO detail (tepat setelah blok `for (const sod of soDetails) { ... }` pertama yang meng-INSERT `DeliveryOrderDetail`, SEBELUM `const salesInvoiceId = await nextSalesInvoiceId(pool);`), tambahkan:

```typescript

    await postDeliveryOrderRealtime(transaction, {
      voucherNo: doVoucherNo,
      documentId: deliveryOrderId,
      transDate: doTransDate,
      branchId: BRANCH_ID,
      departmentId: DEPARTMENT_ID,
      businessPartnerId: so.BusinessPartnerID,
      currencyId: "",
      rate: 1,
      deliveryOrderId: null,
    });
```

- [ ] **Step 3: Extract `transDate` SI, hook setelah loop `SalesInvoiceDetail`**

Cari (sekitar baris 323-349):
```typescript
    const salesInvoiceId = await nextSalesInvoiceId(pool);
    const siVoucherSeq = await nextSIVoucherSeq(pool, yearMonth);
    const siVoucherNo = `MKE/SI/${siVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
    await new sql.Request(transaction)
```
Tambahkan `const siTransDate = getNaiveWibTransDate();` sebelum baris `await new sql.Request(transaction)` itu, lalu di dalam chain-nya ganti `.input("transDate", sql.DateTime, getNaiveWibTransDate())` jadi `.input("transDate", sql.DateTime, siTransDate)`.

Cari akhir loop SI detail (tepat setelah blok `for (const sod of soDetails) { ... }` KEDUA yang meng-INSERT `SalesInvoiceDetail`, SEBELUM `await new sql.Request(transaction).input("soId", ...).query(\`UPDATE SalesOrder SET IsClosed = 1...\`)`), tambahkan:

```typescript

    await postSalesInvoiceRealtime(transaction, {
      voucherNo: siVoucherNo,
      documentId: salesInvoiceId,
      transDate: siTransDate,
      branchId: BRANCH_ID,
      departmentId: DEPARTMENT_ID,
      businessPartnerId: so.BusinessPartnerID,
      currencyId: "",
      rate: 1,
      deliveryOrderId,
    });
```

- [ ] **Step 4: Verifikasi tipe & lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "^\.next"
npx eslint "src/lib/queries/takeaway-muatan.ts"
```

Expected: kosong.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/takeaway-muatan.ts
git commit -m "feat: posting GL real-time saat DeliveryOrder/SalesInvoice Takeaway dibuat"
```

---

### Task 5: Hook posting real-time di `retur-resale.ts`

**Files:**
- Modify: `src/lib/queries/retur-resale.ts`

**Interfaces:**
- Consumes: `postDeliveryOrderRealtime`, `postSalesInvoiceRealtime` (Task 2).
- Produces: tidak ada interface baru — `buatSoDoSiSekaligus` dipakai oleh 3 fungsi (`jualUlangLuarRute`, `jualUlangRetail`, `jualUlangDalamRute`), jadi mengedit fungsi ini SEKALI mencakup ketiganya.

- [ ] **Step 1: Tambah import**

```typescript
import { postDeliveryOrderRealtime, postSalesInvoiceRealtime } from "@/lib/queries/gl-posting-backfill";
```

- [ ] **Step 2: Extract `transDate` DO, hook setelah `DeliveryOrderDetail`**

Cari di `buatSoDoSiSekaligus` (sekitar baris 418-443):
```typescript
  const deliveryOrderId = await nextDeliveryOrderId(transaction);
  const doVoucherSeq = await nextDOVoucherSeq(transaction, yearMonth);
  const doVoucherNo = `MKE/DO/${doVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
  await new sql.Request(transaction)
    .input("id", sql.VarChar(16), deliveryOrderId)
    .input("voucherNo", sql.VarChar(128), doVoucherNo)
    .input("branchId", sql.VarChar(16), BRANCH_ID)
    .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
    .input("bpId", sql.VarChar(16), input.businessPartnerId)
    .input("soId", sql.VarChar(16), salesOrderId)
    .input("salesmanId", sql.VarChar(16), jadwalRow.SalesmanID ?? "")
    .input("expeditionId", sql.VarChar(16), doExpeditionId)
    .input("vehicleNo", sql.VarChar(50), doVehicleNo)
    .input("transDate", sql.DateTime, getNaiveWibTransDate())
    .input("dueDate", sql.DateTime, dueDate).query(`
```

Ganti jadi:
```typescript
  const deliveryOrderId = await nextDeliveryOrderId(transaction);
  const doVoucherSeq = await nextDOVoucherSeq(transaction, yearMonth);
  const doVoucherNo = `MKE/DO/${doVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
  const doTransDate = getNaiveWibTransDate();
  await new sql.Request(transaction)
    .input("id", sql.VarChar(16), deliveryOrderId)
    .input("voucherNo", sql.VarChar(128), doVoucherNo)
    .input("branchId", sql.VarChar(16), BRANCH_ID)
    .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
    .input("bpId", sql.VarChar(16), input.businessPartnerId)
    .input("soId", sql.VarChar(16), salesOrderId)
    .input("salesmanId", sql.VarChar(16), jadwalRow.SalesmanID ?? "")
    .input("expeditionId", sql.VarChar(16), doExpeditionId)
    .input("vehicleNo", sql.VarChar(50), doVehicleNo)
    .input("transDate", sql.DateTime, doTransDate)
    .input("dueDate", sql.DateTime, dueDate).query(`
```

Cari tepat setelah INSERT `DeliveryOrderDetail` (setelah baris yang berbunyi `VALUES (@id, @doId, @itemId, @name, @qty, 'PCS', @qty, 1, @price, 0, NULL, 0, @amount, @qty, @name, @qty, NULL, 0, @soDetailId)` ditutup backtick-nya, SEBELUM `const salesInvoiceId = await nextSalesInvoiceId(transaction);`), tambahkan:

```typescript

  await postDeliveryOrderRealtime(transaction, {
    voucherNo: doVoucherNo,
    documentId: deliveryOrderId,
    transDate: doTransDate,
    branchId: BRANCH_ID,
    departmentId: DEPARTMENT_ID,
    businessPartnerId: input.businessPartnerId,
    currencyId: "",
    rate: 1,
    deliveryOrderId: null,
  });
```

- [ ] **Step 3: Extract `transDate` SI, hook setelah `SalesInvoiceDetail`**

Cari:
```typescript
  const salesInvoiceId = await nextSalesInvoiceId(transaction);
  const siVoucherSeq = await nextSIVoucherSeq(transaction, yearMonth);
  const siVoucherNo = `MKE/SI/${siVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
  await new sql.Request(transaction)
```
Tambahkan `const siTransDate = getNaiveWibTransDate();` sebelum baris `await new sql.Request(transaction)` itu, lalu di dalam chain-nya ganti `.input("transDate", sql.DateTime, getNaiveWibTransDate())` jadi `.input("transDate", sql.DateTime, siTransDate)`.

Cari tepat setelah INSERT `SalesInvoiceDetail` (SEBELUM `await new sql.Request(transaction).input("soId", ...).query(\`UPDATE SalesOrder SET IsClosed = 1, IsInvoiced = 1 WHERE SalesOrderID = @soId\`);`), tambahkan:

```typescript

  await postSalesInvoiceRealtime(transaction, {
    voucherNo: siVoucherNo,
    documentId: salesInvoiceId,
    transDate: siTransDate,
    branchId: BRANCH_ID,
    departmentId: DEPARTMENT_ID,
    businessPartnerId: input.businessPartnerId,
    currencyId: "",
    rate: 1,
    deliveryOrderId,
  });
```

- [ ] **Step 4: Verifikasi tipe & lint**

```bash
npx tsc --noEmit 2>&1 | grep -v "^\.next"
npx eslint "src/lib/queries/retur-resale.ts"
```

Expected: kosong.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/retur-resale.ts
git commit -m "feat: posting GL real-time saat DeliveryOrder/SalesInvoice Jual Ulang Retur dibuat"
```

---

### Task 6: Verifikasi end-to-end live + Review Focus

**Files:**
- Tidak ada file produk yang diubah -- task ini murni verifikasi terhadap Task 1-5.

**Interfaces:**
- Consumes: seluruh perubahan Task 1-5.

- [ ] **Step 1: Verifikasi golden path lewat live browser -- alur pengiriman utama**

Buka `/mkesindo/delivery`, buka Validasi Rute salah satu Jadwal yang armadanya BELUM "Selesai Muat", klik "Selesai Muat". Setelah berhasil, jalankan scratch check:

```typescript
// scripts/_scratch_verify_realtime_gl.ts
import "dotenv/config";
import { getPool, sql } from "../src/lib/db";

async function main() {
  const pool = await getPool();
  // Ganti VOUCHER_NO dengan VoucherNo DO/SI yang baru saja dibuat lewat
  // Selesai Muat di atas (lihat halaman /mkesindo/delivery atau query
  // TOP 1 ORDER BY TransDate DESC dari DeliveryOrder/SalesInvoice).
  const rows = await pool.request().query(`
    SELECT TOP 5 VoucherNo, [Type], ChartOfAccountID, Debit, Credit, Memo
    FROM GeneralLedger
    WHERE Memo = '[DASHPMP-REALTIME]'
    ORDER BY VoucherNo DESC
  `);
  console.log(rows.recordset);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

```bash
npx tsx scripts/_scratch_verify_realtime_gl.ts
rm scripts/_scratch_verify_realtime_gl.ts
```

Expected: baris GL untuk DO & SI yang baru dibuat muncul, dengan Debit = Credit per VoucherNo (seimbang), memo `[DASHPMP-REALTIME]`.

- [ ] **Step 2: Verifikasi golden path -- Takeaway**

Buka `/mkesindo/produksi-app` (atau jalur Takeaway Selesai Muat yang relevan), selesaikan satu order TakeAway. Ulangi query di Step 1 (filter tambahan `AND VoucherNo LIKE 'MKE/DO/%'` sesuai kebutuhan) untuk konfirmasi DO+SI Takeaway itu ter-posting.

- [ ] **Step 3: Verifikasi golden path -- Jual Ulang Retur**

Kalau ada data retur "Baik" tersedia untuk dijual ulang, jalankan salah satu jalur Jual Ulang (Dalam Rute/Luar Rute/Retail) dari UI Validasi Rute, lalu ulangi verifikasi query yang sama. Kalau tidak ada data retur tersedia saat ini, cukup catat sebagai "tidak dapat diverifikasi live saat ini, tapi kode identik strukturnya dengan Task 3/4 yang sudah terverifikasi" -- JANGAN memaksakan membuat data retur palsu di produksi.

- [ ] **Step 4: Verifikasi Review Focus -- panel Kesehatan Posting GL tidak berubah untuk kasus skip**

Buka panel Kesehatan Posting GL (`/mkesindo/pnl`). Konfirmasi:
1. Tanggal yang tadinya ada backlog (kalau ada) TIDAK bertambah oleh dokumen yang BARU dibuat lewat Step 1-3 di atas (karena baru saja langsung ter-posting real-time, seharusnya sudah dihitung "sudah posting" oleh panel ini, bukan "belum").
2. Kalau proses `computeBacklogForDate` untuk tanggal hari ini dijalankan (klik "Proses" atau lihat preview-nya), dokumen yang baru dibuat lewat Step 1-3 TIDAK muncul di daftar yang akan diproses (karena `GeneralLedger` untuk voucherNo itu sudah ada).

- [ ] **Step 5: Cek console browser untuk regresi**

Untuk setiap halaman yang dibuka di Step 1-4, jalankan `read_console_messages` (onlyErrors: true) di tab BARU (bukan tab yang sempat mengalami HMR/reload saat development) untuk memastikan tidak ada error baru yang berkaitan dengan perubahan ini.

- [ ] **Step 6: Commit dokumentasi verifikasi (opsional, kalau ada catatan penting)**

Kalau Step 1-5 menemukan sesuatu yang perlu dicatat untuk masa depan (mis. kasus skip yang benar-benar terjadi live), tambahkan catatan singkat sebagai komentar di kode terkait, lalu:

```bash
git add -A
git commit -m "docs: catatan verifikasi live posting GL real-time SI/DO"
```

Kalau tidak ada temuan baru, tidak perlu commit apa pun di step ini.
