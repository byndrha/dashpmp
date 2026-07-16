# Dashboard PMP Ponorogo

Dashboard operasional untuk pabrik es Maesa Group Ponorogo. Membaca data langsung dari SQL Server
"MKEsindo" (ERP existing), tanpa ORM (pakai `mssql`). Login diverifikasi ke tabel `DashboardAuth`
(terpisah dari `User.PasswordHash` lama).

Modul: P&L & BEP, Aging Piutang, Penjualan Harian per Cabang, Biaya Listrik/Operasional, Pengiriman.

## Menjalankan secara lokal

1. Salin `.env.example` menjadi `.env` dan isi kredensial SQL Server + `AUTH_SECRET`
   (generate dengan `npx auth secret` atau `openssl rand -base64 32`).
2. `npm install`
3. `npm run dev` — buka [http://localhost:3000](http://localhost:3000)

## Seed password awal user

Setelah `DashboardAuth` kosong, jalankan `npm run seed:auth` untuk membuat password acak untuk
setiap user di tabel `User` yang belum punya baris `DashboardAuth`. Hasilnya (username + password
plaintext) ditulis ke `scratchpad/dashboard-auth-seed-<timestamp>.csv` (di-gitignore) — bagikan
manual ke tiap user lalu hapus file tersebut.

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
