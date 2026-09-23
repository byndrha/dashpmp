# Posting GL Real-Time untuk SalesInvoice/DeliveryOrder — Design Spec

## 1. Latar Belakang & Masalah

`SalesInvoice` (SI) dan `DeliveryOrder` (DO) yang dibuat lewat dashpmp (bukan
ERP desktop) tidak pernah otomatis ter-posting ke `GeneralLedger` saat
dibuat. Satu-satunya jalan mereka ter-posting adalah tombol "Proses" manual
di panel Kesehatan Posting GL (`/mkesindo/pnl`), yang memanggil
`computeBacklogForDate`/`postBacklogForDate` di
[gl-posting-backfill.ts](../../../src/lib/queries/gl-posting-backfill.ts).

Masalah operasional nyata (memori sesi: "GL posting backlog DO+SI since 12
Sep"): staf tidak selalu (atau tidak sempat) mengklik tombol itu secara
rutin, sehingga backlog menumpuk (dilaporkan Rp210jt & terus tumbuh, 3 hari
berturut-turut nol posting). User ingin SI/DO otomatis ter-posting ke GL
**tepat saat dokumen itu dibuat** (real-time), bukan menunggu proses batch
manual — pola yang sama seperti perbaikan yang baru saja dilakukan untuk
SalesPayment (SP), tapi dengan pertimbangan tambahan karena formula GL
SI/DO jauh lebih rumit (lihat Bagian 2).

## 2. Temuan Eksplorasi yang Membentuk Desain Ini

- **Pemetaan Item→Akun bersifat historis-dipelajari, bukan kolom statis.**
  `buildItemAccountMapping()` menghitung akun Pendapatan/HPP/Persediaan per
  `ItemID` dengan mencari akun yang PALING SERING dipakai pada baris GL
  historis SEBELUM tanggal tetap `BATAS_DATA_NORMAL = "2026-09-12"`. Karena
  batas tanggalnya tetap (bukan "N hari terakhir"), hasil pemetaan ini
  **konstan selamanya** — bisa di-cache agresif tanpa risiko basi.
- **Query pemetaan itu mahal** (beberapa scan+join atas `GeneralLedger`
  1,9 juta+ baris) — TIDAK boleh dihitung ulang di setiap pembuatan
  dokumen. Harus di-cache.
- **Formula SUDAH menangani dokumen multi-item dengan benar** (agregasi per
  akun dalam `hitungGLSalesInvoice`/`hitungGLDeliveryOrder`) — bukan
  batasan tambahan yang perlu ditangani ulang.
- **`ItemAverage` adalah snapshot bulanan yang terus di-update ERP.**
  Kekhawatiran awal "nilai belum final saat dokumen baru dibuat" ternyata
  bukan risiko baru: begitu real-time posting jadi jalur resmi, nilai
  `ItemAverage` SAAT POSTING itulah yang final (tidak ada proses batch
  susulan yang "meluruskan" lagi untuk dokumen yang sudah diposting
  real-time).
- **Ada kasus yang SENGAJA di-skip** oleh formula yang sudah ada, dan harus
  tetap di-skip di jalur real-time (bukan dipaksa/ditebak):
  1. Item tidak punya histori pemetaan akun sebelum 12 Sep 2026.
  2. Item tidak punya baris `ItemAverage` untuk (Year, Month) dokumen itu.
  3. Untuk SI: `DeliveryOrder` induknya punya `SalesReturn` terkait
     (~0,9% dari transaksi — GL aslinya dari ERP punya baris tambahan yang
     formula 4-baris standar ini tidak bisa mereplikasi dengan benar).
- **Urutan pembuatan dokumen sudah sesuai kebutuhan formula.** Diverifikasi
  di ketiga titik penciptaan (lihat Bagian 4): `DeliveryOrder` SELALU
  dibuat sebelum `SalesInvoice` terkait — baik dalam transaksi yang sama
  (Takeaway, Jual Ulang Retur) maupun transaksi terpisah belakangan
  (alur pengiriman utama, `pengiriman-jadwal.ts`). Ini persis urutan
  dependency yang sudah diasumsikan `hitungGLSalesInvoice` (butuh DO induk
  sudah ter-GL).

## 3. Keputusan Desain (dikonfirmasi user)

1. **Posting GL terjadi DI DALAM transaksi SQL yang sama** dengan
   pembuatan DO/SI itu sendiri — bukan langkah terpisah setelah commit.
   Kalau berhasil, dokumen + GL commit bersamaan (atomik).
2. **Kegagalan posting GL (baik skip yang disengaja MAUPUN error DB
   sungguhan) TIDAK membatalkan pembuatan dokumen.** Fungsi posting
   dirancang untuk menelan kegagalannya sendiri dan mengembalikan status
   "belum ter-posting" ke pemanggil — pemanggil (DO/SI creation) tetap
   lanjut commit transaksinya seperti biasa, hanya tanpa baris GL. Dokumen
   yang belum ter-posting ini akan tetap terlihat & bisa diproses manual
   lewat panel Kesehatan Posting GL yang sudah ada (TIDAK dihapus/diganti
   — tetap jadi jaring pengaman untuk kasus skip & error).
3. **Cache pemetaan Item→Akun in-memory per proses server**, dihitung
   sekali (lazy, saat pemanggilan pertama), dipakai berulang selama
   proses itu hidup. Tidak perlu invalidasi otomatis karena sumbernya
   (data sebelum 12 Sep 2026) tidak pernah berubah oleh alur normal.
4. **ID GeneralLedger & applock memakai resource yang SAMA PERSIS**
   (`dashpmp_gl_backfill_posting`) dengan sistem backlog SI/DO dan posting
   SalesPayment yang baru — seluruh jalur penulisan GL saling eksklusi.

## 4. Titik Integrasi (Call Sites)

Empat tempat penciptaan DO/SI yang perlu diberi hook posting real-time:

| File | Fungsi | Dokumen dibuat | Transaksi |
|---|---|---|---|
| `src/lib/queries/pengiriman-jadwal.ts` | `selesaiMuat` (~baris 2240-2510) | DeliveryOrder | Transaksi sendiri |
| `src/lib/queries/pengiriman-jadwal.ts` | `createSalesInvoiceForStop` (~baris 2124-2240), dipanggil dari `confirmStopDelivery` | SalesInvoice | Transaksi sendiri, terpisah dari DO (dibuat belakangan saat driver konfirmasi) |
| `src/lib/queries/takeaway-muatan.ts` | `takeAwaySelesaiMuat` (~baris 228-...) | DeliveryOrder lalu SalesInvoice | SATU transaksi yang sama |
| `src/lib/queries/retur-resale.ts` | `buatSoDoSiSekaligus` (~baris 356), dipanggil dari `jualUlangLuarRute`/`jualUlangRetail`/`jualUlangDalamRute` | DeliveryOrder lalu SalesInvoice | SATU transaksi yang sama (helper menerima `transaction` dari pemanggil) — mengedit fungsi ini SEKALI mencakup ketiga pemanggilnya |

Total titik edit: 4 (bukan 7 — `buatSoDoSiSekaligus` dipakai bersama oleh 3
fungsi jual-ulang).

## 5. Komponen Baru/Diubah

### 5.1 `gl-posting-backfill.ts` — refactor untuk dipakai bersama

- **Perluas tipe parameter pool.** `hitungGLDeliveryOrder`,
  `hitungGLSalesInvoice`, `getItemAverage`, `buildItemAccountMapping`, dan
  query `returTerkait` di dalam `hitungGLSalesInvoice` saat ini mengetik
  parameter pertamanya sebagai `sql.ConnectionPool` secara eksplisit. Jalur
  real-time butuh menjalankan query yang sama di dalam `sql.Transaction`
  (bukan `pool` langsung) supaya baca-datanya konsisten dengan tulis yang
  belum commit di transaksi yang sama. Semua fungsi ini perlu diperluas
  tipenya jadi `sql.ConnectionPool | sql.Transaction` (pola yang sama
  seperti `nextGeneralLedgerId` sudah pakai) — pemanggilan yang sudah ada
  dari `computeBacklogForDate` (selalu pakai `pool`) tetap jalan tanpa
  perubahan karena `sql.ConnectionPool` valid untuk union type itu.
- **Cache pemetaan**: bungkus `buildItemAccountMapping` dengan cache
  in-memory module-level (`let cachedMapping: Map<...> | null = null`),
  fungsi baru `getItemAccountMappingCached(pool)` yang menghitung ulang
  hanya kalau cache masih `null`. Backlog manual (`computeBacklogForDate`)
  diubah untuk pakai fungsi ter-cache ini juga, supaya kedua jalur
  (real-time & manual) selalu memakai mapping yang identik.
- **Export fungsi penghitung jurnal**: `hitungGLDeliveryOrder` dan
  `hitungGLSalesInvoice` (saat ini private) diekspor supaya bisa dipanggil
  dari titik penciptaan dokumen. Signature TIDAK berubah.
- **Fungsi baru `postDeliveryOrderRealtime(transaction, doc)` dan
  `postSalesInvoiceRealtime(transaction, doc)`**: masing-masing memanggil
  `hitungGL...`, dan kalau hasilnya bukan skip:
  1. `acquireGLPostingApplock(transaction)`
  2. Re-cek idempotency (`SELECT ... WHERE VoucherNo = ... AND Type = ...`)
     — proteksi kalau fungsi ini entah bagaimana terpanggil dua kali.
  3. `nextGeneralLedgerId(transaction)`, lalu INSERT baris-baris GL
     (pola sama persis dengan `postSatuDokumen`, memo `[DASHPMP-REALTIME]`).
  Mengembalikan `{ posted: true }` atau `{ posted: false, alasan: string }`
  — TIDAK PERNAH throw untuk kondisi skip; error DB asli (mis. deadlock)
  DITANGKAP di dalam fungsi ini sendiri dan diubah jadi
  `{ posted: false, alasan: "..." }` juga (lihat Bagian 3, keputusan #2) —
  supaya pemanggil di titik penciptaan dokumen tidak perlu try/catch
  ekstra, cukup abaikan hasilnya.

### 5.2 Empat titik penciptaan dokumen

Di tiap titik (lihat tabel Bagian 4), tepat setelah baris detail dokumen
(SalesInvoiceDetail/DeliveryOrderDetail) selesai ditulis, tambahkan satu
pemanggilan `postDeliveryOrderRealtime(transaction, {...})` (untuk DO) atau
`postSalesInvoiceRealtime(transaction, {...})` (untuk SI) dengan data yang
sudah tersedia di scope (voucherNo, documentId, transDate, branchId,
departmentId, businessPartnerId, currencyId, rate, dan untuk SI:
parentDoVoucherNo). Hasilnya tidak perlu ditangani apa pun oleh pemanggil
(fire-and-forget dari sudut pandang alur bisnis dokumen) — biarkan
transaksi lanjut commit seperti biasa.

## 6. Non-Tujuan / Di Luar Cakupan

- Tidak mengubah formula jurnal itu sendiri (akun, cara hitung HPP) — 100%
  mereplikasi apa yang sudah divalidasi di `gl-posting-backfill.ts`.
- Tidak menghapus/mengubah panel Kesehatan Posting GL atau tombol "Proses"
  manual — tetap jadi jaring pengaman untuk kasus skip & dokumen yang
  gagal ter-posting real-time karena alasan apa pun.
- Tidak melakukan backfill dokumen SI/DO historis yang sudah terlanjur
  ada sebelum perbaikan ini (backlog yang sudah ada tetap jadi mekanisme
  untuk itu, dijalankan manual seperti biasa oleh staf).
- Tidak mengubah cara kerja `SalesReturn`/`retur-resale.ts` di luar
  menambah satu pemanggilan posting-real-time ke `buatSoDoSiSekaligus`.

## 7. Review Focus (kondisi yang harus diuji, bukan cuma golden path)

1. **Item tanpa histori pemetaan** (item baru yang belum pernah muncul di
   GL sebelum 12 Sep 2026) → dokumen tetap dibuat, GL tidak terposting,
   status tetap terdeteksi "belum posting" di panel Kesehatan Posting GL.
2. **Item tanpa `ItemAverage` bulan berjalan** → sama seperti di atas.
3. **SI yang DO induknya punya `SalesReturn` terkait** → SI tetap dibuat
   tanpa GL, tetap terdeteksi backlog seperti sekarang.
4. **Dua dokumen dibuat nyaris bersamaan** (concurrent) → applock yang
   sama dengan backlog SI/DO & posting SP harus mencegah GL ID sama
   ter-assign ke dua dokumen berbeda.
5. **Dokumen yang GL-nya berhasil ter-posting real-time TIDAK ikut muncul
   lagi** di daftar backlog manual (idempotency re-check di
   `computeBacklogForDate` sudah menyaring berdasar keberadaan baris GL —
   perlu dipastikan tetap berlaku untuk dokumen yang baru saja
   ter-posting real-time, bukan cuma yang di-backfill).
