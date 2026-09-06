# Laporan Shift — Pengayaan Kartu Pengiriman & Kas — Design Spec

## Latar Belakang

Tab "Laporan Shift" (baru saja selesai dibangun) saat ini menampilkan data secara sederhana. Pengguna memberikan referensi desain yang jauh lebih informatif — kartu pengiriman bergaya ledger keuangan dengan status bayar berwarna, plus kemampuan mencatat pelunasan tunai langsung dari laporan, input kas keluar yang sungguhan, dan rekap per driver lintas shift.

Ini **BUKAN** proyek terpisah dari fitur Laporan Shift yang baru selesai — ini pengayaan (enrichment) atas 3 bagian yang sudah ada: **Kartu Pengiriman**, **Pengeluaran Uang Kas**, dan **Header**. Bagian lain (Stok Bahan Baku, Produksi, Mesin, Stok Es) tidak berubah.

## Tujuan

1. Judul rute pada Kartu Pengiriman mengikuti format `[JamAktualBerangkat] - Wilayah, Kecamatan` (lokasi tujuan terjauh).
2. Tampilan Kartu Pengiriman & Kas diperkaya mengikuti gaya referensi (badge, tabel per-tujuan, status berwarna) — bukan sekadar daftar teks polos.
3. Dispatcher/staf bisa mencatat pelunasan tunai langsung dari Laporan Shift — memilih SI (SalesInvoice) mana yang dilunasi, per baris, tersimpan seketika saat diklik (tanpa konsep draft).
4. Pengeluaran kas (manual DAN BBM) benar-benar bisa ditambah/diubah/dihapus dari tampilan ini, bukan cuma dipajang.
5. Rekap Total per Driver — total Kirim/Return/Netto per driver, mencakup **seluruh 3 shift pada Tanggal Usaha yang sama** (bukan cuma shift yang dipilih).

## Non-Tujuan

- Tidak mengubah cara pencatatan pembayaran di driver-app (step Pembayaran yang sudah ada tetap seperti sekarang) — ini kanal BARU dan TERPISAH untuk mencatat pelunasan, khusus dari Laporan Shift.
- Tidak membangun ulang modul Pelunasan — modul itu (`recordPayment`/`getOutstandingInvoicesForMitra`, `src/lib/queries/pelunasan.ts`) sudah lengkap (multi-invoice, kelebihan bayar otomatis jadi deposit) dan dipakai apa adanya, hanya disematkan ke permukaan baru.
- Tidak ada state "draft/belum final" untuk laporan shift secara keseluruhan — setiap aksi simpan (pelunasan, tambah/ubah/hapus kas) berdiri sendiri dan langsung permanen saat diklik.
- Bagian Stok Bahan Baku/Produksi/Mesin/Stok Es tidak disentuh sama sekali.

## Bagian 1 — Judul Rute & Field Baru pada Kartu Pengiriman

Format judul: **`[JamAktualBerangkat] - [Wilayah], [Kecamatan]`** — contoh: `06:00 - Ponorogo, [Kecamatan]`. Kalau `Kecamatan` null, tampilkan `Wilayah` saja. Kalau `LokasiTerjauh` seluruhnya null (rute belum tergeokode), tampilkan fallback yang jelas (mis. hanya jam, tanpa lokasi) — jangan sampai menampilkan teks kosong/undefined.

`JamAktualBerangkat` adalah kolom real `DashboardPengirimanJadwal.JamAktualBerangkat` — sudah ada di sistem (dipakai `JadwalCard` di Papan Pengiriman), tapi BELUM diseleksi oleh query Kartu Pengiriman Laporan Shift saat ini (`getKartuPengirimanUntukShift`, yang baru punya `jamSelesaiMuat`). Perlu ditambahkan ke SELECT.

`LokasiTerjauh` (`{ Wilayah, Kecamatan }`) di `getPengirimanBoard` (Papan Pengiriman) dihitung lewat fungsi TypeScript terpisah (`estimateTravelMinutesForJadwal`, bukan kolom SQL langsung) — perlu diverifikasi saat menulis rencana implementasi apakah fungsi itu bisa dipakai ulang langsung (kalau di-export) untuk himpunan Jadwal yang jauh lebih kecil (satu shift, bukan satu papan penuh), atau apakah perlu query "titik terjauh dari pabrik per Jadwal" versi lebih ringan ditulis langsung di `laporan-shift-pengiriman.ts` — kedua-duanya valid, keputusan teknis ini didelegasikan ke tahap penulisan rencana setelah membaca kode `estimateTravelMinutesForJadwal` secara langsung.

Field baru lain yang perlu ditambahkan ke `KartuPengirimanStopRow`: **`businessPartnerId: string`** (sudah tersedia di query yang ada — `SalesOrder.BusinessPartnerID` — tinggal diseleksi, dibutuhkan Bagian 3 untuk mengambil daftar SI outstanding mitra tersebut).

## Bagian 2 — Tata Letak Visual

Kartu Pengiriman & panel Kas mengikuti gaya referensi pengguna secara adaptif ke sistem desain dashboard yang sudah ada (warna/komponen shadcn yang sudah dipakai di tempat lain, bukan meniru piksel demi piksel):

- **Header kartu per-Jadwal**: badge jam keberangkatan, judul rute (Bagian 1), plat nomor kendaraan, nama driver, badge ringkasan qty per varian item (mis. "40×10kg / 16×5kg"), badge status ("tiba HH:mm" / "di jalan").
- **Tabel per-tujuan**: kolom Tujuan, Kirim, Return, Nominal, Metode, Status — status berwarna: hijau untuk Lunas (Tunai/QRIS/Transfer dengan pembayaran tercatat), kuning/oranye untuk "Perlu Validasi" (retur ada tapi belum ada resale/keputusan), merah untuk Tidak Bayar, netral untuk Belum Bayar.
- **Multi-Jadwal**: kartu kedua dst. bisa di-collapse (tertutup ringkas, klik untuk buka) — mengurangi scroll saat banyak rute dalam satu shift.
- **Panel Kas**: dua kolom — Kas Masuk (setoran/kembalian) dan Kas Keluar (BBM otomatis + manual), masing-masing baris berwarna sesuai arah uang (hijau masuk, merah keluar), dengan ringkasan "Saldo Akhir Shift" di bagian bawah (sudah ada datanya dari `kasKecil.saldoAkhir`).

## Bagian 3 — Pelunasan Tunai dari Laporan Shift

Untuk tiap baris tujuan dengan `statusBayar` yang belum final tercatat (`BELUM_BAYAR`, termasuk kasus "Dibayar (metode belum tercatat)" dari fitur sebelumnya) DAN metode yang dipilih pengguna adalah Tunai: tampilkan dropdown pilih SI + tombol Simpan kecil di baris itu juga.

**Alur:**
1. Dropdown diisi dari `getOutstandingInvoicesForMitra(businessPartnerId)` (sudah ada, `pelunasan.ts`) — daftar SI outstanding milik mitra tujuan itu, terurut jatuh-tempo-terlama-dulu (perilaku bawaan fungsi ini).
2. Pengguna pilih satu (atau, karena `recordPayment` sudah mendukung multi-alokasi, desain UI boleh mengizinkan pilih lebih dari satu SI sekaligus dengan nominal per-baris — keputusan detail UI ini didelegasikan ke tahap implementasi, TAPI minimal harus bisa pilih satu SI dengan nominal penuh sebagai kasus paling umum).
3. Klik Simpan → panggil `recordPayment` (sudah ada) dengan `konteks: "kasir"`, `metodePembayaranKode` dari metode Tunai yang aktif untuk konteks "kasir" (resolusi sama seperti pola yang sudah dipakai driver-app: `listActiveMetodePembayaran(perusahaanId, "kasir")` lalu pilih yang `metode === "TUNAI"`), `businessPartnerId` dari stop tersebut, `allocations: [{ salesInvoiceId, amount }]`.
4. Setelah berhasil, refresh data laporan shift ini saja (panggil ulang `getLaporanShiftDetailAction` untuk `(tanggalUsaha, shift)` yang sama) — baris itu akan otomatis pindah status begitu `SalesPaymentDetail` baru terbaca oleh query yang sudah ada.
5. Tidak ada draft/finalisasi menyeluruh — tiap Simpan berdiri sendiri, langsung permanen.

**Server action baru** dibutuhkan (di `src/app/mkesindo/(dashboard)/laporan/actions.ts` atau file actions baru khusus) yang menggabungkan: gate `requireModuleAccess("laporan")` + resolve `perusahaanId` (pola `getMkesindoPerusahaanId()` yang sudah dipakai `getLaporanShiftDetailAction`) + panggil `recordPayment`. Juga dibutuhkan action pembungkus `getOutstandingInvoicesForMitra` (baca-saja) untuk mengisi dropdown per baris.

## Bagian 4 — Input Kas Keluar Sungguhan

**Kas manual** (kas-kecil): pakai ulang `tambahPengeluaranAction`/`hapusPengeluaranAction` yang sudah ada — form tambah (keterangan + nominal) dan tombol hapus per baris, mengadaptasi pola UI yang sudah terbukti di `LaporanKasKecil` (`src/components/dashboard/laporan-kas-kecil.tsx`) ke gaya kartu baru Bagian 2.

**Kas BBM** (otomatis dari driver-app saat isi bensin): SAAT INI tidak ada mekanisme update/hapus sama sekali di `driver-fuel.ts` (hanya `recordMasukSpbu`/`updateFuelLog`, keduanya bagian dari alur pengisian BBM oleh driver, bukan koreksi oleh staf). Karena pengguna secara eksplisit meminta BBM juga bisa dikoreksi dari Laporan Shift, perlu **fungsi baru**: `updateBbmManual(bbmId, liter, nominalAsli, nominalEkstra, akunId)` dan `hapusBbmEntry(bbmId, akunId)` di `driver-fuel.ts`, dipanggil lewat server action baru bergerbang `requireModuleAccess("laporan")` (BUKAN gerbang driver-app — ini koreksi oleh staf, bukan driver mengisi ulang). `hapusBbmEntry` mengikuti konvensi hapus yang sudah dipakai `hapusPengeluaran` di file yang sama (hard delete, karena — sama seperti alasan `hapusPengeluaran` — tidak ada referensi lain ke `BBMID`; verifikasi ulang klaim ini saat menulis rencana, jangan asumsikan otomatis berlaku sama).

## Bagian 5 — Rekap Total per Driver (Lintas Shift, Satu Hari Penuh)

Query baru — bukan bagian dari `getLaporanShiftDetail` yang sudah ada (yang murni per-shift) — mengagregasi, untuk **Tanggal Usaha yang sama** dengan shift yang sedang dipilih (bukan cuma shift itu sendiri, mencakup ketiga shift hari itu): per Driver, total qty Kirim, total qty Return, dan Netto (Kirim dikurangi Return), dalam satuan kantong ekivalen (mengikuti konvensi kantong-ekivalen yang sudah dipakai di seluruh laporan lain — 10KG=1, 5KG=0.5) atau qty mentah per item — keputusan satuan yang persis didelegasikan ke tahap implementasi berdasarkan data mana yang paling mudah diambil dari struktur yang sudah ada (`getKartuPengirimanUntukShift`'s per-stop item/retur breakdown, dijalankan untuk ketiga shift lalu dikelompokkan per `salesmanId`/`driverName`).

Ditampilkan sebagai tabel terpisah di bawah daftar Kartu Pengiriman, dengan keterangan kecil "seluruh shift hari ini" (persis seperti referensi) supaya jelas cakupannya berbeda dari sisa halaman yang per-shift.

## Error Handling & Edge Case

- Stop tanpa `businessPartnerId` yang valid (seharusnya tidak terjadi karena setiap stop punya SalesOrder→BusinessPartner, tapi tetap ditangani): dropdown pelunasan disembunyikan, bukan error.
- Mitra tanpa SI outstanding sama sekali: dropdown menampilkan pesan "Tidak ada SI outstanding" bukan daftar kosong yang membingungkan.
- `recordPayment` gagal (mis. metode tidak aktif, alokasi tidak valid): tampilkan pesan error `AppError` apa adanya di baris itu, jangan sampai menghapus pilihan dropdown pengguna (supaya bisa dicoba ulang tanpa mengisi ulang).
- BBM/kas manual yang dihapus: refresh data laporan shift ini saja, sama seperti Bagian 3.
- Rekap per Driver: driver yang sama sekali tidak punya Jadwal pada hari itu tidak muncul di tabel (bukan baris kosong).

## Testing

Sama seperti fitur Laporan Shift sebelumnya: tidak ada test suite otomatis. Verifikasi lewat `npx tsc --noEmit` + `npx eslint`, live-DB scratch scripts untuk baca-saja, dan capture-baseline/modify/verify/revert untuk apa pun yang menulis (pelunasan sungguhan, tambah/hapus kas) — TERUTAMA `recordPayment` yang menyentuh dokumen finansial nyata, jangan sampai meninggalkan SalesPayment palsu di database produksi tanpa dibersihkan setelah verifikasi.
