# Modul Pemasaran — Design Spec

Status: Approved by user, ready for implementation plan.
Date: 2026-07-22

## Latar Belakang & Tujuan

Divisi Marketing melakukan kunjungan ke calon mitra (outlet retail baru) dan
perlu mencatat tiap kunjungan/pengajuan langsung dari lapangan. Manajemen
perlu memantau daftar pengajuan tersebut dan performa tiap marketing
terhadap KPI kunjungan & konversi.

Proyek besar ini dipecah jadi 2 sub-proyek independen:

1. **Sub-proyek 1 (spec ini)** — fondasi data + form input (halaman web
   biasa, mobile-friendly, bisa dibuka lewat browser HP tanpa app native) +
   dashboard modul Pemasaran.
2. **Sub-proyek 2 (nanti, spec terpisah)** — membungkus halaman input jadi
   app native lewat Capacitor, setelah alur di sub-proyek 1 terbukti benar.

Spec ini HANYA mencakup sub-proyek 1.

## KPI Marketing

- Target 10 kunjungan outlet **baru** per hari per orang.
- 30 hari/bulan &rarr; target 300 kunjungan/bulan.
- 75% dari kunjungan ditargetkan berkonversi jadi pemesanan (qty > 0).
- Angka target ini **tetap/baku** untuk semua marketing (tidak ada UI
  pengaturan target per-orang) — ditanam sebagai konstanta di kode.

## Skema Data

Tabel baru `DashboardMitraPengajuan` (mengikuti konvensi tabel `Dashboard*`
yang sudah ada di proyek ini — lihat `DashboardMitraLocation`,
`DashboardCollectionTarget`):

```sql
CREATE TABLE DashboardMitraPengajuan (
  PengajuanID INT IDENTITY(1,1) PRIMARY KEY,
  MarketingUserID VARCHAR(16) NOT NULL,       -- session.user.id milik marketing yang input
  NamaCalon VARCHAR(128) NOT NULL,
  NoHP VARCHAR(50) NULL,
  WaktuPermintaanSampai DATETIME NULL,        -- tanggal+jam permintaan pesanan sampai
  QtyKantong DECIMAL(23,4) NULL,
  PriceLevel INT NULL,                        -- sama seperti BusinessPartner.PriceLevel
  Wilayah VARCHAR(128) NULL,
  Kecamatan VARCHAR(128) NULL,
  Alamat VARCHAR(1024) NULL,
  Latitude DECIMAL(10,7) NULL,
  Longitude DECIMAL(10,7) NULL,
  Status VARCHAR(20) NOT NULL DEFAULT 'Menunggu',  -- Menunggu | Disetujui | Ditolak
  CatatanTolak VARCHAR(512) NULL,
  ConvertedBusinessPartnerID VARCHAR(16) NULL,     -- terisi otomatis saat Disetujui
  ReviewedByUserID VARCHAR(16) NULL,
  ReviewedAt DATETIME NULL,
  CreatedAt DATETIME NOT NULL DEFAULT (GETDATE())  -- "Waktu input" — disembunyikan di form, tampil di dashboard
);
```

Tidak ada FK constraint keras ke `DashboardUser`/`BusinessPartner` — sama
seperti `CreatedByUserID` di tabel Dashboard lain, karena `session.user.id`
adalah string hasil `String(UserID)`, bukan integer asli.

## Izin Akses

- `"pemasaran"` ditambahkan ke `MODULE_KEYS` (`src/lib/permissions.ts`) dan
  ke sidebar. Role **Marketing** (RoleID 1003, sudah ada di database) diberi
  akses lewat Akun &gt; Peran seperti modul lain — `canView` untuk lihat
  dashboard, `canEdit` untuk submit pengajuan baru.
- Semua pengguna dengan akses modul ini (termasuk sesama Marketing) melihat
  **daftar pengajuan & KPI seluruh marketing**, bukan cuma milik sendiri —
  transparan satu tim.
- **Setujui/Tolak** dibatasi ke Super Admin + role **Supervisor** (RoleID 3)
  + **Accounting** (RoleID 4) — dicek langsung by RoleID di server action
  (bukan lewat grid `canEdit` biasa, karena sistem izin saat ini belum punya
  level granular "submit tapi tidak approve"). Pengecekan ini WAJIB di
  server action, bukan cuma sembunyikan tombol di UI, supaya tidak bisa
  dipanggil langsung oleh role lain.

```ts
// Bukan bagian dari grid izin per-modul biasa — daftar RoleID tetap ini
// yang boleh approve/reject, ditentukan langsung oleh keputusan bisnis.
const APPROVER_ROLE_IDS = [3, 4]; // Supervisor, Accounting
```

## Halaman & Komponen

- `src/app/(dashboard)/pemasaran/page.tsx` — halaman utama, fetch KPI +
  daftar pengajuan, render panel KPI + tombol "+ Pengajuan Baru" + daftar.
- `src/app/(dashboard)/pemasaran/actions.ts` — `createPengajuanAction`,
  `approvePengajuanAction`, `rejectPengajuanAction` (dua terakhir cek
  `APPROVER_ROLE_IDS` sebelum eksekusi).
- `src/lib/queries/mitra-pengajuan.ts` — query & mutation functions.
- `src/components/dashboard/pengajuan-form-dialog.tsx` — form input, reuse
  `WilayahSelect`, `KecamatanSelect`, `MitraLocationField`, dan
  `getPriceLevelOptions()` yang sudah ada. Field: Nama, No HP, Waktu
  Permintaan Sampai (`type="datetime-local"`), Qty Kantong, Harga (dropdown),
  lalu section Lokasi GPS.
  - **Wajib diisi**: Nama Calon, No HP, Waktu Permintaan Sampai, Lokasi GPS.
  - **Opsional**: Qty Kantong, Harga — kunjungan yang belum menghasilkan
    minat pesan tetap valid dicatat (Qty kosong/0 = tidak terhitung
    "konversi", bukan error input).
- `src/components/dashboard/pengajuan-list.tsx` — daftar pengajuan (kartu,
  mengikuti pola kartu lain di app ini), tiap kartu menampilkan: nama
  marketing yang input, waktu input, data calon mitra, badge status, dan
  tombol Setujui/Tolak (dirender kondisional kalau `canApprove`).
- `src/components/dashboard/marketing-kpi-panel.tsx` — satu baris per
  marketing: progressbar "Jumlah Kunjungan" (kunjungan bulan berjalan / 300)
  dan progressbar "Konversi Transaksi" (persentase kunjungan ber-Qty&gt;0,
  menuju target 75%).

## Alur Konversi (Setujui &rarr; jadi Mitra)

`approvePengajuanAction` memanggil ulang fungsi yang sudah ada, tidak
duplikasi logic:

1. `createMitra({ name: NamaCalon, mobileNo: NoHP, address: Alamat, wilayah,
   kecamatan, gender: "Female" /* default Retail */, priceLevel, capacity:
   null, termOfPaymentId: null })` &rarr; dapat `BusinessPartnerID` baru
   (otomatis dapat Code/ID/AP-AR-defaults dari perbaikan bug sebelumnya).
2. `setMitraLocation({ businessPartnerId, latitude, longitude, alamat, userId
   })`.
3. `UPDATE DashboardMitraPengajuan SET Status='Disetujui',
   ConvertedBusinessPartnerID=@id, ReviewedByUserID=@reviewer,
   ReviewedAt=GETDATE()`.

**Asumsi**: Tipe Mitra hasil konversi selalu default **Retail** (`Gender =
"Female"`), karena KPI-nya memang soal target retail. Bisa dikoreksi manual
lewat modul Mitra kalau ternyata harus Agen.

`rejectPengajuanAction` hanya update `Status='Ditolak'`, `CatatanTolak`,
`ReviewedByUserID`, `ReviewedAt` — tidak menyentuh tabel `BusinessPartner`
sama sekali.

## Perhitungan KPI

Per marketing user, untuk bulan berjalan (`getBusinessDate()` +
`monthBoundary()`, konsisten dengan pola tanggal yang sudah dipakai di
seluruh app ini):

```sql
SELECT du.UserID, du.Nama,
       COUNT(dmp.PengajuanID) AS Kunjungan,
       SUM(CASE WHEN dmp.QtyKantong > 0 THEN 1 ELSE 0 END) AS Konversi
FROM DashboardUser du
LEFT JOIN DashboardMitraPengajuan dmp
       ON dmp.MarketingUserID = CAST(du.UserID AS VARCHAR(16))
      AND dmp.CreatedAt >= @monthStart AND dmp.CreatedAt < @monthEnd
WHERE du.RoleID = 1003 AND du.IsActive = 1  -- role Marketing
GROUP BY du.UserID, du.Nama
```

- Progressbar Kunjungan = `Kunjungan / 300 * 100`.
- Progressbar Konversi = `Konversi / NULLIF(Kunjungan, 0) * 100`, target
  garis di 75%.
- Semua marketing aktif ditampilkan meski Kunjungan = 0 (supaya kelihatan
  siapa yang belum aktif bulan ini), bukan cuma yang punya data.

## Yang Sengaja Tidak Dikerjakan (di luar spec ini)

- Pembungkusan Capacitor (sub-proyek 2, spec terpisah nanti).
- UI pengaturan target KPI per-orang (angka tetap, ditanam di kode).
- Edit/hapus pengajuan oleh marketing setelah submit (bisa ditambah nanti
  kalau dibutuhkan — untuk sekarang pengajuan bersifat write-once dari sisi
  marketing, kalau salah minta Supervisor/Accounting Tolak lalu marketing
  submit ulang).
