# Koreksi tahap dan Kosongkan can (admin, layar produksi) — desain singkat

Tanggal: 2026-11-10 · Disetujui pengguna 2026-11-10 ("oke laksanakan") · Ukuran: perubahan kecil.

## Maksud
Admin produksi harus bisa (1) mengubah tahap es secara manual dan (2) mengosongkan can tanpa menunggu es matang
dan tanpa memilih kendaraan. Hanya admin, hanya di layar admin desktop (`/{kode}/produksi`), bukan di aplikasi HP
operator (`produksi-app`).

## Yang sudah ada (tidak diubah)
- Tahap tidak disimpan; dihitung dari `mulai_at` + durasi beku (`hitungKematangan` → `tahapDari`).
- Dialog **Koreksi isian** (admin, gerbang "kelola", alasan wajib, tercatat di log audit) sudah mengubah waktu isi air,
  varian, dan himpunan slot. Slot kosong = isian selesai; `jumlah_awal` ikut digeser agar invarian
  `jumlah_awal = sisa + Σ keluar` tetap berlaku → can yang dikosongkan tidak terhitung produksi/panen dan tidak ikut
  pencocokan DO.

## Perubahan
1. **Pilihan Tahap** di dialog Koreksi (Isian, Solidifikasi, Kristalisasi, Siap, Matang). Memilih tahap mengisi
   "Waktu isi air" ke batas bawah tahap itu (0 / 1 / 50 / 75 / 100 %), jadi es lanjut berjalan mengikuti waktu.
   Pengguna tetap bisa mengatur waktu manual; pilihan tahap mengikuti waktu yang diketik. Tidak muncul untuk isian
   Babonan (Jaga tidak punya tahap). Dinonaktifkan bila varian diubah di dialog yang sama (durasi beku baru belum
   diketahui klien) — simpan varian dulu.
2. **Tombol Kosongkan** per isian di bagian Koreksi (admin): dialog kecil dengan grid pilih can (bawaan: semua can
   isian terpilih), alasan wajib, tombol destruktif. Memanggil `koreksiIsianAction` dengan `slot` = can yang tersisa
   (kosong bila semua dikosongkan). Tanpa kendaraan, tanpa syarat tahap.

## Bukan tujuan
Tidak ada tabel/kolom baru, tidak ada aksi server baru, tidak ada perubahan di aplikasi operator.

## Pilihan saya (bukan keputusan pengguna)
- Batas bawah tahap (bukan tengah) sebagai titik awal; waktu bisa disetel manual.
- Pengosongan tercatat sebagai `koreksi_isian` (jejak audit sudah ada) — tidak dibuat jenis log baru.

## Uji
Fungsi murni `mulaiUntukTahap(tahap, durasiJam, sekarang)`: untuk tiap tahap dan beberapa durasi,
`tahapDari(hitungKematangan(hasil, durasi, sekarang))` = tahap itu dan persen = batas bawah.
