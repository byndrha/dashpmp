# Riset Modul Kelistrikan — 22 November 2026

Tujuan modul: mengubah "Kelistrikan" dari daftar jurnal biaya listrik menjadi alat operasional — tahu **berapa kWh dipakai, kapan (WBP/LWBP), oleh mesin apa, dan di shift siapa** — sehingga penghematan (terutama saat mesin dimatikan) bisa diukur dan dikaitkan dengan kinerja staf produksi.

## 1. Kondisi saat ini (data nyata MKEsindo, dicek baca-saja)

Skrip: `scripts/diag-kelistrikan-2026-11-22.ts`.

| Hal | Temuan |
|---|---|
| Halaman `/mkesindo/electricity` | Hanya daftar jurnal GL akun 6105 "Listrik" + % terhadap pendapatan. Tidak ada kWh, WBP/LWBP, atau data mesin. |
| Biaya listrik (GL, per bulan) | Rp 100–240 jt/bulan; Nov 2025–Okt 2026 total ≈ **Rp 1,84 miliar/tahun**. **Okt 2026 Rp 239,9 jt, naik 40% dari Sep (Rp 171,1 jt)** — belum ada data untuk menjelaskan kenapa. |
| Cara biaya dicatat | Satu jurnal umum per bulan ("Biaya Listrik Bulan …"), tanpa rincian kWh/WBP/LWBP/kVArh. |
| Mesin produksi (`DashboardProduksiMesin`) | 3 mesin. Hanya **Msn 1** yang `KonsumsiListrikKWh` terisi (120); **Msn 2 & Msn 3 = 0**. |
| Catatan On/Off mesin (`DashboardProduksiMesinEvent`) | Fitur sudah ada (waktu + akun pencatat), tetapi **hampir tidak dipakai**: 16 kejadian sejak 28 Agu 2026, terakhir 4 Okt, semuanya oleh satu orang. |
| Tabel meter listrik | **Belum ada** (tidak ada tabel kWh/meter/WBP/LWBP). |

Kesimpulan: fondasi "mesin & on/off per shift" sudah ada di kode, tetapi data dasarnya (kWh mesin, pembacaan meter) belum ada. Tanpa pembacaan meter, angka penghematan apa pun hanya perkiraan.

## 2. Aturan tarif PLN yang relevan

Sumber: Permen ESDM No. 7/2024 (dasar tarif), dokumen penyesuaian tarif PLN Okt–Des 2026, sunenergy.id (golongan I-3/I-4), taalenta.id (kVArh), include.co.id (membaca rekening industri).

- **Golongan**: pabrik dengan daya > 200 kVA s.d. 30 MVA masuk **I-3/TM** (industri menengah). Tarif I-3 ≈ **Rp 1.114,74/kWh** (Q2 2026, mengikuti *tariff adjustment* per kuartal). *Perlu konfirmasi golongan & daya kontrak MKEsindo dari rekening.*
- **Waktu pemakaian**: **WBP** (Waktu Beban Puncak) umumnya **17.00–22.00**, sisanya **LWBP**. Harga WBP = **K × harga LWBP**, dengan **1,4 ≤ K ≤ 2** (ditetapkan PLN per sistem setempat).
- **Biaya beban**: dari daya tersambung (kVA), tetap tiap bulan walau mesin mati.
- **Rekening minimum (RM)**: 40 jam nyala × kVA tersambung × tarif — dikenakan bila pemakaian di bawahnya.
- **Kelebihan kVArh (daya reaktif)**: dikenakan bila faktor daya rata-rata bulanan < 0,85.
  `Kelebihan kVArh = kVArh sebulan − 0,62 × (kWh WBP + kWh LWBP)`; tarif I-3 Rp 1.114,74/kVArh. Penyebab umum: beban motor/kompresor tanpa capacitor bank yang memadai.
- **PPJ** (Pajak Penerangan Jalan): persentase dari pemerintah daerah.
- Meter industri TM memakai **faktor kali** (rasio CT/PT). Selisih angka di register harus dikali faktor ini — tanpa itu angkanya tampak kecil dan menyesatkan.

Implikasi untuk pabrik es: kompresor pendingin adalah beban terbesar dan bisa dijadwalkan. **Memindahkan produksi dari jam 17.00–22.00 ke LWBP** dan **mematikan mesin saat tidak produksi** adalah dua penghematan paling cepat; pencatatan kVArh menunjukkan apakah ada biaya daya reaktif yang bisa dihapus dengan kapasitor.

## 3. Usulan rancangan modul

### 3.1 Data yang perlu dicatat

1. **Snapshot meter PLN per shift** (inti modul) — tabel baru, misalnya `DashboardListrikMeterSnapshot`:
   `Waktu`, `Shift`, `kWhLWBP` (register), `kWhWBP` (register), `kVArh` (register), `FaktorKali`, `FotoMeter`, `DicatatOlehAkunID`.
   - Diambil di **pergantian shift** (dan idealnya pukul 17.00 & 22.00 untuk memisahkan WBP dengan pasti).
   - Wajib **foto meter** (pola sama dengan kamera watermark yang sudah dipakai di aplikasi produksi), supaya angka bisa diaudit.
   - Pemakaian periode = selisih register × faktor kali. Validasi: register tidak boleh turun; lonjakan tak wajar ditandai.
2. **Konsumsi per mesin**: lengkapi `KonsumsiListrikKWh` untuk Msn 2 & 3 (kWh per jam nyala dari nameplate/pengukuran), plus kategori beban: *Produksi (kompresor)*, *Pendingin gudang*, *Penerangan/lainnya*.
3. **On/Off mesin**: pakai `DashboardProduksiMesinEvent` yang sudah ada, tetapi **dibuat wajib/terdorong** di aplikasi produksi (mis. checklist awal/akhir shift, pengingat bila mesin tidak punya catatan dalam satu shift).
4. **Rekening PLN bulanan** (input bagian keuangan): biaya beban, kWh WBP, kWh LWBP, kVArh, PPJ, total — untuk mencocokkan meter sendiri vs tagihan, dan menghitung harga efektif per kWh.
5. **Pengaturan tarif**: golongan, daya kontrak (kVA), harga LWBP, faktor K, jam WBP, faktor kali meter — bisa berubah per kuartal.

### 3.2 Tampilan yang diusulkan

- **Ringkasan**: kWh hari ini/bulan ini, porsi WBP (%), estimasi biaya (kWh × tarif), harga efektif Rp/kWh, faktor daya & potensi denda kVArh.
- **kWh per produk**: kWh ÷ kantong/balok yang diproduksi per shift — indikator efisiensi utama, dibandingkan antar shift dan antar hari.
- **Jam mesin & penghematan**: jam nyala per mesin per shift dari catatan On/Off; "jam mati" di luar produksi × kWh/jam × tarif = **penghematan terukur**.
- **Peta WBP**: berapa produksi/mesin yang menyala di 17.00–22.00 dan berapa rupiah selisihnya bila digeser ke LWBP.
- **Rekonsiliasi bulanan**: meter sendiri vs rekening PLN vs jurnal GL 6105 — menjawab pertanyaan seperti "kenapa Oktober naik 40%?".
- **Kaitan kinerja staf**: per shift/penanggung jawab — kWh per kantong, kepatuhan mencatat meter & On/Off, kWh di jam WBP — masuk ke modul Kinerja Karyawan.

### 3.3 Tahapan yang disarankan

1. **Tahap 1 — pencatatan**: form snapshot meter (+foto) di aplikasi produksi tiap pergantian shift; pengaturan tarif; lengkapi kWh mesin. *Tanpa ini tahap lain tidak punya data.*
2. **Tahap 2 — analitik**: ringkasan kWh/biaya, WBP vs LWBP, kWh per kantong, rekonsiliasi dengan GL.
3. **Tahap 3 — mesin & staf**: wajibkan On/Off mesin, hitung jam nyala & penghematan, sambungkan ke Kinerja Karyawan.
4. **Tahap 4 (opsional)**: meter digital/IoT (Modbus/power meter) untuk data per jam otomatis, menggantikan pembacaan manual.

## 4. Pertanyaan yang perlu dijawab sebelum membangun

1. Golongan tarif & daya kontrak (kVA) MKEsindo, dan berapa faktor K di rekening? (Lihat satu rekening PLN terakhir.)
2. Meter PLN: jenis (elektronik dengan register WBP/LWBP/kVArh?) dan **faktor kali** meternya?
3. Siapa yang mencatat meter dan kapan — operator tiap pergantian shift, atau satpam/teknisi pada jam tetap (mis. 07.00, 17.00, 22.00)?
4. Apakah ada sub-meter per mesin/panel, atau hanya satu meter utama PLN?
5. Berapa kWh per jam nyala Msn 2 & Msn 3 (nameplate kompresor), dan beban pendingin gudang?
6. Apakah Oktober 2026 (Rp 239,9 jt) termasuk tagihan susulan/koreksi, atau memang pemakaian naik?
7. Modul ini untuk MKEsindo saja dulu, atau langsung juga PT Es Balok (PMPutra/PMPersada/PMPakis)?

### Jawaban user (22 Nov 2026)

| # | Jawaban |
|---|---|
| 1–3 | **Belum tahu** — tanyakan lagi nanti (golongan/kVA/K, jenis meter & faktor kali, lonjakan Okt). |
| 4 | **Operator, tiap pergantian shift**; seharusnya minimal **pukul 17.00 dan 22.00**. Rincian jam shift menyusul. |
| 5 | **Hanya satu meter utama PLN.** Rencana: pasang alat pencatat otomatis terhubung jaringan — menunggu kepastian soket & izin PLN. |
| 6 | Data daya mesin yang valid **masih dicari**. |
| 7 | **Semua perusahaan** (Es Kristal & Es Balok), dengan variabel/keadaan berbeda per perusahaan. |

Implikasi desain:
- Semua pengaturan tarif & meter **per perusahaan** dan **boleh kosong**; angka rupiah/kWh terkoreksi hanya tampil bila datanya sudah diisi (selain itu tampil "belum bisa dihitung", bukan angka tebakan).
- Pembacaan pukul 17.00 & 22.00 sudah cukup memisahkan WBP (17→22) dan LWBP (22→17 esok hari) dari selisih register, bahkan bila meter tidak punya register WBP/LWBP terpisah.
- Satu meter utama → konsumsi per mesin hanya bisa **diperkirakan** (jam nyala × daya), dan baru setelah daya mesin diketahui.
- Skema dicatat dengan kolom **sumber** (manual/otomatis) supaya alat otomatis nanti tinggal menulis ke tabel yang sama.
