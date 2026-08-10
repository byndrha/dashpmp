# Timeline Vertikal untuk Driver-App & Satpam-App (Design Spec)

## Latar Belakang

Saat ini `/mkesindo/driver-app`'s tab Riwayat menampilkan daftar Jadwal (trip) yang sudah selesai, terurut waktu tapi tidak dibatasi periode (`TOP 50` tanpa batas tanggal). `/mkesindo/satpam-app`'s Beranda hanya menampilkan armada yang **masih perlu** dicek — tidak ada tampilan riwayat cek yang sudah selesai sama sekali.

Pekerjaan ini menambahkan tampilan **timeline vertikal** (garis + titik di kiri, kartu ringkas di kanan, dari atas ke bawah, terbaru di atas) ke kedua app, dibatasi periode "hari kerja" (business date) yang sudah dipakai di seluruh app — rollover 14:00 WIB (`ROLLOVER_HOUR` di `src/lib/business-date.ts`). Contoh: business date 11 Agustus 2026 mencakup 10 Agustus 2026 pukul 14:00 WIB sampai 11 Agustus 2026 pukul 13:59 WIB.

Tab Riwayat (driver-app) dan Beranda (satpam-app) **diganti isinya**, bukan ditambah tab baru.

## Jendela Waktu (Business Date)

Ditambahkan satu helper baru di `src/lib/business-date.ts`:

```ts
// UTC start/end instants for one business-date's 14:00-WIB-rollover window
// — [businessDate-1 pukul 14:00 WIB, businessDate pukul 13:59:59.999 WIB).
// Used by the driver-app/satpam-app timelines to filter events to "today's"
// business day, the same rollover concept getBusinessDate() already
// expresses as a date label, now expressed as a concrete instant range for
// a WHERE-clause filter.
export function getBusinessDateWindowUTC(businessDateISO: string): { start: Date; end: Date } {
  const start = new Date(`${shiftDateISO(businessDateISO, -1)}T${String(ROLLOVER_HOUR).padStart(2, "0")}:00:00+07:00`);
  const end = new Date(`${businessDateISO}T${String(ROLLOVER_HOUR).padStart(2, "0")}:00:00+07:00`);
  return { start, end };
}
```

Kedua timeline (driver, satpam) memanggil `getBusinessDate()` (tanpa argumen — selalu "sekarang") untuk dapat business date hari ini, lalu `getBusinessDateWindowUTC` untuk dapat rentang UTC yang dipakai di query SQL sebagai `WHERE <kolom_waktu> >= @start AND <kolom_waktu> < @end`.

**Tidak ada navigasi ke periode lain** (tidak ada tombol geser tanggal) — selalu business date saat ini. Keputusan YAGNI, bukan permintaan eksplisit; mudah ditambah nanti kalau dibutuhkan.

## Timeline Driver-App

### Data: `getDriverTimeline`

Fungsi baru di `src/lib/queries/pengiriman-jadwal.ts`, TIDAK mengubah `getDriverJadwalHistory` yang sudah ada (masih dipakai kalau ada konsumen lain).

```ts
export interface DriverTimelineBBM {
  waktuMasukSpbu: string;
  waktuIsi: string | null;
  liter: number | null;
}

export interface DriverTimelineKendala {
  waktuLapor: string;
  jenisKendala: string;
}

export interface DriverTimelineEntry {
  jadwalId: number;
  armadaNama: string;
  vehicleNo: string | null;
  jamAktualBerangkat: string; // anchor time, always present (history is post-departure only)
  totalStop: number;
  totalKantong: number;
  bbm: DriverTimelineBBM[];
  kendala: DriverTimelineKendala[];
}

export async function getDriverTimeline(salesmanId: string, businessDateISO: string): Promise<DriverTimelineEntry[]>
```

Query: sama pola `HAVING COUNT(sa.JadwalDetailID) = SUM(sa.IsSelesai)` seperti `getDriverJadwalHistory` (hanya Jadwal yang semua stop-nya sudah selesai), filter tambahan `j.JamAktualBerangkat >= @start AND j.JamAktualBerangkat < @end`, LEFT JOIN ke `DashboardPengirimanBBM` dan `DashboardPengirimanKendala` (WHERE `JadwalID = j.JadwalID`, tanpa filter periode terpisah — BBM/kendala ikut Jadwal induknya). Baris BBM/Kendala digabung ke array per Jadwal di kode TS (pola sama seperti `getVehicleChecksForJadwal` menggabung foto ke satu `VehicleCheckRow`). `ORDER BY j.JamAktualBerangkat DESC`.

### Kartu entri driver-app

Satu kartu = satu Jadwal. Isi: nama armada/no. polisi, jam berangkat aktual (format `HH:MM`), `StopSelesai/TotalStop` tujuan, total kantong. Kalau `bbm.length > 0`, tiap item tampil baris kecil "⛽ Isi BBM HH:MM" (pakai `waktuIsi` kalau ada, else `waktuMasukSpbu`). Kalau `kendala.length > 0`, tiap item tampil baris kecil "⚠ Kendala: <jenisKendala> HH:MM". Baris-baris ini rapat (tanpa padding kartu-dalam-kartu) — kartu tanpa BBM/kendala dan kartu dengan beberapa entri BBM/kendala sama-sama sepadat mungkin.

## Timeline Satpam-App

### Data: `getSatpamTimeline`

Fungsi baru di `src/lib/queries/vehicle-check.ts`. `getSatpamInspectionList` yang sudah ada TIDAK diubah (tetap dipakai untuk daftar "masih perlu dicek" di atas timeline).

```ts
export interface SatpamTimelineEntry {
  vehicleCheckId: number;
  jadwalId: number;
  tipe: VehicleCheckTipe; // "BERANGKAT" | "DATANG"
  armadaNama: string;
  vehicleNo: string | null;
  driverName: string | null;
  checkedAt: string; // anchor time
  odometerKM: number;
}

export async function getSatpamTimeline(businessDateISO: string): Promise<SatpamTimelineEntry[]>
```

Query: `SELECT` dari `DashboardVehicleCheck` (tanpa join foto — timeline ini ringkasan, bukan detail penuh), filter `CheckedAt >= @start AND CheckedAt < @end`, join Armada/ExpeditionDetail/Jadwal→SalesmanID→driver name (pola sama seperti `getSatpamInspectionList`). `ORDER BY CheckedAt DESC`. Satu baris `DashboardVehicleCheck` = satu entri timeline (BERANGKAT dan DATANG untuk Jadwal yang sama muncul sebagai dua entri terpisah, di posisi waktu masing-masing).

### Kartu entri satpam-app

Satu kartu = satu momen cek. Isi: badge "Cek Berangkat" atau "Cek Datang" (dari `tipe`), nama armada/no. polisi, nama driver, jam cek (`checkedAt`, format `HH:MM`), odometer. Tidak ada foto/detail penuh di kartu ini — untuk itu tetap ke layar detail inspeksi yang sudah ada (`/satpam-app/inspeksi/[jadwalId]`).

### Penempatan di Beranda

`SatpamBerandaClient` (komponen yang sudah ada) mendapat tambahan: daftar "masih perlu dicek" (dari `getSatpamInspectionList`, TIDAK diubah) tetap di bagian atas seperti sekarang; timeline baru (`getSatpamTimeline`) ditambahkan di bawahnya sebagai section terpisah.

## Komponen Timeline Bersama

`src/components/ui/vertical-timeline.tsx` (baru) — mengikuti konvensi yang sudah ada di proyek ini (`src/components/ui/` sudah berisi primitif presentasional generik/tanpa data spesifik-app seperti Button, Dialog — bukan folder "shared" baru), komponen presentasional generik ini dipakai driver-app dan satpam-app:

```tsx
export function VerticalTimeline({ children }: { children: React.ReactNode }) {
  // rel garis vertikal + titik per child, children di-render sebagai kartu
  // ringkas di kanan tiap titik
}

export function VerticalTimelineItem({ time, children }: { time: string; children: React.ReactNode }) {
  // satu titik + kartu; time (HH:MM) tampil di dalam/dekat kartu
}
```

**Tidak ada spasi proporsional waktu** — jarak antar `VerticalTimelineItem` selalu seragam (margin kecil tetap), tidak peduli jarak waktu asli antar entri (bisa 5 menit atau 5 jam, tetap sama). Ini beda dari pola "agenda/calendar day view" yang lazim — desain ini murni daftar kronologis dengan aksen visual garis+titik, bukan sumbu jam.

**Kondisi kosong**: kalau array data kosong, tampilkan pesan "Belum ada aktivitas hari ini" (teks biasa, bukan `VerticalTimeline` kosong).

## Wiring ke Halaman

- `src/app/mkesindo/driver-app/(tabs)/riwayat/page.tsx`: ganti `getDriverJadwalHistory(salesmanId)` jadi `getDriverTimeline(salesmanId, getBusinessDateISO())`. `DriverTabShell`'s prop `initialRiwayat` berganti tipe ke `DriverTimelineEntry[]`.
- `src/app/mkesindo/satpam-app/page.tsx`: tambah `getSatpamTimeline(getBusinessDateISO())` ke `Promise.all` yang sudah ada, teruskan sebagai prop baru ke `SatpamBerandaClient`.
- Komponen `riwayat-list.tsx` (driver-app) dan `beranda-client.tsx` (satpam-app) di-render ulang memakai `VerticalTimeline`/`VerticalTimelineItem` untuk bagian riwayat/timeline-nya.

## Error Handling

Pola yang sudah ada di app dipakai ulang — tidak ada mekanisme baru. Query gagal → `AppError` → ditangkap `runAction`/`ActionResult` (server actions) atau ditangani langsung di server component (untuk kedua halaman ini, keduanya sudah server component yang fetch langsung, bukan lewat action — error dilempar ke error boundary Next.js yang sudah ada, sama seperti sekarang).

## Testing

Proyek ini tidak punya test runner (dikonfirmasi berkali-kali). Verifikasi: `npx tsc --noEmit`, `npm run lint`, dan verifikasi langsung di browser — termasuk kondisi kosong (hari tanpa aktivitas) dan kondisi terisi (beberapa Jadwal dengan/tanpa BBM/kendala; beberapa cek Berangkat/Datang).

## Di Luar Cakupan

- Tidak ada navigasi ke business date lain (selalu "hari ini") — lihat catatan YAGNI di atas.
- Tidak ada pagination — satu hari kerja realistisnya sedikit entri.
- Foto/detail penuh vehicle check tidak ditampilkan di kartu timeline satpam — itu tetap di layar detail inspeksi yang sudah ada, tidak disentuh pekerjaan ini.
- `getDriverJadwalHistory` dan `getSatpamInspectionList` yang sudah ada TIDAK diubah/dihapus — fungsi baru ditambahkan berdampingan.
