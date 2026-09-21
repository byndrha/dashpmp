# Posting Manual GeneralLedger untuk Backlog SI/DO (MKEsindo)

## Latar Belakang

Sejak 12 September 2026, mekanisme yang biasanya membuat ERP desktop MKEsindo otomatis mem-posting `SalesInvoice`/`DeliveryOrder` buatan dashpmp ke `GeneralLedger` berhenti bekerja secara tiba-tiba (dikonfirmasi lewat investigasi live: dokumen asal-dashpmp anjlok dari 97-100% ter-posting/hari menjadi ~0%, sementara dokumen asal-ERP tetap normal — lihat memori `gl-posting-backlog-do-si-sept12`). Root cause di sisi ERP belum ditemukan/diperbaiki. Backlog terus bertambah setiap hari (per 21 Sep 2026: >1.500 SalesInvoice dan >1.500 DeliveryOrder belum ter-posting, gap Pendapatan >Rp210 juta).

dashpmp sendiri **tidak pernah menulis ke `GeneralLedger`** sebelum ini — GL posting untuk SI/DO 100% tanggung jawab ERP. Fitur ini adalah kali pertama dashpmp mengambil alih sebagian tanggung jawab itu, secara manual/terkontrol, sebagai jalur cadangan selama sinkronisasi ERP belum pulih.

Dashboard "Kesehatan Posting GL (SI/DO)" (kartu di `/mkesindo/pnl`, dibangun sebelum spec ini) sudah menampilkan rasio dokumen dibuat vs ter-posting per hari, 30 hari terakhir — fitur ini menambahkan aksi "Proses" di tiap baris tanggal kartu tsb.

## Bagian 1: Mekanisme akuntansi yang direplikasi

Dikonfirmasi lewat investigasi live terhadap data GL yang sudah benar (sebelum 12 Sep):

**Sumber biaya**: tabel `ItemAverage` (kolom `ItemID`, `Year`, `Month`, `Average`) menyimpan rata-rata biaya per unit per item PER BULAN, dipelihara oleh ERP sendiri. Untuk tiap baris `DeliveryOrderDetail`/`SalesInvoiceDetail`:

```
biayaBaris = Qty × ItemAverage.Average  (dicocokkan ke ItemID + Year/Month dari TransDate dokumen)
```

Diverifikasi persis (36 kantong × 330,3011763302/kantong = 11.890,842348, cocok 100% dengan baris GL asli), termasuk pada dokumen multi-item (biaya dihitung per baris lalu dijumlahkan per akun tujuan dalam satu voucher).

**Pemetaan akun per ItemID**: bukan dari field kategori (semua kosong di data ini), murni per-ItemID. Contoh terverifikasi: item bernama "...5 KG" (0111, 0112) → 4004/5004/14013.1; item non-5KG (019, 0110) → 4001/5002/14013. Semesta ItemID yang benar-benar muncul di SI/DO backlog **kecil dan bisa didaftar** — mapping DIHITUNG LIVE tiap kali preview/proses dijalankan (query `SELECT DISTINCT ItemID, AccountNo` dari GL+detail+item pada window sebelum 12 Sep), bukan tabel statis yang dipelihara terpisah dan bisa basi kalau ada item baru. Kalau ada ItemID di backlog yang TIDAK PERNAH muncul di GL sebelum 12 Sep (item baru, tidak ada histori pemetaan sama sekali) — dokumen itu ikut di-skip dengan alasan "item baru, akun tujuan tidak diketahui", sama seperti kasus ItemAverage tidak ditemukan.

**Struktur GL per dokumen** (semua baris dalam satu voucher harus balance):

- **DeliveryOrder** (2 baris): `Debit 1399 Goods In Transit` = total biaya; `Credit <akun Persediaan per item>` = total biaya (bisa lebih dari 1 baris credit kalau item di dokumen itu mencakup lebih dari satu akun Persediaan, mis. campuran 10KG dan 5KG).
- **SalesInvoice** (4 baris minimal): `Credit <akun Pendapatan per item>` = Amount/Netto baris itu; `Credit 1399` = total biaya (menutup saldo yang dibuat DO); `Debit <akun HPP per item>` = total biaya; `Debit 1301 Piutang Usaha` = total Netto dokumen.

**Batasan cakupan**: hanya `SalesInvoice` + `DeliveryOrder`. `SalesReturn` di luar cakupan (struktur GL-nya beda/belum diinvestigasi) — kalau perlu, jadi proyek lanjutan terpisah.

**Dokumen yang di-skip, bukan ditebak**: kalau `ItemAverage` untuk (ItemID, Year, Month) tidak ditemukan (item baru, dsb.), dokumen itu dilewati dan masuk daftar "perlu review manual" — tidak pernah pakai nilai 0 atau estimasi.

## Bagian 2: Trackback (jejak audit)

Dua lapis, keduanya aditif terhadap data ERP (tidak mengubah field yang mungkin dipakai ERP untuk keperluan lain — `IsExported` pada `SalesInvoice` sengaja TIDAK disentuh, karena maknanya bagi ERP tidak diketahui):

1. **`GeneralLedger.Memo`** (kosong `''` di semua baris asli) diisi `"[DASHPMP-BACKFILL] <tanggal proses>"` pada setiap baris yang ditulis fitur ini — supaya terlihat langsung dari ERP tanpa perlu buka dashpmp.
2. **Tabel audit baru** (MSSQL, database MKEsindo yang sama, pola penamaan `Dashboard*` konsisten dengan tabel custom lain):
   - `DashboardGLPostingBackfill` — 1 baris per dokumen diproses: `BackfillID`, `VoucherNo`, `DocType` (`SALESINVOICE`/`DELIVERYORDER`), `DocumentID`, `TransDate`, `DipostingOlehAkunID` (akun Postgres directory), `DipostingPada`.
   - `DashboardGLPostingBackfillDetail` — 1 baris per baris-GL yang ditulis: `DetailID`, `BackfillID` (FK), `GeneralLedgerID` (ID baris GL asli yang dihasilkan — penting untuk undo persis, tidak menebak dari VoucherNo lagi), `AccountNo`, `Debit`, `Credit`.

## Bagian 3: Alur & UI

**Lokasi**: menyatu dengan kartu "Kesehatan Posting GL (SI/DO)" yang sudah ada di `/mkesindo/pnl` — setiap baris tanggal di tabel itu mendapat tombol aksi "Proses" (muncul hanya kalau baris itu punya backlog, hijau/tidak ada tombol kalau sudah 100%).

**Batching per tanggal** (bukan per jumlah dokumen): klik "Proses" pada satu baris tanggal → hanya memproses backlog SI+DO asal-dashpmp untuk `TransDate` hari itu saja (~150-190 dokumen/hari berdasarkan volume backlog saat ini — ukuran wajar untuk satu request, tidak berisiko timeout). Manager mengerjakan satu tanggal, lihat hasilnya, lanjut ke tanggal berikutnya.

**Alur per tanggal**:
1. Manager ke atas (gerbang sama seperti fitur kode ambil-alih: `requireManagerKeAtas()`) klik "Proses" pada baris tanggal tsb.
2. **Preview** (server action read-only, tidak menulis apa pun): daftar dokumen yang akan diposting untuk tanggal itu, total Rupiah per akun (Pendapatan, HPP, Persediaan, Piutang, 1399), dan daftar dokumen yang akan di-skip beserta alasan (ItemAverage tidak ditemukan, dll).
3. Dialog konfirmasi menampilkan ringkasan preview tsb. Manager klik "Posting Sekarang".
4. **Eksekusi** (server action, menulis sungguhan): tiap dokumen diproses dalam satu transaksi MSSQL sendiri (semua baris GL + baris audit dokumen itu sukses, atau rollback semuanya). Sebelum insert, cek ulang atomik di dalam transaksi bahwa `VoucherNo`+`Type` itu masih belum punya baris GL (mencegah dobel-tulis kalau tombol diklik dua kali atau proses tumpang tindih).
5. Hasil: ringkasan berhasil/di-skip per dokumen, kartu "Kesehatan Posting GL" ter-refresh menunjukkan baris tanggal itu membaik.

**Riwayat**: baris tanggal yang sudah pernah diproses menampilkan info dari `DashboardGLPostingBackfill` (siapa & kapan) — tidak perlu UI riwayat terpisah untuk versi pertama ini.

## Global Constraints

- Semua UI dan pesan berbahasa Indonesia.
- Akses dibatasi `requireManagerKeAtas()` (Manager ke atas), sama seperti fitur kode ambil-alih.
- Hanya memproses dokumen asal-dashpmp (terhubung ke `DashboardPengirimanJadwalDetail` atau `DashboardTakeAwayMuatan`) — dokumen asal-ERP tidak pernah disentuh fitur ini.
- Hanya `SalesInvoice`+`DeliveryOrder`. `SalesReturn` di luar cakupan.
- Setiap dokumen: satu transaksi MSSQL, atomik, idempoten (cek ulang di dalam transaksi sebelum insert).
- Dokumen dengan `ItemAverage` tidak ditemukan untuk (ItemID, Year, Month) WAJIB di-skip dengan alasan eksplisit, tidak pernah pakai nilai default/0.
- Field ERP yang maknanya tidak diketahui dashpmp (`IsExported`, dll) tidak boleh ditulis oleh fitur ini.
- Tidak ada framework migrasi — tabel baru dibuat lewat script `scripts/_scratch_*.ts` sekali jalan sesuai konvensi repo ini.
- Tidak ada test suite otomatis — verifikasi via `npx tsc --noEmit`, `npx eslint`, dan skrip scratch yang membandingkan hasil algoritma terhadap data GL yang SUDAH BENAR (sebelum 12 Sep) sebagai validasi sebelum menyentuh backlog sungguhan.

## Verifikasi

Sebelum fitur ini dipakai untuk menulis backlog sungguhan, WAJIB divalidasi dengan cara: jalankan algoritma perhitungan (tanpa menulis) terhadap sample dokumen dari tanggal-tanggal NORMAL (mis. 1-11 Sep, yang sudah benar ter-posting ERP), lalu bandingkan hasil hitungan dengan baris GL asli yang sudah ada — harus cocok persis (sampai desimal) untuk dianggap valid. Kalau ada ketidakcocokan, algoritma belum boleh dipakai ke backlog sungguhan.

Verifikasi lain per task: `npx tsc --noEmit`, `npx eslint <file berubah>`, skrip scratch DB live (dihapus setelah dipakai) untuk memverifikasi insert GL yang atomik/idempoten, dan uji live browser untuk alur preview→konfirmasi→posting.
