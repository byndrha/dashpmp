# Font pada kartu piutang

`kartu-fonts.ts` memuat subset latin (WOFF, base64) dari font berikut, diambil dari paket
[Fontsource](https://fontsource.org) (jsDelivr). Semuanya berlisensi **SIL Open Font License 1.1**
(https://openfontlicense.org), yang mengizinkan penyematan dan redistribusi.

| Font | Bobot | Dipakai untuk |
|---|---|---|
| Inter | 400, 500, 600, 700 | isi kartu (sama dengan `--font-body` dashboard) |
| Space Grotesk | 500, 600, 700 | judul dan angka besar (`--font-display`) |
| IBM Plex Mono | 400, 500 | nomor faktur (`--font-data`) |

Font di-embed (bukan diunduh saat build/runtime) supaya render gambar tidak bergantung pada
jaringan ke Google Fonts. Untuk memperbarui: unduh ulang WOFF latin dari Fontsource dan hasilkan
ulang `kartu-fonts.ts` (base64 per bobot).
