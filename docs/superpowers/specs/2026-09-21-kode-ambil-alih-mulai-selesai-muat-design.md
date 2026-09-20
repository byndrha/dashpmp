# Kode Ambil-Alih untuk Mulai/Selesai Muat Manual (Delivery)

## Ringkasan

`/mkesindo/delivery` (Papan Pengiriman, dipakai Staf Operasional) punya tombol "Mulai Muat" dan "Selesai Muat" yang secara teknis melakukan hal yang sama dengan alur normal di aplikasi produksi (Kepala Produksi/Wakilnya) — tapi tanpa alokasi pallet, dan (ditemukan saat investigasi) **tanpa gerbang akses sama sekali** di level aksi. Tujuan fitur ini: menjadikan board delivery sebagai jalur manual/darurat yang secara aktif dipersulit (bukan alur utama), lewat kode ambil-alih sekali-pakai yang hanya bisa digenerate oleh peran Manager ke atas.

Alur singkat: Manager generate kode 6-digit (wajib re-entry password dulu) lewat ikon baru di navbar, kode berlaku 3 menit atau sampai terpakai. Manager sampaikan kode itu secara lisan/chat ke Staf Operasional. Staf Operasional memasukkan kode itu saat menekan Mulai Muat/Selesai Muat di board delivery — kalau valid, aksi asli baru benar-benar berjalan.

## Bagian 1: Skema data (Postgres)

Flag baru di tabel `peran` (pola sama dengan `is_produksi`/`is_operasional` yang sudah ada):

```sql
ALTER TABLE peran ADD COLUMN boleh_generate_kode_ambil_alih BOOLEAN NOT NULL DEFAULT FALSE
```

Tabel baru (kode + riwayat sekaligus, tidak ada tabel riwayat terpisah):

```sql
CREATE TABLE kode_ambil_alih (
  id SERIAL PRIMARY KEY,
  kode VARCHAR(6) NOT NULL,
  dibuat_oleh_akun_id INT NOT NULL,
  dibuat_pada TIMESTAMPTZ NOT NULL DEFAULT now(),
  kedaluwarsa_pada TIMESTAMPTZ NOT NULL,
  dipakai_pada TIMESTAMPTZ NULL,
  dipakai_oleh_akun_id INT NULL,
  dipakai_untuk_jadwal_id INT NULL,
  dipakai_untuk_aksi VARCHAR(20) NULL
)
```

Database: Postgres yang sama dengan akun/peran/sesi (bukan MSSQL) — fitur ini pada dasarnya perluasan sistem otentikasi, bukan konsep domain pengiriman. Dibuat lewat script `scripts/_scratch_*.ts` sekali jalan, konvensi yang sudah berlaku di repo ini untuk kedua jenis database (MSSQL maupun Postgres).

"Generate baru otomatis membatalkan yang lama" diterapkan lewat LOGIKA VERIFIKASI (baris paling baru dibuat + cocok nilai + belum dipakai + belum kedaluwarsa), bukan kolom status terpisah — baris lama tetap ada apa adanya sebagai riwayat, tidak dihapus/ditandai, otomatis kalah begitu ada baris yang lebih baru.

## Bagian 2: Perubahan sistem role & sesi

- `src/components/dashboard/peran-editor.tsx` (dan action pendukungnya) — tambah toggle "Boleh Generate Kode Ambil-Alih", pola sama dengan toggle `is_produksi`/`is_operasional` yang sudah ada.
- `src/lib/auth.ts` — tambah `bolehGenerateKodeAmbilAlih` ke JWT callback & session callback, sama pola dengan `isProduksi`/`isOperasional`.
- `src/types/next-auth.d.ts` — tambah tipe field yang sama ke `Session["user"]`/JWT augmentation.
- `src/lib/require-access.ts` — fungsi baru:
  ```typescript
  export async function requireManagerKeAtas() {
    const session = await auth();
    if (!session?.user) redirect("/login");
    if (!canAccessAllPT(session.user) && !session.user.bolehGenerateKodeAmbilAlih) {
      redirect("/akses-ditolak");
    }
    return session;
  }
  ```
  Superadmin/Direktur otomatis boleh (lewat `canAccessAllPT`, pola yang sama dipakai gate-gate lain di file ini).

## Bagian 3: Generate & riwayat kode (navbar)

**UI baru** di `src/app/mkesindo/(dashboard)/layout.tsx` — ikon baru sebaris dengan `NotificationBell`/`AppearanceMenu`/`UserMenu` (baris 119-130), dirender HANYA untuk sesi yang lolos `requireManagerKeAtas` (disembunyikan total untuk yang lain, dicek dari `session.user` yang sudah tersedia di layout server component).

Klik ikon membuka dialog:
1. **Kode aktif saat ini** (kalau baris kode paling baru masih valid — belum dipakai, belum lewat 3 menit): tampil langsung besar + hitung mundur, TANPA perlu password lagi (melihat ulang bukan aksi sensitif baru — identitas sudah dibuktikan saat generate). Tombol "Generate Kode Baru" tersedia, otomatis menggantikan yang sedang tampil.
2. **Kalau tidak ada kode aktif** (belum pernah generate / sudah terpakai / sudah kedaluwarsa): tampil form password langsung → submit → kalau benar, kode 6 digit + hitung mundur 3 menit muncul.
3. **Riwayat Kode**: daftar kode-kode sebelumnya — siapa generate & kapan, status (Terpakai/Kedaluwarsa), siapa pakai & kapan, JadwalID & aksi (Mulai/Selesai Muat) kalau sudah terpakai. JadwalID ditampilkan sebagai nomor referensi polos (tidak perlu lookup detail Jadwal lintas MSSQL untuk sekarang).

**Server Actions baru** (lokasi: file actions yang menaungi layout/navbar, atau file baru `src/app/(dashboard)/kode-ambil-alih/actions.ts` sesuai kebiasaan struktur repo):
- `generateKodeAmbilAlihAction(password: string): Promise<ActionResult<{ kode: string; kedaluwarsaPada: string }>>` — `requireManagerKeAtas()`, verifikasi password lewat pola yang sama dengan login (`findAkunByUsername(session.user.username)` + `bcrypt.compare(password, hash)`), generate angka 6-digit acak, INSERT baris baru dengan `kedaluwarsa_pada = now() + interval '3 minutes'`.
- `getKodeAmbilAlihAktifAction(): Promise<ActionResult<{ kode: string; kedaluwarsaPada: string } | null>>` — `requireManagerKeAtas()`, kembalikan baris terbaru kalau masih valid (untuk ditampilkan ulang tanpa password saat dialog dibuka lagi), `null` kalau tidak ada yang aktif.
- `getRiwayatKodeAmbilAlihAction(): Promise<ActionResult<KodeAmbilAlihRow[]>>` — `requireManagerKeAtas()`, daftar riwayat (join nama akun pembuat/pemakai lewat `getAkunNamaMap`, pola yang sudah dipakai di banyak tempat lain di dashboard ini).

## Bagian 4: Verifikasi & konsumsi kode di tombol Mulai/Selesai Muat

**Perbaikan yang menyatu dengan fitur ini**: `startMuatAction`/`selesaiMuatAction` (`src/app/mkesindo/(dashboard)/delivery/actions.ts`) saat ini TIDAK memanggil gerbang akses apa pun (beda dari action lain di file yang sama, yang semuanya memanggil `requireModuleAccess("delivery")`). Sekalian ditambahkan gerbang itu di kedua action ini.

**Fungsi verifikasi & konsumsi baru** (klaim atomik terhadap baris kode TERBARU, pola sama seperti klaim stok atomik `UPDATE ... WHERE kondisi RETURNING id` yang sudah dipakai berulang kali di sesi ini):

```sql
UPDATE kode_ambil_alih
SET dipakai_pada = now(), dipakai_oleh_akun_id = $1, dipakai_untuk_jadwal_id = $2, dipakai_untuk_aksi = $3
WHERE id = (SELECT id FROM kode_ambil_alih ORDER BY dibuat_pada DESC LIMIT 1)
  AND kode = $4 AND dipakai_pada IS NULL AND kedaluwarsa_pada >= now()
RETURNING id
```

Kalau 0 baris terpengaruh → `AppError("Kode ambil-alih tidak valid, sudah dipakai, atau sudah kedaluwarsa.")` — `startMuatAction`/`selesaiMuatAction` gagal total, aksi Mulai/Selesai Muat asli TIDAK dijalankan sama sekali (fail-fast, dipanggil sebelum logika asli).

**Perubahan signature**: `startMuatAction(jadwalId, kode: string)`, `selesaiMuatAction(..., kode: string)` (parameter kode ditambahkan ke signature yang sudah ada, urutan parameter lain tidak berubah).

**UI**: `src/components/dashboard/route-validation-dialog.tsx` — klik "Mulai Muat"/"Selesai Muat" memunculkan dialog kecil "Masukkan Kode Ambil-Alih" terlebih dahulu (dengan catatan: alur normal seharusnya lewat aplikasi produksi, kode didapat dari Manager). Action asli baru dipanggil setelah kode diisi & disubmit.

## Global Constraints

- Semua UI dan pesan error berbahasa Indonesia.
- Kode ambil-alih berlaku universal di `/mkesindo/delivery` — TIDAK ADA pengecualian untuk akun manapun (Tim Produksi memang tidak bisa akses halaman ini sama sekali, jadi tidak relevan).
- Kode 6 digit angka, berlaku 3 menit ATAU sampai terpakai sekali (mana yang lebih dulu).
- Generate kode baru otomatis membuat kode lama yang belum terpakai tidak valid lagi — diterapkan lewat logika verifikasi (selalu bandingkan ke baris TERBARU), bukan menghapus/menandai baris lama.
- Melihat ulang kode aktif (dialog dibuka lagi sebelum kedaluwarsa/terpakai) TIDAK perlu password lagi — hanya GENERATE kode baru yang wajib re-entry password.
- Verifikasi kode WAJIB atomik (`UPDATE ... WHERE ... RETURNING`) untuk mencegah kode yang sama dipakai dua kali oleh dua permintaan bersamaan.
- `startMuatAction`/`selesaiMuatAction` WAJIB memanggil `requireModuleAccess("delivery")` (perbaikan celah yang sudah ada, bukan hanya penambahan kode).
- Tidak ada framework migrasi — perubahan skema (baik Postgres maupun MSSQL) lewat script `scripts/_scratch_*.ts` sekali jalan, dijalankan lalu dihapus, tidak pernah di-commit.
- Tidak ada test suite otomatis — verifikasi via `npx tsc --noEmit`, `npx eslint`, script scratch DB terhadap data live.

## Verifikasi

Tidak ada test suite di repo ini. Setiap task diverifikasi seperti proyek-proyek sebelumnya di sesi ini: `npx tsc --noEmit`, `npx eslint <file berubah>`, script scratch yang memanggil fungsi langsung terhadap data live (dihapus setelah dipakai). Verifikasi khusus yang perlu dicakup:
- Password salah saat generate → ditolak, tidak ada baris kode baru tercipta.
- Generate kode baru → kode lama (kalau ada & belum terpakai) otomatis tidak bisa dipakai lagi (verifikasi lewat percobaan pakai kode lama setelah kode baru dibuat, harus gagal).
- Kode benar & valid → `startMuatAction`/`selesaiMuatAction` berhasil, baris kode ter-update (`dipakai_pada` terisi, dst).
- Kode salah/kedaluwarsa/sudah terpakai → `startMuatAction`/`selesaiMuatAction` gagal total, TIDAK ada perubahan apa pun di `DashboardPengirimanJadwal` (rollback penuh, atau verifikasi bahwa aksi asli memang tidak pernah terpanggil).
- Akun tanpa `boleh_generate_kode_ambil_alih` (dan bukan superadmin/Direktur) mencoba generate → ditolak `requireManagerKeAtas`.
- Ikon navbar tidak muncul sama sekali untuk akun non-Manager (bukan cuma disembunyikan visual tapi tetap bisa diakses lewat URL langsung — action-nya sendiri tetap harus digerbangi server-side, bukan cuma disembunyikan di client).
