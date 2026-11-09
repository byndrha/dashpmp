# Produksi Es Balok — Slot Can per Posisi + Rombak Layar HP — Desain

Tanggal: 2026-11-09 · Melanjutkan: `2026-11-09-produksi-es-balok-operasional-design.md` (sudah live di main 48527c6)

## Maksud

Uji browser aplikasi HP (2026-11-09) menunjukkan dua masalah yang disepakati pengguna:
1. **Satu rek tidak menampilkan setiap ice can.** Tidak terlihat can mana yang sudah dipanen, mana yang Babonan, mana yang pecah atau rusak. Model data saat ini hanya menyimpan *jumlah* per isian.
2. **Layar HP kurang pas untuk operator:**
   - kartu terlalu besar dan kosong (66 rek ≈ 22 baris gulir)
   - rek yang perlu tindakan tidak menonjol (warna tahap redup)
   - tidak ada ringkasan per bak
   - tidak ada daftar "apa yang harus dikerjakan sekarang"
   - Isi Air butuh 3 ketukan
   - tab bak terpotong

Pengguna menyetujui rancangan ini ("ya, lakukan" / "ya, kerjakan").

## Keputusan pengguna
- Posisi can dicatat (slot), termasuk Babonan, pecah, dan can rusak.
- Layar HP dirombak berorientasi tugas, dengan warna tegas seperti IceControl.
- Formulir pembagian kendaraan (sudah lolos uji) dipertahankan.

## Desain

### 1. Model slot
- Slot rek bernomor `1..DenahKolom.jumlahIceCan` (BK 36, BB 18).
- **Setiap isian menyimpan `slot int[]`**, yaitu posisi yang ditempatinya. Invarian: `array_length(slot) = sisa`. Slot isian aktif dalam satu rek tidak boleh beririsan.
- Isian Babonan menyimpan juga `slot_pecah int[]` ⊆ `slot`, yaitu can pecah yang tetap di can. Kolom `pecah` = `array_length(slot_pecah)`.
- **Can rusak**: tabel `produksi_slot_rusak (id, perusahaan_kode, kolom_id, slot, mulai_at, selesai_at NULL, catatan, dibuka_oleh_akun_id, ditutup_oleh_akun_id)`, dengan unik aktif per (kode, kolom, slot). Slot rusak:
  - hanya bisa ditandai bila tidak ditempati isian aktif
  - dilewati saat Isi Air
  - dicabut lewat aksi "Sudah diperbaiki"
- `produksi_panen` menyimpan `slot_dimuat int[]`, `slot_babonan int[]`, `slot_pecah int[]` untuk audit.
- **Backfill (Claude):** isian aktif yang sudah ada diberi slot secara deterministik, yaitu isian produksi tertua mengambil slot terendah, dan Babonan mengambil slot tertinggi. Tidak ada data yang dihapus.

### 2. Aksi (perubahan)

| Aksi | Perubahan |
|---|---|
| Isi Air | Mengisi **semua slot kosong yang tidak rusak** dalam satu ketukan, tanpa layar konfirmasi. Admin/operator boleh mengirim daftar slot eksplisit (subset slot kosong). |
| Panen (isian produksi) | Input: `slotBabonan[]`, `slotPecah[]` (subset `isian.slot`, saling lepas) dan `muatan` per kendaraan. Syarat: `Σ muatan = |slot| − |slotBabonan| − |slotPecah|`. Slot dimuat = sisanya. Slot Babonan + pecah pindah ke isian Babonan rek (slot digabung). Isi ulang mengisi slot yang dimuat (tidak termasuk slot rusak). |
| Panen (isian Babonan) | Input `slotDimuat[]` ⊆ `slot`, Σ muatan = `|slotDimuat|`. Sisanya tetap Babonan. Slot pecah tidak boleh dimuat (Claude: es pecah tidak dijual — keputusan pengguna sebelumnya). |
| Tandai Babonan | Input `slot[]` ⊆ isian produksi |
| Buang Babonan | Input `slot[]` ⊆ isian Babonan (boleh termasuk pecah) |
| Tandai rusak / Sudah diperbaiki | Baru. Operator + admin, per slot. Tercatat di log. |
| Koreksi sisa (admin) | Menjadi koreksi `slot[]`: admin memilih slot isian secara eksplisit, dengan syarat yang sama (tidak beririsan, dalam kapasitas, tidak rusak). |

Semua aturan lama tetap berlaku: kunci denah FOR SHARE, advisory lock per kolom, isian FOR UPDATE, log hanya-INSERT, dan jam server.

Kolom berisi es tetap mengunci denah. Slot rusak aktif juga mengunci kolom (Claude, sama seperti maintenance).

### 3. Keadaan rek per can (logika murni)
`KeadaanRek` mendapat `can: KeadaanCan[]` sepanjang kapasitas:

```ts
type JenisCan = "kosong" | "produksi" | "babonan" | "pecah" | "rusak";
interface KeadaanCan { slot: number; jenis: JenisCan; isianId: string | null; pct: number | null; tahap: Tahap | null }
```

Tampilan susunan can: BK 12 × 3, BB 9 × 2 (Claude). Ini hanya konstanta tampilan.

### 4. Layar HP baru
```
Kendaraan: S 8807 UG ▾              Shift 1 · Lasudji
[Bak1][Bak2][Bak3][Bak4][Bak5]      ← lebar sama, tidak terpotong
Bak 1 · 37 rek   ● Siap 6  ○ Kosong 3  ◆ Babonan 4  ✕ Rusak 1
─────────────────────────────────────
TUGAS SEKARANG
 Rek 14 BK  98%  32j            [Panen]
 Rek 22     kosong 2j           [Isi Air]
 Rek 9      ◆ Babonan 50j
─────────────────────────────────────
SEMUA REK
 1  ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮◆◆  0%
```
- **Ringkasan bak** berupa chip jumlah rek: siap (≥ 75%), kosong (ada slot kosong yang bisa diisi), Babonan, dan rusak.
- **Tugas sekarang:**
  - rek dengan isian produksi ≥ 75%, diurutkan FIFO dari yang tertua
  - rek yang punya slot kosong dan bisa diisi, diurutkan dari yang paling lama kosong
  - Babonan yang lewat ambang 48 jam

  Tombol aksi langsung di baris. "Isi Air" di sini = satu ketukan.
- **Semua rek:** satu baris per rek berisi nomor, strip can berwarna per slot, persen isian tertua, dan usia. Ketuk baris → lembar rek.
- **Warna tegas** (terang dan gelap):
  - air = merah
  - mulai = kuning/amber
  - kristal = ungu
  - siap = biru muda
  - jadi = hijau
  - Babonan = oranye ◆
  - pecah = oranye ✕
  - rusak = abu ✕
  - kosong = garis putus

  Didefinisikan di `warna-tahap.ts`.
- **Lembar rek:** grid can sesuai susunan, daftar isian, serta tombol aksi (Panen, Isi Air, Tandai Babonan, Buang Babonan, Tandai rusak/Perbaiki, Maintenance).
- **Formulir panen:**
  - Grid can bisa diketuk dengan urutan: biasa → Babonan ◆ → Pecah ✕ → biasa.
  - Daftar kendaraan seperti sekarang.
  - Total ✓.
  - Baris muatan pertama otomatis = jumlah slot dimuat.
- Tandai Babonan, Buang Babonan, dan Tandai rusak memakai grid ketuk yang sama (mode pilih slot).

### 5. Layar admin
- `DetailRek` memakai grid can yang sama, dalam mode baca untuk penonton.
- FIFO tetap satu baris per isian.
- Ringkasan stok tetap menghitung per can.
- Koreksi sisa memakai grid pilih slot.

## Bukan tujuan
- Mode offline.
- Pelacakan identitas fisik can (nomor seri) — slot = posisi, bukan identitas can.
- Perubahan pencocokan DO.

## Anti-tujuan
- Slot ganda (satu posisi ditempati dua isian aktif).
- Jumlah dan slot tidak sinkron.
- Isi Air mengisi slot rusak.
