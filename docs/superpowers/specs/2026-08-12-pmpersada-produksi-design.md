# Modul Produksi PMPersada (Pelacakan Pembekuan Es) — Design Spec

## Ringkasan

PMPersada (pabrik es Tuban) belum punya sistem pencatatan digital untuk proses pembekuan es sama sekali. Sebagai referensi awal, user menyediakan draf frontend + backend (`pmp-tuban.html` + `pmp-tuban.gs`) yang dibuat dengan Gemini AI berbasis Google Apps Script + Google Sheets — draf ini mendefinisikan domain bisnisnya (Bak/Rek/Ice Can, tahap pembekuan otomatis berbasis waktu, role Operator vs Admin) tapi tidak dipakai langsung sebagai kode; modul ini dibangun ulang penuh di dalam aplikasi Next.js ini, mengikuti pola-pola yang sudah mapan di codebase (khususnya modul Produksi MKEsindo).

Modul ini beda konsep dari `/mkesindo/produksi`: MKEsindo melacak pallet es balok yang **sudah jadi** di cold storage (warehouse), sedangkan modul ini melacak **proses pembekuan itu sendiri** — dari air baru dituang sampai es matang siap panen.

Dua permukaan baru:
- **Dashboard desktop** `/pmpersada/produksi` — untuk Admin (akun PMPersada yang sudah ada, level Direktur/pengelola company), tab baru di sidebar yang sudah ada.
- **App mobile** `/pmpersada/produksi-app` — untuk 9 operator shift lantai produksi (Adam, Lasudji, Aris, Duraji, Toha, Bisri, Warjono, Bahar, Kohadi), shell ringan mirip `produksi-app`/`satpam-app` MKEsindo.

Sistem baru ini diluncurkan dengan 250 Rek diseed kosong — operator mengisi kondisi nyata masing-masing Rek secara bertahap lewat aksi normal begitu sistem live (bukan lewat entri massal Hari-1).

## Denah fisik & spesifikasi (dikonfirmasi user, dari draf)

| Bak | Jumlah Rek |
|---|---|
| Bak 1 | 37 |
| Bak 2 | 37 |
| Bak 3 | 44 |
| Bak 4 | 66 |
| Bak 5 | 66 |
| **Total** | **250** |

- **Jenis Es**: `BK` (36 Can/Rek) atau `BB` (18 Can/Rek) — properti tiap siklus pengisian (batch), bisa beda-beda antar siklus di Rek yang sama.
- **Durasi beku standar** (dapat diubah Admin, tersimpan permanen): BK = 24 jam, BB = 32 jam.
- **Catatan istilah**: `BB` (jenis es, 18 can) dan status **Babonan** ("penjaga suhu") adalah dua konsep independen yang kebetulan mirip namanya — dikonfirmasi user memang begitu istilah aslinya di lapangan. Satu Rek bisa saja berjenis `BK` (36 can) tapi statusnya Babonan.

## Model Akses

### Akun operator (baru)

9 operator dibuatkan akun Postgres nyata (`akun` + `peran`), `perusahaan_id` = PMPersada, dengan peran baru ber-flag `is_produksi = true` — memakai ulang kolom `is_produksi` yang sudah ada (aman dipakai ulang karena `peran` sudah di-scope per `perusahaan_id`; peran PMPersada dengan `is_produksi=true` sama sekali terpisah dari peran MKEsindo dengan flag yang sama). Password wajar ditentukan Admin lewat halaman Akun yang sudah ada — bukan "password = nama" seperti draf.

### Guard baru: `requirePmpersadaProduksi()`

Di `src/lib/require-access.ts`, mengikuti pola persis `requireProduksi()`/`requireSatpam()` yang sudah ada:

```ts
export async function requirePmpersadaProduksi() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.isProduksi || session.user.accountScope !== "pmpersada") redirect("/akses-ditolak");
  return session;
}
```

Dipakai khusus untuk gerbang `/pmpersada/produksi-app` (mobile).

### Celah yang ditutup: `requirePmpersada()` vs data finansial

`requirePmpersada()` (gerbang company-wide yang sudah ada, dipakai `keuangan` dan semua modul `/pmpersada` lain) hanya cek `accountScope === "pmpersada"` — tidak cek modul. Karena akun operator baru juga otomatis `accountScope === "pmpersada"` (dari `perusahaan_id` yang sama), tanpa perbaikan mereka bisa ikut membuka `/pmpersada/keuangan`. Perbaikan: tambah satu guard baru `requirePmpersadaKeuangan()` (atau cek inline di `keuangan/page.tsx`) yang menolak akun `is_produksi`-only:

```ts
export async function requirePmpersadaKeuangan() {
  const session = await requirePmpersada();
  if (session.user.isProduksi && !canAccessAllPT(session.user)) redirect("/akses-ditolak");
  return session;
}
```

`keuangan/page.tsx` ganti pemanggilan `requirePmpersada()` → `requirePmpersadaKeuangan()`. Modul `/pmpersada/produksi` (dashboard desktop) sendiri tetap pakai `requirePmpersada()` biasa (operator produksi tidak dapat sidebar/akses dashboard desktop sama sekali — mereka hanya lewat app mobile via `requirePmpersadaProduksi()`, jadi tidak relevan di sini).

## Model Data (tabel baru, MSSQL `FINAC_ES_TB`, via `getCompanyPool("pmpersada", "utama")`)

### `DashboardProduksiBak` (master, 5 baris, seed sekali lewat DDL, tidak ada UI edit di v1)

| Kolom | Tipe | Keterangan |
|---|---|---|
| BakID | INT IDENTITY PK | |
| Nama | VARCHAR(20) NOT NULL | 'Bak 1'..'Bak 5' |
| TotalRek | INT NOT NULL | 37/37/44/66/66 |

### `DashboardProduksiRek` (250 baris, seed sekali, semua kosong)

| Kolom | Tipe | Keterangan |
|---|---|---|
| RekID | INT IDENTITY PK | |
| BakID | INT NOT NULL FK → DashboardProduksiBak | |
| NomorRek | INT NOT NULL | 1..TotalRek dalam Bak-nya |
| IsMaintenance | BIT NOT NULL DEFAULT 0 | Rek tidak tersedia (di luar siklus normal) |
| BatchIDAktif | INT NULL | FK → DashboardProduksiBatch.BatchID, NULL = kosong |
| ModifiedDate | DATETIME NOT NULL DEFAULT GETDATE() | |

Mirrors `DashboardProduksiPalletPosisi.BatchIDAktif` MKEsindo persis.

### `DashboardProduksiBatch` (tumbuh terus, satu baris per siklus isi-air-sampai-panen/reset)

| Kolom | Tipe | Keterangan |
|---|---|---|
| BatchID | INT IDENTITY PK | |
| RekID | INT NOT NULL FK → DashboardProduksiRek | |
| JenisEs | VARCHAR(4) NOT NULL | 'BK' \| 'BB' |
| JumlahCan | INT NOT NULL | default 36 (BK) / 18 (BB), bisa dikoreksi Admin |
| IsBabonan | BIT NOT NULL DEFAULT 0 | batch dalam status "penjaga suhu", tidak mengikuti progres waktu |
| WaktuIsi | DATETIME NOT NULL | jam mulai siklus ini |
| EstimasiBeku | DATETIME NOT NULL | WaktuIsi + durasi standar (dari `DashboardProduksiKonfigurasi`) saat batch dibuat |
| DicatatOlehAkunID | INT NOT NULL | akun.id (Postgres) — operator/admin yang mencatat |
| ClosedDate | DATETIME NULL | diisi saat batch ini digantikan siklus baru atau Rek di-Maintenance |
| CreatedDate | DATETIME NOT NULL DEFAULT GETDATE() | |

Batch lama **tidak pernah dihapus/di-overwrite** — riwayat panen jadi query langsung atas tabel ini (pola sama dengan `RiwayatProduksi` MKEsindo).

### `DashboardProduksiAuditLog` (setiap perubahan, bukan cuma koreksi Admin)

| Kolom | Tipe | Keterangan |
|---|---|---|
| LogID | INT IDENTITY PK | |
| RekID | INT NOT NULL FK → DashboardProduksiRek | |
| BatchID | INT NULL FK → DashboardProduksiBatch | NULL untuk aksi yang tidak terkait batch tertentu |
| AksiLabel | NVARCHAR(100) NOT NULL | ringkasan perubahan, mis. "BARU (Isi Air)", "Set Babonan", "Set Maintenance", "Override ke SIAP (Admin)" |
| Keterangan | NVARCHAR(200) NULL | detail tambahan opsional |
| DicatatOlehAkunID | INT NOT NULL | |
| CreatedDate | DATETIME NOT NULL DEFAULT GETDATE() | |

### `DashboardProduksiKonfigurasi` (1 baris singleton)

| Kolom | Tipe | Keterangan |
|---|---|---|
| ID | INT PK | selalu = 1 |
| DurasiBKJam | INT NOT NULL | default 24 |
| DurasiBBJam | INT NOT NULL | default 32 |
| ModifiedDate | DATETIME NOT NULL DEFAULT GETDATE() | |
| ModifiedByAkunID | INT NULL | |

## Logika Bisnis

### Progres otomatis (dihitung server-side, tidak disimpan sebagai kolom terpisah)

Untuk batch aktif non-Babonan:
```
pct = clamp(0, 100, round((now - WaktuIsi) / (EstimasiBeku - WaktuIsi) * 100))
tahap = pct >= 100 ? 'JADI' : pct >= 75 ? 'SIAP' : pct >= 50 ? 'KRISTAL' : pct > 0 ? 'MULAI' : 'BARU'
```
Batch dengan `IsBabonan=1` selalu tampil sebagai status "Babonan", tidak ikut formula di atas. Rek dengan `IsMaintenance=1` selalu tampil "Maintenance", tidak peduli `BatchIDAktif`.

### Aksi "Isi Air Baru" (Operator maupun Admin)

Transaksi atomik: jika `BatchIDAktif` lama ada, set `ClosedDate=GETDATE()`; buat baris `DashboardProduksiBatch` baru (`WaktuIsi=GETDATE()`, `EstimasiBeku` dihitung dari konfigurasi durasi jenis es); update `Rek.BatchIDAktif` ke batch baru; tulis baris `DashboardProduksiAuditLog`. Satu langkah saja (tidak ada konfirmasi jumlah panen terpisah — beda dengan alur Mulai/Selesai Muat MKEsindo yang lebih berat karena berkonsekuensi dokumen keuangan; di sini tidak ada dokumen keuangan yang tersangkut).

### Aksi "Set Babonan" / "Set Maintenance"

- **Babonan**: hanya berlaku pada Rek yang punya `BatchIDAktif` (harus sudah ada siklus berjalan) — set `IsBabonan=1` pada batch aktif tsb. Operator maupun Admin boleh.
- **Maintenance**: set `Rek.IsMaintenance=1`; jika ada `BatchIDAktif`, tutup batch tsb (`ClosedDate=GETDATE()`, `Rek.BatchIDAktif=NULL`) — Rek dianggap kosong & tidak tersedia. Operator maupun Admin boleh. Meng-nonaktifkan Maintenance (Rek tersedia lagi) hanya lewat aksi "Isi Air Baru" berikutnya (otomatis `IsMaintenance=0` saat batch baru dibuat).

### Override manual (Admin saja)

Admin bisa memaksa Rek ke tahap tertentu (MULAI/KRISTAL/SIAP/JADI) atau mengoreksi Jenis Es/Jumlah Can pada batch aktif. Override tahap menghitung mundur `WaktuIsi` palsu (persis logika draf: `targetPct` per tahap — MULAI=0.25, KRISTAL=0.60, SIAP=0.85, JADI=1.00 — lalu `WaktuIsi = now - targetPct * durasiJam`, `EstimasiBeku = WaktuIsi + durasiJam`) supaya progres otomatis konsisten menampilkan tahap yang dipilih. Ditolak (AppError) jika Rek tidak punya `BatchIDAktif` — harus "Isi Air Baru" dulu.

### Matriks izin

| Aksi | Operator | Admin |
|---|---|---|
| Isi Air Baru | ✅ | ✅ |
| Set Babonan | ✅ | ✅ |
| Set Maintenance | ✅ | ✅ |
| Override tahap (MULAI/KRISTAL/SIAP/JADI) | ❌ | ✅ |
| Koreksi Jenis Es / Jumlah Can | ❌ | ✅ |
| Atur Durasi Beku (Konfigurasi) | ❌ | ✅ |

### Peringatan otomatis (bukan "AI")

Aturan sederhana server-side: Rek dengan batch aktif non-Babonan yang usianya melebihi `durasi standar jenisnya + toleransi` (mis. 12 jam, meniru draf) ditampilkan sebagai daftar peringatan di dashboard Overview — dilabeli jujur sebagai "Peringatan", bukan AI.

## Arsitektur Komponen

### Query layer baru

`src/lib/queries/produksi-bak-pmpersada.ts` — semua fungsi pakai `getCompanyPool("pmpersada", "utama")`:
- `getBakList()`, `getRekMap()` (denah + status efektif terhitung)
- `getRiwayatBatch(filter?)` (untuk tab Rekap)
- `getAuditLog(filter?)`
- `getKonfigurasi()`, `updateKonfigurasi(input)` (Admin)
- `isiAirBaru(rekId, jenisEs, jumlahCan, akunId)`
- `setBabonan(rekId, akunId)`, `setMaintenance(rekId, akunId)`
- `overrideTahap(rekId, tahap, akunId)` (Admin)
- `koreksiBatch(rekId, jenisEs, jumlahCan, akunId)` (Admin)

### Dashboard Desktop — `/pmpersada/produksi`

Entry baru di `PMPERSADA_MODULES` (`src/lib/pmpersada-modules.ts`) + `PmpersadaSidebar`. Gerbang `requirePmpersada()`. 3 tab:

1. **Overview** — kartu statistik, progress bar per Bak, panel Peringatan. Auto-refresh polling (mis. 30 detik, `setInterval` + refetch — pola client polling sederhana, tidak perlu SSE/websocket).
2. **Denah Bak 1-5** — grid visual Rek per-Bak (tab pemilih Bak), klik Rek → panel/dialog detail berisi info lengkap + form aksi (role Admin penuh). Toggle ke mode tabel (semua Rek, kolom lengkap, pencarian teks).
3. **Rekap & Log Audit** — ringkasan panen per Bak dari `DashboardProduksiBatch`, breakdown per tahap, tabel `DashboardProduksiAuditLog` lengkap, tombol ekspor Excel (pola export yang sudah dipakai di modul lain di codebase ini).

### App Mobile — `/pmpersada/produksi-app`

Shell tab-bawah baru di `src/components/produksi-pmpersada-app/` (nama folder analog `produksi-app` MKEsindo tapi terpisah, karena domain & aksi berbeda total). Gerbang `requirePmpersadaProduksi()`. 3 tab:
1. **Denah** — grid Rek per-Bak (bisa switch Bak), klik Rek → aksi terbatas (Isi Air Baru / Babonan / Maintenance saja, tanpa override tahap/jenis/can).
2. **Riwayat** — `VerticalTimeline` aktivitas milik operator yang login (komponen bersama yang sudah ada, `src/components/ui/vertical-timeline.tsx`).
3. **Profil** — logout, pola `ProfilView` MKEsindo.

## Error Handling & Edge Case

- Race condition 2 device menekan "Isi Air Baru" di Rek sama bersamaan → transaksi atomik dengan claim UPDATE (pola yang sudah dipakai konsisten di seluruh codebase ini, mis. `createBatch`/`produksiMulaiMuat` MKEsindo).
- Override tahap/Babonan pada Rek tanpa `BatchIDAktif` → `AppError` "Rek ini kosong, isi air baru dulu."
- Set Maintenance pada Rek yang sedang Babonan → tetap diizinkan (Babonan bukan penghalang, Maintenance selalu menutup batch aktif apa pun statusnya).
- Ekspor Excel & pencarian tabel — pola sama persis dengan fitur setara yang sudah ada di codebase ini (mis. `exportAuditLog`-style client-side blob generation).
- DDL migrasi (5 tabel baru) idempotent (check-then-create), dijalankan controller-run sekali, seed 5 Bak + 250 Rek kosong sekaligus.

## Testing / Verifikasi

Tidak ada test runner di proyek ini (pola yang sudah mapan). Verifikasi: `npx tsc --noEmit` + `npx eslint` pada file yang berubah, lalu live click-through:
- Login sebagai akun operator baru (`is_produksi=true`, `accountScope=pmpersada`) → hanya bisa buka `/pmpersada/produksi-app`, ditolak di `/pmpersada/keuangan` dan modul finansial lain.
- Login sebagai akun PMPersada existing (Direktur) → dashboard desktop `/pmpersada/produksi` tampil di sidebar, 3 tab berfungsi, form override Admin berfungsi.
- Mobile: Isi Air Baru pada Rek kosong → langsung berubah warna/tahap "Baru" di grid, tanpa reload.
- Progres otomatis: batch yang di-override Admin ke tahap tertentu menampilkan tahap yang benar sesuai formula, dan terus maju otomatis seiring waktu (verifikasi lewat 2 pengecekan berjarak beberapa menit, atau override durasi ke nilai sangat kecil untuk uji cepat).
- Ekspor Excel dari tab Rekap & Log Audit menghasilkan file `.xls` yang bisa dibuka.
