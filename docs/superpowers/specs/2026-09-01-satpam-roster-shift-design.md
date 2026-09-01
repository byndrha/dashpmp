# Roster Shift Satpam (MKEsindo) — Design Spec

## Latar belakang

`/mkesindo/satpam-app` saat ini hanya punya 2 layar (Beranda + layar Inspeksi full-screen) dan sama sekali tidak punya konsep jadwal jaga/shift untuk Satpam — satu-satunya "shift" yang ada di codebase ini (`src/lib/report-shift.ts`) adalah periode pelaporan (07:00/14-15:00/23:00 rollover), tidak terkait siapa sedang piket.

Ini adalah sub-proyek pertama dari rencana perluasan `satpam-app` yang lebih besar (tab Patroli, tab Tamu, dll — lihat percakapan brainstorming) yang sudah dipecah menjadi beberapa sub-proyek independen. Sub-proyek ini secara spesifik membangun **fondasi jadwal jaga Satpam**: model data roster + UI admin untuk mengisinya + fungsi "siapa sedang bertugas sekarang". Sub-proyek berikutnya (tab-shell satpam-app, Patroli, Tamu) akan MEMAKAI fondasi ini, tapi pemasangannya ke UI satpam-app sendiri di luar cakupan sub-proyek ini.

Jadwal kerja Satpam MKEsindo berbeda dari sistem shift lain di aplikasi ini:
- **Shift 1**: 06:00–13:59 WIB
- **Shift 2**: 14:00–21:59 WIB
- **Shift 3**: 22:00–05:59 WIB (lewat tengah malam)
- **Long Shift Malam**: 18:00–05:59 WIB (lewat tengah malam) — dipakai sebagai pengganti Shift 2 (paruh akhir) + Shift 3 saat kekurangan personel
- **Long Shift Pagi**: 06:00–17:59 WIB — dipakai sebagai pengganti Shift 1 + Shift 2 (paruh awal)

Saat Long Shift dipakai, ia MENGGANTIKAN slot shift reguler yang tumpang tindih dengan jendelanya (bukan tambahan di atas shift reguler yang sudah ada) — keputusan ini dikonfirmasi eksplisit selama brainstorming. Karena itu, dua satpam bertugas bersamaan hanya terjadi secara alami di titik pergantian antar hari/shift, bukan sebagai pola yang sengaja divalidasi/dicegah sistem.

## Tujuan

1. Tabel data untuk menyimpan penugasan shift Satpam per tanggal (siapa piket shift apa, tanggal berapa).
2. Fungsi murni untuk menghitung jendela waktu aktual (mulai–selesai) dari sebuah (tanggal, tipe shift), dan untuk menentukan siapa saja yang sedang bertugas pada suatu waktu.
3. Halaman admin `/mkesindo/keamanan` (desktop dashboard) untuk Supervisor ke atas mengisi/menghapus jadwal ini.
4. Query + Server Action siap pakai (`getSatpamOnDutyNowAction`) yang bisa dipanggil oleh sub-proyek berikutnya (tab-shell satpam-app, Patroli, Tamu) tanpa perlu tahu detail internal tabel/perhitungan jendela waktu.

## Non-tujuan

- **Tidak** memasang tampilan "siapa sedang piket" ke satpam-app manapun (Beranda, tab Patroli, tab Tamu) — itu pekerjaan sub-proyek berikutnya yang MEMAKAI fondasi ini.
- **Tidak** membangun tab-shell satpam-app (Inspeksi/Patroli/Tamu) — sub-proyek terpisah.
- **Tidak** mengubah alur Inspeksi yang sudah ada, termasuk tipe inspeksi "Armada Distribusi [Es Balok]" yang baru — sub-proyek terpisah.
- **Tidak** membangun validasi/pencegahan "tabrakan" jadwal (dua orang di slot yang sama) sebagai hard block — UI hanya memberi peringatan visual, tidak memblokir simpan.
- **Tidak** mengubah `src/lib/report-shift.ts` atau periode pelaporan manapun yang sudah ada — sistem shift Satpam ini sepenuhnya independen, file baru sendiri.
- **Tidak** membangun pola jadwal berulang/mingguan (Approach C yang ditolak) — Supervisor mengisi tanggal demi tanggal.

## Model Data

Tabel baru di MSSQL (perusahaan MKEsindo, lewat `getPool()` dari `@/lib/db`), mengikuti konvensi tabel dashboard-native yang sudah ada (`DashboardTimProduksiAnggota`, `DashboardAktivitasProduksiShift`, dll — prefix `Dashboard`, `INT IDENTITY`, `TanggalUsaha DATE`, referensi akun sebagai `...AkunID INT` polos tanpa FK constraint DB, `IsDeleted BIT`, `CreatedDate`/`ModifiedDate DATETIME`):

```sql
CREATE TABLE DashboardSatpamJadwalJaga (
  JadwalJagaID    INT IDENTITY PRIMARY KEY,
  TanggalUsaha    DATE NOT NULL,       -- tanggal kalender SAAT SHIFT MULAI (bukan tanggal bisnis rollover)
  ShiftType       VARCHAR(12) NOT NULL,  -- 'SHIFT1' | 'SHIFT2' | 'SHIFT3' | 'LONG_MALAM' | 'LONG_PAGI'
  SatpamAkunID    INT NOT NULL,        -- referensi ke Postgres akun.id (lintas-DB, tanpa FK constraint DB, konsisten dgn StafOperasionalAkunID dkk yang sudah ada)
  Catatan         VARCHAR(256) NULL,
  IsDeleted       BIT NOT NULL DEFAULT 0,
  CreatedByAkunID INT NOT NULL,
  CreatedDate     DATETIME NOT NULL DEFAULT GETDATE(),
  ModifiedDate    DATETIME NOT NULL DEFAULT GETDATE()
)
```

**Keputusan penting — `TanggalUsaha` di sini BERBEDA maknanya dari `report-shift.ts`'s `businessDate`**: di sini artinya murni "tanggal kalender saat shift itu dimulai", dihitung MAJU (bukan mundur seperti rollover pelaporan). Supervisor mengisi form berpikir "malam tanggal 1 September, Shift 3 siapa?" — bukan istilah bisnis-rollover. Ini sengaja berbeda dari konvensi `report-shift.ts` karena domainnya berbeda (jadwal piket vs periode laporan).

**`SatpamAkunID` lintas-database**: akun login (termasuk Satpam) sudah dipindah ke Postgres (`akun`/`peran` table, lihat `src/lib/queries/akun.ts`). Tabel roster ini tetap di MSSQL (mengikuti pola `DashboardAktivitasProduksiShift.StafOperasionalAkunID` yang sudah lebih dulu menghadapi masalah yang sama), jadi query yang menampilkan nama satpam HARUS melakukan join di level aplikasi (fetch roster dari MSSQL, fetch nama dari Postgres via `getAkunNamaMap(akunIds)` yang sudah ada di `src/lib/queries/akun.ts:534`), bukan SQL JOIN lintas-database.

## Fungsi Perhitungan Shift — `src/lib/satpam-shift.ts` (baru)

```ts
export type SatpamShiftType = "SHIFT1" | "SHIFT2" | "SHIFT3" | "LONG_MALAM" | "LONG_PAGI";

export const SATPAM_SHIFT_LIST: SatpamShiftType[] = ["SHIFT1", "SHIFT2", "SHIFT3", "LONG_MALAM", "LONG_PAGI"];

export const SATPAM_SHIFT_LABEL: Record<SatpamShiftType, string> = {
  SHIFT1: "Shift 1 (06:00–13:59)",
  SHIFT2: "Shift 2 (14:00–21:59)",
  SHIFT3: "Shift 3 (22:00–05:59)",
  LONG_MALAM: "Long Shift Malam (18:00–05:59)",
  LONG_PAGI: "Long Shift Pagi (06:00–17:59)",
};

// startHour/endHour dalam jam WIB. crossesMidnight = true berarti endHour
// jatuh di TanggalUsaha + 1 hari, bukan hari yang sama.
const SATPAM_SHIFT_HOURS: Record<SatpamShiftType, { startHour: number; endHour: number; crossesMidnight: boolean }> = {
  SHIFT1: { startHour: 6, endHour: 14, crossesMidnight: false },
  SHIFT2: { startHour: 14, endHour: 22, crossesMidnight: false },
  SHIFT3: { startHour: 22, endHour: 6, crossesMidnight: true },
  LONG_MALAM: { startHour: 18, endHour: 6, crossesMidnight: true },
  LONG_PAGI: { startHour: 6, endHour: 18, crossesMidnight: false },
};

// Jendela waktu aktual [start, end) untuk satu baris jadwal, sebagai naive-WIB
// Date (pola yang sama seperti getShiftWindow di report-shift.ts — lihat
// project memory soal TransDate WIB/UTC boundary bug untuk kenapa ini harus
// konsisten naive-WIB, bukan true-UTC).
export function getSatpamShiftWindow(tanggalUsaha: Date, shiftType: SatpamShiftType): { start: Date; end: Date } {
  const { startHour, endHour, crossesMidnight } = SATPAM_SHIFT_HOURS[shiftType];
  const y = tanggalUsaha.getUTCFullYear();
  const m = tanggalUsaha.getUTCMonth();
  const d = tanggalUsaha.getUTCDate();
  return {
    start: new Date(Date.UTC(y, m, d, startHour, 0, 0)),
    end: new Date(Date.UTC(y, m, d + (crossesMidnight ? 1 : 0), endHour, 0, 0)),
  };
}

export interface SatpamJadwalRow {
  jadwalJagaId: number;
  tanggalUsaha: Date;
  shiftType: SatpamShiftType;
  satpamAkunId: number;
}

// Baris mana saja (dari kandidat yang sudah diambil DB, biasanya untuk
// TanggalUsaha hari ini DAN kemarin — supaya shift semalam yang masih
// berjalan ikut tertangkap) yang jendelanya mencakup `now`. Bisa
// mengembalikan 0, 1, atau lebih dari 1 baris (lihat "dua satpam
// bersamaan" di Latar belakang) — TIDAK ada asumsi "maksimal satu".
export function getSatpamOnDutyNow(rows: SatpamJadwalRow[], now: Date = new Date()): SatpamJadwalRow[] {
  return rows.filter((row) => {
    const { start, end } = getSatpamShiftWindow(row.tanggalUsaha, row.shiftType);
    return now >= start && now < end;
  });
}
```

## Query & Server Actions — `src/lib/queries/satpam-jadwal-jaga.ts` (baru) + `src/app/mkesindo/(dashboard)/keamanan/actions.ts` (baru)

- `getSatpamAkunOptions(): Promise<StafOperasionalOption[]>` — mirror persis `getProduksiAkunOptions()` (`src/lib/queries/akun.ts:522`), filter `r.is_satpam = true AND a.is_active = true`, dari Postgres.
- `getSatpamJadwalJagaList(startDate: Date, endDate: Date): Promise<SatpamJadwalDisplayRow[]>` — ambil baris `DashboardSatpamJadwalJaga` (MSSQL) dalam rentang tanggal, `IsDeleted = 0`, lalu isi nama satpam lewat `getAkunNamaMap` (Postgres). `SatpamJadwalDisplayRow` = `SatpamJadwalRow & { satpamNama: string; catatan: string | null }`.
- `getSatpamOnDutyNowAction(): Promise<ActionResult<SatpamJadwalDisplayRow[]>>` — ambil baris untuk `TanggalUsaha IN (hari ini, kemarin)` lalu filter lewat `getSatpamOnDutyNow`. Ini fungsi yang akan dipanggil sub-proyek berikutnya.
- `addSatpamJadwalJagaAction(input: { tanggalUsaha: string; shiftType: SatpamShiftType; satpamAkunId: number; catatan?: string }): Promise<ActionResult<void>>` — gate `WILAYAH_MANAGER_ROLE_IDS`/`isSuperAdmin` (sama seperti `requireWilayahManager` di `mitra/actions.ts:30`), INSERT baris baru. Tidak ada validasi tabrakan — sesuai Non-tujuan.
- `removeSatpamJadwalJagaAction(jadwalJagaId: number): Promise<ActionResult<void>>` — gate sama, `UPDATE ... SET IsDeleted = 1`.

## UI Admin — `/mkesindo/(dashboard)/keamanan`

Halaman baru `src/app/mkesindo/(dashboard)/keamanan/page.tsx`, gate akses sama seperti `mitra/page.tsx:20` (`user.isSuperAdmin || WILAYAH_MANAGER_ROLE_IDS.includes(user.roleId)` — kalau tidak punya akses, redirect `/akses-ditolak`, pola yang sama seperti gate lain di app ini).

Komponen `src/components/dashboard/satpam-roster-panel.tsx`, bentuknya mengikuti pola `MarketingWilayahPanel` (`src/components/dashboard/marketing-wilayah-panel.tsx`) yang sudah terbukti:
- **Form tambah**: date picker Tanggal, `Select` Tipe Shift (5 opsi dari `SATPAM_SHIFT_LIST`/`SATPAM_SHIFT_LABEL`), `Select` Satpam (dari `getSatpamAkunOptions()`), input teks Catatan (opsional), tombol "Tambah".
- **Daftar jadwal**: dikelompokkan per tanggal (heading tanggal, lalu baris-baris di bawahnya), tiap baris menampilkan badge tipe shift + nama satpam + catatan (kalau ada) + tombol hapus (X). Filter rentang tanggal di atas daftar, default minggu berjalan (Senin–Minggu WIB).
- **Peringatan tabrakan** (bukan blokir): kalau tanggal+tipe shift yang mau ditambahkan sudah punya penugasan lain yang masih aktif (`IsDeleted=0`), tampilkan pesan kuning "Slot ini sudah diisi oleh {nama} — tetap simpan?" di atas tombol Tambah, tapi tombol tetap bisa ditekan. Pengecekan ini dihitung di client dari data daftar yang SUDAH dimuat untuk rentang filter yang sedang aktif (tidak ada query tambahan ke server) — kalau tanggal yang ditambahkan berada di luar rentang filter yang sedang ditampilkan, peringatan ini tidak akan muncul. Ini konsisten dengan sifatnya yang cuma peringatan (bukan jaminan integritas data), jadi keterbatasan ini dianggap dapat diterima untuk v1.

## Kasus Khusus

- **Tidak ada yang terjadwal saat query `getSatpamOnDutyNow` dijalankan** → array kosong. Ini valid, bukan error — konsumen (sub-proyek berikutnya) harus menangani kasus ini sendiri (mis. tetap izinkan submit berdasarkan sesi login, bukan berdasarkan roster).
- **Dua satpam aktif bersamaan** (titik pergantian Long Shift) → keduanya dikembalikan dalam array, tidak ada penanganan khusus/prioritas.
- **Akun satpam dihapus/dinonaktifkan setelah dijadwalkan** → baris `DashboardSatpamJadwalJaga` tidak ikut terhapus (tidak ada FK constraint, konsisten dengan pola seluruh app ini); `getAkunNamaMap` akan mengembalikan map tanpa entry untuk akun itu, tampilan nama fallback ke "Akun tidak ditemukan" atau serupa.
- **Rentang tanggal filter kosong/tidak valid di UI admin** → default balik ke minggu berjalan.

## Testing

Tidak ada test suite otomatis di repo ini. Verifikasi:
1. `npx tsc --noEmit` dan `npm run lint` bersih.
2. Script scratch sekali-pakai (dibuat lalu dihapus setelah dijalankan, pola sama seperti fitur-fitur sebelumnya) menguji `getSatpamShiftWindow` dan `getSatpamOnDutyNow` dengan kasus konkret: (a) Shift 1 biasa (tidak lewat tengah malam), (b) Shift 3/Long Malam yang lewat tengah malam, (c) `now` tepat di batas awal/akhir jendela, (d) dua baris jadwal yang jendelanya sengaja tumpang tindih menghasilkan 2 hasil sekaligus dari `getSatpamOnDutyNow`.
3. Klik-tayang manual di `/mkesindo/keamanan` menggunakan akun Supervisor sungguhan yang tersedia di lingkungan pengembangan (bukan `isSatpam`, sehingga tidak terhalang oleh redirect layout di `(dashboard)/layout.tsx:38`) — tambah beberapa baris, hapus satu, cek filter rentang tanggal, cek peringatan tabrakan tampil saat seharusnya.

## Struktur File

- Buat: `src/lib/satpam-shift.ts` (fungsi murni)
- Buat: `src/lib/queries/satpam-jadwal-jaga.ts` (query MSSQL + gabung nama Postgres)
- Modifikasi: `src/lib/queries/akun.ts` (tambah `getSatpamAkunOptions`, mirror `getProduksiAkunOptions`)
- Buat: `src/app/mkesindo/(dashboard)/keamanan/page.tsx`
- Buat: `src/app/mkesindo/(dashboard)/keamanan/actions.ts`
- Buat: `src/components/dashboard/satpam-roster-panel.tsx`
- Buat: script migrasi sekali-jalan `scripts/create-satpam-jadwal-jaga-table.ts` (mirip `scripts/create-aktivitas-produksi-tables.ts`), dijalankan manual sekali oleh pengembang untuk membuat tabel `DashboardSatpamJadwalJaga` di MSSQL MKEsindo — bukan bagian dari migrasi otomatis aplikasi.
