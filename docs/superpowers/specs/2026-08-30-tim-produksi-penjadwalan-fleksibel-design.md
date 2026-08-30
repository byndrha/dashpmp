# Tim Produksi Fleksibel & Penjadwalan Bulanan

## Konteks

Revisi sebelumnya ([2026-08-28-produksi-app-kualitas-aktivitas-revisi-design.md](2026-08-28-produksi-app-kualitas-aktivitas-revisi-design.md))
membangun "Susunan Tim" — daftar anggota yang bisa ditukar/diurutkan per
shift. Tapi identitas tim itu sendiri masih terkunci ke nomor shift:
kolom `Shift` pada `DashboardTimProduksiAnggota` **adalah** identitas
timnya ("Tim Shift 1" = tim yang selalu bekerja setiap kali jam
menunjukkan Shift 1).

Kenyataan di lapangan berbeda: ada 3 tim bernama (Tim A/B/C) dengan
Kepala Produksi masing-masing, dan tim mana masuk ke shift mana **bisa
berbeda-beda per hari**, ditentukan lewat penjadwalan bulanan oleh
Supervisor/Admin — bukan pola tetap 1-ke-1 dengan nomor shift.

Sempat dipertimbangkan auto-assign tim berdasarkan siapa yang login
duluan (meniru pola "Staf Operasional Bertugas"), tapi ditolak: kalau
lebih dari satu Kepala Produksi login bersamaan (mis. sekadar mengecek
aplikasi), assignment-nya bisa salah. Solusi yang disepakati: **jadwal
direncanakan di muka**, dan **Staf Operasional kroscek kebenarannya saat
shift benar-benar berjalan**, dengan hak koreksi manual kapan saja.

Spec ini murni tentang MKEsindo, di atas fondasi yang sama dengan spec
2026-08-28 di atas (shift 1/2/3, TanggalUsaha, `report-shift.ts`).

## Non-Goals

- Pengisian otomatis/pola massal pada Jadwal Tim bulanan (mis. "copy dari
  bulan lalu") — Supervisor mengisi manual sel per sel di versi ini.
  Bisa ditambah belakangan kalau terasa repetitif (YAGNI).
- Seed Jadwal Tim untuk bulan berjalan — dibiarkan kosong, Supervisor
  mengisi manual mulai dari kapan fitur ini aktif.
- Mengubah cara kerja "Susunan Tim" (tukar anggota lintas tim, reorder,
  hapus per shift) yang sudah ada — hanya sumber roster default-nya yang
  berubah dari "cocokkan ke nomor shift" jadi "cocokkan ke Tim yang
  sedang aktif untuk shift ini."
- Membuat akun 3 Kepala Produksi (Fendianto/Hartoyo/Maicha) lewat
  script/migrasi — dibuat manual oleh user lewat halaman admin akun yang
  sudah ada (`/grup/akun`), peran Produksi biasa. Spec ini hanya menaut
  `AkunID` yang sudah ada ke `DashboardTimProduksi.KepalaAkunID`.
- Memperbaiki bug redirect `/mkesindo/produksi` untuk akun `is_produksi`
  — bug lama, tidak terkait, sudah dilaporkan terpisah ke user
  sebelumnya. Justru karena bug ini tetap ada, panel "Tim Saya" untuk
  Kepala Produksi sengaja ditaruh di `produksi-app` (yang memang bisa
  mereka akses), bukan di `/mkesindo/produksi`.
- Fitur "reaktivasi" anggota yang sudah dinonaktifkan — sama seperti
  ruling di spec 2026-08-28, `hapusAnggotaTim` tetap soft-delete
  satu-arah.

## Bagian 1: Model Data

### 1.1 Tabel baru `DashboardTimProduksi`

Entitas Tim itu sendiri, lepas dari nomor shift:

```sql
CREATE TABLE DashboardTimProduksi (
  TimID INT IDENTITY PRIMARY KEY,
  Nama VARCHAR(50) NOT NULL,        -- "Tim A" / "Tim B" / "Tim C"
  KepalaAkunID INT NULL,            -- AkunID Postgres, tanpa FK constraint
                                     -- lintas-DB (pola sama seperti
                                     -- StafOperasionalAkunID/CreatedByAkunID
                                     -- di tabel lain)
  IsDeleted BIT NOT NULL DEFAULT 0,
  CreatedDate DATETIME NOT NULL DEFAULT GETDATE(),
  ModifiedDate DATETIME NULL
);
```

`KepalaAkunID` boleh `NULL` sementara (sebelum user membuat akunnya di
`/grup/akun`) — panel admin Tim Produksi (lihat 3.3) dapat menaut/ubah
nilai ini kapan saja lewat dropdown akun.

### 1.2 `DashboardTimProduksiAnggota`: `Shift` → `TimID`

Tabel ini masih **kosong** di DB live (dicek langsung, belum ada anggota
nyata diisi) — jadi ini penggantian kolom bersih, tanpa migrasi data:

```sql
ALTER TABLE DashboardTimProduksiAnggota DROP COLUMN Shift;
ALTER TABLE DashboardTimProduksiAnggota ADD TimID INT NOT NULL;
-- FK app-level saja (pola konsisten dengan tabel lain di codebase ini,
-- tidak ada FK constraint fisik dipakai untuk Dashboard* tables)
```

`getAnggotaTim(shift: 1|2|3)` di [tim-produksi.ts](../../../src/lib/queries/tim-produksi.ts)
diganti `getAnggotaTim(timId: number)`. `AnggotaTimRow.shift` diganti
`AnggotaTimRow.timId`.

### 1.3 Tabel baru `DashboardJadwalTimProduksi`

Timeline penjadwalan bulanan — satu baris per (TanggalUsaha, Shift):

```sql
CREATE TABLE DashboardJadwalTimProduksi (
  JadwalID INT IDENTITY PRIMARY KEY,
  TanggalUsaha DATE NOT NULL,
  Shift TINYINT NOT NULL,           -- 1, 2, atau 3
  TimID INT NOT NULL,
  CreatedByAkunID INT NOT NULL,
  ModifiedDate DATETIME NULL,
  CONSTRAINT UQ_JadwalTim_TanggalShift UNIQUE (TanggalUsaha, Shift)
);
```

Diisi/diubah lewat UPSERT per sel kalender (lihat Bagian 2) — Supervisor
mengubah sel yang sama berkali-kali seiring waktu, bukan insert baru
setiap kali.

### 1.4 `DashboardAktivitasProduksiShift`: tambah `TimID`

```sql
ALTER TABLE DashboardAktivitasProduksiShift ADD TimID INT NULL;
```

Ini tim yang **benar-benar** tercatat bekerja di **kejadian shift itu**
(satu TanggalUsaha+Shift spesifik) — beda dari jadwal rencana di 1.3.
Diisi otomatis dari Jadwal saat baris shift ini pertama dibuat
(`ensureAktivitasRow`, lihat 3.1), lalu bebas dikoreksi kapan saja lewat
UI live (Bagian 3) — **tidak dikunci** seperti `StafOperasionalAkunID`.

## Bagian 2: Jadwal Tim Produksi — Admin Bulanan

Section baru di `/mkesindo/produksi`, berdampingan dengan panel "Tim
Produksi" yang sudah ada, khusus Supervisor/Admin (akun `is_produksi`
tidak pernah melihat halaman ini sama sekali — lihat Non-Goals soal bug
redirect).

**Urutan kolom kronologis, bukan urutan angka shift.** Untuk satu
`TanggalUsaha`, Shift 2 dan Shift 3 sebenarnya jatuh di tanggal kalender
SEBELUMNYA (lihat `getShiftWindow` di
[report-shift.ts](../../../src/lib/report-shift.ts)) — urutan nyata
dalam satu siklus TanggalUsaha adalah **Shift 2 → Shift 3 → Shift 1**.
Kalender bulanan: satu baris per TanggalUsaha, 3 kolom dalam urutan itu,
tiap kolom diberi label rentang jam nyata:

| TanggalUsaha | Shift 2 (15:00–22:59, H-1) | Shift 3 (23:00–06:59, H-1→H) | Shift 1 (07:00–14:59, H) |
|---|---|---|---|

Tiap sel = dropdown pilih Tim A/B/C, atau kosong ("Belum dijadwalkan").
Navigasi bulan sebelum/sesudah. Tiap perubahan sel langsung tersimpan
lewat server action UPSERT ke `DashboardJadwalTimProduksi` (tidak ada
tombol simpan massal) — pola yang sama seperti form-form lain di app ini.

Query baru di `aktivitas-produksi.ts` atau file baru
`jadwal-tim-produksi.ts`:

- `getJadwalBulan(tahun: number, bulan: number): JadwalTimRow[]` — semua
  baris jadwal + Tim yang cocok, untuk satu bulan kalender.
- `setJadwalTim(tanggalUsaha: string, shift: ShiftNumber, timId: number, akunId: number): Promise<void>` —
  UPSERT (MERGE) satu sel.

## Bagian 3: Kroscek & Koreksi Live di Aktivitas

Di tab Aktivitas produksi-app (shift yang sedang berjalan), field baru
**"Tim Bertugas"** ditampilkan berdampingan dengan "Staf Operasional
Bertugas" yang sudah ada.

### 3.1 Pengisian awal

Saat `ensureAktivitasRow` membuat baris shift baru, `TimID` diisi dari
`DashboardJadwalTimProduksi` untuk (TanggalUsaha, Shift) yang sama, kalau
ada. Kalau belum ada jadwal untuk kombinasi itu, `TimID` tetap `NULL`.

Penting: pengisian ini **hanya terjadi sekali, saat baris shift dibuat**.
Kalau Supervisor mengisi/mengubah Jadwal SETELAH baris Aktivitas shift
itu sudah ada, itu **tidak** menimpa `TimID` yang sudah tercatat di baris
Aktivitas — jadwal cuma jadi nilai default awal, bukan sinkronisasi
berkelanjutan.

### 3.2 Tampilan & koreksi

- Kalau `TimID` terisi (dari jadwal atau koreksi sebelumnya): tampilkan
  nama Tim + dropdown "Ubah" yang selalu aktif (tidak pernah dikunci,
  beda dari Staf Operasional).
- Kalau `TimID` masih `NULL` ("Tim belum dijadwalkan"): tampilkan pesan
  itu + dropdown wajib dipilih (Tim A/B/C) sebelum Staf Operasional bisa
  melanjutkan mengisi data lain di shift ini — konsisten dengan
  permintaan "Staf Operasional kroscek ... jika belum benar maka
  Staf Operasional dapat mengubah secara manual."
- Mengubah Tim Bertugas **hanya memengaruhi kejadian shift ini** — baris
  `DashboardJadwalTimProduksi` sama sekali tidak ikut berubah.

Action baru `setTimBertugasAction(tanggalUsaha, shift, timId)` di
[actions.ts](../../../src/app/mkesindo/produksi/actions.ts), mirip pola
`upsertStafOperasional` — panggil `ensureAktivitasRow` lalu `UPDATE ...
SET TimID = @timId WHERE AktivitasID = @aktivitasId` (tanpa syarat
tambahan, karena field ini memang tidak pernah dikunci).

### 3.3 Efek ke Susunan Tim

Begitu Tim Bertugas dikoreksi (berubah nilainya), Susunan Tim
(`DashboardAktivitasProduksiKehadiran`) untuk shift itu **ditulis ulang
ke roster default Tim yang baru** — pakai ulang logika `setSusunanTim`
yang sudah ada (hapus semua baris Kehadiran lama, isi ulang dari
`getAnggotaTim(timIdBaru)`). Susulan/perubahan manual pada Susunan Tim
yang sempat dilakukan SEBELUM koreksi ini akan tertimpa — perilaku yang
disengaja (alur normal: cek Tim dulu, baru atur susunan orangnya), bukan
bug. Ini hanya berlaku saat Tim Bertugas benar-benar **berubah** nilai;
memilih Tim yang sama tidak menulis ulang apa pun.

`getSusunanTim` (yang sudah ada) untuk kasus "belum ada baris Aktivitas
sama sekali" (shift belum pernah disentuh): sebelumnya fallback ke
`getAnggotaTim(shift)`. Sekarang fallback ke: cari `TimID` dari
`DashboardJadwalTimProduksi` untuk (TanggalUsaha, Shift) itu → kalau ada,
`getAnggotaTim(timId)`; kalau tidak ada jadwal sama sekali, list kosong
(tidak ada default yang bisa ditawarkan).

## Bagian 4: Kepala Produksi & "Tim Saya"

Akun Kepala Produksi (Fendianto/Hartoyo/Maicha) adalah akun Produksi
biasa (`is_produksi=true`), dibuat manual oleh user lewat `/grup/akun`
(lihat Non-Goals). Setelah dibuat, `AkunID` masing-masing ditaut ke
`DashboardTimProduksi.KepalaAkunID` lewat panel admin Tim Produksi yang
sudah ada ([panel-tim-produksi.tsx](../../../src/components/produksi/panel-tim-produksi.tsx),
lihat 4.2 di bawah).

### 4.1 Section baru "Tim Saya" di produksi-app

Muncul hanya kalau akun
yang login adalah `KepalaAkunID` dari salah satu Tim (dicek query
`SELECT TimID FROM DashboardTimProduksi WHERE KepalaAkunID = @akunId AND
IsDeleted = 0`). Section ini menampilkan roster tim miliknya sendiri
dengan tombol tambah/nonaktifkan anggota — pakai ulang
`tambahAnggotaTim`/`hapusAnggotaTim` yang sudah ada, dengan pengecekan
tambahan di action: `hapusAnggotaTimAction`/pemanggil-baru harus
memverifikasi anggota yang ditarget memang milik `TimID` kepunyaan akun
yang login, sebelum eksekusi (tidak boleh Kepala Tim A menonaktifkan
anggota Tim B lewat manipulasi request).

Ditaruh di produksi-app (bukan `/mkesindo/produksi`) karena akun
`is_produksi` memang tidak bisa mengakses halaman admin itu sama sekali
(lihat Non-Goals soal bug redirect yang sudah ada, tidak disentuh di
sini).

### 4.2 Panel admin Tim Produksi — taut Kepala

`panel-tim-produksi.tsx` (sudah ada) ditambah dropdown "Kepala Produksi"
per Tim (pilih dari daftar akun `is_produksi`), untuk menaut
`KepalaAkunID`. Ini tetap bisa diubah kapan saja oleh Supervisor/Admin
(mis. kalau kepala tim berganti orang).

## Bagian 5: Seed Data

Migrasi (script sekali-jalan, pola sama seperti
`scripts/revisi-*.ts`/`scripts/add-*.ts` di sesi ini):

1. Jalankan DDL Bagian 1.1–1.4.
2. Insert 3 baris `DashboardTimProduksi` (`KepalaAkunID = NULL` — ditaut
   belakangan lewat panel admin setelah user membuat akunnya):
   - Tim A
   - Tim B
   - Tim C
3. Insert `DashboardTimProduksiAnggota` sesuai roster default:
   - Tim A: Fendianto, Irfan, Aldo, Deva, Bayu
   - Tim B: Hartoyo, Fian, Reza, Danar, Rozi, Bima
   - Tim C: Maicha, Nizam, Arif, Dika, Raga, Bagas, Rayhan
4. `DashboardJadwalTimProduksi` — **tidak diisi apapun**, dibiarkan
   kosong (lihat Non-Goals).

## Global Constraints

- Semua nama tabel/kolom baru mengikuti konvensi `Dashboard*` PascalCase
  yang sudah ada di seluruh codebase ini.
- Tidak ada FK constraint fisik lintas Dashboard* table maupun lintas-DB
  (Postgres AkunID di kolom MSSQL) — konsisten dengan setiap tabel
  Dashboard* lain yang sudah ada.
- Bahasa UI: Indonesia, konsisten dengan seluruh aplikasi.
- MKEsindo saja — tidak direplikasi ke PMPersada/PMPutra.
