# Estimasi Durasi Bongkar per Kantong — Interpolasi Linear (Design Spec)

## Latar Belakang

Setiap Kartu Pengiriman (Jadwal) di Papan Pengiriman menampilkan estimasi durasi bongkar/penurunan es per mitra (stop), dihitung dari jumlah kantong yang diturunkan di stop tersebut. Estimasi ini dipakai untuk tiga hal: (1) tampilan "~X menit" per stop di dialog Validasi Rute, (2) lebar kartu Jadwal di papan (total durasi semua stop), dan (3) deteksi konflik jadwal armada (`checkArmadaConflict`) — kapan sebuah armada diperkirakan selesai dan bisa dipakai untuk trip berikutnya.

Formula lama berbasis blok 5-kantong yang dibulatkan **ke atas** (mis. 7 kantong dihitung seolah 10 kantong). Berdasarkan data lapangan terbaru, pola durasi aktual berbeda dan tidak linear sederhana — kenaikannya per 5 kantong adalah +2, +2, +2, +3, +3, +3, +4 menit (5→40 kantong), lalu menjadi flat +5 menit per 5 kantong setelah 40. Pekerjaan ini mengganti formula lama dengan tabel titik acuan baru, dan mengganti pembulatan-ke-atas dengan **interpolasi linear** antar titik acuan untuk jumlah yang bukan kelipatan 5 persis.

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

## Dampak ke Pemanggil

Tidak ada perubahan signature/interface pada `estimateDeliveryMinutes` — perubahan murni pada nilai yang dikembalikan. Semua pemanggil otomatis memakai angka baru:

- **`route-validation-dialog.tsx`** — tampilan "~X menit" per stop di dialog Validasi Rute (Kartu Pengiriman). Angka yang tampil akan berbeda dari sebelumnya (umumnya lebih kecil, karena formula baru menghasilkan durasi lebih pendek untuk qty kecil — 5 kantong turun dari 5 menit jadi 1 menit).
- **`pengiriman-jadwal.ts`** — akumulasi `bongkarMinutes` dan perhitungan `candidateEnd` di `checkArmadaConflict`. Karena durasi yang diestimasi berubah (umumnya lebih pendek untuk qty di bawah ~40), jendela waktu yang dianggap "armada sedang sibuk" ikut memendek — ini mengubah kapan sebuah armada dianggap available untuk trip berikutnya. Perubahan ini konsekuensi yang disengaja dari formula baru, bukan efek samping yang perlu di-mitigasi.
- **`route-estimate.ts`** — `estimateTripMinutes` menjumlahkan durasi bongkar semua stop plus waktu tempuh untuk estimasi durasi trip Draft-armada; ikut berubah mengikuti angka baru.

Tidak ada tabel/kolom database baru, tidak ada migrasi data — perubahan murni logika kalkulasi di kode aplikasi.

## Testing

- Unit test `estimateDeliveryMinutes` untuk: setiap titik acuan persis (0, 5, 10, ..., 40 → 0, 1, 3, ..., 20), nilai di atas 40 (45→25, 60→40), nilai interpolasi non-kelipatan-5 di beberapa segmen berbeda (mis. 3→0,6; 7→1,8; 23→8,8; 38→18,4), dan qty negatif/nol → 0.
- Verifikasi manual di Papan Pengiriman: bandingkan angka "~X menit" per stop di dialog Validasi Rute dengan hasil `estimateDeliveryMinutes` yang sama untuk qty yang sama, memastikan SQL dan TS tidak menyimpang.

## Di Luar Cakupan

- Tidak mengubah cara `Qty` per-stop dihitung (tetap dari `SalesOrderDetail`, kantong 5kg dihitung sebagai 0,5 kantong — logika `StopQty` CTE tidak disentuh).
- Tidak mengubah UI dialog Validasi Rute selain angka yang ditampilkan (tidak ada perubahan label/format `~X menit`).
- Tidak ada perubahan pada modul Produksi (`produksi`/`produksi-app`) — perubahan ini murni di modul Pengiriman/Papan Pengiriman yang sudah ada sejak sebelum Modul Produksi dibangun.
