# Laporan Shift Terpadu — Design Spec

## Latar Belakang

`/mkesindo/laporan` saat ini berupa 5 tab terpisah (Stok Bahan Baku, Aktivitas Produksi, Aktivitas Muatan Distribusi, Keuangan Operasional, Ringkasan Lintas Shift), masing-masing menampilkan satu domain data secara independen. Pengguna ingin sebuah tampilan **berbasis shift**: satu shift, satu tempat, semua data yang relevan untuk shift itu langsung terlihat — meniru dua format laporan kertas/Excel yang sudah lama dipakai secara manual (catatan tangan stok gudang + ON/OFF mesin + counter mesin, dan rekap Excel "Laporan Pendapatan Operasional" per staf operasional/driver/agen dengan pengeluaran kas).

Ini **BUKAN** pengganti 5 tab yang ada — ini tab tambahan bernama **"Laporan Shift"**, di samping 5 tab lama yang tetap ada seperti sekarang.

## Tujuan

- Satu tampilan per shift yang merangkum: kartu pengiriman (per Jadwal/rute) lengkap dengan tujuan, qty, status bayar, dan retur/jual-ulang; pengeluaran kas (BBM otomatis + manual); data produksi; timeline ON/OFF & counter tiap mesin; stok bahan baku awal/akhir; stok es awal/akhir.
- Semua data diambil dari sistem yang sudah ada — **tidak ada pencatatan manual baru** yang dibutuhkan dari pengguna, kecuali satu pengecualian eksplisit di bawah (snapshot stok es, yang otomatis lewat scheduler, bukan input manual).
- Halaman tetap ringan: data satu shift diambil sesuai permintaan (saat shift itu dipilih), bukan sekaligus untuk banyak shift.

## Non-Tujuan

- Tidak mengubah/menghapus 5 tab yang sudah ada.
- Tidak membangun mode cetak/export (bisa jadi proyek terpisah nanti).
- Tidak menambah field pencatatan metode pembayaran baru — metode (Tunai/QRIS/Transfer) sudah tercatat lewat alur Pelunasan driver-app yang ada (`recordPayment`), tinggal dibaca.
- Tidak mengubah logika bisnis pengiriman/retur/kas/produksi yang sudah ada — murni agregasi baca (read-only), kecuali satu tabel snapshot baru untuk stok es (lihat Bagian 4).

## Definisi Satu Shift & Pemetaan Data ke Shift

Shift mengikuti definisi yang sudah baku di `src/lib/report-shift.ts`: `getReportShift("work")`/`getShiftWindow(businessDate, shift, "work")`, rollover jam 15:00 WIB, urutan kronologis dalam satu Tanggal Usaha adalah Shift 2 → Shift 3 → Shift 1 (Shift 2 & 3 jatuh di tanggal kalender SEBELUM Tanggal Usaha, hanya Shift 1 yang jatuh di Tanggal Usaha itu sendiri).

Karena laporan ini mengambil **satu shift pada satu waktu** (bukan satu bulan penuh seperti Ringkasan Lintas Shift/Aktivitas Muatan Distribusi), setiap sub-query cukup memfilter dengan `WHERE <kolom_waktu> BETWEEN @start AND @end` memakai window dari `getShiftWindow(...)` — pola yang sama seperti `getMesinEventsForShift` yang sudah ada — TANPA perlu menduplikasi ekspresi SQL `CASE` (`SHIFT_CASE`/`TANGGAL_USAHA_CASE`) yang dipakai versi whole-month di `laporan-ringkasan-lintas-shift.ts`/`laporan-muatan-distribusi.ts`. Ini lebih sederhana karena skalanya berbeda (satu shift vs satu bulan), bukan mengganti konvensi yang sudah ada di tempat lain.

Pemetaan per bagian data ke window waktu shift:

| Bagian | Kolom waktu acuan | Catatan |
|---|---|---|
| Kartu Pengiriman (Jadwal) | `DashboardPengirimanJadwal.JamSelesaiMuat` | Sama seperti Aktivitas Muatan Distribusi/Ringkasan Lintas Shift — Jadwal yang mulai di satu shift tapi selesai muat di shift berikutnya tercatat di shift saat **selesai muat**. |
| Pengeluaran BBM otomatis | `DashboardPengirimanBBM.WaktuIsi` | **Keputusan desain**: dikelompokkan berdasarkan waktu pengisian BBM itu sendiri (real-time), BUKAN mengikuti shift Jadwal induknya — konsisten dengan filosofi akuntansi kas kecil (uang keluar dicatat pada shift saat uang benar-benar keluar), bukan filosofi loading/muatan. Baris dengan `WaktuIsi IS NULL` (baru "Masuk SPBU", belum "Simpan") diabaikan — belum ada nominal untuk ditampilkan. |
| Pengeluaran kas manual | Sudah ada (`kas-kecil.ts`, per shift) | Tidak berubah. |
| Data Produksi | Sudah ada (`aktivitas-produksi.ts`, per shift) | Tidak berubah. |
| Mesin ON/OFF | `DashboardProduksiMesinEvent.WaktuEvent` | Pakai `getMesinEventsForShift` yang sudah ada, tidak perlu fungsi baru. |
| Counter Mesin | `DashboardProduksiBatch.JamPanen` | `DashboardProduksiBatch` sudah punya `TanggalLabel`/`Shift` tersimpan langsung per baris (bukan dihitung dari `JamPanen` — mengikuti pola yang sama dengan `getKantongEkivalenProduksiPerBulan`), filter `WHERE TanggalLabel = @tanggalUsaha AND Shift = @shift`, urutkan per `MesinID, JamPanen ASC`. |
| Stok Bahan Baku awal/akhir | Sudah ada (`stok-bahan-baku.ts`, per shift) | Tidak berubah. |
| Stok Es awal/akhir | Snapshot baru (Bagian 4) | Lihat di bawah. |

## Rincian Kartu Pengiriman

Satu Jadwal = satu kartu, di dalamnya daftar tujuan (stop):

- Nama mitra, item & qty (dari `DashboardPengirimanJadwalDetail`/`SalesOrderDetail` yang sudah dipakai `getStopDeliveryProof`/`getPengirimanBoard`).
- Status bayar: `Tunai` / `QRIS` / `Transfer` (dibaca lewat `SalesPaymentDetail JOIN SalesPayment JOIN DashboardSalesPaymentMetode` — pola query PERSIS yang sudah dipakai `getStopDeliveryProof` untuk field `payment`, tinggal ditambah join ke `DashboardSalesPaymentMetode` untuk resolve `MetodeKode` ke label `TUNAI`/`QRIS`/`TRANSFER`) atau `Tidak Bayar` (`TanpaPembayaran = 1`) atau `Belum Bayar` (invoice ada, belum ada baris `SalesPaymentDetail` yang match).
- Retur: `QtyRetur` per item (`DashboardPengirimanStopDeliveryItem`), dan kalau retur itu sudah dijual ulang — jalur (Dalam Rute / Luar Rute / Retail) beserta qty-nya, dari `DashboardPengirimanReturResale` (fitur yang baru dibangun, `getSisaReturTersedia`-adjacent query, JOIN by `StopDeliveryItemID`).

## Bagian 4 — Snapshot Stok Es

Tabel baru `DashboardLaporanShiftStokEsSnapshot`:

```sql
CREATE TABLE DashboardLaporanShiftStokEsSnapshot (
  SnapshotID INT IDENTITY PRIMARY KEY,
  TanggalUsaha DATE NOT NULL,
  Shift TINYINT NOT NULL,
  TotalSisaQty10KG DECIMAL(18,2) NOT NULL,
  CreatedDate DATETIME NOT NULL DEFAULT GETDATE(),
  IsDeleted BIT NOT NULL DEFAULT 0,
  CONSTRAINT UQ_LaporanShiftStokEsSnapshot UNIQUE (TanggalUsaha, Shift)
);
```

Dibuat lewat skrip idempoten `scripts/create-laporan-shift-stok-es-snapshot-table.ts`, mengikuti konvensi `IF NOT EXISTS` yang sudah dipakai skrip-skrip skema lain di repo ini.

**Scheduler**: `node-cron` didaftarkan sekali di `src/instrumentation.ts` (hook resmi Next.js untuk efek samping sekali-jalan saat proses server nyala — App Router, deploy self-hosted di Coolify sehingga proses Node memang berjalan terus-menerus, bukan serverless). Tiga jadwal cron: `0 7 * * *`, `0 15 * * *`, `0 23 * * *` (WIB — perlu pastikan proses Node berjalan dengan timezone WIB atau `node-cron` dikonfigurasi eksplisit `timezone: "Asia/Jakarta"`).

Setiap tick: hitung shift yang **baru saja berakhir** (jam 07:00 tick → Shift 3 yang baru lewat; jam 15:00 tick → Shift 1; jam 23:00 tick → Shift 2), hitung `SUM(SisaQty10KG)` dari `DashboardProduksiBatch WHERE IsDeleted = 0 AND SisaQty10KG > 0` (query yang sama dengan snapshot live Peta Warehouse), lalu `INSERT` satu baris — dijaga idempoten lewat `IF NOT EXISTS (SELECT 1 FROM ... WHERE TanggalUsaha = @t AND Shift = @s)` sebelum insert (bukan hanya mengandalkan UNIQUE constraint melempar error — constraint di atas adalah jaring pengaman terakhir, bukan mekanisme utama).

**Catch-up saat startup**: di `instrumentation.ts` yang sama, saat proses server baru menyala, jalankan sekali logika "shift-shift yang sudah lewat tapi belum ada snapshot-nya, isi sekarang juga dengan total live saat ini" — menutup celah kalau server mati/restart persis di jam boundary sehingga satu tick cron terlewat. **Keterbatasan yang diterima**: kalau catch-up ini baru jalan lama setelah shift berakhir (server mati berjam-jam), dan shift-shift berikutnya sudah sempat mengonsumsi/memproduksi stok, angka catch-up itu tidak lagi murni "stok akhir shift X" — melainkan tercampur aktivitas sesudahnya. Ini didokumentasikan sebagai limitasi yang diketahui, bukan dipecahkan sempurna (skenario server mati tepat di jam shift dan baru nyala lagi jauh kemudian adalah kasus langka).

**Tampilan**:
- Shift yang sudah lewat dan punya snapshot → tampilkan angka snapshot apa adanya, sebagai **Stok Akhir Shift**.
- Shift yang sedang berjalan (belum berakhir, belum ada snapshot) → hitung live dari query yang sama, beri label eksplisit **"(live, belum final)"**.
- **Stok Awal Shift** = snapshot shift kronologis sebelumnya (urutan 2→3→1→2...). Kalau shift sebelumnya juga belum punya snapshot (mis. shift pertama sejak fitur ini aktif), tampilkan `-` / "Belum ada data" — tidak memaksa mundur lebih jauh.

## Tata Letak UI

Tab baru **"Laporan Shift"** di `LaporanTabShell`, isinya:

1. **Selector shift** di atas — mirip pola navigasi bulan+shift yang sudah ada di Ringkasan Lintas Shift, tapi granularitasnya per-shift (bukan per-bulan): pilih Tanggal Usaha + Shift, lalu tombol "Tampilkan" (atau otomatis fetch saat pilihan berubah — detail interaksi ditentukan implementer, tidak signifikan bagi desain ini).
2. Setelah shift dipilih, satu **kartu detail** ditampilkan, berisi 7 kotak/section berurutan (masing-masing kotak bulat, meniru gaya referensi kertas pengguna):
   1. Header shift (Tanggal Usaha, Shift, Tim Produksi, Staf Operasional bertugas)
   2. Stok Bahan Baku (awal/akhir + pergerakan Gudang→Inventori→Produksi dengan timestamp)
   3. Kartu Pengiriman (satu blok per Jadwal, per tujuan: item/qty/status bayar/retur)
   4. Pengeluaran Uang Kas (BBM otomatis, lalu manual, lalu ringkasan Total Pendapatan/Pengeluaran/Saldo Akhir)
   5. Data Produksi (kantong ekivalen, denda)
   6. Mesin (timeline ON/OFF, lalu daftar counter per mesin dengan timestamp)
   7. Stok Es (awal/akhir shift, per Bagian 4)
3. Menu "lompat ke bagian" kecil yang **sticky** di bagian atas kartu detail (bukan di level halaman), berisi 7 link ke section di atas — membantu navigasi tanpa scroll manual mengingat satu kartu bisa panjang.

Data untuk kartu detail diambil **on-demand** (server action baru) hanya untuk shift yang sedang dipilih — bukan prefetch semua shift di halaman awal, menjaga load awal tab ini tetap ringan.

## Struktur File

- **Baru**: `scripts/create-laporan-shift-stok-es-snapshot-table.ts` — skrip skema idempoten.
- **Baru**: `src/lib/queries/laporan-shift-stok-es-snapshot.ts` — fungsi `catatSnapshotJikaBelumAda(tanggalUsaha, shift)` (dipakai scheduler & catch-up) dan `getSnapshotStokEs(tanggalUsaha, shift)` / cari snapshot shift sebelumnya untuk "Stok Awal".
- **Baru**: `src/instrumentation.ts` (atau ekstensi kalau sudah ada) — registrasi `node-cron` + logic catch-up saat startup.
- **Baru**: `src/lib/queries/laporan-shift-detail.ts` — fungsi utama `getLaporanShiftDetail(tanggalUsaha, shift)` yang menyusun (compose, bukan duplikasi) semua sub-data di atas: kartu pengiriman+status bayar+retur (fungsi baru di sini, atau ekstensi ringan `pengiriman-jadwal.ts` kalau lebih pas di sana — keputusan implementer saat menulis rencana implementasi), BBM (`driver-fuel.ts`-adjacent read), mesin (reuse `getMesinEventsForShift`, `getMesinList`, query counter baru), dan pemanggilan ulang fungsi-fungsi shift-tunggal yang sudah ada untuk Stok Bahan Baku/Produksi/Kas Kecil (bukan versi whole-month yang dipakai Ringkasan Lintas Shift — cek dulu apakah fungsi versi shift-tunggal sudah ada atau perlu varian baru).
- **Baru**: `src/components/dashboard/laporan-shift-detail.tsx` — selector + 7 section + sticky jump-nav.
- **Modifikasi**: `src/components/dashboard/laporan-tab-shell.tsx` — tambah tab "Laporan Shift".
- **Modifikasi**: `src/app/mkesindo/(dashboard)/laporan/actions.ts` — server action baru untuk fetch on-demand `getLaporanShiftDetail`.

## Error Handling & Edge Case

- Shift yang dipilih tidak punya data sama sekali di satu bagian (mis. tidak ada Jadwal yang selesai muat di shift itu) → section itu tampil kosong dengan pesan singkat ("Tidak ada kartu pengiriman pada shift ini"), bukan disembunyikan — konsisten dengan bagian lain yang sudah menampilkan "Belum lengkap"/kosong secara eksplisit di komponen-komponen lama.
- Invoice ada tapi belum ada baris `SalesPaymentDetail` yang cocok (belum dibayar, belum juga ditandai Tanpa Bayar) → status bayar `Belum Bayar` (bukan error, bukan disamakan dengan Tanpa Bayar).
- Snapshot stok es hilang total (server baru pertama kali deploy fitur ini) → semua shift lama tampil "Belum ada data" untuk Stok Es; hanya shift-shift SETELAH fitur ini aktif yang punya data lengkap. Tidak ada usaha merekonstruksi mundur ke masa lalu.

## Testing

Repo ini tidak punya test suite otomatis. Verifikasi memakai `npx tsc --noEmit` + `npx eslint`, plus skrip live-DB (`BEGIN TRAN...ROLLBACK` untuk baca-saja, atau capture-baseline/modify/verify/revert untuk apa pun yang menulis) — mengikuti konvensi yang sudah dipakai berulang kali di seluruh sesi ini. Scheduler `node-cron` diverifikasi dengan menjalankannya secara manual sekali (panggil fungsi penyimpan snapshot langsung, bukan menunggu jam sungguhan) untuk memastikan idempotensi (jalankan dua kali, baris kedua tidak dobel).
