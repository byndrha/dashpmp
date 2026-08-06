# Konfirmasi Gabung Kartu Pengiriman Saat Konflik Armada

## Latar Belakang

`findOverlappingJadwalForArmada()` (`src/lib/queries/pengiriman-jadwal.ts`) sudah
mendeteksi kalau sebuah armada punya dua Jadwal (Draft atau Terbit) dengan
jendela waktu sibuk yang tumpang tindih. Perilaku saat ini:

- Konflik dengan Jadwal **Terbit** (sudah benar-benar berangkat, DO/SI sudah
  terbit) → ditolak keras lewat `AppError` (mis. "Armada ini diperkirakan
  masih dalam perjalanan...").
- Konflik dengan Jadwal **Draft** → **langsung digabung diam-diam** lewat
  `appendRowsToDraft`/`mergeJadwalInto`, tanpa konfirmasi apa pun ke user —
  hanya `toast` sesudahnya ("Digabung dengan keberangkatan lain...").

User ingin auto-merge diam-diam ke Jadwal Draft ini diganti jadi **popup
konfirmasi eksplisit** sebelum digabung, menampilkan kuantitas yang
dipilih/baru, kuantitas yang sudah ada di Kartu Pengiriman tujuan, total
gabungan, dan peringatan kalau totalnya melebihi kapasitas maksimum armada.

## Cakupan

Pola ini dipakai di 4 titik kode (`findOverlappingJadwalForArmada` dipanggil
dari `createJadwalDraft`, `mergeExternalDeliveriesIntoJadwal`,
`updateJadwalDriverTime`, `updateJadwalArmada`), yang berujung ke **6 titik
trigger UI**:

1. **Gabungkan jadi Jadwal** — dialog "Gabungkan jadi Jadwal" di Papan
   Pengiriman (`mergeExternalDeliveriesAction`).
2. **Ubah tanggal/jam di Validasi Rute** — `handleSaveDriverTime`/
   `handleSelesaiMuat` di `route-validation-dialog.tsx`
   (`updateJadwalDriverTimeAction`).
3. **Buat keberangkatan baru dari Papan Pengiriman** — langsung
   (`createJadwalDraftAction`).
4. **Drag-and-drop** kartu Jadwal ke baris armada lain di Papan Pengiriman
   (`updateJadwalArmadaAction`).
5. **Buat Pemesanan** — penjadwalan otomatis di `createPemesanan`
   (`pemesanan.ts`), yang secara internal bisa memanggil `createJadwalDraft`.
6. **Ubah Pemesanan** — penjadwalan otomatis di `reschedulePemesanan`
   (`pemesanan.ts`), sama.

Konflik dengan Jadwal **Terbit** TIDAK berubah — tetap ditolak keras seperti
sekarang di keenam titik ini. Popup konfirmasi ini murni untuk konflik
dengan Jadwal **Draft**.

## Arsitektur

Bukan menambah state baru ke `ActionResult<T>` (yang baru saja dibakukan ke
seluruh app) — sebagai gantinya, satu **action baca-saja baru** dipanggil
dari client SEBELUM action mutasi asli, membentuk pola "cek dulu →
konfirmasi kalau perlu → baru commit":

```
submit → checkArmadaConflictAction(...)
  → tidak ada konflik Draft → panggil action mutasi asli langsung (seperti sekarang, tanpa popup)
  → ada konflik Draft → tampilkan dialog konfirmasi
       → user Batal → tidak ada perubahan apa pun
       → user Gabungkan → panggil action mutasi asli (yang tetap punya assertWithinCapacity sendiri sebagai jaring pengaman kedua)
```

### `checkArmadaConflict()` (query baru, `pengiriman-jadwal.ts`)

```ts
export interface ArmadaConflictInfo {
  jadwalId: number;
  jamJadwal: string; // JamJadwal Kartu Pengiriman tujuan, untuk ditampilkan di dialog
  existingQty: number; // kuantitas yang sudah ada di Kartu Pengiriman tujuan
  candidateQty: number; // kuantitas kandidat (yang mau ditambahkan/dipindah)
  combinedQty: number; // existingQty + candidateQty
  kapasitasMaks: number | null; // KapasitasMaks armada tujuan (null = tak terbatas/tak diatur)
  wouldExceedCapacity: boolean;
}

export async function checkArmadaConflict(
  armadaId: number,
  candidateStart: Date,
  candidateEnd: Date,
  candidateSalesOrderIds: string[],
  excludeJadwalId: number | null
): Promise<ArmadaConflictInfo | null>
```

Memakai ulang `findOverlappingJadwalForArmada` (sudah ada, tidak diubah).
Kalau tidak ada konflik, atau konfliknya berstatus Terbit, kembalikan `null`
— artinya client langsung lanjut ke action mutasi asli tanpa popup (kasus
Terbit akan ditolak keras alami oleh action asli seperti sekarang). Hanya
kalau konfliknya Draft, hitung kuantitas dan kapasitas, kembalikan info
lengkap untuk ditampilkan di dialog.

### `checkArmadaConflictAction()` (action baru, `delivery/actions.ts`)

Action tipis yang membungkus `checkArmadaConflict()` — tidak perlu
`runAction`/`AppError` karena murni baca data, tidak ada validasi bisnis
yang bisa gagal (kalau armada/data tidak ditemukan, cukup kembalikan
`null`, dianggap "tidak ada konflik untuk dicek").

### `ArmadaConflictDialog` (komponen React baru, dipakai bersama di ke-6 titik)

Props: `conflict: ArmadaConflictInfo`, `onConfirm: () => void`,
`onCancel: () => void`. Menampilkan:
- Jam Kartu Pengiriman tujuan (`conflict.jamJadwal`, diformat)
- "Kuantitas terpilih: {candidateQty} kantong"
- "Sudah ada: {existingQty} kantong"
- "Total setelah gabung: {combinedQty} kantong" (tebal)
- Kalau `wouldExceedCapacity`: teks merah "Melebihi kapasitas maksimum
  armada ({kapasitasMaks} kantong)."
- Tombol "Batal" (`onCancel`) dan "Gabungkan" (`onConfirm`, **dinonaktifkan**
  kalau `wouldExceedCapacity`).

## Integrasi per Titik Trigger

Titik 1-4 (Gabungkan jadi Jadwal, ubah tanggal/jam, buat keberangkatan baru,
drag-and-drop) mengikuti pola yang identik: handler submit yang sudah ada
(di `pengiriman-board.tsx`/`route-validation-dialog.tsx`) memanggil
`checkArmadaConflictAction` dulu sebelum action mutasi aslinya, menyisipkan
`ArmadaConflictDialog` di antara.

Titik 5-6 (Buat/Ubah Pemesanan) lebih rumit karena konflik terjadi **di
dalam** `pemesanan.ts`'s `createPemesanan`/`reschedulePemesanan`, bukan
langsung dipanggil dari UI. Pendekatannya: `pemesanan-form-dialog.tsx`/
`ubah-pemesanan-dialog.tsx` memanggil `checkArmadaConflictAction` sendiri
(dengan `armadaId`+`deliveryDateTime`+SO yang sedang dibuat/diedit) SEBELUM
memanggil `createPemesananAction`/`reschedulePemesananAction` — kalau ada
konflik Draft, tampilkan dialog dulu; setelah user konfirmasi, baru submit
order seperti biasa (yang di baliknya tetap memanggil `createJadwalDraft`
apa adanya, sekarang sudah "dikonfirmasi" oleh langkah sebelumnya). Ini
berarti pengecekan konflik di titik 5-6 dilakukan sebelum order benar-benar
dibuat, sedikit berbeda waktunya dari titik 1-4 (yang mengecek tepat
sebelum action mutasi Jadwal-nya) tapi hasil akhirnya sama: user selalu
melihat popup sebelum penggabungan benar-benar terjadi.

## Penanganan Error

Tidak ada perubahan pada `assertWithinCapacity`/pengecekan overlap Terbit
yang sudah ada — keduanya tetap berfungsi sebagai jaring pengaman terakhir
di action mutasi asli, terlepas dari apakah dialog konfirmasi ini
dilewati (mis. race condition dua user mengedit bersamaan). Dialog ini
murni alat bantu keputusan sebelum mencoba, bukan pengganti validasi
server yang sudah ada.

## Pengujian

Proyek ini tidak punya test runner. Verifikasi: `npx tsc --noEmit` penuh,
`npx eslint`, dan verifikasi manual di browser untuk setidaknya 2 dari 6
titik trigger (satu yang sederhana seperti Gabungkan jadi Jadwal, satu yang
kompleks seperti Buat Pemesanan) — kalau login production tidak bisa
diakses dari sandbox (kendala yang sudah berulang kali terjadi sepanjang
sesi ini), verifikasi lewat penelusuran statis kode yang teliti sebagai
gantinya.

## Di Luar Cakupan

- Tidak mengubah perilaku konflik dengan Jadwal Terbit (tetap ditolak
  keras).
- Tidak menambah kemampuan baru ke `ActionResult<T>` — pola cek-dulu ini
  sengaja dipisah sebagai action baca-saja terpisah, bukan varian baru di
  tipe yang sudah dibakukan.
- Tidak menyentuh `findDraftJadwalByArmadaAndTime` (pencarian *exact match*
  armada+waktu di `pemesanan.ts`) — itu bukan "konflik", itu memang
  disengaja jadi stop tambahan di Jadwal yang sama.
