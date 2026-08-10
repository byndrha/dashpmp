# Perluasan Modul Produksi — Akses, Tanggal, Sisa Kantong, Shift (Design Spec)

## Latar Belakang

Modul Produksi (dashboard `/mkesindo/produksi` + mobile `/mkesindo/produksi-app`) sudah selesai dibangun dan berjalan. Pekerjaan ini adalah 4 perluasan/perbaikan berdasarkan penggunaan nyata:

1. **Akses & navigasi** — `/mkesindo/produksi` saat ini HANYA bisa diakses akun `is_produksi` (lewat `requireProduksi()`, bukan sistem izin modul biasa), dan tidak muncul di sidebar untuk role lain. Akun `is_produksi` sendiri mendarat di `/mkesindo/produksi` setelah login. Kedua hal ini diubah: `/mkesindo/produksi` jadi modul biasa (bisa diberi izin ke role lain untuk peninjauan), dan akun `is_produksi` mendarat di `/mkesindo/produksi-app` setelah login.
2. **Tanggal di Kartu Pengiriman** (produksi-app) — kartu saat ini hanya menampilkan jam, tanpa tanggal.
3. **Sisa kantong per pallet** (Peta Warehouse) — saat ini sisa kantong 10kg/5kg cuma muncul setelah pallet diklik, tidak langsung terlihat di selnya.
4. **Tanggal & Shift di Produksi Baru** — form pencatatan produksi baru belum punya cara mencatat tanggal produksi (yang mungkin beda dari hari pencatatan) dan shift kerja.

Satu pertanyaan pengguna soal alur Kartu Pengiriman sudah dijawab terpisah (klik kartu = buka layar alokasi pallet, BUKAN "Mulai Muat" — itu baru terjadi saat "Konfirmasi Isi Muatan" ditekan) — tidak ada perubahan kode untuk itu.

## 1. Akses & Navigasi

**Modul baru di sistem izin**: tambah `"produksi"` ke `MODULE_KEYS`/`MODULE_LABEL` di `src/lib/permissions.ts`. Ini otomatis membuatnya muncul sebagai baris baru di tabel izin Peran Editor (`peran-editor.tsx` sudah me-render satu `<tr>` per `MODULE_KEYS` secara generik — tidak perlu kode UI baru di sana).

**Entri sidebar baru**: tambah ke `NAV_ITEMS` di `app-sidebar.tsx` — `{ href: "/mkesindo/produksi", label: "Produksi", icon: Factory, moduleKey: "produksi" }` (ikon `Factory` dari `lucide-react`). Muncul untuk siapa pun yang Peran-nya diberi izin `canView` pada modul ini (mekanisme yang sama seperti modul lain — `NAV_ITEMS.filter((item) => permissions[item.moduleKey]?.canView)`).

**Guard baru untuk permukaan desktop**: fungsi baru `requireProduksiView()` di `src/lib/require-access.ts`, dipakai HANYA oleh `/mkesindo/produksi/layout.tsx`, `/mkesindo/produksi/page.tsx`, dan setiap fungsi di `src/app/mkesindo/produksi/actions.ts` — MENGGANTIKAN `requireProduksi()` di keempat tempat itu:

```ts
// Desktop /mkesindo/produksi is now a regular, permission-gated module
// (like Pengiriman, Penjualan, etc.) rather than exclusively is_produksi's
// own view — but is_produksi accounts still get automatic access without
// needing the "produksi" module permission explicitly granted, since they
// remain a special role (mirrors canAccessAllPT's superadmin/direktur
// bypass pattern, just for this one module instead of every module).
export async function requireProduksiView() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessAllPT(session.user) && !session.user.isProduksi && !canView(session.user.permissions, "produksi")) {
    redirect("/akses-ditolak");
  }
  return session;
}
```

`requireProduksi()` sendiri **tidak diubah** dan tetap dipakai apa adanya oleh semua halaman `/mkesindo/produksi-app/*` (layout, page per tab) — mobile app tetap eksklusif untuk akun `is_produksi`, tidak dibuka untuk pemegang izin modul biasa.

**Redirect login `is_produksi` berubah tujuan**: di `src/app/mkesindo/(dashboard)/layout.tsx`, blok confinement `is_produksi` (baris ~70-83) tetap ADA (akun `is_produksi` tetap tidak bisa mengembara ke modul dashboard lain), cuma tujuan redirect-nya berubah dari `/mkesindo/produksi` ke `/mkesindo/produksi-app`:

```ts
if (!session?.user?.isSuperAdmin && session?.user?.isProduksi && !pathname.startsWith("/mkesindo/produksi")) {
  redirect("/mkesindo/produksi-app");
}
```

Kondisi `!pathname.startsWith("/mkesindo/produksi")` tetap dipertahankan apa adanya (masih mencakup baik `/mkesindo/produksi` maupun `/mkesindo/produksi-app` sebagai "sudah di rumahnya sendiri, tidak perlu di-redirect") — supaya akun `is_produksi` yang SEDANG membuka `/mkesindo/produksi` (lewat sidebar, karena mereka otomatis py `requireProduksiView()` bypass di atas) tidak ikut ter-redirect paksa ke produksi-app. Ini konsisten dengan jawaban Anda: mereka boleh tetap membuka `/mkesindo/produksi`, cuma pendaratan AWAL setelah login yang pindah ke produksi-app.

## 2. Tanggal di Kartu Pengiriman

`src/components/produksi-app/kartu-pengiriman-list.tsx` — baris tanggal ditambahkan tepat di atas/berdampingan baris jam yang sudah ada (baris ~54-56), dari field `jadwal.JamJadwal` yang sama (sudah berupa datetime lengkap, tidak perlu query baru):

```tsx
<p className="text-xs text-muted-foreground">
  {new Date(jadwal.JamJadwal).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
  {" • "}
  {new Date(jadwal.JamJadwal).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
</p>
```

Tidak ada perubahan query/tipe data — `DraftJadwalForProduksi.JamJadwal` sudah cukup.

## 3. Sisa Kantong per Pallet

`src/components/produksi/peta-warehouse.tsx` (komponen bersama, dipakai baik dashboard `/mkesindo/produksi` maupun `/mkesindo/produksi-app/warehouse` — perubahan ini otomatis berlaku di kedua tempat, disengaja karena tidak ada alasan salah satu permukaan TIDAK dapat manfaat yang sama). Sel pallet (`Cell`, baris 25-39) yang sekarang cuma menampilkan kode 2-huruf, ditambah baris kecil sisa kantong di bawahnya:

```tsx
function Cell({ kode }: { kode: string }) {
  const row = byKode.get(kode);
  return (
    <button
      type="button"
      onClick={() => row && setSelected(row)}
      className={cn(
        "flex h-14 flex-1 flex-col items-center justify-center rounded-md text-xs font-semibold leading-tight",
        row ? ageClass(row.TanggalProduksi) : "bg-muted text-muted-foreground"
      )}
    >
      <span>{kode}</span>
      {row?.BatchIDAktif != null && (
        <span className="text-[9px] font-normal opacity-90">
          {row.SisaQty10KG ?? 0}·{row.SisaQty5KG ?? 0}
        </span>
      )}
    </button>
  );
}
```

Format singkat "10·5" (dipisah titik tengah, bukan label panjang "10kg/5kg") supaya muat di sel kecil (`h-14`) — detail lengkap dengan label tetap ada di panel bawah saat pallet diklik (tidak diubah). Sel yang kosong (tidak ada `BatchIDAktif`) tidak menampilkan baris angka ini sama sekali (tidak ada apa-apa untuk ditampilkan).

## 4. Tanggal & Shift Produksi Baru

**Migrasi DB (controller-run, 2 kolom baru di `DashboardProduksiBatch`)**:

```sql
ALTER TABLE DashboardProduksiBatch ADD TanggalLabel DATE NOT NULL DEFAULT CAST(GETDATE() AS DATE);
ALTER TABLE DashboardProduksiBatch ADD Shift TINYINT NOT NULL DEFAULT 1;
```

`TanggalLabel`/`Shift` adalah metadata deskriptif BARU, terpisah dari `TanggalProduksi` yang sudah ada. **`TanggalProduksi` TIDAK disentuh** — tetap diisi `GETDATE()` apa adanya di `createBatch` (`produksi-warehouse.ts`), tetap jadi acuan urutan FIFO/pewarnaan usia pallet seperti sekarang. `TanggalLabel`+`Shift` murni label "batch ini secara bisnis dicatat untuk tanggal & shift produksi yang mana" — bisa beda dari `TanggalProduksi` (mis. batch dicatat telat, atau shift malam yang melewati tengah malam).

**Shift**: 3 nilai tetap, disimpan sebagai `TINYINT` (1/2/3), dipetakan ke label+jam di kode TS (bukan tabel referensi baru — cuma 3 nilai tetap, tidak butuh tabel):

```ts
export const SHIFT_LABEL: Record<1 | 2 | 3, string> = {
  1: "Shift 1 (07:00)",
  2: "Shift 2 (15:00)",
  3: "Shift 3 (23:00)",
};
```

**`CreateBatchInput`/`createBatch`** (`produksi-warehouse.ts`) dapat 2 field baru: `tanggalLabel: string` (ISO date), `shift: 1 | 2 | 3`. INSERT-nya menambahkan kedua kolom, memakai parameter yang dikirim (bukan `GETDATE()`).

**Form `ProduksiBaruForm`** dapat 2 kontrol baru, ditaruh sebelum field Mesin yang sudah ada:
- **Tanggal**: `<Input type="date">`, default value dari `getBusinessDateISO()` (business-date hari ini, rollover 14:00 WIB — konvensi yang sama dipakai di seluruh app, BUKAN logika cutoff baru khusus shift), bisa diubah manual oleh pengguna.
- **Shift**: `<Select>` 3 opsi dari `SHIFT_LABEL`, default Shift 1.

Keduanya wajib diisi sebelum submit (validasi sama seperti field Mesin/Posisi yang sudah ada — pesan error kalau kosong).

**Tampilan Riwayat Produksi & Warehouse detail**: `RiwayatProduksiRow`/`PalletPosisiRow` (dan `getRiwayatProduksi`/`getWarehouseMap`'s SELECT) ditambah `TanggalLabel`/`Shift`, ditampilkan di `RiwayatProduksi` (dashboard) sebagai info tambahan per baris (mis. "11 Agu 2026 — Shift 2") dan di panel detail pallet PetaWarehouse (saat diklik) sebagai baris tambahan.

## Testing

Tidak ada test runner di proyek ini. Verifikasi: `npx tsc --noEmit`, `npm run lint`, dan verifikasi langsung di browser — termasuk: akun bukan-`is_produksi` dengan izin modul "Produksi" diberikan bisa lihat `/mkesindo/produksi` dari sidebar; akun `is_produksi` login mendarat di `/mkesindo/produksi-app` tapi tetap bisa buka `/mkesindo/produksi` manual; kartu produksi-app menampilkan tanggal; sel pallet menampilkan sisa kantong; form Produksi Baru menyimpan tanggal+shift dengan benar dan `TanggalProduksi` tetap real-time.

## Di Luar Cakupan

- Tidak ada perubahan pada `TanggalProduksi` (FIFO/usia pallet tetap berbasis waktu pencatatan nyata).
- Tidak ada tabel referensi baru untuk shift — 3 nilai tetap di kode.
- Tidak ada perubahan pada alur "Mulai Muat"/"Konfirmasi Isi Muatan" (sudah benar seperti sekarang, dikonfirmasi lewat pertanyaan terpisah).
- `requireProduksi()` (guard mobile produksi-app) tidak diubah — hanya guard desktop yang diperluas lewat fungsi baru `requireProduksiView()`.
