# Mitra: Identitas, Alamat Mitra & Lokasi Pengiriman Ganda — Desain

Tanggal: 2026-10-23 · Status: draf, menunggu persetujuan · Bisnis: Es Kristal (MKEsindo + tenant Demo) dan Es Balok (PMPutra, PMPersada, PMPakis)

## 1. Maksud & alasan

Halaman /mitra saat ini mencampur identitas mitra dan tempat pengiriman dalam satu set kolom (Alamat, Wilayah, Kecamatan, Kontak, satu pin). Pada kenyataannya sebagian mitra punya lebih dari satu titik kirim, dan perusahaan juga perlu mencatat identitas legal mitra (penanggung jawab, NIK + berkas, dokumen SK). Desain ini memisahkan **identitas mitra** dari **lokasi pengiriman**, memungkinkan satu mitra punya banyak lokasi pengiriman, dan mengganti Daftar Kompetitor teks bebas menjadi daftar terstruktur.

Mitra **tetap satu entitas** berapa pun jumlah lokasinya.

## 2. Layout form baru (keputusan pengguna)

```
── Identitas ───────────────────────────────────────────────
Nama Mitra | Nama Penanggung Jawab
NIK + Berkasnya | Tanggal Pendaftaran (otomatis) + Dokumen SK (Unggah, Hapus, Pratinjau)
Wilayah | Kecamatan | Alamat | Kontak   [+ pin, hanya bila kotak di bawah TIDAK dicentang]
Segmentasi | Marketing | Harga | Tenggat
[ ] Lokasi Pengiriman Berbeda dengan Mitra
── Lokasi Pengiriman [+]  (hanya muncul bila kotak dicentang) ──
Lokasi 1 (Utama): Wilayah | Kecamatan | Alamat | Kontak | [lokasi]
Lokasi 2 …      : Wilayah | Kecamatan | Alamat | Kontak | [lokasi]
── Daftar Kompetitor [+] | Kapasitas Harian ─────────────────
(multi-pilih dari master; [+] menambah kompetitor baru ke master)
── Peta: satu pin per lokasi pengiriman ─────────────────────
```

- "Hari" di daftar lama adalah satuan Tenggat Pembayaran, bukan kolom tersendiri.
- Kapasitas Harian = target marketing untuk mitra itu; dipindah ke sebelah Daftar Kompetitor.
- Pin pada baris Identitas: **keputusan desain (bukan dari pengguna)** — saat kotak tidak dicentang, alamat mitra *adalah* lokasi pengiriman, jadi butuh pin. Pin mitra yang ada sekarang otomatis tampil di situ.

## 3. Aturan bisnis (keputusan pengguna)

1. **Kotak "Lokasi Pengiriman Berbeda dengan Mitra"**
   - Tidak dicentang (bawaan): alamat mitra = lokasi pengiriman tunggal. Ditulis **sekali**.
   - Dicentang: bagian Lokasi Pengiriman [+] muncul; alamat mitra disimpan terpisah.
2. **Lokasi pertama = lokasi utama.** Marketing penanggung jawab mengikuti Wilayah/Kecamatan lokasi utama.
3. **Laporan per wilayah tetap per mitra.** Satu mitra dihitung sekali (di wilayah lokasi utama), tidak dipecah per lokasi.
4. **Konversi data lama tanpa kehilangan:** semua mitra lama = kotak tidak dicentang; alamat/wilayah/kecamatan/kontak/pin yang ada menjadi alamat mitra sekaligus lokasi pengiriman.
5. **Pemilihan lokasi per pengiriman** dilakukan **saat menyusun Jadwal di Papan Pengiriman**, bukan di Buat Pemesanan.
6. **Cetak DO & struk thermal** mencetak alamat lokasi pengiriman.
7. **Siapa yang boleh melihat NIK** diatur di /grup/akun (peran).
8. Es Balok belum punya Papan Pengiriman; rancangan ini harus siap dipakai saat Papan Pengiriman Es Balok dibangun.

## 4. Pendekatan (dipilih: C — Hibrida)

| | Pendekatan | Untung | Rugi |
|---|---|---|---|
| A | Semua di tabel pendamping DB ERP | Pola terbukti, JOIN langsung | NIK & berkas terbaca siapa pun yang punya akses DB/ERP desktop; master kompetitor terpecah 6 salinan |
| B | Semua di Postgres pusat | Satu skema | Query rute/Jadwal/Laporan Shift/Satpam/cetak sekarang JOIN pin di SQL Server → harus ditulis ulang jadi merge di aplikasi; paling berisiko |
| **C** | **Hibrida** | Lokasi tetap di DB ERP (JOIN SQL tetap jalan); identitas sensitif + master kompetitor di Postgres (izin /grup/akun berlaku, tidak terbaca dari ERP) | Dua tempat penyimpanan untuk satu mitra |

Pengguna memilih **C**.

## 5. Invarian inti

> **Kolom ERP yang sudah ada + pin yang sudah ada SELALU berisi lokasi pengiriman utama.**

- Es Kristal: `BusinessPartner.Address` (alamat), `NPWPName` (Wilayah), `NPWPAddress` (Kecamatan), `MobileNo` (kontak), dan `DashboardMitraLocation` (pin).
- Es Balok: `PMP_AgenDetail.Address1` + `RegionID` (alamat/wilayah), `PMP_Agen.Telepon` (kontak), `DashboardAgenLocation` (pin).

Konsekuensi:
- 24 file query yang membaca `NPWPName/NPWPAddress` (kepemilikan marketing, Kinerja Marketing, aging per wilayah, pangsa pasar, growth, dll.) **tidak berubah** dan otomatis memenuhi aturan 2 dan 3.
- ERP desktop melihat alamat kirim utama yang benar.
- **Migrasi mitra lama = nol baris ditulis.** Data lama sudah persis di tempat yang benar; kotak tidak dicentang berarti tidak ada baris di tabel baru.
- Lokasi utama **tidak pernah** disimpan di tabel lokasi tambahan (tidak ditulis dua kali). Di tabel lokasi hanya ada lokasi ke-2 dst.

## 6. Model data

### 6.1 Es Kristal — tabel baru di setiap DB Es Kristal (MKEsindo + DemoEsKristal)

**`DashboardMitraAlamat`** — alamat mitra sendiri, **hanya ada baris bila kotak dicentang**.
| Kolom | Tipe | Ket. |
|---|---|---|
| BusinessPartnerID | varchar(16) PK | |
| Wilayah | varchar(128) | |
| Kecamatan | varchar(128) | |
| Alamat | varchar(1024) | |
| Kontak | varchar(128) | |
| CreatedByUserID / UpdatedByUserID | varchar(16) | |
| CreatedAt / UpdatedAt | datetime | |

Keberadaan baris = kotak dicentang. Tidak ada kolom flag terpisah.

**`DashboardMitraLokasiPengiriman`** — lokasi ke-2 dst.
| Kolom | Tipe | Ket. |
|---|---|---|
| LokasiPengirimanID | int IDENTITY PK | |
| BusinessPartnerID | varchar(16), indexed | |
| Urutan | int | 2, 3, … (urutan tampil) |
| Label | varchar(64) NULL | opsional, mis. "Gudang Pasar" — *keputusan desain* untuk memudahkan pemilihan di Papan Pengiriman |
| Wilayah, Kecamatan, Alamat, Kontak | sama dgn di atas | |
| Latitude, Longitude | decimal(10,7) NULL | |
| GeoAlamat | varchar(512) NULL | hasil reverse-geocode, seperti DashboardMitraLocation |
| IsDeleted | bit default 0 | soft-delete; baris lama tetap ada untuk riwayat Jadwal/cetak |
| Created*/Updated* | | |

**`DashboardPengirimanJadwalDetail`** — tambah kolom `LokasiPengirimanID int NULL`. **NULL = lokasi utama.** Semua Jadwal lama otomatis benar.

**Pembekuan alamat per stop (keputusan pengguna):** tambah kolom snapshot di `DashboardPengirimanJadwalDetail`: `KirimAlamat`, `KirimWilayah`, `KirimKecamatan`, `KirimKontak`, `KirimLatitude`, `KirimLongitude`.
- Diisi **saat DO dibuat untuk stop itu** (saat `DeliveryOrderID` terisi), dari lokasi terpilih (atau utama bila NULL). Ini berlaku di semua jalur yang mengisi `DeliveryOrderID`.
- Sebelum DO dibuat, stop mengikuti alamat terkini: edit lokasi atau "Jadikan Utama" langsung terlihat di Jadwal yang belum jadi DO.
- Setelah dibekukan, cetak/cetak ulang DO, struk, Laporan Shift, Inspeksi Satpam, dan Aplikasi Driver membaca snapshot lebih dulu, baru resolusi langsung bila snapshot kosong.
- **Backfill** untuk JadwalDetail lama yang sudah punya `DeliveryOrderID`: isi snapshot dari nilai saat ini (`bp.*` + `DashboardMitraLocation`). Ini dilakukan dengan dry-run ke `docs/data-fixes/` + skrip revert, sesuai pola `scripts/fix-*`/`revert-*`. Tujuannya supaya "Jadikan Utama" di kemudian hari tidak mengubah cetak ulang DO lama. *Keputusan desain.*
- DO yang dibuat dari ERP desktop tanpa JadwalDetail tidak punya tempat snapshot → tetap resolusi langsung ke utama (sama dengan perilaku sekarang).

### 6.2 Es Balok — tabel baru di kelima DB fisik

`DashboardAgenAlamat` dan `DashboardAgenLokasiPengiriman`, isi sama dengan versi Es Kristal tapi dengan kunci `AgenID`. Ikuti aturan koneksi yang sudah ada di `resolveAgenKoneksi()`:
- logistik pmpersada & pmpakis = satu DB fisik bersama (`FINAC_PMP_LOGISTIC`) → satu tabel melayani keduanya, sama seperti `DashboardAgenLocation` sekarang.
- pmputra: kartu gabungan utama+logistik → simpan di DB **utama** saja.

Lokasi tambahan Es Balok **tidak** dibuat sebagai baris `PMP_AgenDetail` tambahan, karena perilaku ERP desktop terhadap >1 baris AgenDetail per Agen belum diketahui. Selain itu, `getAgenRows()` sekarang akan **menggandakan kartu** kalau ada Agen dengan >1 baris AgenDetail aktif. Builder wajib mengecek jumlahnya di data live sebelum mulai (lihat §11).

Form Es Balok memakai **layout yang sama** dengan Es Kristal (*keputusan pengguna*). Pemetaan untuk kolom yang tidak dimiliki Es Balok (usulan yang diterima pengguna):
- **Kecamatan**: Es Balok tidak punya. Tambah kolom `Kecamatan` di `DashboardAgenProfil` (untuk lokasi utama) dan di tabel lokasi tambahan; opsional.
- **Marketing**: Es Balok belum punya penugasan marketing → slot ditampilkan "—".
- **Tenggat**: Es Balok tidak punya tenggat bayar; slot ini menampilkan **Batas Hutang** (`MaksimumHutang`).
- **Harga**: Harga Balok Kecil + Harga Balok Besar.
- **Kapasitas Harian**: Kapasitas Balok Kecil + Besar.

### 6.3 Postgres pusat (DB direktori, `getPgPool()`)

**`mitra_identitas`**
| Kolom | Tipe | Ket. |
|---|---|---|
| perusahaan_kode | text | kode **fisik** hasil `resolveAgenKoneksi()` untuk Es Balok (agar pmpakis & pmpersada logistik berbagi identitas yang sama); kode Es Kristal untuk MKEsindo/Demo |
| sumber | text | `utama` / `logistik` (Es Kristal selalu `utama`) |
| partner_id | text | BusinessPartnerID / AgenID |
| nama_penanggung_jawab | text NULL | tidak sensitif — tampil ke siapa pun yang bisa melihat mitra |
| nik | text NULL | **sensitif** |
| nik_file_id, nik_file_nama, nik_file_mime | text NULL | **sensitif** |
| sk_file_id, sk_file_nama, sk_file_mime | text NULL | **sensitif** (diperlakukan sama dengan NIK) |
| tanggal_pendaftaran | date NULL | lihat di bawah |
| updated_by, updated_at | | |
| PK | (perusahaan_kode, sumber, partner_id) | |

Tanggal Pendaftaran (otomatis, read-only):
- Es Kristal: pakai `BusinessPartner.JoinDate` yang sudah ada (sudah diisi `createMitra()`); kolom Postgres tidak dipakai. Mitra impor ERP yang JoinDate-nya NULL tampil "—".
- Es Balok: `PMP_Agen` tidak punya tanggal daftar → isi `tanggal_pendaftaran` saat mitra dibuat dari dashboard; mitra lama tampil "—".

**`kompetitor`** — master satu untuk seluruh grup **per holding** (*keputusan desain*: tenant SaaS lain seperti DemoEsKristal berbagi deployment, jadi tidak boleh melihat atau menambah daftar kompetitor milik PMP).
| id serial PK | holding_kode text | nama text | bisnis text (`es_kristal` / `es_balok`) | created_by, created_at | UNIQUE (holding_kode, lower(trim(nama)), bisnis) |

Tabel `mitra_identitas` dan `mitra_kompetitor` sudah terisolasi lewat `perusahaan_kode`.

**`mitra_kompetitor`** — relasi banyak-ke-banyak, PK (perusahaan_kode, sumber, partner_id, kompetitor_id).

Dropdown kompetitor hanya menampilkan master dengan `bisnis` yang sama dengan halaman yang sedang dibuka.

### 6.4 Izin NIK di /grup/akun

- Tambah kunci izin baru `mitra_identitas` di `peran_izin` (can_view = lihat NIK + berkas NIK + SK; can_edit = isi/ubah/unggah/hapus). Kunci ini **bukan** item sidebar, jadi masuk daftar terpisah (mis. `SPECIAL_PERMISSION_KEYS`), bukan `MODULE_KEYS`.
- `getPermissionMapForPeran()` (`src/lib/queries/akun.ts`) sekarang membuang `module_key` yang tidak ada di `MODULE_KEYS`, dan tipe `PermissionMap` dibatasi ke `ModuleKey`. Keduanya harus diperluas supaya kunci baru ikut masuk ke JWT.
- Editor peran di /grup/akun/peran menampilkan baris "Identitas Mitra (NIK & Berkas)".
- Super Admin **dan akun Direktur** (akun tanpa peran, `peranId == null`, lewat `akun_direktori`) selalu boleh melihat dan mengubah — *keputusan pengguna*.
- **Penegakan di server**, bukan cuma disembunyikan di UI: tanpa can_view, server tidak pernah mengirim nilai NIK atau ID berkas ke client. UI menampilkan "Tersembunyi".
- Izin ada di JWT sesi. Peran yang baru diberi izin harus login ulang; ini perilaku yang sama dengan izin modul sekarang.
- Akun Es Balok non-Direktur yang punya peran diatur lewat editor peran yang sama.

## 7. Berkas NIK & SK (keamanan)

Temuan: rute `/api/files/[perusahaan]/[fileId]/[filename]` **tidak mengecek login** dan mengirim `Cache-Control: public, max-age=31536000, immutable`, sehingga berkas disimpan di cache Cloudflare. Fallback disk lokal `uploadFile()` juga menulis ke `/uploads/…` publik. **Berkas identitas tidak boleh lewat jalur itu.**

- Rute unggah baru (pola `src/app/api/mkesindo/upload/*`): cek sesi + izin `mitra_identitas` can_edit; tipe JPG/PNG/WEBP/PDF; maks 5 MB; folder Drive `["mitra-identitas", <kode>, <partnerId>]`.
- **Tolak** unggah bila Google Drive perusahaan belum terhubung (jangan pakai fallback disk publik).
- Rute baca baru, mis. `/api/mitra-berkas/[kode]/[sumber]/[partnerId]/[jenis]`: cek sesi + can_view, cari file_id dari `mitra_identitas` (client tidak pernah menerima file_id mentah), header `Cache-Control: private, no-store`.
- Hapus = hapus berkas di Drive + kosongkan kolom.
- Pratinjau: gambar inline, PDF di iframe/tab baru, keduanya lewat rute baca di atas.

## 8. Perilaku form

- **Centang kotak** (dari kondisi tidak dicentang): data alamat yang ada tetap menjadi **Lokasi 1 (Utama)**. Bagian Identitas → Alamat diisi awal dengan salinan data itu supaya pengguna tinggal mengubah. Simpan → buat baris `DashboardMitraAlamat`.
- **Hapus centang** saat ada lokasi tambahan: minta konfirmasi ("N lokasi tambahan akan dihapus, alamat mitra akan disamakan dengan Lokasi Utama"). Lokasi tambahan di-soft-delete, baris `DashboardMitraAlamat` dihapus, data utama tetap.
- **Tambah lokasi [+]**: baris baru Urutan berikutnya.
- **Hapus lokasi**: soft-delete. Lokasi utama tidak bisa dihapus selama ada lokasi lain. Lokasi yang sedang dipakai Jadwal yang belum selesai → tolak dengan pesan yang jelas.
- **Jadikan Utama** (lokasi ke-n naik jadi utama): isi utama lama dipindah ke baris **baru** di tabel lokasi tambahan, isi lokasi ke-n ditulis ke kolom ERP + pin, lalu baris ke-n di-soft-delete. Riwayat Jadwal yang menunjuk ID lama tetap menampilkan alamat yang sama. Karena wilayah utama bisa berubah, **marketing penanggung jawab dan laporan bisa ikut pindah**; tampilkan peringatan sebelum menyimpan.
- Semua penulisan lokasi utama (kolom ERP + pin) dan lokasi tambahan dilakukan dalam **satu transaksi SQL**.
- `updateMitra()` sekarang menulis ulang `Address/NPWPName/NPWPAddress/MobileNo` dari form. Pemetaannya tetap sama: kolom-kolom itu = lokasi utama. Saat kotak dicentang, field yang dipetakan ke kolom ERP adalah Lokasi 1, bukan Identitas → Alamat.
- **Validasi**: Wilayah lokasi utama wajib (kepemilikan marketing bergantung padanya). Kolom lain mengikuti aturan yang berlaku sekarang.

## 9. Dampak ke modul lain

### 9.1 Papan Pengiriman & turunannya (Es Kristal)
- Kartu stop: bila mitra punya >1 lokasi, tampilkan pemilih lokasi (Utama / label / alamat singkat), bawaan Utama. Mitra dengan 1 lokasi: tidak ada perubahan UI.
- Simpan ke `DashboardPengirimanJadwalDetail.LokasiPengirimanID`.
- Semua JOIN pin yang sekarang berbentuk `LEFT JOIN DashboardMitraLocation ml ON ml.BusinessPartnerID = so.BusinessPartnerID` dan punya akses ke `jd`: ganti dengan "lokasi terpilih bila ada, selain itu utama" (LEFT JOIN `DashboardMitraLokasiPengiriman lp ON lp.LokasiPengirimanID = jd.LokasiPengirimanID`, lalu `COALESCE(lp.Latitude, ml.Latitude)` dst.). Termasuk soft-deleted, demi riwayat. Lokasi yang diketahui: `pengiriman-jadwal.ts` (±3 tempat: estimasi waktu tempuh, pengelompokan stop, daftar stop), `laporan-shift-pengiriman.ts`, `satpam-inspeksi-shift.ts`, dan query stop di Aplikasi Driver. Builder wajib grep ulang `DashboardMitraLocation` dan `bp.Address`/`NPWPName` di semua query yang terkait Jadwal/stop.
- Aturan travel-time + overlap/merge (3 jalur tulis Jadwal) memakai koordinat lokasi terpilih.
- Dua SO dari mitra yang sama ke lokasi berbeda di satu Jadwal = dua stop (JadwalDetail per SO sudah mendukung ini).
- Kartu DO eksternal (DO dibuat dari ERP desktop) → lokasi utama.
- Drag-and-drop pindah armada & Jual Ulang Retur (LUAR_RUTE) → lokasi stop ikut terbawa / bawaan utama.

### 9.2 Cetak
- `delivery-order-print.ts` dan `thermal-receipt.ts`: alamat (dan wilayah) diambil lewat `DashboardPengirimanJadwalDetail.DeliveryOrderID` (kolom ini sudah ada; `thermal-receipt.ts` sudah JOIN lewat situ, `delivery-order-print.ts` belum JOIN Jadwal sama sekali) → `LokasiPengirimanID` → lokasi. Fallback ke `bp.Address` (= utama). DO tanpa Jadwal → utama.
- Templat PDF (pdfmake, tipe DeliveryOrder): field alamat memakai nilai yang sudah di-resolve di atas.
- Temuan saat menyusun rencana (cek live 2026-10-23):
  - ERP **memang** punya `DeliveryOrder.AddressDelivery` (varchar 150) dan `BusinessPartnerLocationID`. Dashboard selama ini mengisinya `''`/NULL.
  - Tabel ERP `BusinessPartnerLocation` hanya berisi 275 baris warisan (1 per mitra, tanpa ModifiedDate), jadi **tidak** dipakai.
  - Alamat beku ditulis juga ke `DeliveryOrder.AddressDelivery` saat DO dibuat (*keputusan desain*), sehingga ERP desktop ikut menampilkan alamat kirim. DO lama tidak diubah.

### 9.3 Halaman Mitra
- Daftar mitra Es Kristal (`mitra-list.tsx`, ±1000 baris) dan form/dialog terkait (`mitra-detail-dialog.tsx`, `mitra-edit-dialog.tsx`) dirombak sesuai layout §2.
- Peta /mitra: satu pin per lokasi (utama + tambahan), popup menyebut nama mitra + label lokasi. Filter "pin" tetap berdasarkan lokasi utama.
- Filter Kapasitas, Wilayah, Kecamatan tetap memakai kolom ERP (= utama).

### 9.4 Aplikasi Pemasaran
- Detail/edit mitra (`pemasaran-app/mitra/[id]`, `mitra-edit-form.tsx`, `mitra-detail.tsx`): tampilkan identitas (tunduk pada izin NIK) dan daftar lokasi; edit lokasi boleh, edit NIK hanya dengan izin.
- Kunjungan (`tambah-kunjungan-sheet.tsx`): validasi jarak check-in menerima lokasi mana pun milik mitra (lokasi terdekat). *Keputusan desain.*

### 9.5 Pengajuan Mitra (dashboard, Aplikasi Driver, Aplikasi Pemasaran) + persetujuan
- Pengajuan tetap satu lokasi (mitra baru = kotak tidak dicentang).
- Isian kompetitor di ketiga form diganti menjadi multi-pilih dari master + [+]. `DashboardMitraPengajuan.Kompetitor` (teks) diganti/ditambah kolom daftar ID kompetitor. Saat disetujui, isi `mitra_kompetitor`, bukan `setMitraCompetitor()`.
- Penanggung jawab/NIK **tidak** masuk form pengajuan di versi ini.

### 9.6 ByChat
- `src/lib/bychat/mitra.ts` mencocokkan nomor telepon ke `MobileNo`/`Telepon` (= kontak lokasi utama). Perluas pencocokan ke kontak alamat mitra (`DashboardMitraAlamat.Kontak`) dan kontak lokasi tambahan. Panel `/embed/mitra` menampilkan ringkasan lokasi.

### 9.7 Laporan, marketing, piutang
Tidak berubah, karena invarian §5 sudah menjamin aturan 2 dan 3.

### 9.8 Tenant Demo / SaaS
Tabel baru Es Kristal juga dibuat di DemoEsKristal. `saas-dump-eskristal-schema.ts` dan provisioning tenant baru harus menyertakannya.

## 10. Migrasi

1. **Alamat & lokasi:** tidak ada data yang ditulis (lihat §5). Cukup buat tabel dan kolom baru.
2. **Kompetitor** (satu-satunya migrasi data):
   - Skrip *dry-run*: pecah `DashboardMitraCompetitor.Kompetitor` pada koma/titik koma/baris baru/"dan", trim, dedupe tanpa beda huruf besar-kecil. Tulis pratinjau ke `docs/data-fixes/` (nama unik → mitra) untuk **ditinjau pengguna** (ejaan ganda seperti "Es Kristal Jaya" vs "Kristal Jaya" disatukan manual).
   - Setelah disetujui: isi `kompetitor` (bisnis `es_kristal`) + `mitra_kompetitor`. Simpan pasangan skrip revert, mengikuti pola `scripts/fix-*`/`revert-*` yang ada.
   - `DashboardMitraCompetitor` dibiarkan (hanya-baca) sebagai cadangan, tidak dihapus.
   - Es Balok belum punya data kompetitor → tidak ada migrasi.

## 11. Yang harus dicek builder sebelum membangun

- Hitung Agen dengan >1 baris `PMP_AgenDetail` aktif di kelima DB Es Balok. Kalau ada, laporkan dulu karena kartu sudah terduplikasi hari ini.
- Cari semua pemakai `DashboardMitraLocation`, `bp.Address`, `MobileNo` di jalur Jadwal/stop/cetak/Aplikasi Driver (daftar di §9.1 belum tentu lengkap).
- Baca panduan Next.js di `node_modules/next/dist/docs/` (AGENTS.md); proyek ini memakai Next 16 dengan konvensi yang berbeda.

## 12. Tujuan, bukan tujuan, anti-tujuan

**Tujuan:** layout §2 di Es Kristal & Es Balok; banyak lokasi per mitra; pilihan lokasi per stop di Papan Pengiriman; cetak memakai lokasi; NIK/berkas terlindung dan diatur per peran; master kompetitor.

**Bukan tujuan (versi ini):** Papan Pengiriman Es Balok (hanya disiapkan kontraknya: stop Es Balok nanti menyimpan `LokasiPengirimanID`, NULL = utama); laporan yang dipecah per lokasi; identitas di form pengajuan; menulis lokasi tambahan ke ERP desktop.

**Anti-tujuan (gagal walau "jalan"):**
- Angka laporan wilayah/marketing berubah untuk mitra yang tidak diubah.
- Ada data alamat/pin lama yang hilang atau bergeser.
- NIK/berkas bisa dibuka tanpa login/izin, atau tersimpan di cache publik.
- ERP desktop tidak bisa lagi memakai mitra untuk transaksi.
- Cetak DO lama berubah alamat karena lokasi diedit atau dijadikan utama (dijamin oleh snapshot per stop, §6.1).

## 13. Urutan pengerjaan yang disarankan

1. Skema: tabel MSSQL (Es Kristal + Demo, 5 DB Es Balok), kolom `LokasiPengirimanID`, tabel Postgres, kunci izin + editor peran.
2. Rute berkas aman (unggah/baca).
3. Form & daftar Mitra Es Kristal (identitas, kotak, lokasi, kompetitor, kapasitas, peta multi-pin).
4. Migrasi kompetitor (dry-run → tinjau → jalankan).
5. Papan Pengiriman + snapshot per stop (+ backfill) + query turunan + Aplikasi Driver + cetak.
6. Form & daftar Mitra Es Balok.
7. Aplikasi Pemasaran, form pengajuan, ByChat.

## 14. Diserahkan ke builder

Nama komponen/berkas, pemecahan `mitra-list.tsx`, bentuk persis server action, detail UI pemilih lokasi di kartu stop, strategi uji per langkah.
