# Perbaikan Pola Error-Handling Server Action

## Latar Belakang

Dialog "Gabungkan jadi Jadwal" di Validasi Rute menampilkan pesan generik React:

> "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance which may provide additional details about the nature of the error."

Root cause dikonfirmasi lewat pembacaan kode compiled React
(`node_modules/next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.node.production.js:1780-1785`,
fungsi `resolveErrorProd()`): **setiap** error yang `throw` lewat Server
Component render atau Server Action, di *production build*, pesan aslinya
diganti teks generik itu sebelum dikirim ke browser — hanya `digest`
(kode korelasi log) yang benar-benar sampai ke client. Ini murni fitur
keamanan bawaan React (mencegah kebocoran detail sensitif lewat pesan
error), bukan bug aplikasi, dan berlaku sama rata tanpa peduli apakah
error itu galat teknis tak terduga atau pesan validasi bisnis yang sengaja
ditulis jelas dalam Bahasa Indonesia (mis. `"Total muatan (632 kantong)
melebihi kapasitas maksimum armada (360 kantong)."`).

Survei kode menemukan pola `throw new Error(pesan)` + client-side
`try/catch { setError(err.message) }` dipakai luas di seluruh aplikasi:
115 titik `throw new Error` (56 di 12 file `src/app/**/actions.ts`, 59 di
13 file `src/lib/queries/*.ts`), dipasangkan dengan 114 titik
`catch (err) { ... err instanceof Error ... }` di 25 file komponen client.
Begitu di-deploy production, **semua** pesan validasi bisnis yang sudah
ditulis jelas ini akan tampil sebagai teks generik yang sama dan
membingungkan ke user — bukan hanya di fitur Gabungkan jadi Jadwal.

## Tujuan

Pesan error yang sengaja ditulis developer untuk dibaca user (validasi
bisnis) harus selalu tampil apa adanya di production, tanpa pernah
tergantikan teks generik React. Error yang sungguh tak terduga (bug,
galat SQL mentah, dll) tetap TIDAK boleh bocor detail sensitifnya ke user
— tetap dicatat di log server dan diberi pesan generik yang aman, hanya
saja pesan generik itu ditulis sendiri oleh aplikasi (jelas, bukan teks
React yang membingungkan).

## Arsitektur

### `src/lib/action-result.ts` (baru)

```ts
import { unstable_rethrow } from "next/navigation";

export class AppError extends Error {}

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (err) {
    // Several actions call requireModuleAccess/requirePmputra/etc, which
    // redirect() on failure — redirect() works by throwing a special
    // Next.js control-flow error. unstable_rethrow lets that pass through
    // untouched instead of being swallowed into a generic AppError-style
    // response (see node_modules/next/dist/docs/.../unstable_rethrow.md).
    unstable_rethrow(err);
    if (err instanceof AppError) return { success: false, error: err.message };
    console.error(err);
    return { success: false, error: "Terjadi kesalahan tak terduga. Silakan coba lagi." };
  }
}
```

**Penting:** `unstable_rethrow(err)` harus dipanggil di baris PALING ATAS
blok `catch`, sebelum pengecekan apa pun — ini persis yang direkomendasikan
dokumentasi resminya (`node_modules/next/dist/docs/01-app/03-api-reference/
04-functions/unstable_rethrow.md`), supaya `redirect()`/`notFound()` yang
dipanggil transitif oleh fungsi guard (`requireModuleAccess`,
`requirePmputra`, `requireSuperAdmin`, dll — semuanya di
`src/lib/require-access.ts`) tetap benar-benar melakukan redirect,
bukan malah ditangkap sebagai "error tak terduga".

`AppError` menandai "pesan ini sengaja ditulis untuk dibaca user" — begitu
sebuah error adalah instance `AppError`, `runAction` meneruskan
`.message`-nya apa adanya ke client sebagai **nilai balik biasa** (bukan
`throw`), sehingga tidak pernah melewati jalur redaksi React sama sekali.
Error apa pun yang BUKAN `AppError` (galat teknis tak terduga) tetap
dicatat ke log server (`console.error`, perilaku yang sudah ada sekarang)
dan diberi pesan generik aman yang ditulis aplikasi sendiri.

Karena `AppError` merambat naik lewat rantai `await` biasa seperti error
JavaScript lainnya, tidak masalah jika `throw`-nya terjadi jauh di dalam
fungsi query (`src/lib/queries/*.ts`) — `runAction` di lapisan action
tetap menangkapnya dengan benar, dari kedalaman berapa pun.

### Migrasi 115 titik `throw new Error` yang sudah ada

Setiap `throw new Error("pesan jelas")` di `src/app/**/actions.ts` dan
`src/lib/queries/*.ts` diubah jadi `throw new AppError("pesan jelas")` —
murni penggantian nama class, teks pesan TIDAK berubah sama sekali. Ini
sengaja dipisah dari perubahan lain: rename tidak mengubah perilaku selain
menandai error itu sebagai "aman ditampilkan", jadi risikonya minimal dan
mudah diverifikasi (diff hanya `Error` → `AppError` per baris, plus satu
import baru per file).

### Cakupan pembungkusan `runAction`

TIDAK semua 56 fungsi action dibungkus otomatis. Aturan: sebuah fungsi
action dibungkus `runAction` **jika dan hanya jika** badannya (langsung
atau lewat fungsi query yang dipanggilnya) memuat `throw new AppError`.
Action baca-saja yang murni `SELECT` tanpa validasi bisnis (mis.
`getJadwalDetailAction`, `getAvailableSalesOrdersAction`) dibiarkan dengan
signature `Promise<T>` seperti sekarang — membungkusnya tidak ada
manfaatnya karena tidak ada pesan bisnis yang perlu diselamatkan, dan akan
menambah churn tanpa alasan (memaksa pemanggilnya yang sekarang tidak
punya UI error untuk tiba-tiba menanganinya).

Contoh transformasi (`mergeExternalDeliveriesAction`,
`src/app/(dashboard)/delivery/actions.ts`):

```ts
// Sebelum
export async function mergeExternalDeliveriesAction(
  armadaId: number,
  deliveryOrderIds: string[],
  jamJadwal: Date
): Promise<number> {
  const id = await mergeExternalDeliveriesIntoJadwal(armadaId, deliveryOrderIds, jamJadwal);
  revalidatePath("/delivery");
  return id;
}

// Sesudah
export async function mergeExternalDeliveriesAction(
  armadaId: number,
  deliveryOrderIds: string[],
  jamJadwal: Date
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const id = await mergeExternalDeliveriesIntoJadwal(armadaId, deliveryOrderIds, jamJadwal);
    revalidatePath("/delivery");
    return id;
  });
}
```

### Pola konsumsi di client

Setiap pemanggil action yang sudah dibungkus, yang sebelumnya:

```ts
try {
  const id = await mergeExternalDeliveriesAction(armadaId, ids, jamJadwal);
  onOpenChange(false);
  onDone();
} catch (err) {
  setError(err instanceof Error ? err.message : "Gagal menggabungkan pengiriman.");
}
```

menjadi:

```ts
const result = await mergeExternalDeliveriesAction(armadaId, ids, jamJadwal);
if (!result.success) {
  setError(result.error);
  return;
}
onOpenChange(false);
onDone();
// result.data kalau nilai baliknya dipakai (mis. jadwalId)
```

Pemanggil action yang TIDAK dibungkus (action baca-saja) tidak berubah
sama sekali.

## Rollout

Perubahan diterapkan sekaligus ke seluruh 12 area fitur yang punya
`actions.ts` (`delivery`, `akun` + `akun/peran` + `akun/sesi`, `mitra`,
`sales`, `pnl`, `transaksi`, `pemasaran`, `aging`, `grup/perusahaan`,
`pmputra/keuangan`, `pemesanan`, `profile-actions`, `api/lokasi`), bukan
bertahap — supaya tidak ada area yang "setengah lama setengah baru" untuk
waktu lama. Setiap area dikerjakan sebagai unit task tersendiri saat
implementasi (satu `actions.ts` + client-caller yang memanggilnya), karena
skalanya (~170 titik total) terlalu besar untuk satu task tunggal.

## Penanganan Error

Sudah dijelaskan di bagian Arsitektur — `runAction` adalah SATU-SATUNYA
titik penanganan error baru yang diperkenalkan. Tidak ada perubahan pada
bagaimana query-layer functions menyusun pesan errornya (pesan Bahasa
Indonesia yang sudah ada tetap dipakai apa adanya), hanya nama class-nya.

## Pengujian

Proyek ini tidak punya test runner (tidak ada vitest/jest). Verifikasi
dilakukan dengan:
- `npx tsc --noEmit` penuh setelah setiap area selesai — perubahan tipe
  balik (`Promise<T>` → `Promise<ActionResult<T>>`) akan memunculkan error
  TypeScript di setiap pemanggil yang belum ikut diperbarui, sehingga
  compiler sendiri jadi jaring pengaman utama untuk memastikan tidak ada
  pemanggil yang terlewat.
- Verifikasi manual di browser (dev server) untuk minimal satu skenario
  gagal per area yang benar-benar bisa dipicu (mis. Gabungkan jadi Jadwal
  dengan kapasitas berlebih) — pastikan pesan `AppError` tampil jelas di
  UI, bukan lagi teks generik React.
- `npx eslint` pada setiap file yang disentuh.

## Di Luar Cakupan

- Tidak mengubah pesan Bahasa Indonesia yang sudah ada di 115 titik throw
  — hanya nama class-nya.
- Tidak membungkus action baca-saja yang tidak melempar `AppError`.
- Tidak menyentuh `src/proxy.ts`, NextAuth, atau alur autentikasi lain di
  luar pola `"use server"` actions ini.
- Tidak mengubah `error.tsx` di level `(dashboard)` — boundary itu tetap
  berfungsi sebagai jaring pengaman terakhir untuk error yang benar-benar
  tidak tertangkap di level manapun (mis. error saat render Server
  Component itu sendiri, bukan dari action).
