# Kunci DO, Auto Sales Invoice, dan Halaman Invoice Publik — Design Spec (Fase A)

**Status:** Approved by user 2026-07-26, proceeding to implementation plan.

## Goal (Fase A — WhatsApp dan Dynamic QRIS sengaja di luar cakupan ini)

1. Sekali sebuah keberangkatan ditekan "Berangkat" (DO rilis, real `DeliveryOrder` tercipta), tidak ada jalur di dashboard ini yang bisa mengubahnya lagi — driver, armada, waktu, semuanya terkunci.
2. Saat itu juga, sistem otomatis membuat satu `SalesInvoice` per `DeliveryOrder` yang baru terbit.
3. Setiap `SalesInvoice` mendapat sebuah link publik tak-tertebak (`/invoice/{token}`) yang bisa dibuka siapa pun tanpa login, menampilkan nominal tagihan dan sebuah kotak QRIS placeholder statis.

Pengiriman link ini ke Mitra via WhatsApp (Evolution API) dan penggantian placeholder QRIS dengan Dynamic QRIS (Livin Merchant) keduanya ditunda ke fase berikutnya — keduanya hanya perlu MEMBACA data yang sudah dibuat fase ini, jadi tidak ada yang perlu diubah di sini nanti saat keduanya ditambahkan.

## Part 1: Mengunci DO setelah Berangkat

**Masalah saat ini:** `updateJadwalDriverTime` (`src/lib/queries/pengiriman-jadwal.ts`) punya cabang khusus yang, ketika Jadwal sudah `Terbit`, tetap mengizinkan perubahan `SalesmanID`/`VehicleNo` — dan mengoper perubahan itu ke `DeliveryOrder` asli via `assignDeliveryDriver`/`assignDeliveryVehicle` (`src/lib/queries/delivery.ts`). Di sisi UI, `route-validation-dialog.tsx` selalu menampilkan input Jam/Driver + tombol "Simpan" tanpa memandang status Draft/Terbit.

**Perubahan:**
- `updateJadwalDriverTime`: begitu status Jadwal `Terbit`, langsung `throw new Error("Keberangkatan ini sudah rilis — tidak bisa diubah lagi.")` alih-alih memproses perubahan apa pun. Cabang cascade-ke-DO dihapus seluruhnya.
- `assignDeliveryDriver`/`assignDeliveryVehicle` (`delivery.ts`) jadi dead code (satu-satunya pemanggil dihapus) — dihapus juga, mengikuti kebiasaan proyek ini membuang kode yang benar-benar tidak terpakai.
- `route-validation-dialog.tsx`: blok input Jam/Driver/tombol Simpan hanya tampil kalau `isDraft`; kalau tidak, diganti tampilan read-only nilai final (jam & nama driver).
- Klik ke satu tujuan (`SortableStopRow`'s `onEdit`, pemicu "Ubah Pemesanan") dinonaktifkan kalau `!isDraft` — SO yang sudah benar-benar terkirim (Terbit) tidak masuk akal untuk "dijadwalkan ulang" lewat jalur itu.

## Part 2: Auto `SalesInvoice` saat Berangkat

Di dalam `startBerangkat` (`pengiriman-jadwal.ts`), untuk setiap `DeliveryOrder` yang baru dibuat dalam loop yang sudah ada, tambahkan pembuatan satu `SalesInvoice` + baris `SalesInvoiceDetail` yang bersesuaian (1 DO : 1 SI), memakai Qty/Item/Harga yang sama persis dengan `DeliveryOrderDetail` yang baru saja ditulis (tidak perlu query ulang ke `SalesOrderDetail`).

**Prasyarat keras sebelum kode ditulis:** skema kolom `SalesInvoice`/`SalesInvoiceDetail` (wajib vs nullable, tipe data, pola penomoran `VoucherNo`) **harus diverifikasi langsung ke database** dulu — sama seperti disiplin yang sudah dipakai untuk `SalesOrder`/`DeliveryOrder` sebelumnya di proyek ini — karena ini tabel akuntansi asli ERP yang datanya dipakai bersama aplikasi desktop. Ini jadi Task 0 dari plan implementasi; tugas penulisan kode `INSERT`-nya menunggu sampai verifikasi ini selesai.

Field-field yang sudah pasti dari kode yang ada saat ini (lewat `aging.ts`/`sales.ts`): `SalesInvoiceID`, `VoucherNo`, `TransDate`, `DueDate`, `BusinessPartnerID`, `Amount`, `Netto`, `IsDeleted` — dan ada tabel `SalesInvoiceDetail` terpisah serta view `vCustomerStatement` yang mengelola status piutang. `DueDate` = `TransDate` + `TermOfPayment.Value` hari, mengambil `TermOfPaymentID` yang sama dengan `SalesOrder`-nya.

## Part 3: Link publik invoice

**Bukan enkripsi literal** (yang berarti bisa dibalik/didekripsi) — melainkan **token acak tak-tertebak** (bearer token), yang menghasilkan properti keamanan yang sama persis untuk kasus ini (siapa pun yang punya link = boleh lihat, tidak ada cara menebak link mitra lain) tanpa perlu mesin enkripsi/dekripsi.

**Tabel pendamping baru** (tidak mengubah tabel ERP asli `SalesInvoice` sama sekali):
```sql
CREATE TABLE DashboardInvoicePublicLink (
  SalesInvoiceID VARCHAR(16) NOT NULL PRIMARY KEY,
  Token VARCHAR(64) NOT NULL UNIQUE,
  CreatedDate DATETIME NOT NULL DEFAULT GETDATE()
);
```
`Token` = 32 byte acak kriptografis, di-encode base64url (`crypto.randomBytes(32).toString("base64url")` — pola yang sama seperti token sesi pada umumnya). Dibuat di saat yang sama dengan `SalesInvoice`-nya, di dalam `startBerangkat`.

**Halaman publik** `src/app/invoice/[token]/page.tsx` — sibling dari `src/app/login` (di luar route group `(dashboard)`, jadi otomatis tidak lewat `requireModuleAccess`/sidebar; dikonfirmasi tidak ada `middleware.ts` yang memblokir apa pun secara global di proyek ini). Mencari `Token` di `DashboardInvoicePublicLink` → `SalesInvoice` → `BusinessPartner`, menampilkan: nama Mitra, No. Voucher, ringkasan item, nominal tagihan (`Netto`), tanggal jatuh tempo, dan kotak QRIS placeholder. Token yang tidak cocok menampilkan halaman "tidak ditemukan" generik (tidak boleh membedakan pesan antara "token salah format" vs "token valid tapi tidak ada" — supaya tidak ada informasi yang bocor soal keberadaan token tertentu).

## Part 4: QRIS placeholder statis

Kotak hitam polos (`<div>` persegi, `bg-black`, ukuran mirip kode QR asli) dengan label "QRIS segera hadir" di posisi yang nanti digantikan Dynamic QRIS asli di Fase B. Tidak ada string pembayaran apa pun yang dikodekan — murni visual placeholder, sesuai konfirmasi Anda.

## Di luar cakupan (sengaja tidak dikerjakan sekarang)

- Pengiriman otomatis link invoice via WhatsApp (Evolution API) — akan ditambahkan kemudian; tidak butuh perubahan apa pun pada yang dibangun di fase ini, karena hanya perlu MEMBACA `SalesInvoice`+`DashboardInvoicePublicLink` yang sudah ada.
- Dynamic QRIS via Livin Merchant — riset API-nya masih tertunda (tool riset web sedang bermasalah), diganti placeholder statis untuk saat ini.
- Alur pembatalan/koreksi DO yang sudah rilis (kalau ada kesalahan setelah Berangkat) — belum ada mekanismenya sama sekali di sistem ini; dengan Part 1, kesalahan pasca-rilis kini benar-benar tidak bisa dikoreksi lewat dashboard. Ini konsekuensi yang disadari dan diterima (bukan bug), tapi dicatat di sini karena bisa jadi kebutuhan nyata ke depan.
