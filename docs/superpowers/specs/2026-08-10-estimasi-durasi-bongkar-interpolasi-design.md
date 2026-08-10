# Estimasi Durasi Bongkar & Waktu Konfirmasi Pengiriman (Design Spec)

## Latar Belakang

Setiap Kartu Pengiriman (Jadwal) di Papan Pengiriman menampilkan estimasi durasi bongkar/penurunan es per mitra (stop), dihitung dari jumlah kantong yang diturunkan di stop tersebut. Estimasi ini dipakai untuk tiga hal: (1) tampilan "~X menit" per stop di dialog Validasi Rute, (2) lebar kartu Jadwal di papan (total durasi semua stop), dan (3) deteksi konflik jadwal armada (`checkArmadaConflict`) — kapan sebuah armada diperkirakan selesai dan bisa dipakai untuk trip berikutnya.

Formula lama berbasis blok 5-kantong yang dibulatkan **ke atas** (mis. 7 kantong dihitung seolah 10 kantong). Berdasarkan data lapangan terbaru, pola durasi aktual berbeda dan tidak linear sederhana — kenaikannya per 5 kantong adalah +2, +2, +2, +3, +3, +3, +4 menit (5→40 kantong), lalu menjadi flat +5 menit per 5 kantong setelah 40. Pekerjaan ini mengganti formula lama dengan tabel titik acuan baru, dan mengganti pembulatan-ke-atas dengan **interpolasi linear** antar titik acuan untuk jumlah yang bukan kelipatan 5 persis.

Selain durasi bongkar, setiap stop juga butuh waktu untuk driver mengisi data konfirmasi pengiriman di driver-app (foto bukti, tanda tangan/konfirmasi terima, dsb.) — waktu ini belum pernah masuk ke estimasi manapun. Pekerjaan ini juga menambahkan estimasi tetap 3 menit per stop untuk aktivitas tersebut, dan menampilkan rincian totalnya di dialog Validasi Rute.

## Formula Baru

**Titik acuan (kantong → menit), dikonfirmasi oleh pengguna:**

| Kantong | Menit |
|---|---|
| 0 | 0 |
| 5 | 1 |
| 10 | 3 |
| 15 | 5 |
| 20 | 7 |
| 25 | 10 |
| 30 | 13 |
| 35 | 16 |
| 40 | 20 |

**Di atas 40 kantong:** flat +5 menit per tambahan 5 kantong (kemiringan konstan 1 menit/kantong, garis lurus lanjutan dari titik (40, 20)) — 45→25, 50→30, 55→35, dst. Tidak ada batas atas.

**Untuk jumlah bukan kelipatan 5 persis** (mis. 7, 23, 38 kantong): interpolasi linear antara dua titik acuan terdekat yang mengapitnya. Ini pengganti perilaku lama (pembulatan ke atas ke blok berikutnya) — perubahan perilaku yang disengaja per keputusan pengguna, bukan sekadar update angka.

Contoh: 7 kantong ada di antara titik (5, 1) dan (10, 3) → 1 + (3−1) × (7−5)/(10−5) = **1,8 menit**.

## Presisi & Pembulatan

Formula lama memakai pembagi 2 (langkah 0,5 menit — mis. 2,5; 7,5), yang selalu presisi eksak dalam floating-point biner karena 0,5 = 1/2. Formula baru memakai pembagi 5 (langkah 0,2 menit), dan 1/5 **tidak** presisi eksak dalam floating-point biner (sama seperti 0,1 + 0,2 ≠ 0,3 tepat di JavaScript) — berisiko menghasilkan angka seperti `1.7999999999999998` alih-alih `1.8`, baik di sisi TypeScript (double) maupun berpotensi berbeda tipis dari sisi SQL Server (float/decimal).

**Keputusan desain:** hasil akhir dibulatkan ke 1 angka desimal (`Math.round(x * 10) / 10` di TS, `ROUND(x, 1)` di SQL) sebelum dikembalikan. Ini menghilangkan artefak floating-point, menjaga tampilan tetap rapi (konsisten dengan gaya lama yang menampilkan "~7.5 menit"), dan memastikan TS dan SQL selalu menghasilkan angka yang identik.

## Implementasi

Dua tempat harus diubah bersamaan, sebagai mirror satu sama lain — sama seperti kondisi formula lama saat ini.

### 1. `src/lib/delivery-duration.ts` (fungsi TS)

Menjadi rangkaian segmen linear eksplisit, satu per interval titik acuan, gaya yang sama seperti percabangan tier formula lama supaya mudah dibandingkan baris-per-baris dengan versi SQL:

```ts
// Estimated on-site delivery duration per stop, based on kantong qty.
// Piecewise-linear interpolation between known reference points, then a
// flat 1-menit/kantong slope beyond 40 (5 menit per 5-kantong block).
// Rounded to 1 decimal to avoid binary-float artifacts from the /5 steps
// (unlike the old /2 steps, 1/5 has no exact binary representation).
export function estimateDeliveryMinutes(qtyKantong: number): number {
  const q = qtyKantong;
  let result: number;
  if (q <= 0) result = 0;
  else if (q <= 5) result = q / 5;
  else if (q <= 10) result = 1 + (2 * (q - 5)) / 5;
  else if (q <= 15) result = 3 + (2 * (q - 10)) / 5;
  else if (q <= 20) result = 5 + (2 * (q - 15)) / 5;
  else if (q <= 25) result = 7 + (3 * (q - 20)) / 5;
  else if (q <= 30) result = 10 + (3 * (q - 25)) / 5;
  else if (q <= 35) result = 13 + (3 * (q - 30)) / 5;
  else if (q <= 40) result = 16 + (4 * (q - 35)) / 5;
  else result = q - 20;
  return Math.round(result * 10) / 10;
}
```

### 2. `src/lib/queries/pengiriman-jadwal.ts` (mirror SQL, `StopDuration` CTE)

Ekspresi `CASE` di dalam `StopDuration` (baris ~129-139) diganti dengan segmen yang identik secara matematis dengan versi TS di atas:

```sql
StopDuration AS (
    SELECT JadwalID,
           SUM(ROUND(CASE
             WHEN Qty <= 0 THEN 0
             WHEN Qty <= 5 THEN Qty / 5.0
             WHEN Qty <= 10 THEN 1 + 2 * (Qty - 5) / 5.0
             WHEN Qty <= 15 THEN 3 + 2 * (Qty - 10) / 5.0
             WHEN Qty <= 20 THEN 5 + 2 * (Qty - 15) / 5.0
             WHEN Qty <= 25 THEN 7 + 3 * (Qty - 20) / 5.0
             WHEN Qty <= 30 THEN 10 + 3 * (Qty - 25) / 5.0
             WHEN Qty <= 35 THEN 13 + 3 * (Qty - 30) / 5.0
             WHEN Qty <= 40 THEN 16 + 4 * (Qty - 35) / 5.0
             ELSE Qty - 20
           END, 1)) AS EstimasiDurasiMenit
    FROM StopQty
    GROUP BY JadwalID
)
```

Catatan: `ROUND` diterapkan per-stop (di dalam `SUM`), bukan pada total akhirnya — ini menjaga hasil per-stop identik dengan yang dihasilkan fungsi TS untuk stop yang sama (dipakai untuk cross-check/debugging), sekaligus konsisten dengan cara formula lama sudah menjumlahkan nilai desimal per-stop tanpa pembulatan tambahan di level total.

Komentar SQL yang menjelaskan formula (baris ~111-120, saat ini mendeskripsikan tier lama) diperbarui menyebut titik acuan dan aturan interpolasi baru, mengarah ke `delivery-duration.ts` sebagai sumber kebenaran.

## Dampak ke Pemanggil (Formula Bongkar)

Tidak ada perubahan signature/interface pada `estimateDeliveryMinutes` — perubahan murni pada nilai yang dikembalikan. Semua pemanggil otomatis memakai angka baru:

- **`route-validation-dialog.tsx`** — tampilan "~X menit" per stop di dialog Validasi Rute (Kartu Pengiriman). Angka yang tampil akan berbeda dari sebelumnya (umumnya lebih kecil, karena formula baru menghasilkan durasi lebih pendek untuk qty kecil — 5 kantong turun dari 5 menit jadi 1 menit).
- **`pengiriman-jadwal.ts`** — akumulasi `bongkarMinutes` dan perhitungan `candidateEnd` di `checkArmadaConflict`. Karena durasi yang diestimasi berubah (umumnya lebih pendek untuk qty di bawah ~40), jendela waktu yang dianggap "armada sedang sibuk" ikut memendek — ini mengubah kapan sebuah armada dianggap available untuk trip berikutnya. Perubahan ini konsekuensi yang disengaja dari formula baru, bukan efek samping yang perlu di-mitigasi.
- **`route-estimate.ts`** — `estimateTripMinutes` menjumlahkan durasi bongkar semua stop plus waktu tempuh untuk estimasi durasi trip Draft-armada; ikut berubah mengikuti angka baru.

Tidak ada tabel/kolom database baru, tidak ada migrasi data — perubahan murni logika kalkulasi di kode aplikasi.

## Waktu Konfirmasi Data di Driver-App (+3 Menit per Stop)

Setiap stop butuh waktu tambahan bagi driver untuk mengisi data konfirmasi pengiriman di driver-app (foto bukti, konfirmasi terima/retur) — aktivitas ini terjadi di lokasi mitra, setelah bongkar selesai, sebelum truk bisa lanjut ke stop berikutnya. Ditambahkan sebagai **konstanta tetap 3 menit per stop**, terpisah dari durasi bongkar (bukan bagian dari `estimateDeliveryMinutes`, supaya kedua komponen tetap bisa ditampilkan terpisah dan diubah secara independen di masa depan).

**Cakupan:** dikonfirmasi pengguna untuk diperlakukan sama seperti waktu bongkar — waktu nyata truk "menempel" di lokasi mitra — sehingga ikut masuk ke **semua** kalkulasi yang sudah memakai `estimateDeliveryMinutes` per stop, bukan cuma tampilan.

### Implementasi

**1. `src/lib/delivery-duration.ts`** — konstanta baru diekspor berdampingan dengan `estimateDeliveryMinutes`:

```ts
// Fixed time per stop for the driver to fill delivery-confirmation data in
// driver-app (proof photos, confirm-received/retur) — happens on-site,
// after bongkar, before the truck can move to the next stop. Kept as its
// own constant (not folded into estimateDeliveryMinutes) so the two
// components can still be shown separately and tuned independently.
export const CONFIRMATION_MINUTES_PER_STOP = 3;
```

**2. `src/lib/route-estimate.ts`** — impor di baris 1 ditambah `CONFIRMATION_MINUTES_PER_STOP`; `estimateTripMinutes` (baris 47-48), setiap stop menyumbang bongkar + konfirmasi:

```ts
const bongkarMinutes = orderedStops.reduce(
  (sum, s) => sum + estimateDeliveryMinutes(s.qty) + CONFIRMATION_MINUTES_PER_STOP,
  0
);
```

**3. `src/lib/queries/pengiriman-jadwal.ts`** — impor di baris 6 ditambah `CONFIRMATION_MINUTES_PER_STOP`, lalu tiga titik:

- `StopDuration` CTE (baris ~129-139): tambahkan `+ 3` per baris stop sebelum `SUM`:
  ```sql
  SUM(ROUND(CASE ... END, 1) + 3) AS EstimasiDurasiMenit
  ```
- `estimateBusyMinutes` (baris 712): `bongkarMinutes += estimateDeliveryMinutes(loc?.qty ?? 0) + CONFIRMATION_MINUTES_PER_STOP;`
- `checkArmadaConflict` (baris 829): `candidateEnd = new Date(candidateStart.getTime() + (estimateDeliveryMinutes(candidateQty) + CONFIRMATION_MINUTES_PER_STOP) * 60 * 1000);`

`estimateBusyMinutes` dan `checkArmadaConflict` sudah mengimpor `estimateDeliveryMinutes` dari `delivery-duration.ts` di file yang sama — tinggal menambah `CONFIRMATION_MINUTES_PER_STOP` ke impor itu. `StopDuration` di atas berbeda: itu string SQL mentah (dieksekusi lewat `pool.request().query(...)`), jadi `+ 3` di sana adalah literal SQL biasa, bukan referensi ke konstanta TS — nilainya harus tetap disinkronkan manual dengan `CONFIRMATION_MINUTES_PER_STOP` jika suatu saat berubah, sama seperti CASE bongkar di atasnya sudah harus disinkronkan manual dengan `estimateDeliveryMinutes`.

**4. `src/components/dashboard/route-validation-dialog.tsx`** — impor di baris 30 (`import { estimateDeliveryMinutes } from "@/lib/delivery-duration";`) ditambah `CONFIRMATION_MINUTES_PER_STOP`. Baris "~X menit" per stop (baris 121) **tidak berubah** (tetap murni durasi bongkar per stop, sesuai label "estimasi bongkar"). Perubahan UI ada di baris ringkasan rute (sekitar baris 1229-1256), yang sekarang menampilkan rincian, bukan cuma `{route.durationMinutes} menit`:

```tsx
const bongkarTotalMenit = order.reduce((sum, o) => sum + estimateDeliveryMinutes(o.Qty), 0);
const konfirmasiTotalMenit = order.length * CONFIRMATION_MINUTES_PER_STOP;
const totalMenit = route.durationMinutes + bongkarTotalMenit + konfirmasiTotalMenit;
```

```tsx
<span className="flex items-center gap-1">
  <Clock className="size-3.5 text-muted-foreground" />
  Tempuh {Math.round(route.durationMinutes)} + Bongkar {Math.round(bongkarTotalMenit)} + Konfirmasi{" "}
  {Math.round(konfirmasiTotalMenit)} = {Math.round(totalMenit)} menit
</span>
```

Pembulatan ke bilangan bulat di sini murni untuk tampilan (baris ringkasan) — tidak memengaruhi nilai yang dipakai di kalkulasi penjadwalan lain (yang tetap pakai `Math.round(x*10)/10` per Bagian Presisi & Pembulatan di atas).

### Dampak ke Pemanggil (Waktu Konfirmasi)

- **Deteksi konflik armada (`checkArmadaConflict`)** dan **estimasi busy window (`estimateBusyMinutes`)** — jendela "armada sedang sibuk" bertambah 3 menit per stop dari sebelumnya (setelah perubahan formula bongkar di atas).
- **Estimasi trip Draft (`estimateTripMinutes` di `route-estimate.ts`)** — dipakai untuk menaksir durasi trip sebuah Jadwal Draft sebelum di-Terbit-kan; totalnya naik 3 menit × jumlah stop.
- **Lebar kartu Jadwal di Papan Pengiriman** (`StopDuration` CTE) — ikut bertambah, sehingga kartu di papan mencerminkan waktu riil termasuk pengisian data konfirmasi, bukan cuma bongkar.
- **Dialog Validasi Rute** — baris ringkasan rute sekarang menunjukkan rincian 3 komponen (tempuh, bongkar, konfirmasi) dan totalnya, bukan cuma angka tempuh OSRM seperti sebelumnya.

## Testing

- Unit test `estimateDeliveryMinutes` untuk: setiap titik acuan persis (0, 5, 10, ..., 40 → 0, 1, 3, ..., 20), nilai di atas 40 (45→25, 60→40), nilai interpolasi non-kelipatan-5 di beberapa segmen berbeda (mis. 3→0,6; 7→1,8; 23→8,8; 38→18,4), dan qty negatif/nol → 0.
- Unit test `estimateTripMinutes` (`route-estimate.ts`): pastikan tiap stop menyumbang `estimateDeliveryMinutes(qty) + 3`, bukan cuma `estimateDeliveryMinutes(qty)`.
- Verifikasi manual di Papan Pengiriman: bandingkan angka "~X menit" per stop di dialog Validasi Rute dengan hasil `estimateDeliveryMinutes` yang sama untuk qty yang sama (harus tetap murni bongkar, tanpa +3), dan cek baris ringkasan rute menampilkan rincian Tempuh + Bongkar + Konfirmasi = Total yang konsisten dengan penjumlahan manual.

## Di Luar Cakupan

- Tidak mengubah cara `Qty` per-stop dihitung (tetap dari `SalesOrderDetail`, kantong 5kg dihitung sebagai 0,5 kantong — logika `StopQty` CTE tidak disentuh).
- Tidak mengubah label/format baris "~X menit" per stop individual — hanya baris ringkasan total rute yang mendapat rincian baru.
- Waktu konfirmasi 3 menit adalah konstanta tetap, bukan dihitung dari jumlah kantong atau properti stop lain — tidak ada logika tambahan untuk memvariasikannya per mitra/jenis pengiriman.
- Tidak ada perubahan pada modul Produksi (`produksi`/`produksi-app`) — perubahan ini murni di modul Pengiriman/Papan Pengiriman yang sudah ada sejak sebelum Modul Produksi dibangun.
