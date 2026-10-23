# Mitra Identitas & Lokasi Pengiriman — Checklist Deploy & Uji Browser

Rencana: `2026-10-23-mitra-identitas-lokasi-pengiriman.md` · Spec: `../specs/2026-10-23-mitra-identitas-lokasi-pengiriman-design.md`

## Sudah berlaku di produksi (sebelum deploy kode)
- Skema DB baru sudah dibuat di MKEsindo, DemoEsKristal, 5 DB Es Balok, dan Postgres. Sifatnya aditif, sehingga kode lama tetap aman.
- Migrasi kompetitor sudah jalan: 24 master, 94 relasi, 64/67 mitra (commit 0bde5ee).
- Backfill salinan alamat sudah jalan untuk 13.512 stop Jadwal ber-DO (commit aa7148a).

## Langkah deploy
1. Deploy kode (push `main`).
2. **Segera setelah deploy**, sebelum ada yang mengedit alamat mitra atau memakai "Jadikan Utama":
   - `npx tsx scripts/fix-backfill-snapshot-stop-2026-10-23.ts --execute`
   - Ini membekukan DO yang dibuat kode lama sejak backfill pertama. Skripnya idempoten.
3. Cek ulang kompetitor:
   - Jalankan `npx tsx scripts/fix-kompetitor-mitra-2026-10-23.ts` (tanpa `--execute`).
   - Bila skrip berhenti karena ada teks baru, tambahkan ke `docs/data-fixes/2026-10-23-kompetitor-mitra-disetujui.json`, lalu jalankan dengan `--execute`.
4. Di `/grup/akun/peran`, beri izin "Identitas Mitra (NIK & Berkas)" ke peran yang perlu di tiap PT.
   - Izin berlaku setelah pengguna login ulang.
   - Direktur dan Super Admin tidak perlu diatur.
5. Pastikan Google Drive sudah terhubung untuk setiap PT yang akan mengunggah NIK/SK. Tanpa Drive, unggahan ditolak; tidak ada simpanan cadangan ke disk.

## Uji browser (perlu login, belum dilakukan)
### Mitra Es Kristal (/mkesindo/mitra)
1. Buka Edit mitra. Isian alamat terkunci sebentar ("Memuat..."), lalu bisa diedit.
2. Simpan mitra lama tanpa perubahan. Data tetap sama.
3. Centang "Lokasi Pengiriman Berbeda", tambah 2 lokasi beserta pin. Peta menampilkan 3 pin.
4. "Jadikan Utama" pada lokasi ke-2 yang wilayahnya berbeda:
   - muncul peringatan;
   - peta yang sedang terbuka tertutup;
   - baris lokasi menampilkan alamat yang benar.
5. Hapus satu lokasi dengan ikon tempat sampah lalu Simpan. Hanya lokasi itu yang hilang.
6. Hapus centang lalu konfirmasi. Semua lokasi tambahan hilang.
7. Halaman basi:
   - Tambah lokasi lewat tab lain atau lewat Aplikasi Pemasaran.
   - Kembali ke tab pertama, lalu Edit dan Simpan.
   - Lokasi baru tidak boleh hilang.
8. Kompetitor baru lewat [+] muncul di mitra lain.
9. Peran tanpa izin Identitas: NIK tampil "Tersembunyi" dan tombol berkas tidak ada.
10. Unggah, pratinjau, dan hapus berkas NIK serta SK (gambar dan PDF).
11. /grup/akun/peran menampilkan bagian "Izin Khusus".

### Papan Pengiriman
1. Pesanan untuk mitra dengan 2 lokasi:
   - stop menampilkan pemilih lokasi;
   - setelah memilih lokasi ke-2, rute, jarak, dan BBM dihitung ulang.
2. Mitra dengan 1 lokasi, atau Jadwal yang sudah Terbit: tidak ada pemilih.
3. Selesai Muat:
   - pemilih hilang;
   - Cetak DO dan struk thermal memakai alamat lokasi ke-2;
   - DO di ERP desktop menampilkan AddressDelivery.
4. Edit lokasi itu atau jadikan Utama, lalu cetak ulang DO. Alamat lama tetap tercetak.
5. Aplikasi Driver: pin, alamat, dan kontak berasal dari lokasi terpilih. Bila kontak kosong, yang tampil kontak utama.
6. Ubah Pemesanan ke armada atau jam lain. Pilihan lokasi ikut terbawa.
7. Laporan Shift dan Inspeksi Satpam: "Lokasi Terjauh" mengikuti lokasi terpilih.

### Mitra Es Balok (/pmputra, /pmpersada, /pmpakis → mitra)
1. Ulangi uji Mitra Es Kristal nomor 1–6.
2. Kartu logistik bersama yang dibuka dari PMPakis menampilkan identitas dan lokasi yang sama dengan PMPersada. Menyimpan dari PMPakis tidak mengosongkan Harga dan Kapasitas Balok Besar.
3. Agen 0163 (PMPakis):
   - kedua kartu tetap ada dengan alamat masing-masing;
   - Wilayah harus dipilih sebelum bisa disimpan.
4. Akun Direktur bisa melihat NIK.

### Aplikasi Pemasaran, Pengajuan, ByChat
1. Detail mitra menampilkan Penanggung Jawab, lokasi, dan kompetitor. Edit di layar 375px berfungsi.
2. Pengajuan dengan 2 kompetitor (satu lewat [+]) → setujui → mitra baru punya 2 kompetitor. Uji dari Aplikasi Pemasaran, Aplikasi Driver, dan dialog dashboard.
3. Pengajuan lama bertuliskan "Es atlas, Belum ada kompetitor" → mitra hanya mendapat "Atlas".
4. Kunjungan di dekat lokasi tambahan diterima.
5. ByChat `/embed/mitra` untuk nomor yang hanya ada di kontak lokasi tambahan → mitra ditemukan.

## Konsekuensi yang perlu diketahui
- Agen 01100 dan 0163 (kartu ganda): "Jadikan Utama" dari satu kartu ikut memindahkan pin dan Telepon kartu lainnya, karena keduanya milik Agen yang sama.
- Suspend/hapus pada kartu ganda berlaku untuk seluruh Agen.
- Menyimpan form dengan kotak "Lokasi Pengiriman Berbeda" tidak dicentang menghapus semua lokasi tambahan. Ini termasuk lokasi yang ditambahkan orang lain saat form sedang terbuka.
- Lokasi terpilih tanpa pin tidak jatuh ke pin utama. Stop tampil "Tanpa lokasi" sampai lokasinya dipin.

## Tindak lanjut (bukan penghalang deploy)
- Penjaga izin edit modul "mitra" pada action tulis mitra, termasuk hapus dan suspend. Celah ini sudah ada sebelumnya.
- Cek kepemilikan mitra pada simpan di Aplikasi Pemasaran. Celah ini sudah ada sebelumnya.
- Persetujuan pengajuan belum atomik. Ini sudah ada sebelumnya.
- Mengganti lokasi stop belum menjalankan ulang aturan tumpang-tindih Jadwal.
- Query pertumbuhan Es Balok menghitung ganda Agen 01100/0163.
- Header CSP sandbox dan cek Content-Length pada rute berkas identitas.
