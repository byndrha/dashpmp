# Produksi Es Balok — Operasional (siklus rek, panen per muatan, audit) — Desain

Tanggal: 2026-11-09 · Bisnis: Es Balok · Pabrik: PMPersada (Tuban), PMPakis
Melanjutkan: `2026-10-25-produksi-es-balok-builder-denah-design.md` (tahap 1) dan `2026-11-01-produksi-es-balok-denah-v2-3d-design.md` (denah v2 + 3D). Keduanya sudah live.
Acuan cara kerja: prototipe **IceControl PMP** (`https://ice-control-pmp.pages.dev/`), yang dibuat untuk PMPersada.

## Maksud

Setelah denah sebuah pabrik selesai dibuat, modul Produksi harus langsung bisa dipakai untuk operasional harian. Operator di samping bak mencatat siklus setiap rek: isi air, beku, panen, Babonan, dan maintenance. Admin memantau stok can per tahap kematangan, urutan panen (FIFO), dan log audit. Admin juga **mencocokkan es yang dipanen dengan DO di ERP per kendaraan per hari** untuk mendeteksi es yang keluar tanpa nota.

Cara kerja IceControl yang diambil:
- alur status rek
- kematangan otomatis berdasarkan jam beku
- pembatasan hak operator
- FIFO
- log audit dan ekspor Excel

IceControl sendiri masih prototipe:
- datanya dibuat oleh rumus
- backend Google Sheets belum tersambung
- "analisis AI" berupa teks tetap
- kata sandi tertulis di kode

Yang diambil dari IceControl adalah **struktur dan aturan kerjanya**, bukan datanya.

## Ringkasan IceControl (acuan)

- Struktur PMPersada: 5 bak, 37/37/44/66/66 rek (total 250). BK = 36 can/rek, BB = 18 can/rek. Jam beku BK 24 jam, BB 32 jam, diatur admin. Di data contohnya, Bak 4–5 rek nomor 41 ke atas adalah BB.
- 9 operator (Adam, Lasudji, Aris, Duraji, Toha, Bisri, Warjono, Bahar, Kohadi) dan sistem shift (contoh "Shift 1 07:00–15:00").
- Status: `BARU` (isi air, 0%), `MULAI` (1–49%), `KRISTAL` (50–74%), `SIAP` (75–99%), `JADI` (100%), `BABONAN`, `MAINTENANCE`. Empat tahap tengah dihitung otomatis dari `(sekarang − waktu isi) / jam beku`.
- Operator hanya boleh menandai *Panen – Isi Air*, *Babonan*, dan *Maintenance*. Admin boleh mengubah semuanya, termasuk jenis es dan jumlah can.
- Tampilan:
  - kartu ringkasan stok can (sehat / air baru / proses / matang)
  - progres per bak
  - peta rek per bak
  - tabel FIFO (lokasi, jenis, status, operator, waktu isi, estimasi matang, usia)
  - rekap per tahap
  - log audit (waktu, lokasi, jenis & can, perubahan status, usia es, operator & shift, keterangan) dan ekspor Excel
  - satu aturan anomali nyata: usia es > jam beku + 12 jam
  - penyegaran otomatis setiap 30 detik

## Keputusan pengguna (2026-11-09)

- Yang mengubah status rek di lapangan adalah **Operator Produksi, memakai smartphone pribadi**.
- **Akun pribadi per operator**, bukan akun bersama.
- Setelah diangkat, es **langsung dimuat ke kendaraan distribusi perusahaan**. Tidak ada gudang. Dalam kasus darurat, **kendaraan pembeli** boleh mengambil langsung.
- **1 ice can = 1 balok = 1 angka di "Realisasi" pemesanan ERP**, berlaku untuk Kecil maupun Besar.
- Pencocokan dilakukan **per muatan (per kendaraan)**, bukan hanya total per hari.
- **Isi satu rek bisa terbagi ke dua kendaraan** atau lebih.
- **Standarnya satu rek dikosongkan sekaligus, lalu langsung diisi air lagi setelah muat selesai.** Pengecualiannya: ada ice can yang **sengaja tidak dipanen** (biasanya 1–2 can) untuk menjaga suhu bak, yaitu **Babonan per can**, bukan per rek. (Jawaban awal "bisa sebagian lalu dilanjut nanti" diluruskan pengguna: yang dimaksud adalah can Babonan ini.)
- **Es pecah biasanya tidak dimuat atau dijual.** Es pecah tetap di ice can dan kemungkinan menjadi Babonan.
- **Waktu muat tidak tentu.** Tanggal bisnis memakai **closing 13:59 WIB; pukul 14:00 sudah dihitung hari berikutnya**. Aturan ini sama dengan `ROLLOVER_HOUR` di `business-date.ts`. Kalau ternyata ada salah cocok, aturannya dikonfigurasi ulang nanti.
- **Tata letak awal dari IceControl sudah benar**, termasuk Bak 4–5 rek nomor 41 ke atas = BB 18 can.
- **Sinyal dianggap selalu ada.** Mode offline / pencatatan lokal dikerjakan nanti.
- Pendekatan **A**: dua layar (HP operator dan dashboard admin) di atas data yang sama.

## Temuan dari data live (dicek read-only 2026-11-09)

- `PMP_Pemesanan` (ERP Es Balok) punya `BalokKecilRealisasi` / `BalokBesarRealisasi`. Setiap pemesanan PMPersada dijadwalkan lewat `PMP_PenjadwalanDetail` ke **`PMP_Penjadwalan`**: nomor DO (`PMP/DO/…`), `Tanggal`, `DaftarKendaraanID` (→ `PMP_DaftarKendaraan.Nama` = plat, `MaxQty` 216), dan `SopirID` (→ `PMP_Sopir`). Dalam 7 hari terakhir: 217/217 pemesanan punya DO, 14–15 kendaraan per hari.
- **Sebagian besar DO diinput malam hari** (puncaknya pukul 20.00–21.00, beruntun berjarak detik). Artinya DO dibuat setelah es dimuat. Saat panen, DO biasanya belum ada.
- **Data DO PMPersada tercatat ganda.** Database `utama` (FINAC_ES_TB) dan `logistik` (FINAC_PMP_LOGISTIC, `BranchID='012'`) berisi muatan per kendaraan per hari yang **identik** (dicek untuk 7 Nov, ke-14 kendaraan). Hanya nomor dokumennya yang berbeda (…/HO vs …/TB). Pencocokan harus memakai **satu sumber**.
- **Armada tidak dipakai bersama antar pabrik di hari yang sama.** Dicek 30 Okt – 9 Nov: PMPersada (`BranchID 012`) memakai 13–15 kendaraan per hari dan PMPakis (`011`) 1–8 kendaraan, dengan **0 plat yang sama** di hari yang sama. Pencocokan per kendaraan per pabrik aman.
- Akun: PMPersada hanya punya satu akun bersama `produksi-tuban` (peran "Produksi", `is_produksi`). PMPakis belum punya peran Produksi.
- Denah PMPersada saat ini masih denah uji (3 elemen). `produksi_kolom_isi` masih kosong.

## Tujuan

1. Operator mencatat dari HP: isi air, panen (dengan pembagian ke kendaraan dan jumlah can pecah), Babonan, dan maintenance. Sekali ketuk untuk kasus umum.
2. Kematangan setiap rek dihitung otomatis dari jam beku per bak dan per varian di denah.
3. Admin melihat peta status langsung di atas denah, ringkasan stok can, FIFO, log audit, dan peringatan.
4. Pencocokan harian **panen vs DO ERP per kendaraan**, Kecil dan Besar terpisah, dengan selisih ditandai.
5. Setiap perubahan tercatat atas nama akun pribadi, lengkap dengan shift, dan tidak bisa dihapus.

## Bukan tujuan (tahap ini)

- Mode offline dan antrean lokal.
- Sensor atau otomasi suhu.
- "Analisis AI". Diganti aturan peringatan yang eksplisit (lihat Peringatan).
- PMPutra.
- Notifikasi push/WA.
- Menulis ke ERP. ERP hanya dibaca.

## Anti-tujuan (gagal walau "jalan")

- Panen yang dicatat hilang diam-diam, sehingga muncul selisih palsu di pencocokan.
- Muatan DO terhitung dua kali (`utama` + `logistik`).
- Operator bisa memundurkan waktu atau mengubah catatan orang lain.
- Log audit bisa diedit atau dihapus.
- Denah bisa diubah di bawah rek yang sedang berisi es (aturan tahap 1 tetap berlaku).

## Pendekatan

| | Pendekatan | Untung / rugi | Status |
|---|---|---|---|
| **A** | Layar HP operator `/{kode}/produksi-app` + layar admin `/{kode}/produksi`, satu set tabel Postgres dan server action bersama | Setiap pengguna mendapat layar yang pas. Dua tampilan harus dirawat | **Dipilih pengguna** |
| B | Satu halaman `/produksi` yang tombolnya menyesuaikan peran | Kode lebih sedikit. Di HP operator mendapat halaman dashboard yang padat, dan layar admin dibatasi ukuran HP | Ditolak |
| C | Aplikasi terpisah ala IceControl | Login, denah, dan data DO harus dibangun ulang | Dicoret |

## Desain

### 1. Model rek: kelompok can (isian)

"Rek" di lapangan = `DenahKolom` di denah, dengan `id` stabil. Karena Babonan dihitung per can, **satu rek bisa memuat beberapa kelompok can sekaligus**. Contohnya: 2 can Babonan dari siklus lama dan 34 can yang baru diisi air. Setiap kelompok disebut **isian**.

Satu isian = sekumpulan can dalam satu rek yang diisi air bersamaan:
- `mulai_at` (waktu isi air), `varian`, `durasi_beku_jam` (snapshot)
- `jumlah_awal`: can yang diisi
- `sisa`: can yang masih di bak dan belum dipanen. Dihitung = `jumlah_awal − Σ dipanen − Σ dijadikan Babonan (untuk isian biasa)`
- `jenis`: **`produksi`** (siklus biasa) atau **`babonan`** (can yang sengaja ditinggal penjaga suhu, termasuk es pecah)
- isian selesai (`selesai_at`) begitu `sisa = 0`

Can yang ditinggal saat panen tidak dibiarkan menggantung di isian lama. Can itu **dipindah ke isian Babonan** milik rek tersebut. Ada satu isian Babonan aktif per rek. Isian ini menyimpan `babonan_sejak` (waktu tertua can Babonan di rek itu) dan jumlah can pecah di dalamnya.

**Kapasitas:** `Σ sisa semua isian aktif di rek ≤ DenahKolom.jumlahIceCan`. Isi Air hanya bisa mengisi can yang kosong, yaitu `jumlahIceCan − Σ sisa`.

**Keadaan rek untuk tampilan** (diturunkan, tidak disimpan):

| Keadaan | Syarat |
|---|---|
| **Kosong** | Tidak ada isian aktif dan tidak maintenance |
| **Berisi es (x%)** | Ada isian `produksi` aktif. Persentase dan tahap diambil dari isian `produksi` **tertua** yang masih bersisa (FIFO) |
| **Babonan n** | Ada isian `babonan` aktif. Tampil sebagai badge di samping keadaan utama. Kalau hanya ada Babonan, keadaan utamanya "Babonan" |
| **Maintenance** | Ada catatan maintenance terbuka |
| **Nonaktif** | `DenahKolom.nonaktif = true` |

Kematangan isian `produksi`: `pct = clamp(round((now − mulai_at) / durasi_beku_jam × 100), 0, 100)`, dengan tahap 0 → Air baru, 1–49 → Mulai, 50–74 → Kristal, 75–99 → Siap, 100 → Jadi. Warna mengikuti `TAHAP_KEMATANGAN` di `warna.ts`.

`durasi_beku_jam` dan `varian` di-**snapshot** dari `bak.durasiBekuJam[varian]` dan `DenahKolom` saat isi air (Claude). Perubahan denah tidak memengaruhi isian yang sedang berjalan.

**Kunci denah:** aturan tahap 1, "kolom berisi es tidak boleh diubah", membaca "ada isian aktif apa pun", termasuk Babonan. Query `getKolomBerisiEs` tetap memakai `selesai_at IS NULL` pada tabel yang sama.

### 2. Aksi

| Aksi | Siapa | Efek |
|---|---|---|
| **Isi Air** | Operator, Admin | Membuat isian `produksi` baru (`mulai_at = now()` server) sebanyak can kosong. Jumlahnya bawaan = `jumlahIceCan − Σ sisa` dan hanya boleh dikurangi (mis. ada can rusak) |
| **Panen & Isi Air** | Operator, Admin | Aksi standar. **Mengosongkan seluruh isian `produksi`** dalam satu kejadian: baris muatan per kendaraan, ditambah **"Tinggal sebagai Babonan"** n can dan **"Pecah (tetap di can)"** n can. Keduanya dipindah ke isian Babonan rek. Di transaksi yang sama, can yang kosong langsung diisi air (isian `produksi` baru, jumlah = can yang dimuat). Syarat: `Σ muatan + babonan + pecah = sisa` |
| **Panen tanpa isi ulang** | Operator, Admin | Sama seperti di atas, tapi can kosong tidak diisi. Dipakai kalau rek akan maintenance atau bak dihentikan (Claude: pengecualian, bukan alur normal) |
| **Tandai Babonan** | Operator, Admin | Memindah n can dari isian `produksi` ke Babonan tanpa panen, untuk kasus "rek ini dijadikan penjaga suhu" |
| **Lepas Babonan** | Operator, Admin | Mengeluarkan can Babonan: **dimuat** (lewat Panen, ikut pencocokan) atau **dibuang/dilebur** (tidak dimuat; dicatat, tidak ikut pencocokan) |
| **Mulai / Selesai Maintenance** | Operator, Admin | Mulai hanya kalau rek tidak punya isian `produksi` aktif. Babonan boleh tetap ada (Claude). Selama maintenance, Isi Air ditolak |
| **Koreksi** | Admin saja | Mengubah `mulai_at`, `varian`, atau `sisa` isian aktif, atau membatalkan panen ≤ 7 hari (status `dibatalkan`; jumlahnya dikembalikan ke isian kalau isian masih aktif, kalau tidak hanya ditandai). **Alasan wajib**, nilai lama dan baru masuk log. Tidak ada hapus fisik |

Server selalu memakai jam server. Operator tidak bisa mengisi waktu.

Panen dari isian dengan `pct < 75` meminta konfirmasi ("Es belum siap, tetap panen?"). Aksi ini tidak diblokir, tapi ditandai di log (Claude).

**Konkurensi:** setiap aksi mengunci isian-isian rek yang bersangkutan (`SELECT … FOR UPDATE`), menghitung ulang `sisa` di server, lalu menolak kalau jumlah yang diminta melebihi `sisa`. Contoh: dua operator memanen rek yang sama sehingga can tidak cukup, maka pesannya "tinggal n can, baru saja dipanen {nama} {jam}".

Setiap aksi yang mengubah isian **juga mengunci baris `produksi_denah` perusahaan itu** (`FOR SHARE`). Isi Air menolak kolom yang tidak ada di denah atau `nonaktif`. Ini menutup celah urutan simpan denah ↔ isi kolom (catatan tahap 1).

### 3. Panen per muatan

- Setiap operator punya **kendaraan aktif** yang tersimpan di server per akun (`produksi_kendaraan_aktif`). Kendaraan aktif tetap berlaku sampai diganti, juga setelah aplikasi ditutup.
- Pilihan kendaraan:
  - daftar `PMP_DaftarKendaraan` (IsDeleted=0) dari ERP pabrik itu, dengan pencarian plat
  - opsi **"Kendaraan pembeli"**, dengan isian plat (wajib) dan nama agen (opsional, pilih dari `PMP_Agen` atau teks bebas)
- Formulir Panen & Isi Air:

```
Rek 14 · BK · isian 08:10 (96%) · 36 can        Kendaraan aktif: S 9805 UH ▾
  S 9805 UH ................ [20]
  S 9870 UH ................ [14]   (+ Bagi ke kendaraan lain)
  Tinggal sebagai Babonan .. [ 2]
  Pecah (tetap di can) ..... [ 0]
  ─────────────────────────────────
  Dimuat 34 · Babonan 2 · total 36 ✓
            [ Panen & Isi Air 34 can ]      (Panen tanpa isi ulang)
```

  - Baris muatan pertama otomatis = kendaraan aktif, dengan jumlah = sisa isian dikurangi bawaan Babonan (0).
  - Kendaraan pada baris muatan terakhir otomatis menjadi kendaraan aktif baru.
- Aturan validasi (server): `Σ muatan + babonan + pecah = sisa isian`, setiap angka ≥ 0, dan kendaraan unik dalam satu panen. Tombol baru aktif setelah total cocok.
- Varian muatan = varian isian.

### 4. Pencocokan panen ↔ DO

- **Sumber DO: satu database saja.** Untuk PMPersada dipakai `utama`. Alasannya, `logistik` adalah salinan (lihat Temuan) dan juga dipakai PMPakis.
  - Query: `PMP_Penjadwalan j` → `PMP_PenjadwalanDetail d` (IsDeleted=0) → `PMP_Pemesanan p` (IsDeleted=0, IsVoid=0), dikelompokkan per **tanggal bisnis** `j.Tanggal` (aturan closing di bawah) dan `j.DaftarKendaraanID`, menjumlahkan `p.BalokKecilRealisasi` dan `p.BalokBesarRealisasi`.
  - **`Status` tidak difilter** (Claude). Status '2' adalah satu-satunya status PMPersada 30 hari terakhir, dan realisasinya sudah terisi. Builder memverifikasi ini dan mencatat hasilnya di kode.
  - `j.Tanggal` disimpan naive WIB. Dibaca sebagai WIB tanpa konversi zona (pola sama dengan memory TransDate WIB).
- **Sumber DO PMPakis:** ditentukan builder dengan pengecekan yang sama. Apakah `utama` PMPakis dan `logistik` (`BranchID='011'`) juga cermin? Pilih satu, lalu dokumentasikan.
- **Tanggal bisnis (keputusan pengguna): closing 13:59 WIB, pukul 14:00 sudah dihitung hari berikutnya.** Aturan ini berlaku sama untuk `panen_at` (dikonversi ke WIB) dan `j.Tanggal` DO (naive WIB). Jam rollover diambil dari konstanta milik modul ini, `ROLLOVER_PANEN_JAM`, yang bawaannya = `ROLLOVER_HOUR` (14) dari `business-date.ts`, lewat `getBusinessDateWithRollover`. Karena pengguna akan "mengonfigurasi lebih lanjut kalau ada kesalahan", nilainya dipisah supaya bisa diganti tanpa menyentuh rollover app-wide. Layar juga menampilkan selisih H−1/H+1 sebagai petunjuk, tanpa memindahkan data.
- **Tabel pencocokan** per tanggal, satu baris per kendaraan: Panen K/B, DO K/B, Selisih K/B, jumlah rek, operator.
  - Status: **Cocok**, **Panen > DO** (es keluar tanpa nota, prioritas merah), **DO > Panen** (DO tanpa panen tercatat), **Hanya DO**, **Hanya panen**.
  - Muatan "kendaraan pembeli" ditampilkan di bagian sendiri, dengan total yang dibandingkan ke DO yang kendaraannya tidak termasuk armada pabrik pada hari itu. Pencocokan per baris untuk kasus darurat ini tidak dipaksakan (Claude).
  - Es pecah tidak dimuat (keputusan pengguna). Es pecah masuk Babonan dan tidak ikut pencocokan. Babonan yang dilepas lewat "dibuang/dilebur" juga tidak ikut. Babonan yang dilepas lewat **dimuat** ikut, karena keluar dengan kendaraan.
  - Ringkasan harian di atas tabel: total dipanen, total DO, can masuk Babonan, can pecah, dan Babonan dibuang.
- Hari bisnis yang belum closing diberi label "sementara". Karena waktu muat tidak tentu, selisih sebelum closing wajar.

### 5. Peringatan (pengganti "Analisis AI")

Dihitung langsung saat halaman dibuka, tanpa job terjadwal:
- **Terlambat panen:** isian `produksi` dengan usia > jam beku + 12 jam yang masih bersisa (aturan IceControl).
- **Babonan terlalu lama:** `babonan_sejak` > 48 jam (fakta pengguna: "maks ~2 hari").
- **Maintenance lama:** maintenance terbuka > 72 jam (Claude, konstanta).
- **Kolom kosong lama:** Kosong > 6 jam di bak yang aktif (Claude, konstanta). Ini tanda kapasitas terbuang.
- **Panen < 75%** dalam 24 jam terakhir.
- **Selisih pencocokan** hari bisnis terakhir yang sudah closing (≠ 0) untuk kendaraan mana pun.

Semua ambang ditaruh sebagai konstanta di satu modul (`produksi-operasional.ts`) supaya mudah diubah.

### 6. Shift

Shift dihitung dari jam server WIB saat aksi, lalu disimpan di setiap baris log: **Shift 1 07:00–15:00, Shift 2 15:00–23:00, Shift 3 23:00–07:00** (Claude: IceControl hanya menyebut Shift 1 07:00–15:00, sisanya disimpulkan dari pola 3×8 jam). Shift ditulis sebagai konstanta. Operator tidak memilih shift.

### 7. Layar HP operator — `/{kode}/produksi-app`

Mengikuti pola aplikasi lapangan yang ada (Satpam/Driver/Produksi MKEsindo): layout HP tanpa sidebar, bottom nav tidak fixed (memory keep-alive tab shell).

- **Atas:** nama operator, shift, dan pemilih **kendaraan aktif** (selalu terlihat).
- **Tab bak:** Bak 1 … Bak N, sesuai urutan denah.
- **Grid rek:** kartu berisi nomor, varian (BK/BB), warna tahap, %, dan usia isian tertua, ditambah badge "Babonan n". Maintenance diberi ikon. Urutan dan arah nomor mengikuti `arahNomor` bak.
- **Ketuk rek:** muncul lembar aksi yang sesuai keadaan:
  - Kosong / ada can kosong → Isi Air (sejumlah can kosong), Mulai Maintenance (kalau tidak ada isian produksi)
  - Berisi → Panen & Isi Air, Tandai Babonan
  - Ada Babonan → Lepas Babonan (dimuat / dibuang)
  - Maintenance → Selesai Maintenance
  - Lembar menampilkan setiap isian aktif (waktu isi, %, sisa, operator pengisi) dan estimasi matang.
- **Formulir panen:** seperti bagian 3. Tombol utama besar "Panen & Isi Air". "Panen tanpa isi ulang" berupa tautan kecil.
- **Tab "Riwayat saya":** aksi operator di shift ini, ditambah total muatan per kendaraan hari ini.
- Data disegarkan setiap 30 detik dan setelah setiap aksi.

### 8. Layar admin — `/{kode}/produksi`

Halaman yang sudah ada (penampil denah + tombol Edit Denah) diperluas menjadi tab:
1. **Peta:** penampil denah 2D yang sudah ada, dengan **overlay status per kolom** (warna tahap). Klik kolom membuka detail isian beserta aksi admin (termasuk Koreksi).
2. **Ringkasan:**
   - kartu can sehat / air baru / proses / matang / Babonan / maintenance, gaya IceControl. Semua dihitung dari `sisa` isian, bukan jumlah rek
   - progres per bak
   - estimasi can siap panen 6 dan 12 jam ke depan (Claude: menurunkan FIFO menjadi perencanaan muatan)
3. **FIFO:** tabel semua isian aktif (satu baris per isian, kolom sisa/awal), diurutkan dari usia tertua, dengan filter bak, varian, dan tahap, serta pencarian.
4. **Pencocokan:** bagian 4, dengan pemilih tanggal.
5. **Log audit:** tabel dengan filter tanggal, operator, bak, dan aksi, plus **ekspor Excel** (pustaka ekspor yang sudah dipakai di repo, kalau ada).
6. **Peringatan:** daftar bagian 5. Jumlahnya ditampilkan sebagai badge di tab.

Kalau denah masih kosong, tab operasional diganti pesan "Buat denah dulu" (perilaku tahap 1 tetap).

### 9. Akses

- **Operator:** akun pribadi berperan `is_produksi`.
  - `/{kode}/(dashboard)/layout.tsx` mengarahkan akun `is_produksi` ke `/{kode}/produksi-app` untuk semua rute dashboard, **kecuali** akun yang juga admin produksi (`bolehKelolaProduksi`). Akun admin itu tetap boleh membuka `/{kode}/produksi`, dan layar HP-nya menampilkan tautan ke layar admin (Claude: supervisor lapangan bisa memegang kedua peran).
  - Gerbang `require{Kode}Produksi()` = sesi pabrik itu + `isProduksi`.
- **Admin produksi:** Super Admin, Direktur, atau peran dengan `permissions.produksi.canEdit`. Ini aturan yang sama dengan `bolehEditDenah`, dipakai ulang sebagai `bolehKelolaProduksi`. Hanya admin yang bisa Koreksi.
- Tab **Pencocokan** dan **Log audit** hanya untuk admin produksi, Direktur, dan Super Admin. Akun dashboard lain di pabrik itu hanya melihat Peta, Ringkasan, FIFO, dan Peringatan (Claude: data DO dan jejak per operator bersifat pengawasan).
- Aturan peran ditegakkan di server action, bukan hanya di UI.
- **Akun:**
  - Akun operator PMPersada dibuat lewat UI `/grup/akun` yang sudah ada. Sistem tidak membuat akun otomatis.
  - Akun bersama `produksi-tuban` tidak dihapus oleh sistem. Rencana implementasi mencantumkan langkah manual untuk menonaktifkannya setelah akun pribadi siap.
  - PMPakis mendapat peran "Produksi" (`is_produksi`) lewat skrip.

### 10. Denah awal PMPersada dari IceControl

Skrip sekali jalan `scripts/seed-denah-pmpersada-icecontrol.ts` membuat denah v2 dengan isi:
- 5 bak bernama "Bak 1" … "Bak 5", masing-masing 37/37/44/66/66 kolom.
- Semua kolom BK 36 can, kecuali Bak 4–5 kolom nomor 41 ke atas = BB 18 can (sesuai IceControl, **dikonfirmasi pengguna 2026-11-09**).
- Jam beku BK 24 jam, BB 32 jam.
- Bak ditata berjajar di kanvas. Posisi dan ukuran dirapikan pengguna di builder.

Skrip menolak jalan kalau ada kolom berisi es, dan menimpa denah uji lewat `simpanDenah` (versi naik), bukan SQL mentah.

### 11. Data (Postgres pusat, `getPgPool()`)

```
produksi_kolom_isi            -- sudah ada; diperluas (ALTER ADD COLUMN). Satu baris = satu isian
  id bigserial PK, perusahaan_kode, kolom_id, mulai_at, selesai_at   -- ada
  jenis text NOT NULL             -- 'produksi' | 'babonan'
  bak_id text NOT NULL, varian text NOT NULL,
  jumlah_awal int NOT NULL, sisa int NOT NULL CHECK (sisa >= 0),
  durasi_beku_jam numeric NULL    -- NULL untuk babonan
  pecah int NOT NULL DEFAULT 0    -- babonan: berapa dari sisa yang pecah
  diisi_oleh_akun_id int NOT NULL, ditutup_oleh_akun_id int NULL
  UNIQUE (perusahaan_kode, kolom_id) WHERE selesai_at IS NULL AND jenis = 'babonan'   -- satu babonan aktif per rek
  -- isian produksi aktif per rek boleh > 1 (mis. can bekas Babonan yang dilepas lalu diisi air, mulai_at berbeda)

produksi_maintenance
  id, perusahaan_kode, kolom_id, mulai_at, selesai_at NULL, catatan,
  dibuka_oleh_akun_id, ditutup_oleh_akun_id
  UNIQUE (perusahaan_kode, kolom_id) WHERE selesai_at IS NULL

produksi_panen                  -- satu kejadian panen dari satu isian
  id, perusahaan_kode, isian_id → produksi_kolom_isi, kolom_id, bak_id, varian,
  panen_at, tanggal_bisnis date, dimuat int, ke_babonan int, pecah int,
  persen_saat_panen int NULL, operator_akun_id, shift smallint,
  dibatalkan_at NULL, alasan_batal NULL

produksi_muatan
  id, panen_id → produksi_panen, jenis ('armada' | 'pembeli'),
  kendaraan_erp_id text NULL, plat text NOT NULL, agen_id text NULL, agen_nama text NULL,
  jumlah int CHECK (> 0)

produksi_babonan_keluar         -- babonan dibuang/dilebur (yang dimuat lewat produksi_panen)
  id, isian_id → produksi_kolom_isi, at, jumlah, alasan, akun_id

produksi_kendaraan_aktif
  akun_id PK, perusahaan_kode, jenis, kendaraan_erp_id NULL, plat, agen_nama NULL, updated_at

produksi_log                    -- hanya INSERT
  id, perusahaan_kode, at, akun_id, akun_nama, peran ('operator' | 'admin'), shift,
  aksi text, kolom_id NULL, bak_nama, kolom_nomor, rujukan_id NULL,
  sebelum jsonb, sesudah jsonb, alasan NULL
```

- `tanggal_bisnis` disimpan saat panen supaya pencocokan bisa memakai index. Kalau `ROLLOVER_PANEN_JAM` nanti diubah, ada skrip hitung ulang (Claude).
- `sisa` disimpan (bukan dihitung tiap baca) dan selalu diubah di dalam transaksi yang mengunci barisnya. Fungsi uji memastikan `jumlah_awal = sisa + Σ dimuat + Σ ke_babonan + Σ pecah` untuk isian produksi.
- Nama bak dan nomor kolom di-snapshot ke log supaya log tetap terbaca walaupun denah berubah.
- Hak `UPDATE`/`DELETE` atas `produksi_log` tidak dipakai oleh kode aplikasi. Log hanya ditambah.
- Index untuk keperluan: isian aktif per perusahaan, panen per (perusahaan, tanggal_bisnis), dan log per (perusahaan, at desc).

### 12. Kode

- `src/lib/produksi-operasional.ts` (aman untuk klien, fungsi murni + uji `node:test`):
  - `hitungKematangan`, `tahapDari`, `shiftDari`
  - `validasiPanen` (Σ muatan + babonan + pecah = sisa, kendaraan unik), `canKosong(kolom, isianAktif)`, `keadaanRek(isianAktif, maintenance, sekarang)`
  - `tanggalBisnisPanen(t)` (rollover `ROLLOVER_PANEN_JAM`)
  - `peringatanDari(isian, maintenance, panen, sekarang)`
  - `cocokkanMuatan(panenPerKendaraan, doPerKendaraan)`
  - konstanta ambang dan shift
- `src/lib/queries/produksi-operasional.ts`: baca keadaan pabrik (isian aktif + maintenance + denah), tulis aksi dalam transaksi + log, baca log, baca panen.
- `src/lib/queries/produksi-do-erp.ts`: kendaraan, agen, dan DO per kendaraan per hari dari ERP (read-only, satu sumber per pabrik).
- Server actions di `src/app/produksi-operasional-actions.ts` (pola sama dengan `produksi-denah-actions.ts`), dengan gerbang peran di setiap action.
- Komponen di `src/components/produksi-operasional/` (layar HP + tab admin). Overlay peta memakai ulang `denah-penampil.tsx`.

## Yang diserahkan ke builder

- Tata letak visual detail, ikon, dan pustaka ekspor Excel. Pakai yang sudah ada di repo.
- Sumber DO PMPakis (`utama` vs `logistik` 011). Pastikan lewat data, lalu dokumentasikan.
- Verifikasi `Status` pemesanan yang relevan (lihat bagian 4).
- Apakah modul Penjualan Es Balok yang live ikut menjumlahkan `utama` + `logistik` untuk kuantitas. **Ini temuan terpisah, laporkan saja, jangan diperbaiki di pekerjaan ini.**
