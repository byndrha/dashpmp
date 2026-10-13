# Integrasi dashpmp ↔ ByChat: panel Mitra + kirim Kartu Piutang

Tanggal: 2026-10-13. Disetujui langsung oleh pemilik di sesi dashpmp ("Setuju, bangun semua tahap"). Kontrak sisi ByChat: bagian 11–13 `D:\System\byCall-1.1.0-final\docs\INTEGRASI-DASHPMP-BYCHAT.md`.

## Tujuan
1. Di ByChat (iframe "Dashboard App" di sidebar percakapan) agen melihat ringkasan mitra yang nomor WhatsApp-nya sedang diajak chat: pembelian terbaru + aging piutang.
2. Tombol "Kirim kartu piutang" mengirim gambar kartu piutang mitra itu ke WhatsApp mitra lewat ByChat; pesan tercatat di percakapan.

## Keputusan (pemilik)
- Satu PT = satu akun ByChat (mkesindo, pmputra, pmpersada, pmpakis). Pemetaan dikelola di dashpmp (**/grup/perusahaan → Ubah PT → Integrasi ByChat**).
- Otoritas embed = token bertanda tangan ByChat (JWT HS256, 60 dtk). Tanpa cookie lintas situs, tanpa pemetaan email agen→akun dashpmp. Yang boleh menagih: agen akun ByChat itu, peran apa pun.
- Nomor kosong/ganda diterima apa adanya: normalisasi, UI pilihan bila satu nomor cocok >1 mitra, pesan jelas bila tidak ada.
- Kartu piutang versi awal tanpa menunggu penetapan isi; mudah diubah.

## Arsitektur
| Unit | Berkas | Tugas |
|---|---|---|
| Normalisasi nomor | `src/lib/bychat/phone.ts` | `08…`/`+62…`/`62…`/`8…` → `62…`; satu kolom bisa memuat >1 nomor |
| Verifikasi token | `src/lib/bychat/token.ts` | `jose` jwtVerify: iss=`bychat`, aud=origin dashpmp, exp, HS256; gagal tertutup |
| Konfigurasi per PT | `src/lib/queries/perusahaan-bychat.ts` + tabel `perusahaan_bychat_koneksi` | URL, ID akun (unik), token API terenkripsi (AES-GCM seperti kredensial koneksi lain), ID inbox |
| Lookup mitra | `src/lib/bychat/mitra.ts` | per PT: `BusinessPartner` (mkesindo) atau `PMP_Agen` (Es Balok); selalu satu database PT |
| Data kartu | `src/lib/bychat/kartu-data.ts` | faktur outstanding + aging + total + pembelian terbaru |
| Gambar kartu | `src/lib/bychat/kartu-image.tsx` | PNG 1080 px lewat `next/og` |
| Kirim | `src/lib/bychat/kirim.ts` + tabel `bychat_kirim_audit` | panggil `integration_messages`, idempotency, batas frekuensi, audit |
| API | `src/app/api/bychat/{mitra,kartu,kirim}/route.ts` | semua menerima token konteks; PT dari `account_id` token |
| Embed | `src/app/embed/mitra/` | halaman iframe; postMessage; `event.origin` diperiksa |
| Header | `middleware.ts` | `/embed/*` publik + `frame-ancestors` ByChat; rute lain `frame-ancestors 'self'` |
| Admin | `src/components/dashboard/bychat-integrasi-section.tsx` + actions | form Integrasi ByChat, Uji koneksi, pilih inbox, URL embed |

## Alur
1. Iframe memuat `/embed/mitra`, meminta konteks (`chatwoot-dashboard-app:fetch-info`), menerima `appContextSigned` hanya dari origin ByChat.
2. Iframe POST token ke `/api/bychat/mitra`. Server verifikasi → `account_id` → PT (ditolak bila belum dipetakan) → nomor dari **klaim token** (bukan dari iframe) → lookup di DB PT itu.
3. Kartu: `/api/bychat/kartu` mengembalikan PNG untuk pratinjau; `/api/bychat/kirim` mengirim setelah konfirmasi UI (pratinjau + nomor tujuan).
4. Kirim: `idempotency_key` = hash(PT, mitra, tanggal posisi); batas 1 kartu/24 jam per (PT, mitra), override oleh agen ber-peran administrator; audit tiap upaya (agen dari token, nomor, waktu, id pesan, hasil); galat 401/403/404/409/422/429 → pesan Indonesia. Tidak mengirim bila mitra belum dipilih tegas atau total piutang ≤ 0.

## Keamanan
- Token API ByChat tersimpan terenkripsi, tak pernah dikirim ke klien/log; `BYCHAT_CONTEXT_SECRET` hanya env Coolify.
- Lookup selalu dibatasi satu PT; tak ada gabungan lintas PT.
- Inbox konfigurasi PT harus sama dengan `inbox_id` pada token.

## Pengujian
`node:test` via tsx: normalisasi nomor, verifikasi token (valid, palsu, kedaluwarsa, aud/iss salah, akun tak terpetakan), idempotency key, aturan batas frekuensi. Uji ujung-ke-ujung terhadap ByChat lokal.

## Catatan data
- `PMP_Agen.Telepon` (Es Balok) hampir kosong: pmputra 240/248, pmpersada 100/104 & 183/184 (utama/logistik), pmpakis 98/98 kosong. Pencocokan nomor di Es Balok baru berguna setelah nomor diisi.
- `BusinessPartner.MobileNo` (mkesindo): 497 mitra aktif, 8% kosong, ~15% nomor dipakai >1 mitra.

## Deploy (Coolify)
Env baru: `BYCHAT_CONTEXT_SECRET` (≥32 karakter, sama dengan `DASHBOARD_CONTEXT_SECRET` di ByChat), `BYCHAT_EMBED_AUDIENCE` (default `https://dash.pabrikespmp.com`), `BYCHAT_EMBED_ORIGINS` (default `https://chat.byndrha.id`). Jalankan `scripts/create-bychat-tables.ts` sekali.
