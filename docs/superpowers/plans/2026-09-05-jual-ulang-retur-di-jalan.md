# Jual Ulang Es Retur di Rute Pengiriman Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let qty retur (es yang gagal diterima mitra tujuan, kondisi masih baik) dijual ulang mid-rute ke mitra dalam rute yang belum selesai, mitra lain di luar rute, atau pembeli retail tanpa akun — alih-alih kembali sia-sia ke pabrik — tanpa menyentuh gerbang anti-tabrakan Pemesanan yang sudah ada.

**Architecture:** Satu kolom baru (`KondisiRetur`) pada tabel retur yang sudah ada, satu tabel pelacak baru (`DashboardPengirimanReturResale`), dan satu query-layer module baru (`retur-resale.ts`) berisi 3 fungsi transaksi (satu per jalur) yang semuanya memanggil dua helper bersama: pengurangan `SalesReturn`/`SalesReturnDetail`, dan insert baris pelacak resale dengan claim-guard concurrency check. UI baru menempel ke 3 titik yang sudah ada: layar Konfirmasi Pengiriman driver-app (input kondisi), kartu Jadwal Papan Pengiriman (badge), dan dialog bukti-pengiriman per-stop yang sudah ada (detail + tombol Jual Ulang).

**Tech Stack:** Next.js Server Actions, MSSQL via `mssql` package (raw SQL, tanpa ORM), React Client Components, Tailwind.

**Spec:** docs/superpowers/specs/2026-09-05-jual-ulang-retur-di-jalan-design.md

## Global Constraints

- Tidak ada test runner di proyek ini — verifikasi tiap task lewat `npx tsc --noEmit` + `npx eslint <file berubah>` + scratch script `npx tsx` terhadap DB live (pola yang sudah mapan di proyek ini) atau click-through manual.
- Setiap transaksi uang/qty (SO/DO/SI/SR) WAJIB memakai `sql.Transaction` eksplisit dengan `begin()`/`commit()`/`rollback()` di `try/catch` — pola yang sama seperti `confirmStopDelivery` (`src/lib/queries/pengiriman-jadwal.ts`), BUKAN gaya `pool.request()` polos berturutan seperti `takeAwaySelesaiMuat` (yang tidak dibungkus transaksi eksplisit) — perbedaan ini disengaja demi atomicity, bukan meniru buta.
- Header `Amount`/`Netto` dokumen manapun (SalesOrder/SalesInvoice/SalesReturn) SELALU direcompute sebagai `SUM` baris detailnya sendiri setelah baris detail berubah — tidak pernah dihitung terpisah/diasumsikan.
- Setiap `TransDate` baru yang dibuat memakai `getNaiveWibTransDate()` (`src/lib/business-date.ts`) — bukan `new Date()`/`GETDATE()` langsung pada kolom TransDate — mengikuti pola yang sudah ada persis di `confirmStopDelivery`/`takeAwaySelesaiMuat`.
- Retur berkondisi `RUSAK` tidak PERNAH boleh muncul di jalur Jual Ulang manapun — validasi ini WAJIB di server (query layer), bukan cuma disembunyikan di UI.
- Setiap eksekusi Jual Ulang (jalur a/b/c) WAJIB membaca ulang "sisa tersedia" di DALAM transaksi yang sama sebelum menulis, dan menolak (AppError, tanpa partial-fill) kalau qty diminta melebihi sisa saat itu — pola claim-guard yang sama seperti `isiAirBaru`/`setBabonan` (`src/lib/queries/produksi-bak-pmpersada.ts`).
- Kerja langsung di branch `main`, tanpa worktree terpisah — konvensi baku sesi ini.

---

### Task 1: Migrasi skema — KondisiRetur, tabel ReturResale, BusinessPartner Retail Return

**Files:**
- Create: `scripts/create-retur-resale-schema.ts`

**Interfaces:**
- Consumes: `getPool` dari `src/lib/db.ts` (pola sama seperti `scripts/create-satpam-jadwal-jaga-table.ts`).
- Produces: kolom `DashboardPengirimanStopDeliveryItem.KondisiRetur`, tabel `DashboardPengirimanReturResale`, baris `BusinessPartner` dengan `BusinessPartnerID = 'RETAILRETURN'` — dipakai oleh Task 2 (kolom) dan Task 5 (tabel + BusinessPartnerID) selanjutnya.

- [ ] **Step 1: Tulis script migrasi idempotent**

```ts
// One-off schema migration for the "Jual Ulang Es Retur di Rute
// Pengiriman" feature -- idempotent, safe to re-run.
// Usage: npx tsx scripts/create-retur-resale-schema.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('DashboardPengirimanStopDeliveryItem') AND name = 'KondisiRetur'
    )
    ALTER TABLE DashboardPengirimanStopDeliveryItem ADD KondisiRetur VARCHAR(10) NULL
  `);
  console.log("DashboardPengirimanStopDeliveryItem.KondisiRetur ready.");

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardPengirimanReturResale' AND xtype='U')
    CREATE TABLE DashboardPengirimanReturResale (
      ResaleID                INT IDENTITY PRIMARY KEY,
      StopDeliveryItemID      INT NOT NULL,
      Jalur                   VARCHAR(20) NOT NULL,
      Qty                     DECIMAL(23,4) NOT NULL,
      TargetSalesOrderDetailID VARCHAR(16) NULL,
      SalesOrderID            VARCHAR(16) NULL,
      LokasiLat               DECIMAL(10,7) NULL,
      LokasiLng               DECIMAL(10,7) NULL,
      DicatatOlehAkunID       INT NOT NULL,
      DicatatVia              VARCHAR(10) NOT NULL,
      CreatedDate             DATETIME NOT NULL DEFAULT GETDATE(),
      CONSTRAINT FK_ReturResale_StopDeliveryItem FOREIGN KEY (StopDeliveryItemID)
        REFERENCES DashboardPengirimanStopDeliveryItem(StopDeliveryItemID)
    )
  `);
  console.log("DashboardPengirimanReturResale ready.");

  const existing = await pool
    .request()
    .query(`SELECT BusinessPartnerID FROM BusinessPartner WHERE BusinessPartnerID = 'RETAILRETURN'`);
  if (existing.recordset.length === 0) {
    await pool.request().query(`
      INSERT INTO BusinessPartner
        (BusinessPartnerID, Name, IsDeleted, IsCustomer, IsSupplier, IsEmployee, Gender, SalesmanID)
      VALUES
        ('RETAILRETURN', 'Retail Return', 0, 1, 0, 0, 'Other', NULL)
    `);
    console.log("BusinessPartner 'RETAILRETURN' seeded.");
  } else {
    console.log("BusinessPartner 'RETAILRETURN' already exists, skipped.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Catatan: kolom `BusinessPartner` yang dipakai di INSERT di atas (`IsCustomer`, `IsSupplier`, `IsEmployee`, `Gender`, `SalesmanID`) harus dicocokkan dulu terhadap skema `BusinessPartner` yang sungguhan sebelum menjalankan — jalankan `SELECT TOP 1 * FROM BusinessPartner` (atau `sp_columns BusinessPartner`) lewat MCP SQL tool yang tersedia di sesi ini untuk memastikan nama kolom & NOT NULL constraint lain (mis. `NPWPName`/`Alamat` yang dipakai mitra biasa) tidak wajib diisi — sesuaikan daftar kolom INSERT di atas kalau ada NOT NULL lain yang belum tercakup, sebelum commit step ini.

- [ ] **Step 2: Jalankan migrasi**

Run: `npx tsx scripts/create-retur-resale-schema.ts`
Expected: tiga baris "ready"/"seeded" tercetak, tanpa error. Jalankan dua kali untuk memastikan idempotent (kedua kali harus mencetak "already exists"/tidak menduplikasi kolom).

- [ ] **Step 3: Verifikasi lewat SQL langsung**

Run query verifikasi (lewat MCP SQL tool yang tersedia di sesi ini):
```sql
SELECT COL_NAME(object_id, column_id) FROM sys.columns WHERE object_id = OBJECT_ID('DashboardPengirimanStopDeliveryItem') AND name = 'KondisiRetur';
SELECT * FROM DashboardPengirimanReturResale; -- harus kosong, tabel baru
SELECT BusinessPartnerID, Name FROM BusinessPartner WHERE BusinessPartnerID = 'RETAILRETURN';
```
Expected: kolom ada, tabel ada dan kosong, baris "Retail Return" ada.

- [ ] **Step 4: Commit**

```bash
git add scripts/create-retur-resale-schema.ts
git commit -m "feat: add schema for retur resale (KondisiRetur, ReturResale table, Retail Return BP)"
```

---

### Task 2: Kondisi Retur — capture backend + picker UI driver-app

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts` (`StopDeliveryItemInput`, `confirmStopDelivery`'s INSERT ke `DashboardPengirimanStopDeliveryItem`, `StopDeliveryProofItem`, `getStopDeliveryProof`'s SELECT)
- Modify: `src/components/driver-app/stop-flow.tsx` (`KonfirKirimResult`)
- Modify: `src/components/driver-app/steps/konfir-kirim-step.tsx` (picker Baik/Rusak + assembly)

**Interfaces:**
- Consumes: tidak ada dari task lain (Task 1's kolom `KondisiRetur` sudah ada di DB).
- Produces: `StopDeliveryItemInput.kondisiRetur: "BAIK" | "RUSAK" | null`, `StopDeliveryProofItem.kondisiRetur: "BAIK" | "RUSAK" | null` — dipakai Task 3's `getSisaReturTersedia` dan Task 9's tampilan detail.

- [ ] **Step 1: Tambah field ke `StopDeliveryItemInput` dan `ConfirmStopDeliveryInput`'s pemakainya**

Di `src/lib/queries/pengiriman-jadwal.ts`, cari `export interface StopDeliveryItemInput` (sekitar baris 2701) dan tambahkan field:

```ts
export interface StopDeliveryItemInput {
  salesOrderDetailId: string;
  qtyDiterima: number;
  fotoReturUrl: string | null;
  keteranganRetur: string | null;
  // Wajib diisi ('BAIK' | 'RUSAK') kalau item ini retur (qtyDiterima <
  // qty yang dimuat); null kalau tidak retur. Divalidasi di
  // confirmStopDelivery, bukan cuma di UI -- lihat Step 2.
  kondisiRetur: "BAIK" | "RUSAK" | null;
}
```

- [ ] **Step 2: Validasi kondisiRetur wajib diisi kalau ada retur, di `confirmStopDelivery`**

Di fungsi yang sama, cari blok validasi sebelum `transaction.begin()` (sekitar baris 2801-2808, loop `for (const item of input.items)`), tambahkan pengecekan setelah pengecekan `qtyDiterima > sod.Qty` yang sudah ada:

```ts
    if (item.qtyDiterima < sod.Qty && item.kondisiRetur == null) {
      throw new AppError(`Kondisi retur untuk ${sod.Name} wajib dipilih (Baik atau Rusak).`);
    }
```

- [ ] **Step 3: Simpan `KondisiRetur` di INSERT `DashboardPengirimanStopDeliveryItem`**

Cari blok INSERT `DashboardPengirimanStopDeliveryItem` (sekitar baris 3057-3070), tambahkan input dan kolom:

```ts
      await new sql.Request(transaction)
        .input("stopDeliveryId", sql.Int, existingStopRow.StopDeliveryID)
        .input("soDetailId", sql.VarChar(16), sod.SalesOrderDetailID)
        .input("itemId", sql.VarChar(160), sod.ItemID)
        .input("qtyDimuat", sql.Decimal(23, 4), sod.Qty)
        .input("qtyDiterima", sql.Decimal(23, 4), item.qtyDiterima)
        .input("qtyRetur", sql.Decimal(23, 4), qtyRetur)
        .input("fotoRetur", sql.VarChar(255), item.fotoReturUrl)
        .input("keteranganRetur", sql.VarChar(500), item.keteranganRetur)
        .input("kondisiRetur", sql.VarChar(10), item.kondisiRetur).query(`
          INSERT INTO DashboardPengirimanStopDeliveryItem
            (StopDeliveryID, SalesOrderDetailID, ItemID, QtyDimuat, QtyDiterima, QtyRetur, FotoReturUrl, KeteranganRetur, KondisiRetur)
          VALUES
            (@stopDeliveryId, @soDetailId, @itemId, @qtyDimuat, @qtyDiterima, @qtyRetur, @fotoRetur, @keteranganRetur, @kondisiRetur)
        `);
```

- [ ] **Step 4: Tambah `kondisiRetur` ke `StopDeliveryProofItem` dan SELECT-nya**

Cari `export interface StopDeliveryProofItem` (sekitar baris 3097) dan `getStopDeliveryProof`'s SELECT yang membaca `DashboardPengirimanStopDeliveryItem` (sekitar baris 3180-3195) — tambahkan `kondisiRetur: "BAIK" | "RUSAK" | null` ke interface dan `sd.KondisiRetur` ke kolom SELECT + mapping return value-nya (pola yang sama seperti `qtyRetur`/`keteranganRetur` yang sudah ada persis di baris itu).

- [ ] **Step 5: Tambah `kondisiRetur` ke `KonfirKirimResult`**

Di `src/components/driver-app/stop-flow.tsx`, ubah:

```ts
export interface KonfirKirimResult {
  items: {
    salesOrderDetailId: string;
    qtyDiterima: number;
    fotoReturUrl: string | null;
    keteranganRetur: string | null;
    kondisiRetur: "BAIK" | "RUSAK" | null;
  }[];
  fotoBuktiUrls: string[];
  tanpaPembayaran: boolean;
}
```

- [ ] **Step 6: Tambah state + picker UI di `konfir-kirim-step.tsx`**

Tambah state baru di dekat `keteranganRetur`:

```ts
  const [kondisiRetur, setKondisiRetur] = useState<Record<string, "BAIK" | "RUSAK">>({});
```

Di dalam blok `{retur > 0 && (...)}` (sekitar baris 190-241), TEPAT SEBELUM baris `<div className="flex items-center justify-between gap-2">` yang berisi teks "Retur: {retur}", sisipkan dua tombol pilihan:

```tsx
                  <div className="flex gap-1.5">
                    <Button
                      type="button"
                      size="xs"
                      variant={kondisiRetur[item.SalesOrderDetailID] === "BAIK" ? "default" : "outline"}
                      onClick={() => setKondisiRetur((prev) => ({ ...prev, [item.SalesOrderDetailID]: "BAIK" }))}
                    >
                      Baik
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant={kondisiRetur[item.SalesOrderDetailID] === "RUSAK" ? "default" : "outline"}
                      onClick={() => setKondisiRetur((prev) => ({ ...prev, [item.SalesOrderDetailID]: "RUSAK" }))}
                    >
                      Rusak
                    </Button>
                  </div>
```

- [ ] **Step 7: Validasi wajib pilih kondisi sebelum submit + kirim ke `onNext`**

Di `handleSubmit` (sekitar baris 100), sebelum `setSubmitting(true)`, tambahkan validasi:

```ts
    const returTanpaKondisi = items.some(
      (item) => (qtyDiterima[item.SalesOrderDetailID] ?? item.Qty) < item.Qty && !kondisiRetur[item.SalesOrderDetailID]
    );
    if (returTanpaKondisi) {
      setError("Kondisi retur (Baik/Rusak) wajib dipilih untuk setiap item yang retur.");
      return;
    }
```

Lalu di `resultItems` mapping (sekitar baris 113-132), tambahkan field:

```ts
          return {
            salesOrderDetailId: item.SalesOrderDetailID,
            qtyDiterima: qtyDiterima[item.SalesOrderDetailID] ?? item.Qty,
            fotoReturUrl,
            keteranganRetur: keteranganRetur[item.SalesOrderDetailID]?.trim() || null,
            kondisiRetur: kondisiRetur[item.SalesOrderDetailID] ?? null,
          };
```

- [ ] **Step 8: Verifikasi**

Run: `npx tsc --noEmit`
Expected: tidak ada error tipe (semua pemanggil `StopDeliveryItemInput`/`KonfirKirimResult` sudah konsisten).

Run: `npx eslint src/lib/queries/pengiriman-jadwal.ts src/components/driver-app/stop-flow.tsx src/components/driver-app/steps/konfir-kirim-step.tsx`
Expected: tidak ada error baru.

Login sebagai driver di `/mkesindo/driver-app`, jalankan sampai stop dengan retur (kurangi qty di layar Konfirmasi Muatan), pastikan tombol Baik/Rusak muncul dan submit ditolak kalau belum dipilih. Setelah submit, verifikasi lewat SQL:
```sql
SELECT TOP 5 StopDeliveryItemID, QtyRetur, KondisiRetur FROM DashboardPengirimanStopDeliveryItem WHERE QtyRetur > 0 ORDER BY StopDeliveryItemID DESC;
```
Expected: baris terbaru punya `KondisiRetur` terisi sesuai yang dipilih.

- [ ] **Step 9: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts src/components/driver-app/stop-flow.tsx src/components/driver-app/steps/konfir-kirim-step.tsx
git commit -m "feat: capture Kondisi Retur (Baik/Rusak) at driver stop confirmation"
```

---

### Task 3: Query layer — sisa retur tersedia + helper bersama (SR reduction, resale insert)

**Files:**
- Create: `src/lib/queries/retur-resale.ts`

**Interfaces:**
- Consumes: `DashboardPengirimanStopDeliveryItem.KondisiRetur` (Task 2), `DashboardPengirimanReturResale` (Task 1).
- Produces:
  - `interface SisaReturRow { stopDeliveryItemId: number; jadwalDetailId: number; stopCustomerName: string; itemId: string; itemName: string; sisaQty: number; price: number; salesOrderDetailId: string; salesReturnId: string }`
  - `getSisaReturTersedia(jadwalId: number): Promise<SisaReturRow[]>`
  - `async function kurangiSalesReturDetail(transaction: sql.Transaction, salesReturnId: string, salesOrderDetailId: string, qty: number): Promise<void>` (tidak diekspor — dipakai Task 4/5 lewat file yang sama)
  - `async function claimSisaReturAtauGagal(transaction: sql.Transaction, stopDeliveryItemId: number, qtyDiminta: number): Promise<{ itemId: string; itemName: string; price: number; salesOrderDetailId: string; salesReturnId: string; sisaSebelumnya: number }>` (tidak diekspor — claim-guard bersama, dipakai Task 4/5)
  - `async function insertReturResale(transaction: sql.Transaction, input: { stopDeliveryItemId: number; jalur: "DALAM_RUTE" | "LUAR_RUTE" | "RETAIL"; qty: number; targetSalesOrderDetailId: string | null; salesOrderId: string | null; lokasiLat: number | null; lokasiLng: number | null; akunId: number; via: "DRIVER" | "DISPATCHER" }): Promise<void>` (tidak diekspor)

- [ ] **Step 1: Buat file dengan `getSisaReturTersedia`**

```ts
import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";

export interface SisaReturRow {
  stopDeliveryItemId: number;
  jadwalDetailId: number;
  stopCustomerName: string;
  itemId: string;
  itemName: string;
  sisaQty: number;
  price: number;
  salesOrderDetailId: string;
  salesReturnId: string;
}

// Baris StopDeliveryItem berkondisi Baik dengan sisa > 0, untuk satu
// Jadwal -- dipakai badge + panel detail Papan Pengiriman & driver-app.
// "Sisa" dihitung live dari QtyRetur dikurangi SUM ReturResale yang sudah
// terjadi untuk baris itu, tidak pernah disimpan sebagai kolom sendiri.
export async function getSisaReturTersedia(jadwalId: number): Promise<SisaReturRow[]> {
  const pool = await getPool();
  const result = await pool.request().input("jadwalId", sql.Int, jadwalId).query(`
    SELECT
        sdi.StopDeliveryItemID, jd.JadwalDetailID, bp.Name AS StopCustomerName,
        sdi.ItemID, sod.Name AS ItemName, sod.Price, sdi.SalesOrderDetailID,
        sd.SalesReturnID,
        sdi.QtyRetur - ISNULL(rr.SudahTerjual, 0) AS SisaQty
    FROM DashboardPengirimanStopDeliveryItem sdi
    JOIN DashboardPengirimanStopDelivery sd ON sd.StopDeliveryID = sdi.StopDeliveryID
    JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalDetailID = sd.JadwalDetailID
    JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
    JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    JOIN SalesOrderDetail sod ON sod.SalesOrderDetailID = sdi.SalesOrderDetailID
    OUTER APPLY (
        SELECT SUM(Qty) AS SudahTerjual FROM DashboardPengirimanReturResale
        WHERE StopDeliveryItemID = sdi.StopDeliveryItemID
    ) rr
    WHERE jd.JadwalID = @jadwalId
      AND sdi.KondisiRetur = 'BAIK'
      AND sdi.QtyRetur > 0
      AND (sdi.QtyRetur - ISNULL(rr.SudahTerjual, 0)) > 0
  `);
  return (result.recordset as {
    StopDeliveryItemID: number;
    JadwalDetailID: number;
    StopCustomerName: string;
    ItemID: string;
    ItemName: string;
    Price: number;
    SalesOrderDetailID: string;
    SalesReturnID: string;
    SisaQty: number;
  }[]).map((r) => ({
    stopDeliveryItemId: r.StopDeliveryItemID,
    jadwalDetailId: r.JadwalDetailID,
    stopCustomerName: r.StopCustomerName,
    itemId: r.ItemID,
    itemName: r.ItemName,
    sisaQty: r.SisaQty,
    price: r.Price,
    salesOrderDetailId: r.SalesOrderDetailID,
    salesReturnId: r.SalesReturnID,
  }));
}
```

- [ ] **Step 2: Tambah claim-guard bersama `claimSisaReturAtauGagal`**

Tambahkan di file yang sama, di bawah `getSisaReturTersedia`:

```ts
// Claim-guard bersama untuk ketiga jalur Jual Ulang -- membaca ulang sisa
// tersedia DI DALAM transaksi yang sama (bukan dari state yang sudah
// di-fetch pemanggil), menolak kalau qty diminta melebihi sisa saat itu.
// Sama sekali tidak melakukan partial-fill otomatis.
async function claimSisaReturAtauGagal(
  transaction: sql.Transaction,
  stopDeliveryItemId: number,
  qtyDiminta: number
): Promise<{ itemId: string; itemName: string; price: number; salesOrderDetailId: string; salesReturnId: string; sisaSebelumnya: number }> {
  const result = await new sql.Request(transaction).input("id", sql.Int, stopDeliveryItemId).query(`
    SELECT
        sdi.ItemID, sod.Name AS ItemName, sod.Price, sdi.SalesOrderDetailID, sd.SalesReturnID,
        sdi.QtyRetur - ISNULL((SELECT SUM(Qty) FROM DashboardPengirimanReturResale WHERE StopDeliveryItemID = sdi.StopDeliveryItemID), 0) AS SisaQty,
        sdi.KondisiRetur
    FROM DashboardPengirimanStopDeliveryItem sdi
    JOIN DashboardPengirimanStopDelivery sd ON sd.StopDeliveryID = sdi.StopDeliveryID
    JOIN SalesOrderDetail sod ON sod.SalesOrderDetailID = sdi.SalesOrderDetailID
    WHERE sdi.StopDeliveryItemID = @id
  `);
  const row = result.recordset[0] as
    | { ItemID: string; ItemName: string; Price: number; SalesOrderDetailID: string; SalesReturnID: string; SisaQty: number; KondisiRetur: string | null }
    | undefined;
  if (!row) throw new AppError("Baris retur tidak ditemukan.");
  if (row.KondisiRetur !== "BAIK") throw new AppError("Retur ini berkondisi Rusak, tidak bisa dijual ulang.");
  if (qtyDiminta <= 0) throw new AppError("Qty yang dijual ulang harus lebih dari 0.");
  if (qtyDiminta > row.SisaQty) {
    throw new AppError(`Sisa retur yang tersedia tinggal ${row.SisaQty}, tidak bisa menjual ${qtyDiminta}.`);
  }
  return {
    itemId: row.ItemID,
    itemName: row.ItemName,
    price: row.Price,
    salesOrderDetailId: row.SalesOrderDetailID,
    salesReturnId: row.SalesReturnID,
    sisaSebelumnya: row.SisaQty,
  };
}
```

- [ ] **Step 3: Tambah `kurangiSalesReturDetail`**

```ts
// Mengurangi SalesReturnDetail (dan header SalesReturn) sebesar qty yang
// berhasil dijual ulang -- berlaku sama di ketiga jalur, dipanggil setelah
// claimSisaReturAtauGagal berhasil, di dalam transaksi yang sama.
async function kurangiSalesReturDetail(
  transaction: sql.Transaction,
  salesReturnId: string,
  salesOrderDetailId: string,
  qty: number
): Promise<void> {
  const result = await new sql.Request(transaction)
    .input("srId", sql.VarChar(16), salesReturnId)
    .input("soDetailId", sql.VarChar(16), salesOrderDetailId)
    .query(
      `SELECT SalesReturnDetailID, Qty, Price FROM SalesReturnDetail WHERE SalesReturnID = @srId AND SalesOrderDetailID = @soDetailId`
    );
  const row = result.recordset[0] as { SalesReturnDetailID: string; Qty: number; Price: number } | undefined;
  if (!row) throw new AppError("Baris SalesReturnDetail untuk retur ini tidak ditemukan.");

  const newQty = row.Qty - qty;
  const newAmount = newQty * row.Price;
  await new sql.Request(transaction)
    .input("id", sql.VarChar(16), row.SalesReturnDetailID)
    .input("qty", sql.Decimal(23, 4), newQty)
    .input("amount", sql.Decimal(23, 4), newAmount)
    .query(
      `UPDATE SalesReturnDetail SET Qty = @qty, Amount = @amount, Netto = @amount, Value = @amount, Retur = @qty WHERE SalesReturnDetailID = @id`
    );

  await new sql.Request(transaction).input("srId", sql.VarChar(16), salesReturnId).query(`
    UPDATE SalesReturn SET
      Amount = (SELECT ISNULL(SUM(Amount), 0) FROM SalesReturnDetail WHERE SalesReturnID = @srId),
      Netto = (SELECT ISNULL(SUM(Amount), 0) FROM SalesReturnDetail WHERE SalesReturnID = @srId)
    WHERE SalesReturnID = @srId
  `);
}
```

- [ ] **Step 4: Tambah `insertReturResale`**

```ts
async function insertReturResale(
  transaction: sql.Transaction,
  input: {
    stopDeliveryItemId: number;
    jalur: "DALAM_RUTE" | "LUAR_RUTE" | "RETAIL";
    qty: number;
    targetSalesOrderDetailId: string | null;
    salesOrderId: string | null;
    lokasiLat: number | null;
    lokasiLng: number | null;
    akunId: number;
    via: "DRIVER" | "DISPATCHER";
  }
): Promise<void> {
  await new sql.Request(transaction)
    .input("stopDeliveryItemId", sql.Int, input.stopDeliveryItemId)
    .input("jalur", sql.VarChar(20), input.jalur)
    .input("qty", sql.Decimal(23, 4), input.qty)
    .input("targetSodId", sql.VarChar(16), input.targetSalesOrderDetailId)
    .input("soId", sql.VarChar(16), input.salesOrderId)
    .input("lat", sql.Decimal(10, 7), input.lokasiLat)
    .input("lng", sql.Decimal(10, 7), input.lokasiLng)
    .input("akunId", sql.Int, input.akunId)
    .input("via", sql.VarChar(10), input.via).query(`
      INSERT INTO DashboardPengirimanReturResale
        (StopDeliveryItemID, Jalur, Qty, TargetSalesOrderDetailID, SalesOrderID, LokasiLat, LokasiLng, DicatatOlehAkunID, DicatatVia)
      VALUES
        (@stopDeliveryItemId, @jalur, @qty, @targetSodId, @soId, @lat, @lng, @akunId, @via)
    `);
}

export { claimSisaReturAtauGagal, kurangiSalesReturDetail, insertReturResale };
```

(Diekspor lewat named export terpisah di akhir file, bukan `export async function` langsung di definisinya, supaya jelas ini "internal API" antar-fungsi jalur di file yang sama/Task 4-5, bukan API publik untuk actions layer.)

- [ ] **Step 5: Verifikasi**

Run: `npx tsc --noEmit`
Expected: bersih (Task 4/5 belum memakai `claimSisaReturAtauGagal` dkk, jadi belum ada unused-import warning sampai task itu).

Run scratch script terhadap DB live untuk `getSisaReturTersedia`: cari satu `JadwalID` nyata yang punya retur berkondisi Baik (dari Task 2's verifikasi), panggil fungsi ini, `console.log` hasilnya, pastikan `sisaQty` sama dengan `QtyRetur` (belum ada resale sama sekali).

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/retur-resale.ts
git commit -m "feat: add retur-resale query layer (sisa tersedia, SR reduction, resale insert helpers)"
```

---

### Task 4: Query layer — Jalur (a) jual ulang dalam rute

**Files:**
- Modify: `src/lib/queries/retur-resale.ts`

**Interfaces:**
- Consumes: `claimSisaReturAtauGagal`, `kurangiSalesReturDetail`, `insertReturResale` (Task 3).
- Produces: `jualUlangDalamRute(stopDeliveryItemId: number, targetJadwalDetailId: number, qty: number, akunId: number, via: "DRIVER" | "DISPATCHER"): Promise<void>` — dipakai Task 6 (actions).

- [ ] **Step 1: Tambah fungsi `jualUlangDalamRute`**

Reuse teknik pencocokan posisi DeliveryOrderDetail<->SalesInvoiceDetail yang PERSIS sama dengan `confirmStopDelivery` (`src/lib/queries/pengiriman-jadwal.ts`, baris ~2895-2955) — baca fungsi itu dulu sebelum menulis ini, supaya teknik matching-nya benar-benar sama, bukan reinterpretasi.

```ts
export async function jualUlangDalamRute(
  stopDeliveryItemId: number,
  targetJadwalDetailId: number,
  qty: number,
  akunId: number,
  via: "DRIVER" | "DISPATCHER"
): Promise<void> {
  const pool = await getPool();

  const targetResult = await pool.request().input("id", sql.Int, targetJadwalDetailId).query(`
    SELECT jd.SalesOrderID, jd.DeliveryOrderID, jd.SalesInvoiceID, sd.JamSelesai
    FROM DashboardPengirimanJadwalDetail jd
    LEFT JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = jd.JadwalDetailID
    WHERE jd.JadwalDetailID = @id AND jd.IsDeleted = 0
  `);
  const target = targetResult.recordset[0] as
    | { SalesOrderID: string; DeliveryOrderID: string | null; SalesInvoiceID: string | null; JamSelesai: Date | null }
    | undefined;
  if (!target) throw new AppError("Stop tujuan tidak ditemukan.");
  if (target.JamSelesai) throw new AppError("Stop mitra ini sudah selesai, tidak bisa ditambah qty dari sini.");
  if (!target.DeliveryOrderID) throw new AppError("Stop tujuan belum Selesai Muat, tidak bisa ditambah qty dari sini.");

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const claim = await claimSisaReturAtauGagal(transaction, stopDeliveryItemId, qty);

    // Cari baris SalesOrderDetail milik SO target dengan ItemID yang sama.
    const existingSod = await new sql.Request(transaction)
      .input("soId", sql.VarChar(16), target.SalesOrderID)
      .input("itemId", sql.VarChar(160), claim.itemId)
      .query(`SELECT SalesOrderDetailID, Qty, Price, Name, Unit FROM SalesOrderDetail WHERE SalesOrderID = @soId AND ItemID = @itemId`);
    let targetSodRow = existingSod.recordset[0] as
      | { SalesOrderDetailID: string; Qty: number; Price: number; Name: string; Unit: string }
      | undefined;

    if (!targetSodRow) {
      // Item ini belum pernah dipesan mitra target hari ini -- insert baris baru.
      const newSodId = await nextSalesOrderDetailId(transaction);
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), newSodId)
        .input("soId", sql.VarChar(16), target.SalesOrderID)
        .input("itemId", sql.VarChar(160), claim.itemId)
        .input("name", sql.VarChar(150), claim.itemName)
        .input("qty", sql.Decimal(23, 4), qty)
        .input("price", sql.Decimal(23, 4), claim.price)
        .input("amount", sql.Decimal(23, 4), qty * claim.price).query(`
          INSERT INTO SalesOrderDetail (SalesOrderDetailID, SalesOrderID, ItemID, Name, Qty, Unit, Price, Disc, DiscValue, DiscRp, Ratio, Amount, FlagClosed)
          VALUES (@id, @soId, @itemId, @name, @qty, 'PCS', @price, 0, 0, 0, 1, @amount, '')
        `);
      targetSodRow = { SalesOrderDetailID: newSodId, Qty: 0, Price: claim.price, Name: claim.itemName, Unit: "PCS" };
    } else {
      const newQty = targetSodRow.Qty + qty;
      const newAmount = newQty * targetSodRow.Price;
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), targetSodRow.SalesOrderDetailID)
        .input("qty", sql.Decimal(23, 4), newQty)
        .input("amount", sql.Decimal(23, 4), newAmount)
        .query(`UPDATE SalesOrderDetail SET Qty = @qty, Amount = @amount WHERE SalesOrderDetailID = @id`);
    }

    // Cascade ke DeliveryOrderDetail, dicocokkan lewat SalesOrderDetailID.
    const existingDod = await new sql.Request(transaction)
      .input("doId", sql.VarChar(16), target.DeliveryOrderID)
      .input("soDetailId", sql.VarChar(16), targetSodRow.SalesOrderDetailID)
      .query(`SELECT DeliveryOrderDetailID, Qty, Delivered, Amount FROM DeliveryOrderDetail WHERE DeliveryOrderID = @doId AND SalesOrderDetailID = @soDetailId`);
    const dodRow = existingDod.recordset[0] as { DeliveryOrderDetailID: string; Qty: number; Delivered: number; Amount: number } | undefined;

    if (!dodRow) {
      const newDodId = await nextDeliveryOrderDetailId(transaction);
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), newDodId)
        .input("doId", sql.VarChar(16), target.DeliveryOrderID)
        .input("itemId", sql.VarChar(160), claim.itemId)
        .input("name", sql.VarChar(160), claim.itemName)
        .input("qty", sql.Decimal(23, 4), qty)
        .input("price", sql.Decimal(23, 4), claim.price)
        .input("amount", sql.Decimal(23, 4), qty * claim.price)
        .input("soDetailId", sql.VarChar(16), targetSodRow.SalesOrderDetailID).query(`
          INSERT INTO DeliveryOrderDetail (DeliveryOrderDetailID, DeliveryOrderID, ItemID, Qty, Unit, UnitRatio, Ratio, Price, Disc, DiscValue, DiscRp, Amount, Delivered, Name, Outstanding, Description, Cashback, SalesOrderDetailID)
          VALUES (@id, @doId, @itemId, @qty, 'PCS', @qty, 1, @price, 0, NULL, 0, @amount, @qty, @name, @qty, NULL, 0, @soDetailId)
        `);
    } else {
      const newQty = dodRow.Qty + qty;
      const newAmount = newQty * claim.price;
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), dodRow.DeliveryOrderDetailID)
        .input("qty", sql.Decimal(23, 4), newQty)
        .input("delivered", sql.Decimal(23, 4), dodRow.Delivered + qty)
        .input("amount", sql.Decimal(23, 4), newAmount)
        .query(`UPDATE DeliveryOrderDetail SET Qty = @qty, Delivered = @delivered, Amount = @amount WHERE DeliveryOrderDetailID = @id`);
    }
    await new sql.Request(transaction)
      .input("doId", sql.VarChar(16), target.DeliveryOrderID)
      .query(`UPDATE DeliveryOrder SET ModifiedDate = GETDATE() WHERE DeliveryOrderID = @doId`);

    // Cascade ke SalesInvoiceDetail kalau SI sudah terbit -- dicocokkan
    // lewat ItemID langsung DI SINI (bukan korespondensi posisi seperti
    // confirmStopDelivery) karena baris baru yang barusan
    // di-insert/diupdate di atas TIDAK PUNYA rekan SalesInvoiceDetail yang
    // "diciptakan di iterasi loop yang sama" seperti asumsi teknik posisi
    // itu -- di sini cukup ada SATU baris SalesInvoiceDetail per ItemID per
    // SO (order manual tidak pernah punya dua baris ItemID sama), jadi
    // pencocokan langsung lewat ItemID aman.
    if (target.SalesInvoiceID) {
      const existingSid = await new sql.Request(transaction)
        .input("siId", sql.VarChar(16), target.SalesInvoiceID)
        .input("itemId", sql.VarChar(160), claim.itemId)
        .query(`SELECT SalesInvoiceDetailID, Qty FROM SalesInvoiceDetail WHERE SalesInvoiceID = @siId AND ItemID = @itemId`);
      const sidRow = existingSid.recordset[0] as { SalesInvoiceDetailID: string; Qty: number } | undefined;

      if (!sidRow) {
        const newSidId = await nextSalesInvoiceDetailId(transaction);
        await new sql.Request(transaction)
          .input("id", sql.VarChar(16), newSidId)
          .input("siId", sql.VarChar(16), target.SalesInvoiceID)
          .input("itemId", sql.VarChar(160), claim.itemId)
          .input("name", sql.VarChar(160), claim.itemName)
          .input("qty", sql.Decimal(23, 4), qty)
          .input("price", sql.Decimal(23, 4), claim.price)
          .input("amount", sql.Decimal(23, 4), qty * claim.price).query(`
            INSERT INTO SalesInvoiceDetail (SalesInvoiceDetailID, SalesInvoiceID, ItemID, Qty, Unit, Ratio, UnitRatio, Price, Disc, DiscValue, DiscRp, Amount, Name, Value, Netto, Description, WaiterName, Cashback, Total)
            VALUES (@id, @siId, @itemId, @qty, 'PCS', 1, 1, @price, 0, 0, 0, @amount, @name, @amount, @amount, '', '', 0, NULL)
          `);
      } else {
        const newQty = sidRow.Qty + qty;
        const newAmount = newQty * claim.price;
        await new sql.Request(transaction)
          .input("id", sql.VarChar(16), sidRow.SalesInvoiceDetailID)
          .input("qty", sql.Decimal(23, 4), newQty)
          .input("amount", sql.Decimal(23, 4), newAmount)
          .query(`UPDATE SalesInvoiceDetail SET Qty = @qty, Amount = @amount, Netto = @amount, Value = @amount WHERE SalesInvoiceDetailID = @id`);
      }
      await new sql.Request(transaction).input("siId", sql.VarChar(16), target.SalesInvoiceID).query(`
        UPDATE SalesInvoice SET
          Amount = (SELECT ISNULL(SUM(Amount), 0) FROM SalesInvoiceDetail WHERE SalesInvoiceID = @siId),
          Netto = (SELECT ISNULL(SUM(Amount), 0) FROM SalesInvoiceDetail WHERE SalesInvoiceID = @siId)
        WHERE SalesInvoiceID = @siId
      `);
    }

    // Recompute header SalesOrder.
    await new sql.Request(transaction).input("soId", sql.VarChar(16), target.SalesOrderID).query(`
      UPDATE SalesOrder SET
        Amount = (SELECT ISNULL(SUM(Amount), 0) FROM SalesOrderDetail WHERE SalesOrderID = @soId),
        Netto = (SELECT ISNULL(SUM(Amount), 0) FROM SalesOrderDetail WHERE SalesOrderID = @soId),
        ModifiedDate = GETDATE()
      WHERE SalesOrderID = @soId
    `);

    await kurangiSalesReturDetail(transaction, claim.salesReturnId, claim.salesOrderDetailId, qty);
    await insertReturResale(transaction, {
      stopDeliveryItemId,
      jalur: "DALAM_RUTE",
      qty,
      targetSalesOrderDetailId: targetSodRow.SalesOrderDetailID,
      salesOrderId: null,
      lokasiLat: null,
      lokasiLng: null,
      akunId,
      via,
    });

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
```

Tambahkan import `nextSalesOrderDetailId`, `nextDeliveryOrderDetailId`, `nextSalesInvoiceDetailId` — cek dulu apakah fungsi `next*Id` ini sudah diekspor dari `src/lib/queries/sales-order.ts`/`pengiriman-jadwal.ts` (pola `SELECT MAX(TRY_CAST(...AS INT))+1` yang sudah dipakai berulang di codebase ini, lihat `nextSalesReturnId` di `pengiriman-jadwal.ts` baris ~1972 untuk pola persisnya) — kalau belum diekspor, tambahkan `export` di depan definisinya di file asalnya (perubahan minimal, jangan duplikasi logic next-ID yang sudah ada).

- [ ] **Step 2: Verifikasi tipe**

Run: `npx tsc --noEmit`
Expected: bersih. Kalau `next*Id` functions belum diekspor dari file asalnya, perbaiki dulu (tambah `export`) sampai bersih.

- [ ] **Step 3: Verifikasi live lewat scratch script**

Tulis scratch script sementara (`scratchpad`) yang: cari satu `StopDeliveryItemID` retur Baik dengan sisa > 0 dari Task 2/3's data uji, cari `JadwalDetailID` lain di Jadwal yang sama yang `JamSelesai IS NULL`, panggil `jualUlangDalamRute` dengan qty kecil (mis. 1), lalu query ulang `SalesOrderDetail`/`DeliveryOrderDetail`/`SalesReturnDetail` terkait untuk konfirmasi qty berubah benar dan `SUM(Amount)` header cocok.

Expected: qty SO/DO target naik tepat sebesar yang diminta, SR turun tepat sebesar itu, tidak ada baris dengan qty negatif.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/retur-resale.ts
git commit -m "feat: add Jalur (a) jual ulang dalam rute (SO/DO/SI qty cascade)"
```

---

### Task 5: Query layer — Jalur (b)/(c) SO-DO-SI baru (luar rute & retail)

**Files:**
- Modify: `src/lib/queries/retur-resale.ts`

**Interfaces:**
- Consumes: `claimSisaReturAtauGagal`, `kurangiSalesReturDetail`, `insertReturResale` (Task 3); `createSalesOrderManual` dari `src/lib/queries/sales-order.ts` (baca signature persisnya dulu sebelum dipakai — `CreateSalesOrderManualInput`).
- Produces: `jualUlangLuarRute(stopDeliveryItemId: number, businessPartnerId: string, qty: number, jadwalId: number, akunId: number, via: "DRIVER" | "DISPATCHER"): Promise<{ salesOrderId: string }>`, `jualUlangRetail(stopDeliveryItemId: number, qty: number, lokasiLat: number, lokasiLng: number, jadwalId: number, akunId: number, via: "DRIVER" | "DISPATCHER"): Promise<{ salesOrderId: string }>` — dipakai Task 6.

- [ ] **Step 1: Baca dulu precedent DO+SI creation**

Baca `takeAwaySelesaiMuat` (`src/lib/queries/takeaway-muatan.ts`, baris ~227-410) SELURUHNYA sebelum menulis step berikutnya — ini precedent PERSIS untuk "buat DeliveryOrder+DeliveryOrderDetail+SalesInvoice+SalesInvoiceDetail dari satu SalesOrder yang sudah ada", termasuk daftar kolom INSERT lengkap yang harus disalin persis (jangan menebak-nebak kolom BusinessPartner/DeliveryOrder/SalesInvoice yang tidak relevan seperti `ProjectID`/`BillOfQuantityID` — salin apa adanya dari precedent itu). Perbedaan dari precedent: (1) HARUS dibungkus `sql.Transaction` eksplisit (precedent itu TIDAK memakainya — pakai `pool.request()` polos berturutan — ini pelanggaran terhadap Global Constraints kalau ditiru mentah; task ini WAJIB membungkusnya, bukan meniru itu), (2) `VehicleNo`/`ExpeditionID` diisi dari armada Jadwal yang sedang berjalan (bukan string kosong), (3) `SalesmanID` dari `DashboardPengirimanJadwal.SalesmanID` milik `jadwalId` (bukan `TAKEAWAY_SALESMAN_ID`).

- [ ] **Step 2: Tambah helper internal `buatSoDoSiSekaligus`**

```ts
interface BuatSoDoSiInput {
  businessPartnerId: string;
  itemId: string;
  itemName: string;
  qty: number;
  price: number;
  jadwalId: number;
}

// Membuat SalesOrder + SalesOrderDetail + DeliveryOrder + DeliveryOrderDetail
// + SalesInvoice + SalesInvoiceDetail sekaligus, atomik, dalam SATU
// transaksi -- dipakai jalur (b)/(c) yang butuh dokumen langsung jadi saat
// itu juga (barangnya sudah di atas truk, tidak ada "Selesai Muat"
// susulan seperti TakeAway). Struktur INSERT DO/SI disalin dari
// takeAwaySelesaiMuat (src/lib/queries/takeaway-muatan.ts) dengan
// VehicleNo/ExpeditionID/SalesmanID diisi dari armada Jadwal yang sedang
// berjalan, bukan string kosong / TAKEAWAY_SALESMAN_ID.
async function buatSoDoSiSekaligus(transaction: sql.Transaction, input: BuatSoDoSiInput): Promise<{ salesOrderId: string; deliveryOrderId: string; salesInvoiceId: string }> {
  // PERINGATAN: JOIN di bawah ini (DashboardArmadaExpeditionDetail/
  // ExpeditionDetail) adalah TEBAKAN berbasis konvensi penamaan, BUKAN
  // dikonfirmasi lewat pembacaan langsung -- ada catatan sesi sebelumnya
  // ("Armada-ExpeditionDetail linkage") yang menyebutkan DO.VehicleNo/
  // ExpeditionID di kode LAIN sudah bersumber dari ExpeditionDetail yang
  // ditautkan ke Armada (plat nomor sungguhan), bukan dari Armada
  // langsung. SEBELUM memakai query ini, cari fungsi yang SUDAH
  // mengimplementasikan linkage itu (grep "ExpeditionDetail" di
  // src/lib/queries/pengiriman-jadwal.ts atau armada.ts) dan salin JOIN
  // yang SUNGGUHAN dipakai di sana -- jangan percaya nama tabel/kolom di
  // bawah ini tanpa verifikasi, ini cuma titik awal.
  const jadwalResult = await new sql.Request(transaction).input("jadwalId", sql.Int, input.jadwalId).query(`
    SELECT j.SalesmanID, a.PlatNomor, ed.ExpeditionID
    FROM DashboardPengirimanJadwal j
    LEFT JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
    LEFT JOIN DashboardArmadaExpeditionDetail aed ON aed.ArmadaID = j.ArmadaID AND aed.IsDeleted = 0
    LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = aed.ExpeditionDetailID
    WHERE j.JadwalID = @jadwalId AND j.IsDeleted = 0
  `);
  const jadwalRow = jadwalResult.recordset[0] as { SalesmanID: string | null; PlatNomor: string | null; ExpeditionID: string | null } | undefined;
  if (!jadwalRow) throw new AppError("Jadwal tidak ditemukan.");

  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const amount = input.qty * input.price;

  const salesOrderId = await nextSalesOrderId(transaction);
  const soVoucherSeq = await nextSOVoucherSeq(transaction, yearMonth);
  const soVoucherNo = `MKE/SO/${soVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
  const dueDate = now;
  await new sql.Request(transaction)
    .input("id", sql.VarChar(16), salesOrderId)
    .input("voucherNo", sql.VarChar(128), soVoucherNo)
    .input("bpId", sql.VarChar(16), input.businessPartnerId)
    .input("branchId", sql.VarChar(16), BRANCH_ID)
    .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
    .input("salesmanId", sql.VarChar(16), jadwalRow.SalesmanID)
    .input("transDate", sql.DateTime, getNaiveWibTransDate())
    .input("dueDate", sql.DateTime, dueDate)
    .input("amount", sql.Decimal(23, 4), amount).query(`
      INSERT INTO SalesOrder
        (SalesOrderID, VoucherNo, TransDate, DueDate, BranchID, DepartmentID, BusinessPartnerID, SalesmanID,
         Amount, Disc, DiscValue, DiscRp, Tax, TaxValue, Netto, IsClosed, IsInvoiced, IsDeleted, ModifiedDate,
         CurrencyID, Rate, StatusForm, TermOfPaymentID)
      VALUES
        (@id, @voucherNo, @transDate, @dueDate, @branchId, @departmentId, @bpId, @salesmanId,
         @amount, 0, 0, 0, 0, 0, @amount, 0, 0, 0, GETDATE(),
         '', 1, 1, '')
    `);
  const soDetailId = await nextSalesOrderDetailId(transaction);
  await new sql.Request(transaction)
    .input("id", sql.VarChar(16), soDetailId)
    .input("soId", sql.VarChar(16), salesOrderId)
    .input("itemId", sql.VarChar(160), input.itemId)
    .input("name", sql.VarChar(150), input.itemName)
    .input("qty", sql.Decimal(23, 4), input.qty)
    .input("price", sql.Decimal(23, 4), input.price)
    .input("amount", sql.Decimal(23, 4), amount).query(`
      INSERT INTO SalesOrderDetail (SalesOrderDetailID, SalesOrderID, ItemID, Name, Qty, Unit, Price, Disc, DiscValue, DiscRp, Ratio, Amount, FlagClosed)
      VALUES (@id, @soId, @itemId, @name, @qty, 'PCS', @price, 0, 0, 0, 1, @amount, '')
    `);

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
    .input("salesmanId", sql.VarChar(16), jadwalRow.SalesmanID)
    .input("expeditionId", sql.VarChar(16), jadwalRow.ExpeditionID ?? "")
    .input("vehicleNo", sql.VarChar(20), jadwalRow.PlatNomor ?? "")
    .input("transDate", sql.DateTime, getNaiveWibTransDate())
    .input("dueDate", sql.DateTime, dueDate).query(`
      INSERT INTO DeliveryOrder
        (DeliveryOrderID, VoucherNo, TransDate, BranchID, DepartmentID, BusinessPartnerID, Notes, SalesOrderID,
         IsClosed, ExpeditionID, VehicleNo, AddressDelivery, IsDeleted, ModifiedDate, PIC, ShippingNo,
         BusinessPartnerLocationID, IsInvoiced, CurrencyID, Rate, StatusForm, SalesmanID, OverLimit,
         ReferenceNo, DueDate, ProjectID, AddressDeliveryID, IsDOReturn)
      VALUES
        (@id, @voucherNo, @transDate, @branchId, @departmentId, @bpId, '', @soId,
         0, @expeditionId, @vehicleNo, '', 0, GETDATE(), '', NULL,
         NULL, 0, '', 1, 1, @salesmanId, 0,
         '', @dueDate, '', '', NULL)
    `);
  const doDetailId = await nextDeliveryOrderDetailId(transaction);
  await new sql.Request(transaction)
    .input("id", sql.VarChar(16), doDetailId)
    .input("doId", sql.VarChar(16), deliveryOrderId)
    .input("itemId", sql.VarChar(160), input.itemId)
    .input("name", sql.VarChar(160), input.itemName)
    .input("qty", sql.Decimal(23, 4), input.qty)
    .input("price", sql.Decimal(23, 4), input.price)
    .input("amount", sql.Decimal(23, 4), amount)
    .input("soDetailId", sql.VarChar(16), soDetailId).query(`
      INSERT INTO DeliveryOrderDetail
        (DeliveryOrderDetailID, DeliveryOrderID, ItemID, Qty, Unit, UnitRatio, Ratio, Price, Disc, DiscValue,
         DiscRp, Amount, Delivered, Name, Outstanding, Description, Cashback, SalesOrderDetailID)
      VALUES
        (@id, @doId, @itemId, @qty, 'PCS', @qty, 1, @price, 0, NULL,
         0, @amount, @qty, @name, @qty, NULL, 0, @soDetailId)
    `);

  const salesInvoiceId = await nextSalesInvoiceId(transaction);
  const siVoucherSeq = await nextSIVoucherSeq(transaction, yearMonth);
  const siVoucherNo = `MKE/SI/${siVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
  await new sql.Request(transaction)
    .input("id", sql.VarChar(16), salesInvoiceId)
    .input("voucherNo", sql.VarChar(128), siVoucherNo)
    .input("dueDate", sql.DateTime, dueDate)
    .input("soId", sql.VarChar(16), salesOrderId)
    .input("doId", sql.VarChar(16), `'${deliveryOrderId}'`)
    .input("bpId", sql.VarChar(16), input.businessPartnerId)
    .input("branchId", sql.VarChar(16), BRANCH_ID)
    .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
    .input("amount", sql.Decimal(23, 4), amount)
    .input("transDate", sql.DateTime, getNaiveWibTransDate())
    .input("salesmanId", sql.VarChar(16), jadwalRow.SalesmanID).query(`
      INSERT INTO SalesInvoice
        (SalesInvoiceID, VoucherNo, ReferenceNo, TaxNo, TransDate, DueDate, Notes, TermOfPaymentID,
         SalesOrderID, DeliveryOrderID, SalesDepositID, BusinessPartnerID, BranchID, DepartmentID,
         Amount, Disc, DiscValue, DiscRp, Tax, TaxValue, Netto, BankID, Paid, Deposit, PaidDate,
         IsClosed, IsDeleted, ModifiedDate, Rate, CurrencyID, IsAccountReceiveable, StatusForm,
         SalesmanID, ServiceTax, ServiceTaxValue, Visitor, IsTX, PromotionID, IsPerforma,
         DiscRpBefore, ProjectID, IsExported, BillOfQuantityID)
      VALUES
        (@id, @voucherNo, '', '', @transDate, @dueDate, '', '',
         @soId, @doId, '', @bpId, @branchId, @departmentId,
         @amount, 0, 0, 0, 0, 0, @amount, '', 0, 0, NULL,
         0, 0, GETDATE(), 1, '', 0, 1,
         @salesmanId, 0, 0, 0, 0, '', 0,
         0, '', 0, '')
    `);
  const siDetailId = await nextSalesInvoiceDetailId(transaction);
  await new sql.Request(transaction)
    .input("id", sql.VarChar(16), siDetailId)
    .input("siId", sql.VarChar(16), salesInvoiceId)
    .input("itemId", sql.VarChar(160), input.itemId)
    .input("name", sql.VarChar(160), input.itemName)
    .input("qty", sql.Decimal(23, 4), input.qty)
    .input("price", sql.Decimal(23, 4), input.price)
    .input("amount", sql.Decimal(23, 4), amount).query(`
      INSERT INTO SalesInvoiceDetail
        (SalesInvoiceDetailID, SalesInvoiceID, ItemID, Qty, Unit, Ratio, UnitRatio, Price, Disc, DiscValue,
         DiscRp, Amount, Name, Value, Netto, Description, WaiterName, Cashback, Total)
      VALUES
        (@id, @siId, @itemId, @qty, 'PCS', 1, 1, @price, 0, 0,
         0, @amount, @name, @amount, @amount, '', '', 0, NULL)
    `);

  await new sql.Request(transaction).input("soId", sql.VarChar(16), salesOrderId).query(`UPDATE SalesOrder SET IsClosed = 1, IsInvoiced = 1 WHERE SalesOrderID = @soId`);
  await new sql.Request(transaction).input("doId", sql.VarChar(16), deliveryOrderId).query(`UPDATE DeliveryOrder SET IsClosed = 1, IsInvoiced = 1 WHERE DeliveryOrderID = @doId`);

  return { salesOrderId, deliveryOrderId, salesInvoiceId };
}
```

Tambah import `nextSalesOrderId`, `nextSOVoucherSeq`, `nextDOVoucherSeq`, `nextSIVoucherSeq`, `BRANCH_ID`, `DEPARTMENT_ID`, `DOC_SUFFIX` dari file yang sudah mengekspornya (`sales-order.ts`/`pengiriman-jadwal.ts`/`takeaway-muatan.ts` — cek exact source masing-masing sebelum impor, jangan duplikasi konstanta yang sudah ada; kalau salah satu belum diekspor, tambahkan `export` di depannya).

- [ ] **Step 2: Tambah `jualUlangLuarRute` (harga dari Price Level mitra)**

```ts
export async function jualUlangLuarRute(
  stopDeliveryItemId: number,
  businessPartnerId: string,
  qty: number,
  jadwalId: number,
  akunId: number,
  via: "DRIVER" | "DISPATCHER"
): Promise<{ salesOrderId: string }> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const claim = await claimSisaReturAtauGagal(transaction, stopDeliveryItemId, qty);

    const priceResult = await new sql.Request(transaction)
      .input("bpId", sql.VarChar(16), businessPartnerId)
      .input("itemId", sql.VarChar(160), claim.itemId).query(`
        SELECT dpl.Price
        FROM BusinessPartner bp
        JOIN DashboardPriceLevel dpl ON dpl.PriceLevel = bp.PriceLevel AND dpl.ItemID = @itemId
        WHERE bp.BusinessPartnerID = @bpId
      `);
    const priceRow = priceResult.recordset[0] as { Price: number } | undefined;
    if (!priceRow) throw new AppError("Mitra ini belum punya Price Level untuk item retur ini.");

    const { salesOrderId } = await buatSoDoSiSekaligus(transaction, {
      businessPartnerId,
      itemId: claim.itemId,
      itemName: claim.itemName,
      qty,
      price: priceRow.Price,
      jadwalId,
    });

    await kurangiSalesReturDetail(transaction, claim.salesReturnId, claim.salesOrderDetailId, qty);
    await insertReturResale(transaction, {
      stopDeliveryItemId,
      jalur: "LUAR_RUTE",
      qty,
      targetSalesOrderDetailId: null,
      salesOrderId,
      lokasiLat: null,
      lokasiLng: null,
      akunId,
      via,
    });

    await transaction.commit();
    return { salesOrderId };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
```

Catatan: nama tabel/kolom Price Level (`DashboardPriceLevel`, `bp.PriceLevel`) harus dicocokkan dulu terhadap yang sungguhan dipakai `getPriceLevelOptions`/pricing lookup di `src/lib/queries/mitra.ts` (sudah dipakai `pemesanan-form-dialog.tsx`) — baca fungsi itu dan salin nama tabel/kolom persis, jangan menebak.

- [ ] **Step 3: Tambah `jualUlangRetail` (harga fixed, wajib lokasi)**

```ts
const RETAIL_RETURN_BP_ID = "RETAILRETURN";
const HARGA_RETAIL_RETURN_10KG = 8000;
const HARGA_RETAIL_RETURN_5KG = 6000;

export async function jualUlangRetail(
  stopDeliveryItemId: number,
  qty: number,
  lokasiLat: number,
  lokasiLng: number,
  jadwalId: number,
  akunId: number,
  via: "DRIVER" | "DISPATCHER"
): Promise<{ salesOrderId: string }> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const claim = await claimSisaReturAtauGagal(transaction, stopDeliveryItemId, qty);

    // ItemID untuk 10kg vs 5kg -- cek konstanta yang sudah ada
    // (KANTONG_ITEM_ID / KANTONG_VARIANTS di src/lib/queries/sales-order.ts)
    // alih-alih membandingkan string nama item secara manual di sini.
    const hargaFixed = claim.itemId === KANTONG_ITEM_ID ? HARGA_RETAIL_RETURN_10KG : HARGA_RETAIL_RETURN_5KG;

    const { salesOrderId } = await buatSoDoSiSekaligus(transaction, {
      businessPartnerId: RETAIL_RETURN_BP_ID,
      itemId: claim.itemId,
      itemName: claim.itemName,
      qty,
      price: hargaFixed,
      jadwalId,
    });

    await kurangiSalesReturDetail(transaction, claim.salesReturnId, claim.salesOrderDetailId, qty);
    await insertReturResale(transaction, {
      stopDeliveryItemId,
      jalur: "RETAIL",
      qty,
      targetSalesOrderDetailId: null,
      salesOrderId,
      lokasiLat,
      lokasiLng,
      akunId,
      via,
    });

    await transaction.commit();
    return { salesOrderId };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
```

Tambah import `KANTONG_ITEM_ID`/`KANTONG_VARIANTS` dari `src/lib/queries/sales-order.ts` (cek nama export persisnya dulu).

- [ ] **Step 4: Verifikasi tipe**

Run: `npx tsc --noEmit`
Expected: bersih setelah semua import next-ID/konstanta di atas dilengkapi dengan nama yang benar dari sumber aslinya.

- [ ] **Step 5: Verifikasi live**

Scratch script: panggil `jualUlangLuarRute` dengan satu mitra terdaftar nyata (bukan bagian Jadwal manapun) dan qty kecil, verifikasi SO+DO+SI baru muncul dengan `VehicleNo`/`ExpeditionID` = armada Jadwal asal, harga = Price Level mitra itu, SR turun benar. Ulangi untuk `jualUlangRetail`, verifikasi `BusinessPartnerID = 'RETAILRETURN'`, harga fixed benar sesuai varian, `LokasiLat`/`LokasiLng` tersimpan di `DashboardPengirimanReturResale`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/retur-resale.ts
git commit -m "feat: add Jalur (b)/(c) jual ulang luar rute & retail (atomic SO-DO-SI)"
```

---

### Task 6: Server Actions — desktop & driver-app

**Files:**
- Modify: `src/app/mkesindo/(dashboard)/delivery/actions.ts`
- Modify: `src/app/mkesindo/driver-app/actions.ts`

**Interfaces:**
- Consumes: `getSisaReturTersedia`, `jualUlangDalamRute`, `jualUlangLuarRute`, `jualUlangRetail` (Task 3/4/5).
- Produces: `getSisaReturTersediaAction`, `jualUlangDalamRuteAction`, `jualUlangLuarRuteAction`, `jualUlangRetailAction` di kedua file — dipakai Task 7 (badge+detail dialog) dan Task 8/9 (driver-app UI).

- [ ] **Step 1: Tambah actions di `delivery/actions.ts` (dispatcher)**

Cari gerbang akses yang dipakai action lain di file ini (mis. `getStopDeliveryProofAction` baris ~244 — baca guard apa yang dipakainya, kemungkinan `requireModuleAccess("delivery")` atau serupa) dan pakai gerbang yang SAMA untuk konsistensi:

```ts
import {
  getSisaReturTersedia,
  jualUlangDalamRute,
  jualUlangLuarRute,
  jualUlangRetail,
  type SisaReturRow,
} from "@/lib/queries/retur-resale";

export async function getSisaReturTersediaAction(jadwalId: number): Promise<ActionResult<SisaReturRow[]>> {
  return runAction(async () => {
    // ganti dengan guard yang sama persis dipakai getStopDeliveryProofAction di file ini
    return getSisaReturTersedia(jadwalId);
  });
}

export async function jualUlangDalamRuteAction(
  stopDeliveryItemId: number,
  targetJadwalDetailId: number,
  qty: number
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth(); // sesuaikan dengan pola auth() yang sudah dipakai file ini
    await jualUlangDalamRute(stopDeliveryItemId, targetJadwalDetailId, qty, Number(session!.user.id), "DISPATCHER");
    revalidatePath("/mkesindo/delivery");
  });
}

export async function jualUlangLuarRuteAction(
  stopDeliveryItemId: number,
  businessPartnerId: string,
  qty: number,
  jadwalId: number
): Promise<ActionResult<{ salesOrderId: string }>> {
  return runAction(async () => {
    const session = await auth();
    const result = await jualUlangLuarRute(stopDeliveryItemId, businessPartnerId, qty, jadwalId, Number(session!.user.id), "DISPATCHER");
    revalidatePath("/mkesindo/delivery");
    return result;
  });
}

export async function jualUlangRetailAction(
  stopDeliveryItemId: number,
  qty: number,
  lokasiLat: number,
  lokasiLng: number,
  jadwalId: number
): Promise<ActionResult<{ salesOrderId: string }>> {
  return runAction(async () => {
    const session = await auth();
    const result = await jualUlangRetail(stopDeliveryItemId, qty, lokasiLat, lokasiLng, jadwalId, Number(session!.user.id), "DISPATCHER");
    revalidatePath("/mkesindo/delivery");
    return result;
  });
}
```

Ganti komentar `// ganti dengan...` dan `// sesuaikan...` di atas dengan pola akses yang SUNGGUHAN dipakai action lain di file ini — baca dulu 2-3 action lain di file yang sama sebelum menulis, jangan asal pakai `auth()` polos kalau ternyata file ini konsisten pakai helper guard tertentu.

- [ ] **Step 2: Tambah actions yang sama di `driver-app/actions.ts` (driver)**

Pola guard: `requireOwnSalesmanId()` + `assertOwnsJadwalDetail`/`assertOwnsJadwal` yang SUDAH ADA di file ini (lihat `confirmStopDeliveryAction` baris ~86-96 untuk pola persisnya):

```ts
import {
  getSisaReturTersedia,
  jualUlangDalamRute,
  jualUlangLuarRute,
  jualUlangRetail,
  type SisaReturRow,
} from "@/lib/queries/retur-resale";

export async function getSisaReturTersediaDriverAction(jadwalId: number): Promise<ActionResult<SisaReturRow[]>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    await assertOwnsJadwal(jadwalId, salesmanId);
    return getSisaReturTersedia(jadwalId);
  });
}

export async function jualUlangDalamRuteDriverAction(
  stopDeliveryItemId: number,
  targetJadwalDetailId: number,
  qty: number,
  jadwalId: number
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    await assertOwnsJadwal(jadwalId, salesmanId);
    const session = await requireDriver();
    await jualUlangDalamRute(stopDeliveryItemId, targetJadwalDetailId, qty, Number(session.user.id), "DRIVER");
    revalidatePath("/mkesindo/driver-app");
  });
}

export async function jualUlangLuarRuteDriverAction(
  stopDeliveryItemId: number,
  businessPartnerId: string,
  qty: number,
  jadwalId: number
): Promise<ActionResult<{ salesOrderId: string }>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    await assertOwnsJadwal(jadwalId, salesmanId);
    const session = await requireDriver();
    const result = await jualUlangLuarRute(stopDeliveryItemId, businessPartnerId, qty, jadwalId, Number(session.user.id), "DRIVER");
    revalidatePath("/mkesindo/driver-app");
    return result;
  });
}

export async function jualUlangRetailDriverAction(
  stopDeliveryItemId: number,
  qty: number,
  lokasiLat: number,
  lokasiLng: number,
  jadwalId: number
): Promise<ActionResult<{ salesOrderId: string }>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    await assertOwnsJadwal(jadwalId, salesmanId);
    const session = await requireDriver();
    const result = await jualUlangRetail(stopDeliveryItemId, qty, lokasiLat, lokasiLng, jadwalId, Number(session.user.id), "DRIVER");
    revalidatePath("/mkesindo/driver-app");
    return result;
  });
}
```

Nama fungsi dibedakan dengan suffix `Driver` supaya tidak bentrok kalau kelak kedua actions file ini pernah diimpor bersamaan dari satu tempat (tidak terjadi sekarang, tapi konsisten dengan konvensi penamaan actions per-permukaan yang sudah ada di codebase ini).

- [ ] **Step 3: Verifikasi**

Run: `npx tsc --noEmit`
Expected: bersih.

Run: `npx eslint "src/app/mkesindo/(dashboard)/delivery/actions.ts" src/app/mkesindo/driver-app/actions.ts`
Expected: tidak ada error baru.

- [ ] **Step 4: Commit**

```bash
git add "src/app/mkesindo/(dashboard)/delivery/actions.ts" src/app/mkesindo/driver-app/actions.ts
git commit -m "feat: add server actions for retur resale (desktop + driver-app)"
```

---

### Task 7: Desktop UI — badge tanda seru merah di kartu Jadwal

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts` (tambahkan flag ke query yang menghasilkan `JadwalCardData` — cari fungsinya dulu, kemungkinan `getJadwalCards`/serupa, grep `JadwalCardData` untuk lokasi definisi & fungsi yang mengembalikannya)
- Modify: `src/components/dashboard/pengiriman-board.tsx` (`DraggableJadwalCard`)

**Interfaces:**
- Consumes: tabel `DashboardPengirimanReturResale`/`DashboardPengirimanStopDeliveryItem.KondisiRetur` (Task 1/2) — TIDAK perlu memanggil `getSisaReturTersedia` (Task 3) di sini, cukup satu flag boolean ringan lewat `EXISTS` langsung di query kartu, supaya tidak menambah beban per-kartu di board yang bisa berisi puluhan Jadwal sekaligus.
- Produces: `JadwalCardData.AdaReturTersedia: boolean` — dipakai `DraggableJadwalCard`.

- [ ] **Step 1: Cari & baca definisi `JadwalCardData` dan fungsi query-nya**

```bash
grep -n "interface JadwalCardData\|JadwalCardData\[\]" src/lib/queries/pengiriman-jadwal.ts
```

Baca fungsi yang mengembalikan array itu (SELECT-nya) sebelum lanjut ke step berikutnya.

- [ ] **Step 2: Tambah `AdaReturTersedia` ke interface dan query**

Tambahkan field ke `interface JadwalCardData`:

```ts
  // true kalau ada sisa qty retur berkondisi Baik yang masih tersedia
  // untuk dijual ulang di mana pun dalam Jadwal ini -- lihat
  // src/lib/queries/retur-resale.ts. Dihitung EXISTS ringan di sini
  // (bukan panggil getSisaReturTersedia penuh) karena query ini
  // menghasilkan puluhan kartu sekaligus untuk seluruh board.
  AdaReturTersedia: boolean;
```

Tambahkan ke SELECT fungsi query-nya (subquery `EXISTS`, dikorelasikan ke `j.JadwalID`):

```sql
,
CASE WHEN EXISTS (
    SELECT 1
    FROM DashboardPengirimanStopDeliveryItem sdi
    JOIN DashboardPengirimanStopDelivery sd ON sd.StopDeliveryID = sdi.StopDeliveryID
    JOIN DashboardPengirimanJadwalDetail jd2 ON jd2.JadwalDetailID = sd.JadwalDetailID
    WHERE jd2.JadwalID = j.JadwalID
      AND sdi.KondisiRetur = 'BAIK'
      AND sdi.QtyRetur > ISNULL((SELECT SUM(Qty) FROM DashboardPengirimanReturResale WHERE StopDeliveryItemID = sdi.StopDeliveryItemID), 0)
) THEN 1 ELSE 0 END AS AdaReturTersedia
```

Sesuaikan alias tabel Jadwal (`j`) dengan alias yang SUNGGUHAN dipakai query aslinya (cek di Step 1), dan tambahkan mapping `AdaReturTersedia: Boolean(row.AdaReturTersedia)` di baris return-nya (pola yang sama seperti field boolean lain yang sudah ada di fungsi itu, mis. `IsTarget` di `getCollectionPriority`).

- [ ] **Step 3: Render badge di `DraggableJadwalCard`**

Di `src/components/dashboard/pengiriman-board.tsx`, tambahkan `relative` ke className `<button>` yang sudah ada (baris ~573-584, tambahkan `"relative"` ke daftar class), dan sisipkan badge tepat setelah tag `<button ...>` dibuka (sebelum `<div className="flex items-center justify-between gap-1 leading-none">` baris 597):

```tsx
      {j.AdaReturTersedia && (
        <span
          title="Ada retur berkondisi Baik yang masih bisa dijual ulang"
          className="absolute -right-1 -top-1 z-10 flex size-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white"
        >
          !
        </span>
      )}
```

- [ ] **Step 4: Verifikasi**

Run: `npx tsc --noEmit` dan `npx eslint src/lib/queries/pengiriman-jadwal.ts src/components/dashboard/pengiriman-board.tsx`
Expected: bersih.

Buka `/mkesindo/delivery` dengan Jadwal yang punya retur Baik tersedia (dari data uji Task 2/4) — pastikan badge merah muncul di pojok kanan atas kartu itu, dan TIDAK muncul di kartu Jadwal lain yang tidak punya retur.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts src/components/dashboard/pengiriman-board.tsx
git commit -m "feat: add red badge on Jadwal card for available retur resale"
```

---

### Task 8: Desktop UI — detail retur per-stop + dialog Jual Ulang

**Files:**
- Read then modify: `src/components/dashboard/stop-delivery-proof-dialog.tsx`
- Create: `src/components/dashboard/jual-ulang-retur-dialog.tsx`

**Interfaces:**
- Consumes: `jualUlangDalamRuteAction`, `jualUlangLuarRuteAction`, `jualUlangRetailAction` (Task 6); `getJadwalDetailAction` (`src/app/mkesindo/(dashboard)/delivery/actions.ts`, sudah ada, mengembalikan `Promise<DriverStopRow[]>` langsung tanpa `ActionResult` — dipakai untuk daftar target jalur DALAM_RUTE, BUKAN `getSisaReturTersediaAction`, yang isinya daftar retur yang tersedia untuk dijual, bukan daftar stop yang bisa menerima); `MitraSelect` (`src/components/dashboard/mitra-select.tsx`, pola pemakaian di `pemesanan-form-dialog.tsx`); `MitraLocationMap` (`src/components/dashboard/mitra-location-map.tsx`).
- Produces: komponen `JualUlangReturDialog` — dipakai dari `stop-delivery-proof-dialog.tsx`.

- [ ] **Step 1: Baca `stop-delivery-proof-dialog.tsx` sepenuhnya**

Pahami bagaimana `proof.items[]` (dari `StopDeliveryProof`/`StopDeliveryProofItem`, sudah punya `kondisiRetur` sejak Task 2) dirender per item, dan bagaimana dialog ini menerima konteksnya dari `route-validation-dialog.tsx`. `route-validation-dialog.tsx` sudah memanggil `getStopDeliveryProof(jadwalDetailId)` dengan `jadwalDetailId` yang ia sendiri tahu (parameter fetch itu) DAN `openJadwal.JadwalID` (dari `pengiriman-board.tsx`) ada di scope-nya — tambahkan dua prop baru ke `StopDeliveryProofDialog`: `jadwalId: number` dan `originJadwalDetailId: number` (nilai `jadwalDetailId` yang sama dipakai untuk fetch proof-nya), diteruskan dari `route-validation-dialog.tsx`.

- [ ] **Step 2: Tambah tampilan sisa retur + tombol "Jual ke Mitra Lain" per item**

Di dalam loop render `proof.items`, untuk item dengan `kondisiRetur === "BAIK"` dan `qtyRetur > 0`, tambahkan:

```tsx
{item.kondisiRetur === "BAIK" && item.qtyRetur > 0 && (
  <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-emerald-500/5 p-2">
    <p className="text-xs text-emerald-700 dark:text-emerald-400">
      Retur Baik: {item.qtyRetur} (sisa tersedia dihitung saat dialog Jual Ulang dibuka)
    </p>
    <Button
      type="button"
      size="xs"
      variant="outline"
      onClick={() => setJualUlangTarget({ stopDeliveryItemId: item.stopDeliveryItemId, itemName: item.name })}
    >
      Jual ke Mitra Lain
    </Button>
  </div>
)}
```

Tambahkan state `const [jualUlangTarget, setJualUlangTarget] = useState<{ stopDeliveryItemId: number; itemName: string } | null>(null);` dan render `<JualUlangReturDialog jadwalId={jadwalId} originJadwalDetailId={originJadwalDetailId} target={jualUlangTarget} onOpenChange={(open) => !open && setJualUlangTarget(null)} onDone={() => setJualUlangTarget(null)} />` di akhir komponen. Catatan: `StopDeliveryProofItem` belum punya field `stopDeliveryItemId` per item — tambahkan (Task 2 memodifikasi interface ini, lengkapi field ini di sana sebagai bagian revisi Task 2 kalau terlewat, atau tambahkan di sini kalau Task 2 belum menutupnya — cek dulu sebelum menulis ulang).

- [ ] **Step 3: Buat `JualUlangReturDialog`**

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MitraSelect } from "@/components/dashboard/mitra-select";
import { MitraLocationMap } from "@/components/dashboard/mitra-location-map";
import {
  jualUlangDalamRuteAction,
  jualUlangLuarRuteAction,
  jualUlangRetailAction,
  getJadwalDetailAction,
} from "@/app/mkesindo/(dashboard)/delivery/actions";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";

type Jalur = "DALAM_RUTE" | "LUAR_RUTE" | "RETAIL";
const UNSET = "__unset__";

export function JualUlangReturDialog({
  jadwalId,
  // JadwalDetailID stop ASAL retur ini -- dikeluarkan dari daftar pilihan
  // jalur DALAM_RUTE (mitra yang menolak barang ini bukan tujuan yang
  // relevan untuk membeli balik returnya sendiri).
  originJadwalDetailId,
  target,
  onOpenChange,
  onDone,
}: {
  jadwalId: number;
  originJadwalDetailId: number;
  target: { stopDeliveryItemId: number; itemName: string } | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [jalur, setJalur] = useState<Jalur>("LUAR_RUTE");
  // Daftar STOP (bukan daftar retur) yang belum JamSelesai di Jadwal yang
  // sama -- ini calon penerima jalur DALAM_RUTE, dari getJadwalDetailAction
  // yang sudah ada (dipakai juga oleh RouteValidationDialog), BUKAN dari
  // getSisaReturTersediaAction (itu daftar retur yang tersedia untuk
  // DIJUAL, bukan daftar stop yang bisa MENERIMA jualan).
  const [belumSelesaiStops, setBelumSelesaiStops] = useState<DriverStopRow[] | null>(null);
  const [targetJadwalDetailId, setTargetJadwalDetailId] = useState<string>(UNSET);
  const [businessPartnerId, setBusinessPartnerId] = useState("");
  const [qty, setQty] = useState("");
  const [lokasiLat, setLokasiLat] = useState<number | null>(null);
  const [lokasiLng, setLokasiLng] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!target) return;
    getJadwalDetailAction(jadwalId).then((rows) => {
      setBelumSelesaiStops(rows.filter((r) => r.JamSelesai == null && r.JadwalDetailID !== originJadwalDetailId));
    });
  }, [target, jadwalId, originJadwalDetailId]);

  if (!target) return null;

  function handleSubmit() {
    const qtyNum = Number(qty);
    if (!(qtyNum > 0)) {
      setError("Qty harus lebih dari 0.");
      return;
    }
    setError(null);
    startTransition(async () => {
      let result;
      if (jalur === "DALAM_RUTE") {
        if (targetJadwalDetailId === UNSET) {
          setError("Pilih mitra tujuan dalam rute.");
          return;
        }
        result = await jualUlangDalamRuteAction(target!.stopDeliveryItemId, Number(targetJadwalDetailId), qtyNum);
      } else if (jalur === "LUAR_RUTE") {
        if (!businessPartnerId) {
          setError("Pilih mitra tujuan.");
          return;
        }
        result = await jualUlangLuarRuteAction(target!.stopDeliveryItemId, businessPartnerId, qtyNum, jadwalId);
      } else {
        if (lokasiLat == null || lokasiLng == null) {
          setError("Titik lokasi wajib dipilih dari peta.");
          return;
        }
        result = await jualUlangRetailAction(target!.stopDeliveryItemId, qtyNum, lokasiLat, lokasiLng, jadwalId);
      }
      if (!result.success) {
        setError(result.error);
        return;
      }
      onDone();
    });
  }

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Jual Ulang Retur — {target.itemName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Select value={jalur} onValueChange={(v) => setJalur((v as Jalur) ?? "LUAR_RUTE")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DALAM_RUTE">Mitra dalam rute (stop belum selesai)</SelectItem>
              <SelectItem value="LUAR_RUTE">Mitra lain (cari)</SelectItem>
              <SelectItem value="RETAIL">Retail Return (non-mitra)</SelectItem>
            </SelectContent>
          </Select>

          {jalur === "DALAM_RUTE" && (
            <Select value={targetJadwalDetailId} onValueChange={(v) => setTargetJadwalDetailId(v ?? UNSET)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pilih mitra tujuan" />
              </SelectTrigger>
              <SelectContent>
                {(belumSelesaiStops ?? []).map((r) => (
                  <SelectItem key={r.JadwalDetailID} value={String(r.JadwalDetailID)}>
                    {r.CustomerName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {jalur === "LUAR_RUTE" && (
            <MitraSelect
              options={[]}
              value={businessPartnerId}
              onChange={setBusinessPartnerId}
            />
          )}

          {jalur === "RETAIL" && (
            <MitraLocationMap
              latitude={lokasiLat ?? -7.8}
              longitude={lokasiLng ?? 111.9}
              onChange={(lat, lng) => {
                setLokasiLat(lat);
                setLokasiLng(lng);
              }}
              recenterKey={0}
            />
          )}

          <Input type="number" min="1" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button disabled={pending} onClick={handleSubmit}>
            {pending ? "Menyimpan..." : "Konfirmasi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Catatan implementasi: `MitraSelect`'s prop `options` di atas diisi `[]` sebagai placeholder yang HARUS diganti — baca `pemesanan-form-dialog.tsx`'s pemakaian `MitraSelect` (sudah dibaca di sesi brainstorming, `mitraOptions` di-derive dari `mitraList` yang di-fetch server-side lewat props halaman) untuk pola pengisian `options` yang benar; dialog ini kemungkinan perlu menerima prop `mitraOptions` dari pemanggilnya (`route-validation-dialog.tsx`, yang kemungkinan sudah punya akses ke daftar mitra lewat props halaman Papan Pengiriman — cek dulu, atau fetch on-demand lewat action baru kalau belum ada).

- [ ] **Step 4: Verifikasi**

Run: `npx tsc --noEmit` dan `npx eslint src/components/dashboard/stop-delivery-proof-dialog.tsx src/components/dashboard/jual-ulang-retur-dialog.tsx`
Expected: bersih setelah `MitraSelect`'s `options` diisi benar (Step 3's catatan).

Klik-lewat manual di `/mkesindo/delivery`: buka kartu ber-badge → buka bukti pengiriman stop yang retur Baik → klik "Jual ke Mitra Lain" → coba ketiga jalur dengan qty kecil → verifikasi lewat SQL bahwa dokumen/qty berubah sesuai jalur yang dipilih, dan badge merah hilang dari kartu setelah sisa retur habis terjual.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/stop-delivery-proof-dialog.tsx src/components/dashboard/jual-ulang-retur-dialog.tsx
git commit -m "feat: add retur detail + Jual Ulang dialog to stop delivery proof view"
```

---

### Task 9: Driver-app UI — prompt "jual sekarang" saat konfirmasi + tampilan sisa retur sepanjang rute

**Files:**
- Modify: `src/components/driver-app/steps/konfir-kirim-step.tsx`
- Read then modify: `src/components/driver-app/steps/pengiriman-step.tsx` (untuk tampilan sisa retur sepanjang sisa rute)
- Create: `src/components/driver-app/jual-ulang-retur-sheet.tsx` (reuse form 3-jalur, versi mobile)

**Interfaces:**
- Consumes: `getSisaReturTersediaDriverAction`, `jualUlangDalamRuteDriverAction`, `jualUlangLuarRuteDriverAction`, `jualUlangRetailDriverAction` (Task 6).
- Produces: komponen `JualUlangReturSheet` — dipakai dari `konfir-kirim-step.tsx` (prompt langsung) dan `pengiriman-step.tsx` (akses sepanjang rute).

- [ ] **Step 1: Buat `JualUlangReturSheet` (versi mobile dari Task 8's dialog)**

Struktur sama persis dengan `JualUlangReturDialog` (Task 8, termasuk perbaikan target-list-nya: daftar target jalur DALAM_RUTE berasal dari daftar STOP yang belum `JamSelesai`, bukan dari daftar retur yang tersedia) — Select jalur, target picker per jalur, input qty, `MitraLocationMap` untuk Retail — tapi memanggil action `*DriverAction` (Task 6) alih-alih action desktop, dan dibungkus tampilan bottom-sheet (`fixed inset-x-0 bottom-0 rounded-t-2xl`, pola yang sama seperti `KonfirTerimaStep`, bukan `Dialog` shadcn) supaya konsisten dengan gaya driver-app yang sudah ada. Untuk daftar target DALAM_RUTE, pakai `getDriverJadwalStopsAction(jadwalId)` yang SUDAH ADA di `driver-app/actions.ts` — perhatikan action ini DIBUNGKUS `ActionResult` (beda dari `getJadwalDetailAction` versi desktop yang mengembalikan array langsung), jadi cek `result.success` dulu sebelum memakai `result.data`. Jangan duplikasi logic bisnis — komponen ini murni UI + pemanggilan action, sama seperti Task 8.

- [ ] **Step 2: Prompt setelah kondisi Baik dipilih, di `konfir-kirim-step.tsx`**

Setelah tombol Baik/Rusak (ditambahkan Task 2 Step 6), untuk item dengan `kondisiRetur[item.SalesOrderDetailID] === "BAIK"`, tampilkan tombol kecil "Ada yang mau beli retur ini sekarang?" yang membuka `JualUlangReturSheet` untuk `stopDeliveryItemId` item itu — TAPI item ini belum punya `stopDeliveryItemId` yang sungguhan sampai `confirmStopDelivery` (submit) selesai (baris `DashboardPengirimanStopDeliveryItem` baru dibuat saat itu, bukan sebelumnya). Karena itu, prompt di titik ini HANYA bisa berupa niat ("catat, saya akan input detailnya setelah konfirmasi ini tersimpan") — pindahkan eksekusi sungguhan ke Step 3 di bawah (setelah `confirmStopDeliveryAction` sukses), bukan di sini. Hapus asumsi keliru ini dari desain awal task ini kalau implementer awalnya menuju arah "eksekusi langsung di sini" — jangan coba jual retur sebelum baris DB-nya ada.

- [ ] **Step 3: Prompt sungguhan setelah `confirmStopDeliveryAction` sukses**

Di `stop-flow.tsx`'s `handleKonfirmasiPenerima` (atau titik setara setelah `confirmStopDeliveryAction` berhasil), kalau ada item retur Baik pada stop yang baru saja dikonfirmasi, panggil `getSisaReturTersediaDriverAction(jadwalId)` untuk mendapatkan `stopDeliveryItemId` sungguhan yang baru dibuat (dicocokkan lewat `jadwalDetailId` = stop yang baru selesai + `itemId`), lalu tampilkan `JualUlangReturSheet` sebagai langkah opsional sebelum lanjut ke step berikutnya (`pembayaran`/`berhasil`) — tombol "Lewati" untuk skip kalau belum ada peminat saat itu.

- [ ] **Step 4: Akses sepanjang sisa rute, di `pengiriman-step.tsx`**

Baca `pengiriman-step.tsx` untuk memahami di mana `remainingStops`/`jadwalId` sudah ada di scope-nya. Tambahkan tombol/badge kecil (mis. di header layar ini) "Retur Tersedia" yang memanggil `getSisaReturTersediaDriverAction(jadwalId)` dan menampilkan `JualUlangReturSheet` kalau operator menekannya — supaya driver bisa menjual retur yang dicatat di stop SEBELUMNYA, bukan cuma sesaat setelah dicatat.

- [ ] **Step 5: Verifikasi**

Run: `npx tsc --noEmit` dan `npx eslint src/components/driver-app/steps/konfir-kirim-step.tsx src/components/driver-app/steps/pengiriman-step.tsx src/components/driver-app/jual-ulang-retur-sheet.tsx src/components/driver-app/stop-flow.tsx`
Expected: bersih.

Klik-lewat manual di `/mkesindo/driver-app` sebagai akun driver: konfirmasi stop dengan retur Baik → prompt jual-sekarang muncul setelah konfirmasi tersimpan → coba salah satu jalur → lanjut ke stop berikutnya → verifikasi tombol "Retur Tersedia" di layar Pengiriman menampilkan sisa retur dari stop sebelumnya yang belum terjual habis.

- [ ] **Step 6: Commit**

```bash
git add src/components/driver-app/steps/konfir-kirim-step.tsx src/components/driver-app/steps/pengiriman-step.tsx src/components/driver-app/jual-ulang-retur-sheet.tsx src/components/driver-app/stop-flow.tsx
git commit -m "feat: add driver-app Jual Ulang prompt + persistent sisa-retur access"
```

---

## Ringkasan Urutan Eksekusi

Task 1 (skema) → Task 2 (kondisi retur) → Task 3 (helper bersama) → Task 4 (jalur a) → Task 5 (jalur b/c) → Task 6 (actions) → Task 7 (badge) → Task 8 (dialog desktop) → Task 9 (driver-app). Task 7/8 bisa dikerjakan paralel dengan Task 9 (sama-sama bergantung hanya pada Task 6), tapi tetap satu implementer per waktu sesuai konvensi sesi ini (tidak ada dispatch implementer paralel).
