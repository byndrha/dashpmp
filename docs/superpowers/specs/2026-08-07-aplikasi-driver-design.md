# Aplikasi Driver (Standalone)

## Latar Belakang

Roadmap Armada/Driver/Pengiriman ([[roadmap-armada-driver-pengiriman]]) menyisakan
satu langkah tertunda: kartu Jadwal di Papan Pengiriman hanya punya status
Draf/Berangkat (kini, setelah pemisahan `selesaiMuat`/`konfirmasiBerangkat`,
efektif 3 sub-status: Dijadwalkan/Proses Muat/Dalam Pengiriman) — status
ke-4 "Selesai" (semua stop benar-benar terkirim) sengaja ditunda karena
belum ada aplikasi sisi driver untuk melaporkan penyelesaian dari lapangan.

User telah membuat draf desain 6 layar untuk aplikasi ini:

1. Driver - Tugas (Beranda Driver)
2. Driver - Pengiriman (peta rute aktif)
3. Driver - Konfir Kirim
4. Driver - Konfir Terima
5. Driver - Pembayaran
6. Driver - Berhasil

Dokumen ini men-desain seluruh alur, dari autentikasi sampai penyesuaian
data finansial (retur), berdasarkan kode dan skema database ERP yang
sebenarnya (dikonfirmasi lewat query langsung ke database, bukan asumsi).

## Cakupan

Standalone app baru untuk driver, dengan penyesuaian data pengiriman/
invoice/retur yang menyertainya. **Tidak termasuk**: integrasi QRIS
dinamis (Mandiri Livin — menunggu kredensial user), notifikasi push,
pengeditan urutan stop dari sisi driver, dan retur untuk Jadwal yang
sudah Selesai sebelum fitur ini dirilis.

## Arsitektur & Routing

### Standalone app, mengikuti pola `satpam-app`

Route baru `src/app/driver-app/` (di luar route group `(dashboard)`),
dengan layout sendiri: bottom nav 4 tab (Tugas/Peta/Riwayat/Profil),
bukan sidebar dashboard biasa. Ini mengikuti persis preseden
`src/app/satpam-app/` yang sudah terbukti bekerja sebagai aplikasi
terpisah di dalam Next.js app yang sama, dibungkus Capacitor Android
shell yang sama (`MainActivity.java`, `AppVersionGate`, offline-handling
yang sudah ada — semuanya reused, tidak ada shell native baru).

### Akses: peran-level flag + akun-level link

Dua mekanisme berbeda dibutuhkan, karena Driver berbeda dari Satpam:
Satpam semua melihat data yang sama (shared inspection list), tapi
setiap driver harus hanya melihat Jadwal miliknya sendiri.

- **`peran.is_driver`** (kolom baru Postgres, boolean, default `false`)
  — gerbang akses, persis pola `peran.is_satpam` yang sudah ada:
  `setPeranDriver(peranId, isDriver)` di `akun/peran/actions.ts`, toggle
  baru di `peran-editor.tsx`, `session.user.isDriver` ditambahkan ke
  JWT/session (mengikuti pola `isSatpam` di `auth.ts`), `requireDriver()`
  baru di `require-access.ts` (`if (!session.user.isDriver) redirect("/akses-ditolak")`).
- **`akun.salesman_id`** (kolom baru Postgres, `varchar` nullable,
  menyimpan `Salesman.SalesmanID` dari MSSQL) — penaut akun ke identitas
  driver sebenarnya. Diisi lewat dropdown "Driver (Salesman)" baru di
  form edit Akun di `/grup/akun` (`src/app/grup/akun/page.tsx` +
  `actions.ts` — lokasi manajemen akun MKEsindo saat ini, per
  [[postgres-directory-multi-company]]), dropdown ini hanya tampil/
  relevan kalau peran akun tsb `is_driver=true`.
  Opsinya diambil dari `getDriverProfiles()`/`Salesman` yang sudah ada
  (`src/lib/queries/driver-profile.ts`), bukan tabel baru.
- Login dengan `isDriver=true` tapi `salesman_id` masih `null` → ditolak
  masuk driver-app dengan pesan jelas ("Akun ini belum ditautkan ke data
  Driver, hubungi Admin"), bukan crash atau layar kosong.

### Redirect setelah login

Akun dengan `isDriver=true` diarahkan ke `/driver-app` (bukan `/`),
mengikuti pola redirect Marketing→`/pemasaran` yang sudah ada di
`src/app/(dashboard)/page.tsx` (`BerandaPage`) — bukan `proxy.ts`, karena
proxy hanya mengurus `accountScope` (mkesindo/direktur/pmputra), bukan
role dalam satu scope yang sama.

### Reuse infrastruktur yang sudah ada

- `useLiveCameraCapture`/`LiveCameraCaptureField`
  (`src/hooks/use-live-camera-capture.ts`,
  `src/components/dashboard/live-camera-capture-field.tsx`) untuk semua
  foto bukti — tidak menulis ulang logic kamera.
- Pola `AppError`/`runAction`/`ActionResult<T>` (`src/lib/action-result.ts`)
  untuk SEMUA Server Action baru, tanpa kecuali.
- Leaflet/react-leaflet (sudah jadi dependency) untuk semua peta.
- `/api/routing/multi` (OSRM) untuk polyline rute.
- `recordLokasi`/`akun_lokasi` (`src/lib/queries/akun-lokasi.ts`) untuk
  posisi driver — diperluas frekuensi pingnya saat Jadwal aktif, BUKAN
  tabel baru.
- `getDriverProfiles()` (`src/lib/queries/driver-profile.ts`) untuk data
  profil driver (Layar Profil, dropdown penaut akun).

## Perubahan Data Model

### Status "Selesai" (dihitung, bukan kolom baru)

Tabel baru `DashboardPengirimanStopDelivery` di MSSQL (bukan Postgres) —
mengikuti pola `DashboardXxx` yang sudah dominan di app ini untuk data
perpanjangan ERP (mis. `DashboardDriverProfile`, `DashboardMitraLocation`),
dan supaya join ke `DashboardPengirimanJadwalDetail.JadwalDetailID`
(juga MSSQL) tidak perlu lintas-database. Satu baris per stop
(`JadwalDetailID`), kolom:
`JamTiba`, `JamSelesai`, `FotoBuktiPengirimanUrl`, `FotoBuktiMuatanUrl`,
`TandaTanganUrl`, dan detail per-item (qty diterima, qty retur, foto
retur opsional) di tabel anak `DashboardPengirimanStopDeliveryItem`.

Sebuah Jadwal dianggap **Selesai** ketika SEMUA stop-nya (semua baris
`DashboardPengirimanJadwalDetail` milik Jadwal itu) sudah punya baris
`DashboardPengirimanStopDelivery` dengan `JamSelesai` terisi — dihitung
di query, bukan kolom status baru di `Jadwal` sendiri, supaya Draft/Terbit
yang sudah ada di `pengiriman-jadwal.ts` tidak perlu diubah.

### Retur & penyesuaian Invoice

Saat driver konfirmasi kuantitas diterima di satu stop (Layar 4), dalam
**satu transaksi SQL**:

1. `DeliveryOrderDetail.Delivered` diupdate ke qty yang benar-benar
   diterima (kolom ini sudah ada di skema MSSQL, saat ini di-set penuh
   sama dengan `Qty` saat `selesaiMuat()` — dikoreksi turun di sini kalau
   ada retur).
2. `SalesInvoiceDetail` per baris item: `Qty`/`Amount`/`Netto` dikoreksi
   turun ke nilai yang benar-benar tertagih, kolom `Retur` (sudah ada di
   skema MSSQL — `SalesInvoiceDetail.Retur decimal(23,4)`, belum pernah
   ditulis oleh app ini) diisi qty yang dikembalikan.
3. `SalesInvoice.Amount`/`Netto` (header) dihitung ulang dari SUM baris
   Detail yang baru. **Ini wajib**, karena `vCustomerStatement` (dasar
   perhitungan piutang di `aging.ts`, dipakai di Piutang/Aging/Pelunasan)
   membaca `SalesInvoice.Netto` langsung sebagai satu angka, bukan SUM
   live dari `SalesInvoiceDetail` — retur tidak akan mengurangi piutang
   mitra kalau header ini tidak ikut diupdate.
4. `SalesReturn` + `SalesReturnDetail` dibuat sebagai dokumen resmi
   (`MKE/SR/<seq>/<yearMonth>/<DOC_SUFFIX>`, pola numbering sama seperti
   `nextDOVoucherSeq`/`nextSIVoucherSeq` di `pengiriman-jadwal.ts`) —
   tabel ini sudah ada di ERP (9.567 baris historis dari desktop app,
   kolom `SalesReturnDetail.Retur` sudah tersedia) tapi belum pernah
   ditulis oleh dashboard ini. Dipakai murni sebagai audit-trail
   pergerakan barang, field `DeliveryOrderID`/`SalesOrderID`/
   `BusinessPartnerID`/`SalesmanID` diisi dari Jadwal/stop terkait,
   `SalesReturnDetail` satu baris per item dengan `SalesOrderDetailID`
   yang sama dengan baris DO/SI aslinya.

Retur murni penyesuaian TURUN — tidak pernah menambah kuantitas melebihi
apa yang sudah dimuat (`candidateQty` dari `Qty` asli di
`DashboardPengirimanJadwalDetail`).

## Alur per Layar

**Layar 1 — Tugas (Beranda Driver):** query baru
`getDriverJadwalList(salesmanId, dateFilter, statusFilter)` — daftar
Jadwal milik `SalesmanID` login sendiri (dari `akun.salesman_id`), kartu
status Dijadwalkan/Proses Muat/Dalam Pengiriman/Selesai. "Total Hari
Kerja"/"Total Jarak" dihitung dari histori Jadwal Selesai milik driver
ini. Filter tanggal + status sesuai mockup.

**Layar 2 — Pengiriman (peta rute aktif satu tugas):** dibuka dari kartu
"Dalam Pengiriman". Menampilkan stop berikutnya (belum ada `JamSelesai`
di `DashboardPengirimanStopDelivery`) urut `Urutan`. Posisi driver: ping
lokasi periodik (perluasan `recordLokasi` yang sudah ada, dipanggil lebih
sering saat Jadwal aktif) digambar sebagai marker bergerak; rute
(polyline) ditarik dari `/api/routing` (OSRM) antara posisi driver dan
tujuan berikutnya, dihitung ulang tiap beberapa ping baru. "Geser untuk
Tiba" mencatat `JamTiba` untuk stop itu dan membuka Layar 3.

**Layar 3 — Konfir Kirim:** Foto Bukti Pengiriman & Bukti Muatan pakai
`LiveCameraCaptureField`. Daftar item per stop (dari
`DashboardPengirimanJadwalDetail`) dengan qty +/- (maks = qty dimuat,
tidak bisa lebih), retur otomatis dihitung = dimuat − diterima, dengan
foto bukti tambahan untuk baris yang ada returnya (ikon kamera merah di
mockup, opsional tapi disarankan). Toggle "Tanpa Pembayaran/Lewati
Penagihan" melewati Layar 5 langsung ke Layar 6 (konsisten dengan pola
invoice-tak-dibayar TakeAway yang sudah ada).

**Layar 4 — Konfir Terima:** bottom sheet tanda tangan (canvas → gambar,
disimpan via endpoint upload yang sama polanya dengan
`/api/upload/satpam-check`) di atas Layar 3. "Konfirmasi Penerima"
menjalankan transaksi retur/invoice di atas SEKALIGUS menstempel
`JamSelesai` untuk stop ini.

**Layar 5 — Pembayaran:** tab Tunai aktif penuh — memanggil
`recordPayment()` yang sudah ada (Pelunasan,
`src/lib/queries/pelunasan.ts`) terhadap `SalesInvoiceID` stop ini,
channel **Kas Kecil (`014`)** sebagai default (bisa diedit ulang oleh
Finance dari sisi dashboard biasa nanti kalau perlu). Tab Dynamic QR &
QR Statis tampil nonaktif berlabel "Segera Hadir" — TIDAK ada QR
palsu/simulasi, menunggu kredensial Mandiri Livin dari user.

**Layar 6 — Berhasil:** ringkasan statis dari hasil Layar 5 (atau
langsung dari Layar 3 kalau "Tanpa Pembayaran" aktif). Tombol "Selesai &
Kembali ke Tugas" kembali ke Layar 1; stop ini hilang dari hitungan
"tersisa" di Layar 2; kalau itu stop terakhir Jadwal ini, kartunya
berubah status jadi Selesai di Layar 1.

## Bottom Nav Lainnya

**Tab Peta:** menampilkan SELURUH penugasan (Jadwal) hari ini milik
driver ini sekaligus — bukan cuma satu tugas aktif seperti Layar 2. Tiap
Jadwal digambar dengan warna rute (polyline OSRM) yang berbeda beserta
pin-pin stop-nya, ditumpuk dengan satu marker posisi driver saat ini.
Ini murni tampilan overview/visual, tidak ada aksi "Geser untuk Tiba" di
sini (aksi itu tetap di Layar 2, dibuka dari kartu tugas aktif).

**Tab Riwayat:** daftar Jadwal berstatus Selesai milik driver ini,
read-only, dengan ringkasan qty terkirim/retur/total nilai per trip.

**Tab Profil:** data `DriverProfileRow` (dari `driver-profile.ts`) milik
driver sendiri, read-only (pengeditan tetap lewat Kelola Driver oleh
Admin di dashboard biasa), tombol logout.

## Penanganan Error

Semua Server Action baru mengikuti pola `AppError`/`runAction`/
`ActionResult<T>` yang sudah jadi standar app ini (lihat
`docs/superpowers/specs/2026-08-06-action-error-handling-design.md`) —
tidak ada pengecualian, termasuk transaksi retur/invoice yang kompleks
di Layar 4 (rollback penuh kalau salah satu langkah gagal, pesan error
spesifik per kegagalan bukan generic).

## Pengujian

Proyek ini tidak punya test runner. Verifikasi: `npx tsc --noEmit` penuh,
`npx eslint`, verifikasi manual di browser untuk alur utama (Tugas →
Pengiriman → Konfir Kirim → Konfir Terima → Pembayaran → Berhasil) kalau
login production bisa diakses dari sandbox; kalau tidak (kendala yang
sudah berulang kali terjadi), verifikasi lewat penelusuran statis kode
yang teliti sebagai gantinya, didokumentasikan secara eksplisit di setiap
laporan task.

## Di Luar Cakupan

- Dynamic QR & QR Statis fungsional (tunggu kredensial Mandiri Livin
  user) — tab tetap ada di UI, nonaktif.
- Retur untuk Jadwal yang sudah Selesai sebelum fitur ini dirilis.
- Notifikasi push ke driver (tugas baru, dsb.).
- Pengeditan urutan stop dari sisi driver — urutan tetap ditentukan dari
  Validasi Rute di dashboard staff.
- Multi-driver per Jadwal (satu Jadwal tetap satu `SalesmanID`, tidak
  berubah dari skema yang ada).
