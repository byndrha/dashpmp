# Modul Keuangan PT Putra Maesa Persada (pmpersada) — Design Spec

## Latar Belakang

PT Prima Maesa Putra (pmputra) sudah punya modul Keuangan yang lengkap dan live (P&L, BEP, Balance Sheet, Cash Flow, Cash Flow Harian, HPP Bersih, Detail COA/Anggaran), dibaca langsung dari dua database ERP milik klien (FINAC_ES_PO/"utama", FINAC_LOGISTIC_PO/"logistik") lewat kredensial yang dikelola di Postgres (`perusahaan_koneksi`, lihat `docs/superpowers/specs/2026-07-30-perusahaan-db-koneksi-design.md`).

Pekerjaan ini membangun modul yang sama untuk PT baru: **PT Putra Maesa Persada** (kode `pmpersada`, bisnis Es Balok), dengan dua database ERP-nya sendiri: **utama = `FINAC_ES_TB`**, **logistik = `FINAC_PMP_LOGISTIC`** — di server yang sama dan kredensial yang sama dengan pmputra (host `pmp-db.mixtra.co.id:49232`, user `pmp`).

**Sudah diverifikasi langsung ke database live (read-only, sebelum spec ini ditulis):**
- Kedua database bisa dikoneksikan dengan kredensial pmputra, berisi data GL real: utama 307.649 baris jurnal sejak Des 2017, logistik 495.469 baris sejak Des 2016.
- Skema tabel (`GeneralLedger`, `ChartOfAccount` — kolom `Description` bukan `AccountName`, ada `IsDeleted`/`IsChildest`/`ParentID`) **identik** dengan skema pmputra — query SQL yang sudah ada bisa dipakai ulang strukturnya, hanya beda data.
- Tabel `PMP_Pemesanan` (sumber "kantong terjual" untuk HPP Bersih pmputra, kolom `BalokKecilRealisasi`/`BalokBesarRealisasi`/`Status`/`IsVoid`/`IsDeleted`) **sudah ada** di kedua database pmpersada dengan kolom yang sama persis — mekanisme HPP Bersih pmputra bisa dipakai ulang tanpa gap.
- Kolom `CostBehavior` pada `ChartOfAccount` (dipakai fitur BEP pmputra, tipe `VARCHAR(16) NULL`) **tidak ada** di kedua database pmpersada — perlu ditambahkan (lihat bagian DDL).
- Chart of Account pmpersada punya nomor & nama akun **berbeda** dari pmputra — klasifikasi kategori P&L (`BiayaTetap`/`Adjustment`) dan daftar akun HPP Bersih sudah diturunkan dari data real dan dikonfirmasi user (lihat bagian Klasifikasi Akun).

## Cakupan

Meniru struktur pmputra persis: route tree `/pmpersada` dengan shell 9-modul (Keuangan live, 8 lainnya placeholder "Belum ada data"), guard `requirePmpersada()`, dan seluruh query layer Keuangan (P&L, BEP, Balance Sheet, Cash Flow, Cash Flow Harian, HPP Bersih, Detail COA + Anggaran + Cost Behavior).

**Di luar cakupan:**
- 8 modul non-Keuangan tetap placeholder, sama seperti pmputra sampai sekarang — bukan diintegrasikan sungguhan.
- Pembuatan akun login dengan `accountScope='pmpersada'` — langkah manual lewat `/grup/akun` setelah setup PT ini selesai (PT-nya otomatis muncul di dropdown begitu Task 1 selesai).
- Pengisian klasifikasi `CostBehavior` per akun (FIXED/VARIABLE/MIXED) — kolom baru dibuat kosong, diisi manual lewat `CostBehaviorEditor` yang sudah ada, sama seperti workflow pmputra pertama kali.

## Setup Perusahaan (Task 1 — controller-run, sebelum kode apa pun)

**Tidak ada UI apa pun di aplikasi ini untuk membuat baris `perusahaan` Postgres baru** (diverifikasi: satu-satunya penulis tabel ini adalah migrasi one-off; `/grup/perusahaan` hanya mengelola `perusahaan_koneksi` untuk `perusahaan_id` yang sudah ada). Karena itu setup PT baru ini wajib lewat skrip one-off, controller-run, mirip `scripts/migrate-produksi-app.ts`:

1. `INSERT INTO perusahaan (kode, nama, jenis_bisnis) VALUES ('pmpersada', 'PT Putra Maesa Persada', 'Es Balok')`.
2. Dua baris `perusahaan_koneksi` untuk `perusahaan_id` yang baru: `label='utama'` → `db_name='FINAC_ES_TB'`, `label='logistik'` → `db_name='FINAC_PMP_LOGISTIC'` — `host`/`port`/`db_user`/`db_password_encrypted` **disalin langsung** (query SQL, bukan hardcode di skrip) dari baris `perusahaan_koneksi` pmputra yang sudah ada (`host='pmp-db.mixtra.co.id'`, `port=49232`, `db_user='pmp'`) — kredensial terenkripsi disalin apa adanya, tidak pernah didekripsi/dicetak.
3. Panggil `createPerusahaan()` (fungsi MSSQL yang sudah ada, `src/lib/queries/perusahaan.ts`) untuk mendaftarkan baris `DashboardPerusahaan` registry: `Nama='PT Putra Maesa Persada'`, `JenisBisnis='Es Balok'`, `Status='AktifPenuh'`, `Kode='pmpersada'` — supaya otomatis muncul di PT Switcher dan halaman admin `/grup/perusahaan`, dan supaya `listPerusahaanDirektori()` (dipakai form Akun) menampilkan pmpersada sebagai pilihan.

## DDL ERP Live (Task 2 — controller-run, dua database milik klien)

Sama persis dengan definisi kolom `CostBehavior` yang sudah diverifikasi ada di database pmputra (`VARCHAR(16) NULL`, tanpa default):

```sql
ALTER TABLE ChartOfAccount ADD CostBehavior VARCHAR(16) NULL;
```

Dijalankan di **kedua** database pmpersada (FINAC_ES_TB dan FINAC_PMP_LOGISTIC) — ini mengubah skema database ERP produksi milik klien, bukan database aplikasi kita sendiri, jadi hanya kolom baru nullable tanpa efek samping ke data/aplikasi ERP klien yang sudah ada.

## Refactor db-pmputra.ts → db-company.ts (Task 3)

`db-pmputra.ts` (± 30 baris, murni boilerplate buka-koneksi via `resolveKoneksi`, tanpa logika bisnis) diganti dengan `src/lib/db-company.ts` yang mengekspor `getCompanyPool(kode: string, label: string): Promise<sql.ConnectionPool>` — sama persis isinya, cuma `kode` jadi parameter alih-alih konstanta `"pmputra"` yang di-hardcode, dan cache pool (`global._pmputraPools`) jadi `Map<string, Promise<ConnectionPool>>` dengan key `` `${kode}:${label}` `` supaya pool pmputra dan pmpersada tidak saling menimpa.

6 file query pmputra yang sebelumnya `import { getPmputraPool } from "@/lib/db-pmputra"` lalu memanggil `getPmputraPool(label)` diubah jadi `import { getCompanyPool } from "@/lib/db-company"` lalu `getCompanyPool("pmputra", label)` — **satu-satunya perubahan** ke kode pmputra yang sudah production, murni penggantian pemanggilan fungsi tanpa mengubah query SQL atau logika bisnis apa pun.

## Klasifikasi Akun P&L & BEP (dikonfirmasi user)

Mengikuti pola `pmputraKategoriCase()` (satu fungsi per label, karena kedua database punya set akun berbeda — TIDAK boleh disatukan jadi satu CASE string):

**Utama (FINAC_ES_TB):**
- `BiayaTetap` = Gaji (6101.01), BPJS Kesehatan (6101.03), BPJS Ketenagakerjaan (6101.04), Sewa (6103)
- `Adjustment` = Beban Pajak Lainnya (6605)

**Logistik (FINAC_PMP_LOGISTIC):**
- `BiayaTetap` = Gaji (6101.01), Sewa (6103) — tanpa BPJS, akun itu tidak ada di logistik
- `Adjustment` = Beban Pajak Lainnya (6605)

Akun pajak lain (PPh 21/23/29/4(2) — 6601-6604, Beban Pajak Penghasilan — 6606, Beban Pajak PBB — 6607) masuk `BebanOperasional` biasa lewat fallback prefix-6 default, bukan `Adjustment` — sama seperti pola pmputra yang hanya menandai SATU akun "Lainnya" per database sebagai Adjustment, bukan seluruh grup Beban Pajak.

Prefix lain sama seperti pmputra: `4`→Pendapatan, `5`→HPP (di pmpersada akun 5000-5003 memang berisi data, tidak seperti pmputra yang HPP-nya selalu 0 — jadi `LabaKotor` PMPersada bisa `< Pendapatan`, ini yang benar, bukan bug), `6`→BebanOperasional (fallback), `7`→PenghasilanLainnya, `8`→BebanLainnya.

## Akun HPP Bersih (dikonfirmasi user)

Mengikuti struktur `HPP_BERSIH_ACCOUNTS` pmputra (label + accountNo + displayName):

**Utama:** Listrik (6105), Garam (6114), Air (6115), Sewa (6103), Oli (6116) — 5 akun (pmpersada tidak punya akun Amoniak terpisah seperti pmputra).

**Logistik:** BBM Es (6122.01), Sparepart (6115), Oli (6121), Vulkanisir (6114), Pembelian Ban (6119), Sewa (6103) — 6 akun.

`totalKantongPenjualan` dihitung dari `PMP_Pemesanan` di database **utama** saja (`SUM(BalokKecilRealisasi + BalokBesarRealisasi) WHERE Status='3' AND IsVoid=0 AND IsDeleted=0`) — sama persis query pmputra (`getMonthlyBalokRealisasi`), karena skema `PMP_Pemesanan` identik.

## Arsitektur Route & Guard

- `AccountScope` (3 file: `next-auth.d.ts`, `auth.config.ts`, `auth.ts`) dan `PtSwitcherLocation` (`pt-switcher.tsx`) dapat member baru `"pmpersada"`.
- `PT_ROUTES` dapat entri `pmpersada: "/pmpersada"`.
- `middleware.ts` dapat cabang baru setelah cabang `pmputra` yang sudah ada: `if (scope === "pmpersada" && !path.startsWith("/pmpersada")) return NextResponse.redirect(new URL("/pmpersada", req.nextUrl));`
- `requirePmpersada()` baru di `require-access.ts`, identik `requirePmputra()`: redirect `/login` jika tidak ada sesi, redirect `/akses-ditolak` jika `accountScope !== "pmpersada"` dan bukan `canAccessAllPT`.
- Route tree `src/app/pmpersada/`: `layout.tsx` (pakai `requirePmpersada`, render `PmpersadaSidebar`, header "PT Putra Maesa Persada"), `page.tsx` (beranda placeholder sama pola pmputra), `keuangan/page.tsx` + `keuangan/actions.ts` (struktur identik pmputra, sumber data ganti ke fungsi `-pmpersada`), `[modul]/page.tsx` (placeholder sama persis, pakai `PMPERSADA_MODULES`).
- `src/lib/pmpersada-modules.ts` baru, isi sama persis 9 modul pmputra (`keuangan`, `piutang`, `penjualan`, `transaksi`, `listrik`, `pengiriman`, `pemesanan`, `mitra`, `pemasaran`).
- `src/components/dashboard/pmpersada-sidebar.tsx` baru, meniru `pmputra-sidebar.tsx` persis (ganti nama PT jadi "PT Putra Maesa Persada", badge "Es Balok", `PT_ROUTES`/`PMPERSADA_MODULES`/`current="pmpersada"`). pmputra-sidebar.tsx punya baris kecil "Ponorogo" (kota) di bawah nama PT — kota/wilayah PMPersada belum diketahui, jadi baris itu **dihilangkan** (bukan diisi placeholder) untuk sidebar PMPersada; bisa ditambahkan belakangan kalau infonya ada.

## Query Layer Baru (6 file, meniru struktur pmputra)

`pnl-pmpersada.ts`, `balance-sheet-pmpersada.ts`, `cash-flow-pmpersada.ts`, `cash-flow-harian-pmpersada.ts`, `hpp-bersih-pmpersada.ts`, `keuangan-detail-pmpersada.ts` — SQL dan struktur fungsi identik dengan versi `-pmputra`, hanya: (1) `getCompanyPool("pmpersada", label)` bukan `getCompanyPool("pmputra", label)`, (2) `pmpersadaKategoriCase()` dengan mapping akun di atas, (3) `HPP_BERSIH_ACCOUNTS` dengan daftar akun di atas. Cash Flow (`TYPE_LABEL` mapping di `cash-flow.ts` dasar, dipakai bersama) tidak perlu diubah — nilai `GeneralLedger.Type` (VOUCHER/PMP_PEMESANAN/PEMBAYARAN/dst) berasal dari sistem PMP_* yang sama, sudah diverifikasi ada di kedua PT.

## Testing

Tidak ada test runner di proyek ini. Verifikasi: `npx tsc --noEmit`, `npx eslint`, dan live check — akun dengan `accountScope='pmpersada'` (setelah dibuat manual pasca-Task 1) mendarat di `/pmpersada`, sidebar menampilkan 9 modul dengan Keuangan menunjukkan angka real dari FINAC_ES_TB/FINAC_PMP_LOGISTIC, 8 modul lain menampilkan placeholder. Superadmin/direktur bisa switch PT ke PMPersada lewat PTSwitcher. Pastikan `requirePmputra()`/halaman Keuangan pmputra masih berfungsi identik setelah refactor `db-company.ts` (regresi check, bukan fitur baru).
