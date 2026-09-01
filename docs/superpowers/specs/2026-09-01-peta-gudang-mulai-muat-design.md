# Penyatuan "Mulai Muat" ke Peta Stok Es (produksi-app)

## Latar belakang

Operator produksi-app mengeluhkan UI "Mulai Muat" saat ini (tab Pengiriman, `src/components/produksi-app/kartu-pengiriman-list.tsx`): setelah menekan sebuah Kartu Pengiriman lalu "Mulai Muat", layar `AlokasiScreen` menampilkan daftar pallet sebagai **teks** ("Pallet {kode}") yang terpisah sama sekali dari peta gudang visual di tab Stok Es (`src/components/produksi-app/warehouse-view.tsx`) — operator harus menghafal kode pallet tanpa tahu di mana pallet itu secara fisik.

Tab Stok Es sendiri sudah punya mekanisme yang relevan (dibangun terpisah oleh pemilik produk, dikonfirmasi masih berlaku dilanjutkan/diubah untuk kebutuhan ini): 3 "Area Muat" (dermaga truk) di kolom kanan zona Utara, yang menampilkan kartu Kartu Pengiriman begitu keberangkatannya tinggal <2 jam lagi (`JAM_AMBANG_MENDEKATI_KEBERANGKATAN`), menimpa arsiran kuning kosong milik dermaga tersebut. Yang belum ada: pemasangan visual antara dermaga yang terisi dengan pallet mana yang seharusnya diambil (FIFO — stok termalam duluan).

Pemilik produk mengusulkan menyatukan kedua hal ini: tombol "Mulai Muat" pindah ke kartu Area Muat itu sendiri, dan pemilihan pallet + kuantitas dilakukan langsung dengan menekan kotak pallet di peta — bukan lagi daftar teks terpisah.

## Tujuan

- "Mulai Muat" dipicu dari kartu Area Muat di tab Stok Es, bukan dari tab Pengiriman.
- Memilih pallet dilakukan dengan menekan kotak pallet langsung di peta gudang, bukan daftar teks kode pallet.
- Pallet kosong tidak bisa ditekan saat mode ambil stok aktif (mode ini murni untuk mengambil, bukan menambah stok).
- Pallet dengan stok FIFO-tertua mendapat penanda visual yang jelas saat mode ambil stok aktif.
- Tab Pengiriman tetap ada sebagai daftar referensi + tombol "Selesai Muat" cepat (tanpa pallet, sudah ada), tapi kehilangan tombol "Mulai Muat".

## Non-tujuan

- Tidak mengubah ambang `JAM_AMBANG_MENDEKATI_KEBERANGKATAN` (tetap 2 jam) atau mekanisme dermaga-3-slot yang sudah ada.
- Tidak mengubah `produksiStartMuatAction`/`produksiSelesaiMuatAction`/`getBatchAktifForAlokasiAction` di lapisan server — logikanya dipakai ulang persis sama, hanya lapisan UI yang berpindah tempat.
- Tidak menambah cara baru untuk memulai muat pada Kartu Pengiriman yang keberangkatannya masih >2 jam — operator menunggu sampai kartu itu masuk salah satu Area Muat.
- Tidak mengubah alur "Selesai Muat cepat" (tanpa pallet) yang sudah ada di tab Pengiriman.
- Tidak mengubah `TambahProduksiDialog`/alur tambah stok produksi baru — itu tetap dijangkau lewat menekan pallet di LUAR mode ambil stok, seperti sekarang.

## Model interaksi: "Mode Ambil Stok"

`WarehouseView` mendapat satu state baru: pallet mana yang sedang dalam proses diambil untuk Kartu Pengiriman yang mana (`pickingJadwal: DraftJadwalForProduksi | null`). Saat `pickingJadwal` terisi, seluruh peta (lintas ketiga zona Selatan/Tengah/Utara — operator tetap bisa berpindah zona, karena pallet yang dibutuhkan bisa saja tidak semuanya ada di Utara) masuk **mode ambil stok**:

- Kotak pallet **kosong** menjadi redup dan tidak bisa ditekan (`onClick` dinonaktifkan) — sebelumnya kotak kosong bisa ditekan untuk menambah produksi baru; di mode ini itu tidak relevan.
- Kotak pallet **terisi** tetap bisa ditekan, mengikuti kode warna umur yang sudah ada (merah/kuning/hijau) sebagai penanda umum. Pallet yang menjadi baris pertama hasil `getBatchAktifForAlokasiAction` (FIFO paling depan) mendapat cincin highlight tambahan — pemasangan visual "ambil di sini dulu" yang diminta.
- Menekan kotak pallet terisi di mode ini **tidak lagi** membuka dialog detail/tambah-produksi — sebagai gantinya membuka popover kecil tepat di atas kotak berisi input angka qty10kg (maksimum = sisa stok pallet itu) + tombol OK. Menekan kotak yang sama lagi membuka ulang popover untuk mengoreksi angkanya.
- Kartu Area Muat lain (2 dermaga yang tidak sedang diproses) menjadi non-interaktif (diredupkan) selama mode ambil stok aktif untuk satu Kartu Pengiriman — mencegah dua sesi pengambilan berjalan tumpang tindih. Berakhir otomatis begitu operator menyelesaikan atau membatalkan sesi yang sedang berjalan.

**Pallet dengan lebih dari satu batch aktif** (badge "×N" yang sudah ada di `WarehouseCell`): popover tetap menampilkan **satu** input angka gabungan untuk kotak itu (mewakili "berapa banyak yang mau diambil dari pallet fisik ini"), bukan satu input per batch — sesuai kenyataan fisik yang dilihat operator. Di baliknya, angka itu dialokasikan otomatis ke batch-batch pada posisi tersebut secara FIFO (batch termalam duluan) sampai jumlahnya terpenuhi, sebelum dikirim ke `produksiSelesaiMuatAction`'s `alokasi` list (yang tetap per-BatchID seperti sekarang).

## Alur lengkap

1. Kartu Area Muat di tab Stok Es menampilkan Kartu Pengiriman begitu keberangkatannya <2 jam (tidak berubah dari sekarang).
2. Operator menekan kartu tersebut. Jika `JamMulaiMuat` belum ada: muncul dialog konfirmasi ringkas "Mulai Muat — {ArmadaNama}?" (menampilkan kebutuhan kantong 10kg/5kg, sama seperti info yang sudah ada di layar "Mulai Muat" lama) dengan tombol Ya/Batal. Menekan Ya memanggil `produksiStartMuatAction` (stempel `JamMulaiMuat`, tidak berubah), lalu masuk mode ambil stok untuk Kartu Pengiriman itu. Jika `JamMulaiMuat` sudah ada (sesi yang dilanjutkan setelah sebelumnya dibatalkan) — langsung masuk mode ambil stok tanpa dialog ini, sama seperti gate `IsiMuatanScreen` yang sudah ada hari ini.
3. Peta masuk mode ambil stok (lihat bagian di atas). Sebuah panel mengambang muncul di bagian bawah layar (tetap terlihat saat berpindah zona), berisi:
   - Total qty10kg yang sudah dialokasikan vs kebutuhan (`Sudah dialokasikan: X kantong 10kg`, sama seperti teks yang sudah ada).
   - Input angka manual untuk qty5kg (`Qty 5kg dimuat (tanpa pallet, langsung)`, field yang sama persis seperti sekarang — tidak ada representasi pallet untuk 5kg).
   - Tombol "Selesai Muat", aktif begitu kombinasi qty10kg+qty5kg sudah cukup (logika `cukup` yang sudah ada, tidak berubah).
   - Tombol "Batal" — keluar dari mode ambil stok tanpa menyelesaikan. `JamMulaiMuat` tetap tersimpan (sesi bisa dilanjutkan lagi nanti dengan menekan kartu Area Muat yang sama).
4. Menekan "Selesai Muat" membuka dialog konfirmasi tujuan pengiriman yang sama persis seperti sekarang (daftar `CustomerName`+qty per tujuan, tombol Ya/Tidak) → `produksiSelesaiMuatAction` → mode ambil stok berakhir, dermaga kembali kosong (arsiran muncul lagi) atau terisi Kartu Pengiriman berikutnya yang sudah <2 jam.

## Perubahan tab Pengiriman

`KartuPengirimanList` (`kartu-pengiriman-list.tsx`) kehilangan seluruh alur `IsiMuatanScreen`/`AlokasiScreen` — menekan sebuah kartu tidak lagi membuka layar apa pun (tidak ada pengganti tampilan detail). Yang tersisa di tab ini: daftar Kartu Pengiriman (referensi visual, termasuk yang belum <2 jam), badge "Sedang dimuat" bila relevan, dan tombol "Selesai Muat" cepat (`QuickSelesaiDialog`, tanpa pallet) yang sudah ada — tidak berubah sama sekali.

## Struktur file

- `src/components/produksi-app/warehouse-view.tsx`: tambah state `pickingJadwal`, teruskan ke `TruckCard`/`TruckDockColumn` (jadi trigger mode ambil) dan ke `WarehouseCell` (jadi trigger nonaktif/highlight/popover). Tidak menambah logika alokasi di sini — didelegasikan ke komponen baru di bawah.
- **Baru:** `src/components/produksi-app/pallet-ambil-panel.tsx` — komponen yang memegang seluruh state sesi ambil-stok (`alokasi: Record<batchId, qty10KG>`, `qty5Dimuat`, pengambilan `getBatchAktifForAlokasiAction`, dialog konfirmasi, pemanggilan `produksiSelesaiMuatAction`) — dipindahkan (bukan disalin) dari `AlokasiScreen` yang lama, plus popover per-kotak dan panel mengambang. `WarehouseView` merender ini saat `pickingJadwal != null`.
- `src/components/produksi/warehouse-cell.tsx`: tambah prop mode (mis. `mode: "lihat" | "ambil"`) yang mengendalikan: kotak kosong dinonaktifkan, kotak FIFO-terdepan mendapat highlight tambahan, dan `onClick` memicu popover ambil (bukan dialog detail) saat `mode === "ambil"`.
- `src/components/produksi-app/kartu-pengiriman-list.tsx`: hapus `IsiMuatanScreen`, `AlokasiScreen`, dan import terkait (`getBatchAktifForAlokasiAction`, `produksiStartMuatAction`) yang tidak lagi dipakai di file ini — `getJadwalDetailForProduksiAction` tetap dipakai (masih dibutuhkan `QuickSelesaiDialog`).

## Error handling & edge case

- **Pallet habis saat popover terbuka** (dua operator memuat bersamaan): validasi sisi server pada `produksiSelesaiMuatAction` (yang sudah ada, transaksional) tetap jadi penjaga akhir — popover UI hanya membatasi maksimum berdasarkan data yang terakhir dimuat, tidak real-time lintas-perangkat.
- **Membatalkan sesi lalu menekan Area Muat lain**: karena hanya satu `pickingJadwal` aktif per waktu, membatalkan (atau menyelesaikan) sesi harus benar-benar mengosongkan state ini sebelum dermaga lain bisa ditekan.
- **Kartu Pengiriman keluar dari 3 slot Area Muat sebelum selesai dimuat** (jadwal baru yang lebih mendesak masuk): perilaku ini sudah ada sebelum perubahan ini (bukan regresi baru) — di luar cakupan spec ini.

## Testing

- Tekan kartu Area Muat kosong (arsiran) → pastikan tidak ada aksi (belum ada jadwal untuk dermaga itu).
- Tekan kartu Area Muat berisi jadwal, belum `JamMulaiMuat` → dialog konfirmasi muncul → Ya → peta masuk mode ambil, kotak kosong redup & tidak bisa ditekan, satu kotak mendapat highlight FIFO-terdepan.
- Tekan kotak pallet terisi → popover qty muncul → isi angka → OK → panel bawah menunjukkan total bertambah.
- Isi cukup 10kg+5kg → tombol Selesai Muat aktif → konfirmasi tujuan → `produksiSelesaiMuatAction` sukses → dermaga kembali kosong/terisi jadwal berikutnya.
- Tekan Batal di tengah sesi → peta kembali ke mode lihat normal → tekan kartu Area Muat yang sama lagi → langsung masuk mode ambil (tanpa dialog konfirmasi Mulai Muat lagi, karena `JamMulaiMuat` sudah tersimpan).
- Di tab Pengiriman, pastikan tidak ada lagi tombol/aksi "Mulai Muat" pada kartu mana pun, dan "Selesai Muat" cepat tetap berfungsi seperti sebelumnya.
