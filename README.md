# Dashboard PMP Ponorogo

Dashboard operasional untuk pabrik es Maesa Group Ponorogo. Membaca data langsung dari SQL Server
"MKEsindo" (ERP existing), tanpa ORM (pakai `mssql`). Akun, peran, dan izin modul tersimpan di
Postgres `pmp_directory` (tabel `akun` / `peran` / `peran_izin`) — bukan lagi di MSSQL. Tabel MSSQL
lama (`DashboardAuth`, `DashboardUser`, `DashboardRole`, `DashboardRolePermission`) sudah di-DROP
pada 2026-08-22 lewat `scripts/drop-legacy-auth-tables.ts`.

Modul: P&L & BEP, Aging Piutang, Penjualan Harian per Cabang, Biaya Listrik/Operasional, Pengiriman.

## Menjalankan secara lokal

1. Salin `.env.example` menjadi `.env` dan isi kredensial SQL Server + `AUTH_SECRET`
   (generate dengan `npx auth secret` atau `openssl rand -base64 32`).
2. `npm install`
3. `npm run dev` — buka [http://localhost:3000](http://localhost:3000)

## Mengelola akun

Akun dibuat dan direset lewat UI admin di `/grup/akun` (menulis ke Postgres `akun`). Tidak ada lagi
seed script — `npm run seed:auth` dan `scripts/seed-dashboard-auth.ts` sudah tidak bisa dipakai
sejak `DashboardAuth` di-DROP; file scriptnya disimpan hanya sebagai catatan historis.

## Deploy (Coolify)

Repo ini sudah menyertakan `Dockerfile` multi-stage (`output: "standalone"`). Di Coolify, set
environment variables sesuai `.env.example` (`DB_*`, `AUTH_SECRET`,
`NEXTAUTH_URL=https://dash.pabrikespmp.com`) lewat panel Coolify, bukan di-bake ke image.

## Catatan skema penting

Lihat komentar di `src/lib/queries/*.ts` untuk catatan sumber data, termasuk:

- `DeliveryOrderDetail.Outstanding` tidak reliable — sisa kirim dihitung manual dari `Qty - Delivered`.
- Klasifikasi P&L pakai prefix `AccountNo` (bukan kolom `ChartOfAccount.Type`).
- Field `BusinessPartner` dipakai ulang untuk data yang tidak punya kolom khusus: `NPWPName` →
  Wilayah, `NPWPAddress` → Kecamatan, `MobileNo` → Kontak, `SalesmanID = '0127'` → TakeAway,
  `Gender` Female/Male → Retail/Agen.
- `src/lib/auth.ts` mengasumsikan `User.UserName` sebagai identifier login — belum sempat
  diverifikasi ke skema live saat scaffold dibuat, sesuaikan bila nama kolom aslinya berbeda.
