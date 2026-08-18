# Aplikasi Pemasaran /mkesindo/pemasaran-app — Design Spec

## Latar Belakang

Modul desktop `/mkesindo/pemasaran` sudah lengkap secara fungsional (Kinerja Marketing, Log Kunjungan, Pengiriman per Wilayah, Pengajuan Mitra Baru, peta posisi live) tapi UI/UX-nya tidak cocok dipakai marketing di lapangan lewat HP. Solusinya: aplikasi eksklusif `/mkesindo/pemasaran-app`, mengikuti pola app-shell mobile yang sudah ada untuk role lain (driver-app, satpam-app, produksi-app) — bukan perbaikan terpisah di sisi desktop.

Ini adalah kelanjutan langsung dari `docs/superpowers/specs/2026-07-22-modul-pemasaran-design.md`, yang eksplisit menyebut app native ini sebagai "Sub-proyek 2 (nanti, spec terpisah)".

**Sudah diverifikasi lewat eksplorasi kode langsung sebelum spec ini ditulis:** hampir seluruh data yang dibutuhkan mockup (5 gambar Figma, disediakan user) sudah punya query/action yang identik atau sangat dekat di kode yang ada — lihat bagian Pemetaan Layar di bawah. Pekerjaan baru yang sesungguhnya kecil: shell aplikasi + navigasi, dua query baru, dan satu guard baru.

## Cakupan

- Aplikasi mobile penuh `/mkesindo/pemasaran-app`: 3 tab bottom-nav (Beranda, Mitra, Pemasaran — tab Pemasaran punya 4 sub-tab: Kinerja Marketing, Log Kunjungan, Pengiriman, Pengajuan) + layar Profil (Pengaturan Akun, Ubah Password) diakses dari header.
- Redirect login: akun ber-role Marketing (bukan Super Admin) diarahkan ke `/mkesindo/pemasaran-app`, bukan lagi `/mkesindo/pemasaran`.
- Satu spec+plan menyeluruh, dieksekusi sekaligus (bukan bertahap per tab) — keputusan eksplisit user.

**Di luar cakupan:**
- Modul desktop `/mkesindo/pemasaran` tidak diubah sama sekali — tetap seperti sekarang, tetap bisa diakses oleh Supervisor/Accounting/Manager/Super Admin.
- Tidak ada perubahan skema untuk "Jenis Usaha" (tetap otomatis dari qty) maupun "Harga/Kantong" (tetap lewat PriceLevel, bukan Rupiah bebas) — keputusan eksplisit user, form mobile mengikuti perilaku yang sudah ada, bukan menambah field baru.
- Peta Wilayah (statistik agregat per wilayah dari tab Mitra di mockup) memakai data yang sama dengan Pengiriman (`getPemasaranWilayahDelivery`) plus hitungan jumlah mitra per wilayah dari `getMitraList`/`getMarketingPerformance` — tidak perlu query baru, cukup komposisi dari yang sudah ada.

## Arsitektur

### Routing & Guard

- `src/app/mkesindo/pemasaran-app/(tabs)/` — pola identik `driver-app`/`produksi-app`: layout dengan bottom nav, tiga folder tab (`page.tsx` = Beranda, `mitra/`, `pemasaran/`), dipisah dari layar penuh non-tab (`profil/`, `profil/akun/`, `profil/password/`) yang hidup di `src/app/mkesindo/pemasaran-app/` langsung (di luar `(tabs)`), sama seperti driver-app.
- `requireMarketing()` baru di `src/lib/require-access.ts`, pola identik `requireDriver()`/`requireSatpam()`:
  ```ts
  export async function requireMarketing() {
    const session = await auth();
    if (!session?.user) redirect("/login");
    if (!session.user.isSuperAdmin && session.user.roleId !== MARKETING_ROLE_ID) redirect("/akses-ditolak");
    return session;
  }
  ```
- `src/app/mkesindo/(dashboard)/layout.tsx:52-53` — ubah target redirect dari `/mkesindo/pemasaran` ke `/mkesindo/pemasaran-app`:
  ```ts
  if (!session?.user?.isSuperAdmin && session?.user?.roleId === MARKETING_ROLE_ID && !pathname.startsWith("/mkesindo/pemasaran-app")) {
    redirect("/mkesindo/pemasaran-app");
  }
  ```
  Catatan: prefix check `/mkesindo/pemasaran-app` TIDAK boleh salah cocok dengan `/mkesindo/pemasaran` (modul desktop) — keduanya beda path, `startsWith` aman karena `/mkesindo/pemasaran-app` bukan prefix dari `/mkesindo/pemasaran` maupun sebaliknya.

### Identitas "mitra dalam cakupan marketing ini"

Dipakai berulang di banyak tab (Mitra, Log Kunjungan, Beranda) — bukan konsep baru, sudah ada persis di `marketing-wilayah.ts`/`marketing-performance.ts`: gabungan dari (a) `DashboardMarketingMitra` (override prioritas per-mitra) dan (b) `DashboardMarketingWilayah` (cakupan Wilayah/Kecamatan), diresolusi lewat `resolveResponsibleMarketing()`. Setiap query baru di bawah reuse fungsi resolusi ini, tidak menulis ulang logikanya.

## Pemetaan Layar → Data

| Layar (mockup) | Sumber data | Status |
|---|---|---|
| Kinerja Marketing | `getMarketingPerformance()` — filter `cells`/`mitraDailyQty`/`allMitraByMarketing` ke `session.user.id` | Reuse langsung |
| Log Kunjungan | **Baru** (lihat di bawah) + `getMarketingVisitLogForDate`/`saveMarketingVisitLog` (sudah ada) untuk detail per mitra | Reuse + 1 fungsi baru |
| Pengiriman (rate per wilayah) | `getPemasaranWilayahDelivery()` | Reuse langsung |
| Pengajuan (daftar) | `getPengajuanList()` — filter ke `MarketingUserID === session.user.id` (pola sama seperti desktop `isPlainMarketing`) | Reuse langsung |
| Pengajuan Mitra Baru (form) | `createPengajuan()` — field mengikuti `PengajuanInput` apa adanya, TANPA field Jenis Usaha eksplisit, Harga/Kantong jadi dropdown Price Level (`getPriceLevelOptions()`) | Reuse langsung |
| Mitra (daftar + peta) | `getMitraList(): Promise<MitraRow[]>` (`src/lib/queries/mitra.ts`) — filter ke mitra dalam cakupan marketing ini | Reuse, difilter |
| Mitra (detail) | `getMitraDetailAction()` | Reuse langsung |
| Edit Mitra | `updateMitraAction()` — form field sama seperti `MitraInput`, Harga/Kantong jadi dropdown Price Level | Reuse langsung |
| Peta Wilayah (statistik per wilayah) | `getPemasaranWilayahDelivery()` + jumlah mitra per wilayah (turunan dari daftar Mitra yang sudah difilter) | Komposisi dari yang sudah ada |
| Beranda: Ringkasan Utama + Perbandingan Penjualan | **Baru** (lihat di bawah) | 1 fungsi baru |
| Beranda: Detail Piutang / Top 10 Mitra + Catatan | `getTopMitraPiutang()` + `setMitraNoteAction()` — filter baris ke mitra dalam cakupan marketing ini | Reuse, difilter |
| Profil: Pengaturan Akun, Ubah Password | Pola `account-settings-dialog.tsx` yang sudah dipakai di tempat lain, dipecah jadi 2 layar penuh alih-alih dialog | Reuse pola, UI baru |

## Query Baru

### 1. Log Kunjungan — status harian semua mitra dalam cakupan

```ts
export interface VisitLogStatusRow {
  BusinessPartnerID: string;
  Name: string;
  Wilayah: string;
  Kecamatan: string | null;
  HasilKunjungan: string | null; // null = belum diisi hari ini
}

export async function getVisitLogStatusForMarketing(
  marketingUserId: string,
  dateISO: string
): Promise<VisitLogStatusRow[]>
```

Ambil roster mitra dalam cakupan (sama seperti `allMitraByMarketing` di `marketing-performance.ts` — reuse fungsi resolusinya, bukan query terpisah untuk "cakupan"), lalu `LEFT JOIN DashboardMarketingVisitLog` pada `(BusinessPartnerID, LogDate = @dateISO)`. Baris tanpa match di log = belum diisi (`HasilKunjungan: null`).

### 2. Beranda — ringkasan penjualan ter-scope marketing

```ts
export async function getSalesDayComparisonForMarketing(
  marketingUserId: string
): Promise<SalesDayComparisonResult> // tipe sama persis dengan sales-overview.ts
```

Mirror `getSalesDayComparison()` (`sales-overview.ts`) persis strukturnya (label Kemarin/Pekan Lalu/Bulan Lalu/Tahun Lalu, `current`/`previous` NetSales+DOQty, pct change, breakdown per jam) — **satu-satunya beda**: tambahkan filter `WHERE do_.BusinessPartnerID IN (<mitra dalam cakupan marketing ini>)` pada setiap query di dalamnya. Reuse tipe `SalesDayComparisonResult`/`SalesDayComparison`/`SalesDayPoint`/`HourlyPoint` dari `sales-overview.ts` apa adanya (`export type`), jangan didefinisikan ulang.

"Ringkasan Utama" (Kantong Terkirim hari ini, Penjualan hari ini) di mockup adalah subset dari hasil fungsi ini (`comparisons[0].current`, yaitu titik "Hari Ini") — tidak perlu fungsi terpisah.

## Server Actions

`src/app/mkesindo/pemasaran-app/actions.ts` — satu file, pola sama seperti `driver-app/actions.ts`/`produksi-app` punya: setiap fungsi memanggil `requireMarketing()` dulu, lalu memanggil query/action yang sudah ada (dari bagian Pemetaan Layar di atas), auto-menyisipkan `session.user.id` sebagai `marketingUserId`/filter — pemanggil di client tidak pernah mengirim `marketingUserId` sendiri (mencegah satu marketing melihat/mengubah data marketing lain lewat manipulasi request).

Untuk aksi yang sudah punya fungsi desktop (`updateMitraAction`, `setMitraNoteAction`, dst.) — **reuse fungsi actions yang sudah ada langsung**, tidak dibungkus ulang, KECUALI perlu memfilter/menyisipkan `marketingUserId` (Pengajuan, Log Kunjungan) atau ganti guard (`requireMarketing()` bukan `requireModuleAccess("pemasaran")`).

## Halaman & Navigasi

- Bottom nav 3 item: Beranda (`/mkesindo/pemasaran-app`), Mitra (`/mkesindo/pemasaran-app/mitra`), Pemasaran (`/mkesindo/pemasaran-app/pemasaran`) — ikon dan pola visual mengikuti driver-app/produksi-app punya (icon aktif berwarna primary, non-aktif muted).
- Tab Pemasaran sendiri punya 4 sub-tab horizontal di dalam halamannya (Kinerja Marketing, Log Kunjungan, Pengiriman, Pengajuan) — bukan route terpisah, state lokal (client component), sesuai mockup yang menampilkan keempatnya sebagai tab dalam satu header "Pemasaran".
- Header konsisten di semua layar: logo "Dashboard PMP Group" + notifikasi + avatar (nama akun) — pola sama seperti driver-app/produksi-app.
- Profil diakses lewat avatar di header (bukan tab bottom-nav ke-5) — 3 layar bertingkat: Profil (ringkasan + link) → Pengaturan Akun / Ubah Password.

## Testing

Tidak ada test runner di proyek ini. Verifikasi: `npx tsc --noEmit`, `npx eslint`, live check di browser — login sebagai akun Marketing (role Marketing, bukan superadmin) harus mendarat langsung di `/mkesindo/pemasaran-app`; setiap tab menampilkan data nyata yang match dengan yang tampil di modul desktop `/mkesindo/pemasaran` untuk marketing yang sama (cross-check angka); submit Pengajuan Mitra Baru dan Edit Mitra dari mobile harus muncul benar di desktop; Log Kunjungan yang diisi dari mobile harus tersimpan dan terbaca ulang; pastikan modul desktop `/mkesindo/pemasaran` dan redirect role lain (Driver/Satpam/Produksi) tidak berubah (regresi check).
