# Piutang Es Balok — Redesain ala MKEsindo

## Konteks

Modul Piutang untuk bisnis Es Balok (pmputra, pmpersada — dan nantinya pmpakis)
saat ini hanya punya: 2 KPI card (Total Piutang Mitra Saat Ini, Total Tabungan
Mitra Saat Ini), tabel tren bulanan, dan "Rincian per Agen" (kartu per mitra
dengan fitur Bayar/Tarik). User ingin tampilan disamakan dengan modul Piutang
MKEsindo (`/mkesindo/aging`, lihat `src/app/mkesindo/(dashboard)/aging/page.tsx`
dan `src/components/dashboard/piutang-sections.tsx`), termasuk 3 tab
(Invoice Outstanding, Pembayaran, Prioritas Pemulihan), sambil tetap
mempertahankan 2 KPI card yang sudah ada.

## Kendala model data (WAJIB dibaca sebelum implementasi)

MKEsindo punya `vCustomerStatement`, sebuah VIEW ERP yang SUDAH mencocokkan
setiap pembayaran (`SalesPayment`) ke invoice (`SalesInvoice`) tertentu, dan
setiap invoice punya `DueDate` eksplisit. Es Balok TIDAK punya ini:

- `PMP_Pembayaran` (tabel pembayaran/tarikan) hanya punya `AgenID`, TIDAK
  punya kolom yang menunjuk ke `PMP_Pemesanan` mana yang dibayar.
- `PMP_Pemesanan` (tabel pesanan/"invoice") TIDAK punya kolom jatuh
  tempo/termin sama sekali.

Karena itu, "Invoice Outstanding" dan "jatuh tempo" untuk Es Balok adalah
**pendekatan/asumsi**, bukan fakta langsung dari data:

1. **FIFO matching** (dikonfirmasi user): per `(kode, sumber, AgenID)`, urutkan
   `PMP_Pemesanan` dari `Tanggal` paling lama. Jumlahkan total `Pembayaran`
   (HANYA dari `PMP_Pembayaran.Pembayaran`, BUKAN `Tarikan` — Tarikan menaikkan
   hutang, bukan melunasi pesanan tertentu) milik Agen itu, lalu "serap" dari
   Pesanan tertua ke termuda sampai habis. Pesanan yang belum sepenuhnya
   terserap = baris "Invoice Outstanding", dengan `Outstanding` = nilai
   bersih Pesanan (net Retur) dikurangi bagian yang sudah terserap.
2. **Jatuh tempo = `Tanggal Pesanan + 14 hari`** (ASUMSI, bukan konfirmasi
   eksplisit user — koreksi jika salah). `DaysOverdue = DATEDIFF(DAY,
   Tanggal+14, GETDATE())`. Bucket & Status pakai ambang yang SAMA persis
   dengan MKEsindo (`aging.ts`): Belum Jatuh Tempo (≤0) / 1-30 / 31-60 / 61-90
   / >90 Hari; Status Sehat (≤30) / Perhatian (31-60) / Kritis (>60).
3. Retur pada Pesanan (jika ada, sebagian atau penuh) dikurangkan dari nilai
   Pesanan SEBELUM proses FIFO (net value = existing formula di
   `penjualan-piutang.ts`: `(BalokKecilRealisasi-Retur)*Harga + (BalokBesarRealisasi-Retur)*Harga`).

## Yang TIDAK berubah

- "Rincian per Agen" (`piutang-per-agen-table.tsx`, fitur Bayar/Tarik) tetap
  ada, TIDAK dihapus, TIDAK diganti oleh tab-tab baru. Ditempatkan di bawah
  ketiga tab baru (opsional — lihat Task terakhir plan, urutan final
  dikonfirmasi user saat review plan/spec).
- 2 KPI card "Total Piutang Mitra Saat Ini" dan "Total Tabungan Mitra Saat
  Ini" (`getPiutangSummary`) tetap dipertahankan persis seperti sekarang.
- Tabel "Tren Pergerakan Piutang Bulanan" tetap ada, tidak berubah dari
  pekerjaan sebelumnya di sesi ini.

## Arsitektur

Semua komponen UI generik MKEsindo dipakai ulang APA ADANYA (tidak fork):
`KpiCard`, `PiutangTabs`. `PiutangStatusPanel` dipakai ulang tapi dengan type
`Status` yang didefinisikan lokal (jangan import `PiutangStatus` dari
`aging.ts` — itu file khusus MKEsindo, Es Balok harus independen). Duplikasi
tipe 3-baris ini lebih baik daripada coupling lintas-modul.

`AgingTable` dan `CollectionPriorityTable` (MKEsindo) TIDAK dipakai ulang
langsung — kolom/aksinya (link ke invoice PDF MKEsindo, dialog target yang
query ke `DashboardCollectionTarget` MSSQL) spesifik MKEsindo. Buat versi Es
Balok baru: `EsBalokInvoiceOutstandingTable`, `EsBalokCollectionPriorityTable`.

### File baru

- `src/lib/queries/piutang-invoice-outstanding.ts`
  - `getEsBalokInvoiceOutstanding(kode: string): Promise<EsBalokInvoiceRow[]>`
    — jalankan FIFO per `(sumber, AgenID)` untuk KEDUA sumber (utama +
    logistik), gabungkan hasil. Row: `{ agenId, agenNama, sumber, noDokumen,
    tanggal, outstanding, daysOverdue, agingBucket, status, segmentasi }`.
  - `getEsBalokPiutangPeriodSummary(kode, filter): Promise<{ saldoAwalPeriode,
    totalPembayaranPeriode, totalPenjualanPeriode, ratioPiutangOmzetPct }>`
    — adaptasi `getPiutangSummary`'s baseline+movement formula tapi dengan
    cutoff tanggal custom (bukan bulanan), MENIRU pola `piutang-summary.ts`
    milik MKEsindo persis (Saldo Awal = saldo per Agen dihitung hanya dari
    baris dengan `Tanggal < startDate`; Total Pembayaran = SUM `Pembayaran`
    dalam rentang; Total Penjualan = SUM nilai bersih Pesanan dalam rentang;
    Ratio = TotalOutstandingSaatIni / TotalPenjualanPeriode * 100).
  - `getEsBalokStatusOverview(rows: EsBalokInvoiceRow[]): { status, count,
    total }[]` — group per Agen (bukan per invoice) pakai `MAX(DaysOverdue)`
    milik Agen itu, SAMA seperti `getPiutangStatusOverview` MKEsindo (supaya
    angka "N mitra" di 3 box konsisten dengan status BUKAN per-invoice).

- `src/lib/queries/piutang-priority-es-balok.ts`
  - `getEsBalokCollectionPriority(kode): Promise<EsBalokPriorityRow[]>` — 1
    baris per Agen dengan outstanding > 0: `PiutangBerjalan` (total, dari
    `getPiutangPerAgen`-style balance), `MaxDaysOverdue` (dari invoice
    outstanding di atas), `Status`, `TerakhirPesan`, `TerakhirBayar`, target
    pelunasan (join dari tabel Postgres baru).
  - `setEsBalokCollectionTarget(kode, agenId, agenNama, { targetDate,
    targetAmount, note }, userId)`, `removeEsBalokCollectionTarget(kode,
    agenId)` — tulis ke tabel Postgres.

### Tabel Postgres baru

```sql
CREATE TABLE IF NOT EXISTS piutang_es_balok_target (
  id BIGSERIAL PRIMARY KEY,
  kode VARCHAR(32) NOT NULL,        -- 'pmputra' | 'pmpersada' | 'pmpakis'
  agen_id VARCHAR(16) NOT NULL,     -- AgenID kanonis (lihat catatan di bawah)
  target_date DATE,
  target_amount NUMERIC(18,2),
  note VARCHAR(256),
  created_by_user_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kode, agen_id)
);
```

Dijalankan via `sql_execute_ddl` (bukan migration file — proyek ini tidak
punya sistem migration, lihat catatan di plan).

**Catatan AgenID lintas-database**: satu Agen fisik bisa punya `AgenID`
berbeda di database utama vs logistik (dua record ERP terpisah untuk PT yang
sama). `getPiutangPerAgen` yang sudah ada menggabungkan keduanya — cek
implementasinya untuk field mana yang dipakai sebagai key gabungan
(kemungkinan `row.agenId` sudah merupakan salah satu ID kanonis atau
gabungan). Task plan HARUS memverifikasi ini dan pakai key yang SAMA yang
sudah dipakai `piutang-per-agen-table.tsx` (agar target pelunasan konsisten
dengan mitra yang sama yang muncul di "Rincian per Agen").

### Perubahan UI

- `piutang-summary-panel.tsx` atau file page baru: susun ulang jadi 3 baris
  KPI + status panel PERSIS layout screenshot:
  - Baris 1 (3 kol): Saldo Awal Periode, Pembayaran Piutang Periode Ini,
    Rasio Piutang/Omzet — filter tanggal + dropdown Segmentasi (pengganti
    Wilayah MKEsindo) di kanan atas judul "Piutang".
  - Baris 2 (3 kol): Total Piutang Outstanding (KpiCard baru yang
    menampilkan `totalPiutangSaatIni` — SAMA angka dengan KPI lama, cukup
    gaya kartu kecil ala MKEsindo; KPI besar lama boleh dihapus/diganti kartu
    ini SELAMA nilainya identik, supaya tidak dobel — konfirmasi di
    review plan), Sudah Jatuh Tempo, >90 Hari (Kritis).
  - Baris 3: `PiutangStatusPanel` (Sehat/Perhatian/Kritis, N mitra masing-
    masing).
  - "Total Tabungan Mitra Saat Ini" tetap sebagai KpiCard terpisah (tidak ada
    padanannya di MKEsindo, Es Balok-only) — taruh di baris pertama atau
    sebagai kartu ke-4, keputusan visual di task implementasi.
- `PiutangTabs` (reuse) dengan 3 panel baru: Invoice Outstanding, Pembayaran,
  Prioritas Pemulihan.
- `EsBalokInvoiceOutstandingTable`: mirip `AgingTable` tapi kolom mitra pakai
  Segmentasi (bukan Wilayah/Kecamatan MKEsindo), tanpa link PDF invoice
  (Es Balok tidak punya PDF invoice per pesanan — cukup NoDokumen teks).
- `EsBalokPembayaranPanel`: daftar `PMP_Pembayaran` (Pembayaran + Tarikan)
  pada tanggal terpilih, mirip `PiutangPaymentsPanel`.
- `EsBalokCollectionPriorityTable` + dialog target: mirip
  `CollectionPriorityTable`, tapi submit ke `setEsBalokCollectionTarget`
  (server action baru per company, pola sama seperti
  `getPiutangBayarContextAction`).
- "Rincian per Agen" (`PiutangPerAgenTable`) tetap dirender, ditaruh SETELAH
  ketiga tab (di luar `PiutangTabs`, sebagai section sendiri seperti
  sekarang) — TIDAK dihapus.

### Halaman yang disentuh

`src/app/pmputra/piutang/page.tsx` dan
`src/app/pmpersada/(dashboard)/piutang/page.tsx` (pmpakis belum punya
halaman Piutang — di luar scope, tidak disentuh).

## Review Focus

1. FIFO harus per SUMBER (utama/logistik) terpisah, jangan campur — satu Agen
   bisa py Pesanan+Pembayaran di kedua sumber dengan saldo independen (lihat
   aturan "tidak boleh saling menutup" yang sudah berlaku di fitur Bayar/Tarik).
2. Retur harus dikurangi dari nilai Pesanan SEBELUM FIFO, bukan sesudah —
   kalau tidak, invoice yang sudah full-retur akan tetap muncul sebagai
   outstanding.
3. `getEsBalokPiutangPeriodSummary`'s "Saldo Awal Periode" harus konsisten
   dengan formula baseline yang SUDAH divalidasi cocok dengan ERP
   (`getPiutangSummary`) — jangan reimplementasi dari nol, adaptasi rumus
   yang sama persis dengan cutoff custom.
4. Query FIFO berpotensi berat (semua Pesanan+Pembayaran per Agen, bukan
   cuma agregat) — pastikan tetap agregasi SQL sebisa mungkin (kelompokkan
   per Agen dulu, FIFO alokasi hanya pada level yang benar-benar perlu
   granularitas per-dokumen), hindari mengulang bug connection-pool
   exhaustion yang pernah terjadi di modul ini (lihat komentar
   `getPiutangPerAgen`).
5. AgenID lintas-database untuk key tabel target pelunasan — pastikan key
   yang dipilih benar-benar mengidentifikasi mitra yang sama seperti yang
   dipakai `PiutangPerAgenTable`, supaya target yang di-set tidak "salah
   sasaran" mitra.

## Spec self-review

- Placeholder scan: tidak ada TBD/TODO tersisa.
- Konsistensi: field yang disebut (`EsBalokInvoiceRow`, `EsBalokPriorityRow`)
  konsisten dipakai antar bagian.
- Scope: cukup fokus untuk satu plan (meski besar) — semua bagian saling
  berkaitan langsung (KPI panel butuh Invoice Outstanding, Invoice
  Outstanding dipakai juga oleh Status Panel & Priority).
- Ambiguitas yang SENGAJA dibiarkan terbuka untuk plan/user memutuskan saat
  review: (a) apakah KPI lama "Total Piutang Mitra Saat Ini" dihapus atau
  digabung tampilannya dengan "Total Piutang Outstanding" yang baru; (b)
  urutan final "Rincian per Agen" vs tab baru di halaman.
