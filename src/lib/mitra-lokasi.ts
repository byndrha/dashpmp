// Logika murni alamat mitra & lokasi pengiriman. Client-safe: JANGAN import
// mssql/pg/next/* di sini — modul ini diimpor komponen client maupun server.

export interface AlamatFields { wilayah: string | null; kecamatan: string | null; alamat: string | null; kontak: string | null }
export interface PinFields { latitude: number | null; longitude: number | null; geoAlamat: string | null }
export interface LokasiTambahanInput extends AlamatFields, PinFields {
  lokasiPengirimanId: number | null;
  label: string | null;
  // Kunci React baris baru (khusus client, diabaikan server).
  kunciKlien?: string;
}

export interface MitraAlamatForm {
  lokasiBerbeda: boolean;
  alamatMitra: AlamatFields & PinFields; // pin dipakai hanya bila !lokasiBerbeda
  lokasiUtama: AlamatFields & PinFields; // diabaikan bila !lokasiBerbeda
  lokasiTambahan: LokasiTambahanInput[]; // harus [] bila !lokasiBerbeda
  // ID lokasi tambahan tersimpan yang SENGAJA dihapus pengguna di form ini.
  // Server hanya men-soft-delete ID di sini (plus semua lokasi aktif bila
  // kotak lokasi berbeda tidak dicentang); lokasi yang tidak dikirim dan
  // tidak ada di sini dibiarkan (mis. ditambah dari tempat lain setelah form
  // dibuka).
  lokasiDihapusIds: number[];
}

export interface MitraAlamatTernormalisasi {
  utama: AlamatFields & PinFields; // → kolom ERP + pin
  alamatMitra: AlamatFields | null; // → Dashboard*Alamat; null = hapus baris
  tambahan: LokasiTambahanInput[];
  dihapusIds: number[]; // dari lokasiDihapusIds, sudah divalidasi bentuknya
  hapusSemuaTambahan: boolean; // true bila tidak dicentang → semua lokasi tambahan aktif dihapus
}

const ambilAlamat = (a: AlamatFields): AlamatFields => ({
  wilayah: a.wilayah, kecamatan: a.kecamatan, alamat: a.alamat, kontak: a.kontak,
});
const ambilAlamatPin = (a: AlamatFields & PinFields): AlamatFields & PinFields => ({
  ...ambilAlamat(a), latitude: a.latitude, longitude: a.longitude, geoAlamat: a.geoAlamat,
});

/**
 * Tidak dicentang: alamat mitra = lokasi utama (termasuk pin), tidak ada baris
 * alamat terpisah, lokasi tambahan dibuang.
 * Dicentang: lokasi utama dari isian terpisah; alamat mitra disimpan tanpa pin.
 */
export function normalisasiMitraForm(f: MitraAlamatForm): MitraAlamatTernormalisasi {
  const dihapusIds = rapikanIdDihapus(f.lokasiDihapusIds);
  const hasil: MitraAlamatTernormalisasi = f.lokasiBerbeda
    ? {
        utama: ambilAlamatPin(f.lokasiUtama),
        alamatMitra: ambilAlamat(f.alamatMitra),
        tambahan: f.lokasiTambahan,
        dihapusIds,
        hapusSemuaTambahan: false,
      }
    : { utama: ambilAlamatPin(f.alamatMitra), alamatMitra: null, tambahan: [], dihapusIds, hapusSemuaTambahan: true };
  if (!hasil.utama.wilayah || hasil.utama.wilayah.trim() === "") {
    throw new Error("Wilayah lokasi utama wajib diisi");
  }
  return hasil;
}

/**
 * lokasiDihapusIds dari client → larik ID bulat positif tanpa duplikat.
 * Tidak dikirim (client lama) → []. Bentuk lain → throw.
 */
function rapikanIdDihapus(ids: unknown): number[] {
  if (ids == null) return [];
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "number" || !Number.isInteger(id) || id <= 0)) {
    throw new Error("Daftar lokasi yang dihapus tidak valid.");
  }
  return [...new Set(ids as number[])];
}

/**
 * Client: tambahkan ID tersimpan dari `baris` (baris yang dibuang dari form)
 * ke lokasiDihapusIds. Baris baru (tanpa ID) diabaikan; tanpa duplikat.
 */
export function tandaiLokasiDihapus(ids: number[] | undefined, baris: LokasiTambahanInput[]): number[] {
  const hasil = [...(ids ?? [])];
  for (const l of baris) {
    if (l.lokasiPengirimanId != null && !hasil.includes(l.lokasiPengirimanId)) hasil.push(l.lokasiPengirimanId);
  }
  return hasil;
}

export interface LokasiMilik {
  id: number;
  aktif: boolean;
}

/**
 * Rencana sinkronisasi lokasi tambahan saat simpan form (murni, diuji unit).
 * - `milik`: SEMUA baris lokasi tambahan mitra ini di DB (aktif & terhapus).
 * - `idInput`: ID baris yang dikirim form (akan di-UPDATE) — harus aktif & unik.
 * - `idDiminta`: lokasiDihapusIds — harus milik mitra ini; yang sudah
 *   terhapus diabaikan; tidak boleh sekaligus ada di idInput.
 * - `hapusSemuaAktif`: kotak lokasi berbeda tidak dicentang → semua lokasi
 *   aktif ikut dihapus (idInput harus kosong).
 * Hasil: `dihapus` (aktif yang di-soft-delete) dan `dipertahankan` (aktif,
 * tidak dikirim, tidak diminta hapus — dibiarkan, mis. ditambah dari tempat
 * lain setelah form dibuka). Melempar Error berpesan Indonesia bila tidak sah.
 */
export function rencanakanLokasiTambahan(p: {
  milik: LokasiMilik[];
  idInput: number[];
  idDiminta: number[];
  hapusSemuaAktif: boolean;
}): { dihapus: number[]; dipertahankan: number[] } {
  const aktif = new Set(p.milik.filter((m) => m.aktif).map((m) => m.id));
  const semua = new Set(p.milik.map((m) => m.id));

  const input = new Set<number>();
  for (const id of p.idInput) {
    if (!aktif.has(id)) {
      throw new Error("Lokasi pengiriman yang diubah tidak ditemukan atau sudah dihapus. Muat ulang data mitra lalu coba lagi.");
    }
    if (input.has(id)) throw new Error("Lokasi pengiriman yang sama muncul dua kali di form.");
    input.add(id);
  }
  if (p.hapusSemuaAktif && input.size > 0) {
    throw new Error("Lokasi tambahan tidak boleh dikirim bila lokasi pengiriman tidak berbeda dengan mitra.");
  }

  const diminta = new Set<number>();
  for (const id of p.idDiminta) {
    if (!semua.has(id)) throw new Error("Lokasi pengiriman yang dihapus bukan milik mitra ini. Muat ulang data mitra lalu coba lagi.");
    if (input.has(id)) throw new Error("Lokasi pengiriman yang sama ditandai diubah sekaligus dihapus.");
    diminta.add(id);
  }

  const urutanAktif = p.milik.filter((m) => m.aktif).map((m) => m.id);
  const dihapus = urutanAktif.filter((id) => p.hapusSemuaAktif || diminta.has(id));
  const hapusSet = new Set(dihapus);
  const dipertahankan = urutanAktif.filter((id) => !input.has(id) && !hapusSet.has(id));
  return { dihapus, dipertahankan };
}

export interface StopLokasiSumber {
  snapshot: (AlamatFields & { latitude: number | null; longitude: number | null }) | null;
  dipilih: (AlamatFields & PinFields) | null;
  lokasiDipilihId: number | null;
  utama: AlamatFields & PinFields;
}

export type LokasiStop = AlamatFields & {
  latitude: number | null;
  longitude: number | null;
  sumber: "snapshot" | "dipilih" | "utama";
};

/**
 * Urutan prioritas (harus identik dengan STOP_LOKASI_COLUMNS di SQL):
 * 1. snapshot (bila ada) — alamat yang dibekukan saat stop dibuat.
 * 2. lokasiDipilihId != null → baris dipilih, APA ADANYA. Tidak ada fallback ke
 *    pin/alamat utama, walau koordinat dipilih null atau barisnya sudah hilang.
 *    SATU-SATUNYA pengecualian: kontak. Bila kontak dipilih kosong/null (atau
 *    barisnya hilang) → kontak utama (keputusan pengguna 2026-10-23). Pin
 *    tetap TIDAK jatuh ke utama.
 * 3. selain itu → lokasi utama.
 */
export function pilihLokasiStop(s: StopLokasiSumber): LokasiStop {
  const jadi = (a: (AlamatFields & { latitude: number | null; longitude: number | null }) | null, sumber: LokasiStop["sumber"]): LokasiStop => ({
    wilayah: a?.wilayah ?? null,
    kecamatan: a?.kecamatan ?? null,
    alamat: a?.alamat ?? null,
    kontak: a?.kontak ?? null,
    latitude: a?.latitude ?? null,
    longitude: a?.longitude ?? null,
    sumber,
  });
  if (s.snapshot) return jadi(s.snapshot, "snapshot");
  if (s.lokasiDipilihId != null) {
    const r = jadi(s.dipilih, "dipilih");
    // Cermin COALESCE(NULLIF(LTRIM(RTRIM(lp.Kontak)),''), bp.MobileNo).
    const kontakDipilih = r.kontak?.trim() ?? "";
    r.kontak = kontakDipilih !== "" ? kontakDipilih : (s.utama.kontak ?? null);
    return r;
  }
  return jadi(s.utama, "utama");
}

/**
 * Pecah teks kompetitor bebas menjadi daftar nama: pemisah koma, titik koma,
 * baris baru, dan kata "dan" yang berdiri sendiri. Trim, buang kosong, dedupe
 * tanpa beda huruf besar-kecil (ejaan kemunculan pertama dipertahankan).
 */
export function pecahTeksKompetitor(teks: string | null): string[] {
  if (!teks) return [];
  const hasil: string[] = [];
  const sudah = new Set<string>();
  for (const bagian of teks.split(/[,;]|\r?\n|\s+dan\s+/i)) {
    const nama = bagian.trim();
    if (!nama) continue;
    const kunci = nama.toLowerCase();
    if (sudah.has(kunci)) continue;
    sudah.add(kunci);
    hasil.push(nama);
  }
  return hasil;
}

/**
 * Pesan galat simpanMitraLengkap bila data MSSQL sudah ter-commit tetapi
 * identitas/kompetitor (Postgres) gagal. Diekspor agar form bisa mengenalinya:
 * pada mitra BARU, form harus ditutup (mitra sudah dibuat) supaya "simpan
 * ulang" tidak membuat mitra ganda.
 */
export const PESAN_SIMPAN_SEBAGIAN =
  "Data mitra tersimpan, tetapi identitas/kompetitor gagal disimpan — coba simpan ulang.";

/**
 * Buang field `nik` dari masukan form bila sesi tidak berhak mengubah NIK —
 * dipakai server action sebelum meneruskan ke lapisan simpan. Tanpa hak,
 * properti `nik` hilang sama sekali (undefined = kolom NIK tidak disentuh).
 */
export function saringNikMasukan<T extends { nik?: string | null }>(input: T, bolehUbah: boolean): T {
  if (bolehUbah) return input;
  const salinan = { ...input };
  delete salinan.nik;
  return salinan;
}

/** Lebar live kolom ERP DeliveryOrder.AddressDelivery (varchar(150)). */
export const ADDRESS_DELIVERY_MAKS = 150;

/**
 * Nilai DeliveryOrder.AddressDelivery dari alamat stop yang dibekukan saat
 * DO dibuat (spec §9.2): NULL → '' (perilaku lama), dipotong ke 150 karakter.
 */
export function alamatUntukDeliveryOrder(alamatBeku: string | null): string {
  return (alamatBeku ?? "").slice(0, ADDRESS_DELIVERY_MAKS);
}

/**
 * Pilihan yang ditampilkan pemilih lokasi di kartu stop Papan Pengiriman,
 * atau null bila pemilih harus disembunyikan: Jadwal bukan Draft
 * (`bolehUbah` false), alamat stop sudah dibekukan, atau mitra hanya punya
 * satu lokasi (pilihan null / ≤1 elemen).
 */
export function pilihanLokasiStopTampil<T>(pilihan: T[] | null, dibekukan: boolean, bolehUbah: boolean): T[] | null {
  if (!bolehUbah || dibekukan || !pilihan || pilihan.length <= 1) return null;
  return pilihan;
}
