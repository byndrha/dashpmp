# GPS Kendaraan (Hino Connect + SoloFleet) — /mkesindo/delivery

**Tanggal:** 2026-09-26
**Status:** Disetujui secara desain (chat), menunggu tahap Discovery sebelum penulisan plan implementasi.

## Latar Belakang & Tujuan

Perusahaan berlangganan dua layanan GPS tracker kendaraan pihak ketiga:
- **connect.hino.co.id** (Hino Connect)
- **www.solofleet.com/Vehicle** (SoloFleet)

Ini adalah GPS **perangkat yang terpasang permanen di kendaraan/truk**, berbeda dari sistem lokasi yang sudah ada di project ini (`akun_lokasi`), yang melacak **akun/orang** (driver login lewat Aplikasi Driver di HP). Tujuannya: menampilkan posisi live + jejak rute kendaraan sebagai segmen baru di halaman `/mkesindo/delivery`, tanpa mencampur konsep dengan tracking driver yang sudah ada.

Kedua platform tidak punya API publik terdokumentasi dan formatnya berbeda satu sama lain — endpoint dan struktur payload harus digali lewat inspect Network tab, dilakukan bersama user (user login manual, Claude membaca Network tab).

## Perbedaan Eksplisit dari Sistem yang Sudah Ada

| | `akun_lokasi` (sudah ada) | `armada_gps_riwayat` (baru) |
|---|---|---|
| Melacak | Akun/orang (driver, marketing) | Kendaraan/armada (device permanen) |
| Sumber | Browser geolocation / Capacitor background-geolocation di app driver | API tersembunyi Hino Connect / SoloFleet |
| Kunci | `akun_id` | `armada_id` (via match plat nomor) |
| Retensi | 30 hari | 14 hari |

Kedua sistem tetap berjalan independen — tidak saling menggantikan.

## Arsitektur & Alur Data

```
Discovery (manual, sekali di awal):
  User login manual di connect.hino.co.id & solofleet.com/Vehicle di browser
  → Claude inspect Network tab → temukan endpoint auth + endpoint device-list
    + struktur payload masing-masing (BEDA per provider)

Runtime:
  [Server action: syncVehicleGpsPositions()]
    → Adapter hino-connect.ts: login pakai kredensial tersimpan → fetch device list
    → Adapter solofleet.ts: login pakai kredensial tersimpan → fetch device list
    (masing-masing di try/catch terpisah — satu provider gagal tidak
     menghentikan provider lain)
    → Normalisasi ke bentuk seragam:
        { provider, externalVehicleId, platNomorRaw, lat, lng, speedKmh,
          heading, ignitionOn?, recordedAt, rawPayload }
    → Cocokkan platNomorRaw → Armada.PlatNomor (normalisasi: uppercase,
      strip spasi/dash/titik, exact match)
    → INSERT ke armada_gps_riwayat (append-only)
    → Hapus baris armada_gps_riwayat yang lebih tua dari 14 hari

  [Tab "GPS Kendaraan" di /mkesindo/delivery, saat aktif]
    → Poller client-side (pola PrintQueuePoller) panggil
      syncVehicleGpsPositions() tiap 30-60 detik, HANYA selagi tab ini aktif
    → Peta (leaflet, pola peta-overview-map.tsx) + daftar kendaraan
    → Polyline jejak rute per kendaraan, filter rentang waktu (1 jam/6 jam/24 jam)
    → Kendaraan tanpa match plat nomor tetap tampil, badge
      "Belum terhubung ke Armada" (tidak disembunyikan)
```

Dua adapter (`hino-connect.ts`, `solofleet.ts`) mengimplementasikan satu interface `VehicleGpsProvider` agar perbedaan format Hino vs SoloFleet tidak bocor ke server action, DB, atau UI.

> **Catatan eksplisit (keputusan user):** Tahap awal ini sengaja pakai polling client-side (bukan cron server), karena project belum punya infrastruktur cron. **Ingatkan user untuk migrasi ke server-side cron (via API route + scheduler eksternal seperti Coolify cron/cron-job.org) di masa depan**, supaya data tetap update walau tidak ada yang membuka dashboard.

## Skema Data (Postgres)

**`gps_kendaraan_kredensial`** — kredensial platform, dikelola dari admin UI `/grup/perusahaan` yang sudah ada (bukan halaman baru), mengikuti pola `perusahaan_koneksi`:
```sql
id                  serial primary key
provider            text not null check (provider in ('hino', 'solofleet'))
username            text not null
password_encrypted  text not null   -- AES-256-GCM, kunci turunan baru dari
                                    -- AUTH_SECRET dengan prefix purpose-specific
                                    -- terpisah (pola src/lib/crypto-secret.ts),
                                    -- BUKAN reuse kunci perusahaan-db-credential
extra_config        jsonb           -- base_url/account_id, dsb — isi beda tiap provider
updated_at          timestamptz not null default now()
updated_by_akun_id  text
unique (provider)
```

**`armada_gps_riwayat`** — append-only, 1 baris per titik GPS:
```sql
id                     bigserial primary key
provider               text not null
external_vehicle_id    text not null   -- ID kendaraan versi platform asal
plat_nomor_raw         text not null
plat_nomor_normalized  text not null
armada_id              integer         -- nullable; hasil match ke Armada.ArmadaID (SQL Server)
latitude               double precision not null
longitude              double precision not null
speed_kmh              double precision
heading                double precision
ignition_on            boolean
recorded_at            timestamptz not null   -- timestamp dari device GPS
fetched_at             timestamptz not null default now()
raw_payload            jsonb           -- payload asli, untuk debug jika format provider berubah

index (armada_id, recorded_at)
index (provider, external_vehicle_id, recorded_at)
```
Retensi: hapus baris dengan `recorded_at` lebih tua dari 14 hari, dijalankan setiap kali `syncVehicleGpsPositions()` insert data baru (pola sama seperti pembersihan `akun_lokasi`, bukan cron terpisah).

"Posisi terkini per kendaraan" = query `DISTINCT ON (armada_id) ... ORDER BY recorded_at DESC` dari tabel ini — tidak ada tabel snapshot terpisah.

## Komponen yang Disentuh/Ditambahkan

- `src/lib/queries/armada-gps.ts` — query DB baru (insert riwayat, get posisi terkini, get jejak rute per rentang waktu, cleanup retensi)
- `src/lib/crypto-secret.ts` — tambah fungsi `encryptGpsCredential`/`decryptGpsCredential` dengan kunci turunan baru (purpose-specific, terpisah dari kunci lain di file ini)
- `src/lib/gps-providers/types.ts` — interface `VehicleGpsProvider`
- `src/lib/gps-providers/hino-connect.ts` — adapter Hino Connect (endpoint & auth sudah ditemukan, lihat "Hasil Discovery" di bawah)
- `src/lib/gps-providers/solofleet.ts` — adapter SoloFleet (endpoint & auth sudah ditemukan, lihat "Hasil Discovery" di bawah)

## Hasil Discovery (2026-09-26, inspect Network tab bersama user)

### Hino Connect
- Backend riil: `https://be-pub-sg-hino.gazellecomputing.com` (bukan connect.hino.co.id — itu cuma frontend Angular SPA)
- Auth: **AWS Cognito** (user pool `ap-southeast-1_D0GwdGbuB`, app client `keguk4gegt09c9kmfa5rvb1b8`), token disimpan di `localStorage['_gazelle_session'].token` (JWT access token, `Authorization: Bearer <token>`, exp ~18 jam dari `iat`).
  - Login programatik server-side perlu library `amazon-cognito-identity-js` (atau panggil `InitiateAuth` Cognito langsung) dengan flow SRP — **BUKAN** auth sederhana user/password POST biasa. Perlu dicek saat implementasi apakah app client mengizinkan `USER_PASSWORD_AUTH` (lebih simpel) atau wajib `USER_SRP_AUTH`.
- Endpoint data posisi: `POST /mapproxy/map/clusters`
  ```json
  // body:
  { "boundingBox": { "topLeftCorner": {"lon":103.09,"lat":-1.90}, "bottomRightCorner": {"lon":114.89,"lat":-11.79} },
    "fleets": [], "deviceListMaxLen": 25, "zoomLevel": 7, "hideExpired": true }
  ```
  Response: `data[]` berisi cluster per geohash, tiap cluster punya `devices[]`:
  ```json
  { "vehicleId": "132450", "deviceId": "140535", "plate": "AE 8072 SQ", "vin": "...", "type": "TRUCK",
    "vehicleLastInfo": { "vehicleState": "MOVING", "lastTransmissionTimestamp": "2026-09-26T06:43:06Z",
      "latitude_deg": -7.79, "longitude_deg": 111.51, "heading_deg": 30, "speed_kmh": 23, "distance_m": 63893100 } }
  ```
  Catatan: `plate` kadang berisi VIN (bukan plat nomor asli) untuk kendaraan yang belum di-setup platnya di Hino Connect — kendaraan ini akan otomatis masuk kategori "Belum terhubung ke Armada" karena tidak match apapun. Bounding box cukup pakai batas Indonesia tetap (tidak perlu dinamis per viewport) + `deviceListMaxLen` besar agar semua kendaraan balik tanpa clustering berlebih.

### SoloFleet
- Auth: cookie session ASP.NET klasik (form login `/Account/Login`) — jauh lebih simpel dari Hino, tidak perlu SRP/JWT. Login programatik = POST form biasa (username, password, mungkin antiforgery token — cek saat implementasi).
- Endpoint data posisi: `GET https://www.solofleet.com/Vehicle/vehiclelivewithoutzonetripNewModelCondense` (no body/query param, cookie session cukup)
  Response:
  ```json
  { "vehicles": [ { "vehicleid": "PP50", "alias": "AE 8072 SQ", "y": -7.7729111, "x": 111.5264816,
      "spd": 11, "course": 4, "lastupdated": "2026-09-26T13:46:45+07:00", "gpstimeISO": 1790405205,
      "City": "Madiun", "Province": "Jawa Timur", "deviceid": "0861128068142121", "gstat": 1 } ] }
  ```
  Catatan: `y`/`x` = lat/lon, `alias` = plat nomor (field match langsung), `lastupdated` sudah dalam **waktu lokal WIB** (`+07:00`) bukan UTC — beda dari Hino yang UTC (`Z`). Adapter WAJIB menormalkan keduanya ke UTC sebelum simpan ke `recorded_at`, supaya tidak kena masalah serupa [[transdate-wib-utc-boundary-bug]] (bug WIB/UTC yang pernah terjadi di desktop-ERP).
  - Ada juga `socketio.solofleet.com` (Socket.IO) untuk push real-time — di luar scope tahap awal (client-side polling), tapi dicatat sebagai opsi upgrade non-polling di masa depan.
- `src/app/mkesindo/(dashboard)/delivery/actions.ts` — tambah `syncVehicleGpsPositions()`, `getVehiclePositionsAction()`, `getVehicleTrailAction(armadaId, rangeHours)`
- `src/components/dashboard/pengiriman-tabs.tsx` — tambah tab ke-4 `"gps"` / "GPS Kendaraan"
- `src/components/dashboard/vehicle-gps-panel.tsx` — peta + daftar kendaraan + poller
- Halaman admin `/grup/perusahaan` (file existing, cari `perusahaan-form-dialog.tsx` / halaman terkait) — tambah form kredensial GPS Kendaraan (2 baris: Hino, SoloFleet)
- Migrasi SQL baru di lokasi migrasi Postgres yang sudah ada di project ini (ikuti pola `scripts/migrate-directory-db.ts` atau folder migrasi yang berlaku)

## Penanganan Error

- Login/token Hino atau SoloFleet expired → adapter retry login sekali; gagal lagi → tandai provider itu "gagal sync" di UI (badge merah + waktu gagal terakhir), TIDAK mematikan sync provider lain.
- Format payload provider berubah sewaktu-waktu (risiko nyata, API tidak resmi) → `raw_payload` disimpan untuk debug tanpa perlu inspect ulang dari nol.
- Kendaraan tak ter-match plat nomor → tetap tampil dengan badge "Belum terhubung ke Armada", tidak silent-drop.

## Testing / Verifikasi

Tidak ada mocking end-to-end yang berarti (bergantung pada API tak resmi pihak ketiga). Verifikasi:
1. Migrasi tabel jalan bersih.
2. Kredensial tersimpan & ter-enkripsi benar (round-trip encrypt/decrypt).
3. Sync sungguhan lewat kredensial user → data masuk ke `armada_gps_riwayat` dengan `raw_payload` sesuai temuan Discovery.
4. Pencocokan plat nomor teruji dengan data Armada yang sudah ada.
5. Verifikasi visual lewat browser Claude: tab baru muncul, peta+list tampil, poller jalan, badge unmatched & badge gagal-sync tampil saat disimulasikan.

## Batasan yang Disengaja (Out of Scope Tahap Ini)

- **Tidak** ada cron server — polling murni client-side selagi tab dibuka (lihat catatan migrasi di atas).
- **Tidak** menyentuh sistem tracking driver/akun (`akun_lokasi`) yang sudah ada.
- **Tidak** membangun halaman admin kredensial baru — digabung ke `/grup/perusahaan` existing.
- Endpoint & struktur payload exact Hino Connect/SoloFleet BELUM diketahui — diisi di tahap Discovery sebelum implementation plan ditulis penuh untuk adapter.
