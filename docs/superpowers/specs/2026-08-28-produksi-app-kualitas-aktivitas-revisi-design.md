# Revisi Tab Kualitas & Aktivitas — produksi-app

## Konteks

`/mkesindo/produksi-app` punya dua tab yang perlu direvisi berdasarkan
pengalaman pemakaian nyata di lapangan:

- **Tab Kualitas** ([kualitas-view.tsx](../../../src/components/produksi-app/kualitas-view.tsx)) —
  form pencatatan pemeriksaan kualitas es per mesin/shift. Field "Berat
  Sampel (gram)" ternyata tidak pernah dipakai untuk apa pun — sementara
  operator butuh cara mencatat **berapa kantong 10KG yang benar-benar
  dihasilkan** dari satu pemeriksaan, supaya angka itu bisa jadi plafon
  saat kantong-kantong itu dialokasikan ke pallete penyimpanan.
- **Tab Aktivitas** ([aktivitas-produksi-view.tsx](../../../src/components/produksi-app/aktivitas-produksi-view.tsx)) —
  "Staf Operasional Bertugas" masih dropdown manual (harusnya otomatis
  dari akun yang login), dan "Tim Produksi" masih berupa checklist
  kehadiran melawan daftar tetap tanpa kemampuan meminjam anggota tim lain
  atau mengurutkan siapa yang benar-benar bertugas.

Ini adalah revisi mendadak yang diminta berjalan **sebelum** Tahap 3
Modul Laporan (Aktivitas Muatan Distribusi) dilanjutkan — lihat
[2026-08-27-modul-laporan-stok-bahan-baku-design.md](2026-08-27-modul-laporan-stok-bahan-baku-design.md)
untuk konteks roadmap itu, yang sepenuhnya terpisah dari spec ini.

## Non-Goals

- Modul Laporan Tahap 2/3/4/5 — sub-proyek sendiri, tidak disentuh di sini.
- Replikasi ke PMPersada/PMPutra — MKEsindo saja, sama seperti seluruh
  produksi-app yang sudah ada.
- Tabel "Karyawan" generik terpisah — `DashboardTimProduksiAnggota` yang
  sudah ada (satu baris per orang + Tim/Shift permanennya) dipakai
  langsung sebagai master data, tidak dibuat tabel baru.
- Dropdown koreksi manual "Staf Operasional Bertugas" pada dialog **Ubah
  Aktivitas** di tab Riwayat (`riwayat-aktivitas-produksi.tsx`) — itu
  tetap ada, untuk memperbaiki kesalahan pencatatan shift yang sudah
  lewat. Yang dihilangkan hanya dropdown di shift yang **sedang berjalan**.
- Backfill nilai `Qty10KG` untuk baris Kualitas lama yang masih
  `BeratSampel` — data lama biarkan `NULL` (lihat bagian Plafon Stok:
  `NULL` diperlakukan "tanpa batas").

## Bagian 1: Tab Kualitas

### 1.1 "Berat Sampel (gram)" → "QTY 10 KG Kantong Es"

**Data model** — kolom `BeratSampel DECIMAL(10,2)` pada
`DashboardProduksiKualitas` di-rename+retype jadi `Qty10KG INT NULL`
(pola yang sama seperti
[`scripts/rename-kualitas-suhues-to-diameter.ts`](../../../scripts/rename-kualitas-suhues-to-diameter.ts)
yang sudah pernah dipakai di tabel ini). Baris lama otomatis jadi `NULL`
(nilai gram lama dibuang, bukan dikonversi — tidak ada hubungan satuan
antara gram dan kantong).

**Form** ([kualitas-view.tsx](../../../src/components/produksi-app/kualitas-view.tsx)) —
input "Berat Sampel (gram)" (`type="number" step="0.1"`) diganti input
integer "QTY 10 KG Kantong Es" (`type="number" step="1" min="0"`),
**wajib diisi** (validasi client + server: kosong atau ≤0 ditolak) untuk
pemeriksaan baru. `KualitasRow`/`CreateKualitasInput` field `beratSampel`
→ `qty10KG`.

**Tampilan** (`KualitasCard`) — baris "Berat sampel: Xg" diganti "QTY:
X kantong 10kg".

### 1.2 Diameter Dalam: cm → mm

**Data model** — kolom `DiameterDalamCm DECIMAL(5,2)` di-rename jadi
`DiameterDalamMm DECIMAL(5,1)`. Migrasi mengalikan setiap nilai non-NULL
yang sudah ada ×10 (2.8cm → 28mm) supaya data historis tetap bermakna di
satuan baru (bukan dibuang seperti BeratSampel — nilainya masih relevan,
cuma beda satuan).

**Form** — label "Ukuran Diameter Dalam (cm)" → "Ukuran Diameter Dalam
(mm)", `step="0.1"` tetap, ditambah teks bantuan kecil di bawah input:
"Standar: 28mm" (informasi saja, bukan validasi keras — nilai di luar itu
tetap boleh disimpan).

**Tampilan** — "Diameter dalam: X cm" → "Diameter dalam: Xmm".

### 1.3 Hapus total Kontaminasi & Kemasan

Kolom `CekKontaminasi BIT` dan `CekKemasan BIT` di-**DROP** dari
`DashboardProduksiKualitas` (data lama ikut hilang — sudah dikonfirmasi
eksplisit). Mengikuti pola aman
[`scripts/drop-legacy-auth-tables.ts`](../../../scripts/drop-legacy-auth-tables.ts):
backup ke `scratchpad/` dulu sebelum DROP.

Konsekuensi kode:
- `KualitasRow`/`CreateKualitasInput` — hapus field `cekKontaminasi`/`cekKemasan`.
- `createKualitasAction`/`kualitas-view.tsx` — hapus nilai hardcode
  `cekKontaminasi: true, cekKemasan: true` yang dikirim saat submit.
- `KualitasCard` — hapus 2 badge "Kontaminasi"/"Kemasan" dari daftar
  `items`; `allPass` cuma dari `CekKejernihan`+`CekUkuranBentuk`.
- `TambahProduksiDialog` — `allPass` (dipakai untuk badge "Ada temuan"
  pada daftar pilihan Kualitas) juga cuma dari 2 field yang tersisa.

## Bagian 2: Plafon Stok — QTY Kualitas membatasi alokasi ke Pallete

`DashboardProduksiBatch` **sudah** punya kolom `KualitasID` (FK ke
`DashboardProduksiKualitas`, ditambahkan oleh
[`scripts/add-kualitas-id-to-produksi-batch.ts`](../../../scripts/add-kualitas-id-to-produksi-batch.ts))
— jadi tidak perlu struktur data baru, cukup satu pengecekan tambahan.

**Aturan**: total `Qty10KG` yang sudah dialokasikan ke pallete manapun
(`SUM(DashboardProduksiBatch.Qty10KG) WHERE KualitasID = @kualitasId AND
IsDeleted = 0`) tidak boleh melebihi `Qty10KG` milik Kualitas itu sendiri.
Kualitas dengan `Qty10KG IS NULL` (baris lama) **tidak dibatasi** —
plafon hanya berlaku untuk Kualitas yang punya nilai QTY.

**Server** ([`createBatch`](../../../src/lib/queries/produksi-warehouse.ts))
— di dalam transaction yang sama (setelah insert speculatif, sebelum
commit, mengikuti pola pengecekan kapasitas pallete 120 yang sudah ada):
hitung total alokasi existing untuk `KualitasID` batch ini (termasuk
baris yang baru diinsert), tolak dengan `AppError` kalau melebihi
`Qty10KG` milik Kualitas tsb. Pesan: `"Melebihi qty produksi tercatat
pada pemeriksaan ini (tercatat X kantong, sudah dialokasikan Y, sisa
Z)."`.

**Client** ([`TambahProduksiDialog`](../../../src/components/produksi-app/tambah-produksi-dialog.tsx))
— daftar pilihan Kualitas menampilkan sisa kuota di sebelah label yang
sudah ada (mis. "Sisa 18 kantong"), dihitung dari data yang sama yang
sudah diambil `getKualitasRiwayatAction`+`getRiwayatProduksiAction`-style
join (perlu extend `getKualitasRiwayat()` agar mengembalikan juga total
teralokasi per Kualitas — LEFT JOIN aggregate ke `DashboardProduksiBatch`
GROUP BY `KualitasID`). Kualitas dengan sisa kuota 0 tetap terlihat
(bukan disembunyikan) tapi ditandai visual (mis. redup) dan tidak bisa
dipilih. Input qty10 pada dialog dibatasi `max={Math.min(sisaKapasitas,
sisaKualitas ?? Infinity)}`.

## Bagian 3: Manajemen Anggota Produksi (baru, di `/mkesindo/produksi`)

Section baru ("Tim Produksi") ditambahkan ke halaman desktop
[`/mkesindo/produksi/page.tsx`](../../../src/app/mkesindo/produksi/page.tsx)
yang sudah ada — sejajar dengan "Peta Warehouse"/"Mesin Produksi"/
"Riwayat Produksi" yang sudah ada di sana, bukan route terpisah — untuk
kelola `DashboardTimProduksiAnggota`:

- **Daftar** — dikelompokkan per Tim (Shift 1/2/3), tampilkan nama +
  status aktif.
- **Tambah** — form Nama + pilih Tim (Select 1/2/3) → `tambahAnggotaTim`
  (sudah ada, tidak berubah signature-nya).
- **Nonaktifkan** — tombol per baris → `hapusAnggotaTim` (soft-delete,
  sudah ada, tidak berubah).
- **Pindah tim** — perlu fungsi baru `updateAnggotaTim(anggotaId, {nama?,
  shift?})` (UPDATE sederhana) karena saat ini `DashboardTimProduksiAnggota`
  tidak punya operasi edit sama sekali, cuma insert+soft-delete.

Widget "Tambah anggota baru" (input teks bebas) dan tombol hapus
permanen pada [`tim-produksi-roster.tsx`](../../../src/components/produksi-app/tim-produksi-roster.tsx)
(dipakai di tab Aktivitas, HP) **dicabut total** — pengelolaan anggota
tim pindah seluruhnya ke halaman admin ini.

## Bagian 4: Staf Operasional Bertugas — otomatis

**Server** ([`ensureAktivitasRow`](../../../src/lib/queries/aktivitas-produksi.ts))
— tambahkan `StafOperasionalAkunID = @akunId` pada `INSERT` (akun yang
memicu pembuatan baris shift ini — parameter `akunId` sudah diterima
fungsi ini, cuma belum dipakai untuk kolom ini). Sekali tercatat, tidak
pernah ditimpa otomatis oleh akun lain yang belakangan menyentuh shift
yang sama (baris sudah ada → `ensureAktivitasRow` langsung return,
`UPDATE` StafOperasionalAkunID tidak lagi dipanggil dari jalur otomatis
manapun).

**Client (shift berjalan)** — `StafOperasionalSelect` dicabut dari
[`AktivitasProduksiView`](../../../src/components/produksi-app/aktivitas-produksi-view.tsx);
diganti teks baca-saja "Staf Operasional Bertugas: {nama}" (nama diambil
lewat `getAkunNamaMap`, pola yang sama seperti `RiwayatProduksiRowWithNama`).

**Tidak berubah**: `StafOperasionalSelect` tetap dipakai apa adanya di
dialog **Ubah Aktivitas** ([`riwayat-aktivitas-produksi.tsx`](../../../src/components/produksi-app/riwayat-aktivitas-produksi.tsx))
untuk koreksi manual shift lampau — komponennya, action-nya
(`upsertStafOperasionalAction`), dan `getStafOperasionalOptions` semua
tetap ada, cuma tidak lagi dipanggil dari live view.

## Bagian 5: Susunan Tim Produksi (redesain, per-shift)

Konsep "siapa hadir" (checkbox melawan daftar tetap tim) diganti konsep
baru: **susunan tim yang bertugas untuk (tanggalUsaha, shift) ini**,
sebuah daftar tersendiri (bisa lintas-tim, punya urutan) yang independen
dari keanggotaan tim permanen (Bagian 3).

### Data model

`DashboardAktivitasProduksiKehadiran (AktivitasID, AnggotaID)` ditambah
kolom `Urutan INT NOT NULL DEFAULT 0`.

### Server

- `getKehadiran(tanggalUsaha, shift)` → **ganti nama jadi
  `getSusunanTim`**, kembalikan `{anggotaId, urutan}[]` terurut
  `Urutan ASC` (bukan cuma `number[]`).
- Kalau belum ada baris tersimpan untuk (tanggalUsaha, shift) ini SAMA
  SEKALI (bukan cuma kosong setelah pernah disimpan — beda kondisi ini
  dicek dari `aktivitasId === null`, konsisten dengan pola
  "belum pernah disimpan" yang sudah ada di `getAktivitasForShift`),
  fallback ke anggota tim permanen shift ini (`getAnggotaTim(shift)`,
  urutan by nama) sebagai daftar kerja awal — TIDAK langsung ditulis ke
  DB, cuma dikembalikan ke client sebagai starting point.
- `setKehadiran` → **ganti nama jadi `setSusunanTim`**, terima
  `{anggotaId, urutan}[]` (bukan cuma `number[]`), tetap pola
  delete-lalu-insert-ulang dalam satu transaction seperti sekarang, cuma
  sertakan `Urutan` di setiap INSERT.

### Client (`tim-produksi-roster.tsx`, ditulis ulang)

- Daftar anggota bertugas (bukan lagi checkbox) — tiap baris: drag-handle
  (`@dnd-kit/sortable`, sudah ter-install — dipakai `pengiriman-board.tsx`
  untuk kasus lain) + nama + tombol "X" (keluarkan dari susunan **shift
  ini saja**, `hapusAnggotaTim` TIDAK dipanggil).
- Drag reorder memperbarui state urutan lokal secara langsung (client-side
  array reorder), disimpan bersamaan saat tombol "Simpan Susunan Tim"
  ditekan (pola yang sama seperti sekarang — bukan auto-save tiap drag).
- Dropdown "Tambah dari tim lain" — daftar SEMUA anggota aktif dari
  ketiga tim (perlu action baru `getSemuaAnggotaTimAction` — union dari
  `getAnggotaTim(1|2|3)`, dikurangi yang sudah ada di susunan saat ini).
  Memilih satu menambah ke akhir daftar (urutan lokal), belum tersimpan
  sampai "Simpan".
- Prop `canEdit` yang sudah ada dipertahankan (dipakai membedakan live
  view vs riwayat read-only di tempat lain — perlu dicek pemakaiannya
  saat implementasi, tidak diasumsikan berubah di spec ini).

## Testing

Tidak ada test framework otomatis untuk produksi-app di repo ini
(diverifikasi manual via Browser pane, sama seperti alur kerja sesi-sesi
sebelumnya). Rencana implementasi (dokumen terpisah) harus mencakup
langkah verifikasi manual eksplisit untuk tiap bagian:

1. Kualitas: buat pemeriksaan baru dengan QTY, cek badge Kontaminasi/
   Kemasan sungguh hilang, cek diameter tampil dalam mm.
2. Plafon: buat Kualitas QTY=48, alokasikan 30 ke satu pallete (berhasil),
   coba alokasikan 19 lagi ke pallete lain (harus ditolak, sisa cuma 18).
3. Manajemen Anggota: tambah/pindah-tim/nonaktifkan anggota di halaman
   admin baru, konfirmasi perubahan terlihat di dropdown tab Aktivitas.
4. Staf Operasional: buka shift baru, konfirmasi nama otomatis muncul
   tanpa memilih apa pun; buka Riwayat, konfirmasi dropdown koreksi
   manual masih berfungsi di sana.
5. Susunan Tim: shift baru menampilkan anggota tim permanen secara
   otomatis; tambah anggota lintas-tim; hapus satu via X (cek tim
   permanen TIDAK berubah); drag reorder lalu Simpan; reload halaman,
   konfirmasi urutan tersimpan persis seperti sebelum reload.
