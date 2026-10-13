# Penagihan otomatis via ByChat (ekstensi modul Piutang)

Tanggal: 2026-10-14. Disetujui pemilik: Jalur A; pembagian tugas dashpmp = penjadwal/otak, ByChat = jalur kirim + kotak masuk.

## Penempatan
- **/grup/perusahaan → Ubah PT → Integrasi ByChat**: HANYA tombol "Penagihan otomatis" (aktif/nonaktif per PT).
- **Modul Piutang (tab "Penagihan ByChat")**: seluruh pengaturan (hari, jam, jeda, batas harian, kriteria mitra, mode), ronde/antrean, hasil penagihan, daftar opt-out. Fokus awal MKEsindo (`/mkesindo/aging`).
- **Coolify Scheduled Task** memicu `POST /api/penagihan/tick` tiap menit (header `x-cron-secret` = env `PENAGIHAN_CRON_SECRET`). Aman dipanggil berulang; tombol mati = tick tidak mengirim apa pun.

## Alur
1. Tick: untuk tiap PT dengan integrasi aktif **dan** penagihan aktif, di dalam jendela hari/jam (WIB).
2. **Susun ronde** (sekali per hari): kandidat = mitra dengan faktur lewat ≥ N hari, total piutang ≥ ambang, punya nomor valid yang cocok TEPAT satu mitra, bukan opt-out, belum ditagih dalam X hari. Urut: paling lama lewat lalu terbesar; dipotong batas harian. Tiap kandidat diberi jadwal rencana (jeda acak min–maks, jeda panjang tiap N pesan).
3. Mode **pratinjau** (bawaan): ronde menunggu persetujuan petugas di tab; mode **otomatis**: langsung berjalan.
4. **Proses**: baris yang jadwalnya tiba → cek ulang piutang & opt-out (sudah lunas/opt-out → dilewati) → buat gambar tepat sebelum kirim → `integration_messages` (idempoten, audit) → catat hasil. 3 kegagalan beruntun → auto-pause 1 jam.
5. **Status pesan** (terkirim/gagal di WhatsApp) dibaca lewat API ByChat setelah kirim (tahap lanjutan, menunggu jawaban sesi ByChat).

## Data (Postgres)
`penagihan_pengaturan` (per PT), `penagihan_ronde`, `penagihan_antrean`, `penagihan_optout`; kolom `penagihan_aktif` pada `perusahaan_bychat_koneksi`.

## Nilai awal
Senin–Sabtu 09.00–16.00 WIB; jeda acak 20–60 dtk; jeda panjang 300 dtk tiap 10 pesan; batas 100/hari; faktur lewat ≥ 7 hari; piutang ≥ Rp 100.000; ulang tiap 7 hari; mode pratinjau.

## Keamanan
Bawaan MATI. Hanya nomor yang cocok tepat satu mitra. Satu kartu per mitra per periode. Rahasia cron tak pernah di repo. Pengujian memakai ByChat tiruan; tidak ada pesan nyata.
