# Driver Health Check — Desain

Tanggal: 2026-11-26 · Modul: MKEsindo / Pengiriman / Validasi Rute

## Maksud & alasan

Sebelum armada berangkat, driver yang ditugaskan harus dinyatakan layak
mengemudi: tekanan darah wajar, bebas alkohol, pandangan baik, dan membawa SIM
yang masih berlaku. Tujuannya keselamatan. Karena itu pemeriksaan bersifat
**wajib lolos**, bukan sekadar catatan.

Kelayakan hanya berlaku untuk **satu keberangkatan (Jadwal) dan satu driver**.
Keberangkatan berikutnya, walau drivernya sama dan di hari yang sama, wajib
diperiksa ulang.

## Tujuan

- Tombol **Health Check** di samping dropdown driver pada Validasi Rute (saat
  Draf), dengan ikon ✓ hijau bila lolos dan ✗ merah bila tidak lolos.
- Formulir empat pemeriksaan, diisi manual oleh operasional:
  1. **Tekanan darah:** sistolik & diastolik (mmHg), dinilai otomatis.
  2. **Kadar alkohol mulut:** angka dari breathalyzer, dinilai otomatis.
  3. **Pandangan:** lolos/tidak, dinilai pemeriksa.
  4. **Surat mengemudi:** SIM tersimpan per driver; sistem menolak bila tidak
     ada SIM yang masih berlaku, dan pemeriksa mencentang "SIM fisik dibawa".
- **Selesai Muat terkunci** sampai driver jadwal itu lolos Health Check.
- Bila tidak lolos, ada dua jalan keluar:
  - pilih driver lain, lalu periksa driver baru itu; atau
  - **ambil alih** dengan Kode Ambil-Alih yang sudah ada, ditambah **alasan
    wajib**.
- Data SIM (golongan, nomor, berlaku hingga) disimpan **per driver**: diisi
  sekali, tampil otomatis di cek berikutnya, dan bisa diubah dari formulir
  Health Check maupun dari Kelola Driver.

## Bukan tujuan

- Mencocokkan golongan SIM dengan jenis armada (data kebutuhan SIM per armada
  belum ada). Cukup: minimal satu SIM driver masih berlaku.
- Pemeriksaan dari Aplikasi Driver atau aplikasi satpam. Hanya dari Validasi
  Rute di dashboard.
- Integrasi otomatis dengan alat (tensimeter/breathalyzer). Semua input manual.
- Riwayat kesehatan atau tren per driver di halaman tersendiri (bisa menyusul;
  datanya sudah tersimpan).

## Anti-tujuan (gagal walau "jalan")

- Kunci hanya di tampilan sehingga bisa dilewati lewat jalur lain. Kunci harus
  ada di server (`selesaiMuat`).
- Centang lolos terbawa ke driver lain, atau ke keberangkatan lain.
- Ambil-alih tanpa jejak (siapa, kapan, kenapa).
- Formulir lambat untuk pemakaian harian (harus selesai dalam ±1 menit).

## Batasan & fakta yang ditemukan

- Dropdown driver hanya tampil saat Jadwal berstatus **Draf**.
  `updateJadwalDriverTime` menolak perubahan saat **Terbit**, jadi driver tidak
  bisa berganti setelah Selesai Muat. Kunci cukup di `selesaiMuat` (satu-satunya
  pemanggil: `selesaiMuatAction` di `src/app/mkesindo/(dashboard)/delivery/actions.ts`).
- Driver di form disimpan ke DB (`SalesmanID` di `DashboardPengirimanJadwal`)
  oleh `updateJadwalDriverTime` sebelum `selesaiMuat` berjalan; `selesaiMuat`
  membaca `SalesmanID` dari baris DB. Health Check dicocokkan ke `SalesmanID`
  di DB pada saat itu.
- Kode Ambil-Alih sudah ada (Postgres `kode_ambil_alih`,
  `src/lib/queries/kode-ambil-alih.ts`): 6 digit, berlaku 3 menit, dibuat oleh
  peran berizin dengan password, sekali pakai, dicatat per jadwal + aksi. Saat
  ini aksinya `MULAI_MUAT` | `SELESAI_MUAT`. Selesai Muat dari dashboard sudah
  meminta kode ini.
- SIM driver sudah ada di Kelola Driver (`DashboardDriverSim`: `SalesmanID`,
  `JenisSim` VARCHAR(10), `IsDeleted`), hanya berisi golongan. Penyimpanan
  Kelola Driver saat ini menghapus semua baris lalu memasukkan ulang.
- Pola tabel samping dashboard di MSSQL (`DashboardXxx`), skrip pembuat tabel
  idempoten di `scripts/create-*.ts` (lihat `create-mitra-cadangan-table.ts`).
- Jam di layar = WIB (zona browser); simpan `CheckedAt` dengan `GETDATE()` /
  pola yang sama dengan `DashboardVehicleCheck`.

## Pendekatan yang dipertimbangkan

1. **SIM disimpan per driver (DIPILIH user).** Perluas `DashboardDriverSim`
   dengan nomor & masa berlaku. Health Check membaca SIM tersimpan; formulir
   cukup centang "SIM fisik dibawa". Cepat untuk harian, bisa memperingatkan
   SIM yang hampir habis. Konsekuensi: data induk harus dijaga saat SIM
   diperpanjang (bisa diubah langsung dari formulir).
2. SIM diketik ulang tiap Health Check. Tanpa data induk, tapi lambat, rawan
   salah ketik, dan cek masa berlaku hanya sebaik angka yang diketik. Ditolak.
3. Penyimpanan di Postgres (tempat akun). Ditolak: Jadwal, Salesman, dan
   Kelola Driver semuanya di MSSQL; kunci `selesaiMuat` paling sederhana di DB
   yang sama.

## Keputusan user

- Wajib lolos; bila tidak, ganti driver **atau** masukkan Kode Ambil-Alih.
- Alat alkohol = breathalyzer (ada angka). Semua nilai input manual oleh
  operasional.
- SIM disimpan per driver.

## Rancangan

### Kriteria lolos (usulan saya, belum dikoreksi user)

| Pemeriksaan | Lolos bila |
|---|---|
| Tekanan darah | sistolik 90–159 **dan** diastolik 60–99 mmHg |
| Alkohol | angka breathalyzer = 0 (toleransi nol) |
| Pandangan | pemeriksa memilih "Lolos" |
| SIM | ada ≥1 SIM driver dengan `BerlakuHingga` ≥ tanggal hari ini (WIB) **dan** "SIM fisik dibawa" dicentang |

Hasil akhir lolos hanya bila keempatnya lolos. Batas angka disimpan sebagai
konstanta di satu modul murni (mis. `src/lib/health-check-driver.ts`) dengan
fungsi `nilaiHealthCheck(input) → { lolos, alasanGagal[] }` yang dipakai
klien (penilaian langsung saat mengetik) dan server (penilaian ulang saat
menyimpan — server tidak mempercayai hasil dari klien).

### Data (MSSQL)

`DashboardDriverHealthCheck` — satu baris per pemeriksaan (riwayat utuh;
pemeriksaan ulang menambah baris baru, bukan menimpa):

- `HealthCheckID` INT IDENTITY PK
- `JadwalID` INT, `SalesmanID` VARCHAR(16)
- `Sistolik` INT, `Diastolik` INT
- `KadarAlkohol` DECIMAL(6,3)
- `PandanganLolos` BIT
- `SimDibawa` BIT, `SimBerlakuHingga` DATE NULL (snapshot SIM terbaik saat cek)
- `Lolos` BIT (hasil penilaian server)
- `AlasanGagal` NVARCHAR(400) NULL (ringkasan kriteria yang gagal)
- `Catatan` NVARCHAR(400) NULL
- `DiperiksaOlehAkunID` INT, `DiperiksaPada` DATETIME DEFAULT GETDATE()
- `AmbilAlih` BIT DEFAULT 0, `AmbilAlihAlasan` NVARCHAR(400) NULL,
  `AmbilAlihOlehAkunID` INT NULL, `AmbilAlihPada` DATETIME NULL

Status berlaku untuk Jadwal = **baris terbaru** untuk (`JadwalID`,
`SalesmanID` jadwal saat ini). Layak berangkat bila baris itu `Lolos = 1` atau
`AmbilAlih = 1`.

`DashboardDriverSim` ditambah kolom nullable `NomorSim` VARCHAR(30) dan
`BerlakuHingga` DATE. Penyimpanan Kelola Driver diubah agar menyimpan ketiga
kolom (tetap boleh pola hapus-lalu-sisip, asal nomor & masa berlaku ikut).

Skrip idempoten `scripts/create-driver-health-check-table.ts` membuat tabel &
menambah kolom.

### Kunci di server

- `selesaiMuat(jadwalId)`: sebelum membuat DO/SI, baca `SalesmanID` jadwal
  dan baris Health Check terbaru untuk pasangan itu. Bila tidak ada, atau tidak
  lolos dan tidak diambil alih → `AppError("Driver belum lolos Health Check …")`.
- Ambil-alih: aksi server baru memverifikasi kode lewat
  `verifikasiDanPakaiKodeAmbilAlih(kode, akun, jadwalId, "HEALTH_CHECK")`
  (perluas union aksi), lalu menandai baris Health Check terbaru jadwal+driver
  itu `AmbilAlih = 1` + alasan. Hanya bisa bila baris terbaru tidak lolos.
- Simpan Health Check hanya saat Jadwal masih Draf. Baris dikunci ke
  `SalesmanID` yang diperiksa (driver di dropdown); driver di form tidak perlu
  tersimpan dulu. Gerbang `selesaiMuat` mencocokkan ke `SalesmanID` jadwal di
  DB saat itu, jadi driver yang berbeda dari yang diperiksa tetap ditolak.

### Tampilan

```
Driver: [ Moch Sahrul Nizam ▾ ] [ Health Check ] ✓
```

- Tombol nonaktif bila belum ada driver. Status di sampingnya: kosong (belum
  dicek), ✓ hijau (lolos), ✓ kuning "diambil alih" (lolos lewat kode), ✗ merah
  (tidak lolos). Ganti driver di dropdown → status mengikuti driver baru
  (biasanya kosong).
- Tombol Selesai Muat nonaktif + petunjuk singkat bila belum layak; validasi
  server tetap berlaku.
- Formulir (dialog):
  - Tekanan darah: dua kolom angka "Sistolik / Diastolik mmHg", label lolos/
    gagal langsung muncul.
  - Alkohol: satu kolom angka, gagal bila > 0.
  - Pandangan: pilihan Lolos / Tidak lolos.
  - SIM: daftar SIM driver (golongan, nomor, berlaku hingga) dengan tanda
    kedaluwarsa / hampir habis (≤30 hari); bisa ditambah/diubah di tempat;
    kotak centang "SIM fisik dibawa".
  - Catatan (opsional). Tombol Simpan.
  - Setelah disimpan dan gagal: tampil alasan + dua tombol "Ganti driver"
    (tutup formulir) dan "Ambil alih dengan kode" (kolom kode 6 digit + alasan
    wajib).
- Linimasa/ekspor Validasi Rute boleh menampilkan "Health Check lolos HH.MM
  oleh X" — keputusan builder, tidak wajib.

## Keputusan kecil (diambil perancang, boleh dikoreksi)

- **Cek ulang boleh langsung** setelah gagal (mis. tensi diulang setelah
  istirahat): menambah baris baru, yang terbaru yang berlaku.
- **Siapa yang boleh mengisi:** semua akun dengan akses modul `delivery`.
  Pemeriksa tercatat lewat `DiperiksaOlehAkunID`.
- **Dua kode berurutan:** Selesai Muat dari dashboard sudah meminta Kode
  Ambil-Alih (`SELESAI_MUAT`). Ambil-alih Health Check memakai kode
  terpisah (`HEALTH_CHECK`) sebelumnya. Karena kode baru selalu mengalahkan
  yang lama, keduanya dipakai berurutan, tidak bentrok.
- **Breathalyzer:** satu angka tanpa satuan tetap (alat bisa ‰ BAC atau mg/L).
  Toleransi nol membuat satuan tidak memengaruhi penilaian; label kolom
  "sesuai tampilan alat".
- **Jadwal lama:** kunci hanya berlaku untuk Selesai Muat yang terjadi
  setelah fitur terpasang, termasuk Draf yang dibuat sebelumnya. Jadwal yang
  sudah Terbit tidak terpengaruh.
- **Tenant demo (DemoEsKristal):** skrip tabel juga dijalankan di sana bila
  tenant itu memakai alur Selesai Muat.

## Diserahkan ke builder

- Tata letak persis dialog, ikon, dan teks.
- Nama aksi server & berkas, selama mengikuti pola `runAction` /
  `requireModuleAccess("delivery")` yang ada.
- Bentuk tes unit untuk `nilaiHealthCheck` (wajib ada) dan kunci
  `selesaiMuat` (sejauh praktis).
