# Wakil Kepala Produksi & Perbaikan Tampilan Nama Tim Produksi

## Latar belakang

Dua masalah terkait modul Tim Produksi ditemukan bersamaan:

**Bagian A — bug tampilan.** Tiga dropdown di aplikasi ini menampilkan angka ID mentah (mis. `40`, `1`) pada kondisi *terpilih/tertutup*, walau daftar pilihannya sendiri (saat dropdown dibuka) menampilkan nama dengan benar: `KepalaSelect` (`src/components/produksi/panel-tim-produksi.tsx`), `SelSelect` (`src/components/produksi/jadwal-tim-bulanan.tsx`), dan `TimBertugasSelect` (`src/components/produksi-app/aktivitas-produksi-view.tsx`). Root cause: komponen `<Select>` di codebase ini (berbasis `@base-ui/react`) tidak otomatis me-resolve label dari `<SelectItem>` ke tampilan trigger tertutup — perlu pola *render-prop* eksplisit, seperti yang sudah dipakai dengan benar di `pemesanan-form-dialog.tsx` (dropdown Armada/Driver/Variant).

**Bagian B — fitur baru.** Sistem kehadiran shift saat ini (`DashboardAktivitasProduksiKehadiran`, dipakai `hitungKontribusiPerOrang`) hanya menghitung anggota biasa (`DashboardTimProduksiAnggota`) sebagai pembagi kontribusi produksi — Kepala Produksi tidak pernah ikut dihitung sama sekali. Pemilik produk ingin memperkenalkan peran baru "Wakil Kepala Produksi" (satu per Tim), serta membuat Kepala dan Wakil Kepala keduanya ikut masuk hitungan pembagian kontribusi per shift, dengan kemampuan saling menggantikan/menandai tidak hadir jika salah satu absen.

## Tujuan

- Memperbaiki 3 dropdown agar menampilkan nama, bukan ID mentah.
- Kepala Produksi tampil sebagai baris paling atas di roster shift produksi-app (tab Aktivitas), disusul Wakil Kepala Produksi, baru daftar anggota yang sudah ada.
- Menambahkan peran "Wakil Kepala Produksi", satu per Tim, dengan mekanisme penetapan yang sama seperti Kepala Produksi saat ini.
- Kepala dan Wakil Kepala masing-masing dapat ditandai "tidak hadir" untuk satu shift tertentu (tidak memengaruhi penetapan standing mereka di Tim), dan pembagi kontribusi (`jumlahHadir`) menyesuaikan secara dinamis: `(Kepala hadir ? 1 : 0) + (Wakil hadir ? 1 : 0) + jumlah anggota di roster`.
- Membuat 3 akun baru (Nizam → Tim A, Aldo → Tim B, Reza → Tim C) sebagai Wakil Kepala Produksi, password `12345678`.

## Non-tujuan

- Tidak mengubah izin akses layar Aktivitas Produksi produksi-app — tetap terbuka untuk siapa pun akun `isProduksi` yang login (pola yang sudah ada hari ini untuk roster anggota; lihat bagian "Izin akses" di bawah untuk alasannya).
- Tidak mengubah mekanisme drag-and-drop/tambah/hapus anggota biasa yang sudah ada (`TimProduksiRoster`) — Kepala dan Wakil ditambahkan sebagai baris terpisah di atasnya, bukan bagian dari daftar yang bisa di-drag.
- Tidak membuat peran/permission baru di sistem akun Postgres — Wakil Kepala Produksi memakai peran "Produksi" (`peran_id` yang sama dengan Kepala Produksi hari ini, `is_produksi = true`), dibedakan hanya lewat kolom baru pada level Tim.
- Tidak mengubah histori shift yang sudah lewat — kolom baru memakai `DEFAULT 1` (dianggap hadir) sehingga baris lama tetap konsisten tanpa migrasi data.

## Model data

**Kolom baru pada `DashboardTimProduksi`:**
```sql
ALTER TABLE DashboardTimProduksi ADD WakilKepalaAkunID INT NULL
```
Mirip persis `KepalaAkunID` yang sudah ada — assignment standing, bukan per-shift.

**Kolom baru pada `DashboardAktivitasProduksiShift`:**
```sql
ALTER TABLE DashboardAktivitasProduksiShift ADD KepalaHadir BIT NOT NULL DEFAULT 1
ALTER TABLE DashboardAktivitasProduksiShift ADD WakilHadir BIT NOT NULL DEFAULT 1
```
Status hadir/tidak KHUSUS shift itu — tidak mengubah `KepalaAkunID`/`WakilKepalaAkunID` di Tim. Default 1 (hadir) baik untuk baris baru maupun baris lama yang sudah ada.

**Akun baru (Postgres `akun`, mengikuti konvensi 3 akun Kepala Produksi yang sudah ada — `peran_id=1012` "Produksi", `perusahaan_id=1` MKEsindo, `email`/`salesman_id` null):**

| username | nama | password | Wakil dari |
|---|---|---|---|
| Nizam | PRD-Nizam | 12345678 | Tim A |
| Aldo | PRD-Aldo | 12345678 | Tim B |
| Reza | PRD-Reza | 12345678 | Tim C |

Dibuat lewat `createAkun()` (`src/lib/queries/akun.ts`, sudah ada — hash password via bcrypt cost 12, sama seperti akun lain), lalu `WakilKepalaAkunID` Tim terkait diisi dengan id akun yang baru dibuat.

## Perbaikan tampilan (Bagian A)

Ketiga dropdown diubah dari:
```tsx
<SelectValue placeholder="..." />
```
menjadi pola render-prop yang sudah terbukti di `pemesanan-form-dialog.tsx`:
```tsx
<SelectValue placeholder="...">
  {(v: string) => optionsList.find((o) => String(o.id) === v)?.nama ?? "..."}
</SelectValue>
```
Diterapkan di `KepalaSelect`, `SelSelect`, dan `TimBertugasSelect` — tidak menyentuh query/database, murni perbaikan render.

## UI: dropdown Wakil Kepala Produksi (panel admin)

Di `PanelTimProduksi` (`panel-tim-produksi.tsx`), tambah `WakilKepalaSelect` sejajar dengan `KepalaSelect` yang sudah ada, memakai `produksiAkunOptions` yang sama. Untuk mencegah satu akun jadi Kepala sekaligus Wakil di Tim yang sama:
- Opsi di `KepalaSelect` mengecualikan `tim.wakilKepalaAkunId` milik Tim itu sendiri.
- Opsi di `WakilKepalaSelect` mengecualikan `tim.kepalaAkunId` milik Tim itu sendiri.

## UI: roster Kepala/Wakil di tab Aktivitas (produksi-app)

`TimProduksiRoster` (`tim-produksi-roster.tsx`) mendapat dua baris tetap di atas daftar anggota yang bisa di-drag (tidak ikut drag, tidak ikut sortir manual — urutannya selalu Kepala → Wakil → anggota):
- Baris Kepala: nama Kepala Produksi Tim yang bertugas shift ini, dengan tombol "tandai tidak hadir". Kalau sudah ditandai tidak hadir, baris berubah jadi ringkas ("Kepala Produksi tidak hadir shift ini") dengan tombol "tandai hadir kembali" — reversibel kapan saja dalam shift yang sama, karena operasinya murni membalik satu bit, bukan seperti hapus-anggota-dari-roster yang mengubah susunan penuh.
- Baris Wakil: sama persis, untuk Wakil Kepala Produksi.
- Kalau Tim belum punya Kepala atau Wakil yang ditetapkan (kolom `NULL`), baris itu tidak ditampilkan sama sekali (tidak ada "Kepala: -").

Data ini datang dari perluasan `AktivitasShiftInfo` (`aktivitas-produksi.ts`): tambah field `kepalaAkunId`, `wakilKepalaAkunId`, `kepalaHadir`, `wakilHadir` (mengikuti `TimID` shift ini, join ke `DashboardTimProduksi`). Nama Kepala/Wakil di-resolve di lapisan action (`produksi/actions.ts`), pola yang sama persis dengan `stafOperasionalNama` yang sudah ada hari ini (`getAkunNamaMap` lintas-DB Postgres).

## Rumus pembagian kontribusi

`jumlahHadir` yang dikirim ke `hitungKontribusiPerOrang` (dipanggil dari `QtyRecapCard` di `aktivitas-produksi-view.tsx`) berubah dari `susunanTim.length` menjadi:

```
jumlahHadir =
  (kepalaAkunId != null && kepalaHadir ? 1 : 0) +
  (wakilKepalaAkunId != null && wakilHadir ? 1 : 0) +
  susunanTim.length
```

Cek terhadap 4 contoh yang diberikan (Kepala+Wakil+5 anggota = 7; salah satu Kepala/Wakil tidak hadir + 5 anggota = 6; Kepala+Wakil hadir + 4 dari 5 anggota = 6) — seluruhnya cocok, karena anggota yang tidak hadir memang sudah tidak ada di `susunanTim` (mekanisme yang sudah ada, tidak berubah).

## Izin akses

Tidak ada pembatasan baru ditambahkan — menandai Kepala/Wakil tidak hadir memakai gerbang `requireProduksiView()` yang sama seperti seluruh layar Aktivitas Produksi hari ini (siapa pun akun `isProduksi` yang login bisa menandainya, sama seperti siapa pun bisa mengedit roster anggota hari ini via `canEdit={true}` yang sudah ada). Keputusan ini diambil supaya satu layar tidak punya sebagian terkunci-ketat dan sebagian terbuka — kalau pemilik produk ingin ini dikunci hanya untuk Kepala/Wakil Tim yang sedang bertugas, itu perubahan terpisah yang bisa menyusul.

## Error handling & edge case

- **Tim tanpa Kepala/Wakil**: baris terkait tidak tampil di roster (lihat di atas); `jumlahHadir` otomatis tidak menghitungnya (guard `!= null`).
- **Shift lama sebelum fitur ini**: `KepalaHadir`/`WakilHadir` `DEFAULT 1` membuat baris lama otomatis dianggap "Kepala/Wakil hadir". Perlu dicatat: `hitungKontribusiPerOrang` selalu dihitung langsung saat ditampilkan (tidak pernah disimpan per shift), jadi membuka Riwayat Aktivitas Produksi untuk shift LAMA setelah fitur ini rilis akan menampilkan angka kontribusi-per-orang yang **berbeda** dari sebelumnya (kini ikut membagi dengan Kepala, dan Wakil kalau sudah ditetapkan) — bukan karena data produksinya berubah, murni karena rumus pembagi berubah. Tidak ada data mentah yang ditulis ulang, hanya angka yang ditampilkan saat itu.
- **Satu akun jadi Kepala sekaligus Wakil di Tim sama**: dicegah di level UI (opsi saling mengecualikan, lihat di atas) — tidak ada constraint database, karena skenario ini tidak mungkin terjadi lewat UI yang disediakan.

## Testing

- Buka `/mkesindo/produksi` — pastikan Kepala Produksi & Tim tampil sebagai nama di ketiga dropdown (termasu kondisi tertutup, bukan cuma saat dibuka).
- Set Wakil Kepala Produksi untuk satu Tim, buka tab Aktivitas produksi-app untuk shift yang memakai Tim itu — pastikan Kepala & Wakil tampil di atas anggota, dalam urutan yang benar.
- Tandai Kepala tidak hadir → cek `jumlahHadir`/kontribusi di kartu QtyRecap berkurang 1, lalu tandai hadir kembali → kembali seperti semula.
- Verifikasi ketiga akun baru bisa login dengan password `12345678` dan muncul di dropdown Kepala/Wakil (peran Produksi).
