// Pemetaan MitraCard (Es Balok) ↔ isian form alamat/lokasi + titik peta.
// Client-safe: hanya impor tipe dari lapisan query.
import type { AlamatFields, MitraAlamatForm, PinFields } from "@/lib/mitra-lokasi";
import type { MitraCard } from "@/lib/queries/mitra-es-balok";
import type { AgenLocationPoint } from "@/components/dashboard/agen-locations-map";

type AlamatPin = AlamatFields & PinFields;

const ALAMAT_KOSONG: AlamatPin = {
  wilayah: null,
  kecamatan: null,
  alamat: null,
  kontak: null,
  latitude: null,
  longitude: null,
  geoAlamat: null,
};

/**
 * Kunci unik kartu untuk React key & pemilihan: kartu ganda dari Agen yang
 * sama (>1 PMP_AgenDetail aktif) dibedakan oleh AgenDetailID-nya, kartu
 * utama/logistik yang kebetulan ber-AgenID sama dibedakan oleh sumber.
 */
export function kunciKartu(card: Pick<MitraCard, "sumber" | "agenId" | "agenDetailId">): string {
  return `${card.sumber}:${card.agenId}:${card.agenDetailId ?? "-"}`;
}

// Kolom ERP kartu (Address1/RegionID baris detail kartu ini, Telepon,
// Kecamatan profil, pin) SELALU = lokasi utama (spec §5). Slot Wilayah Es
// Balok berisi WilayahID.
export function kartuKeAlamatForm(card: MitraCard | null): MitraAlamatForm {
  if (!card) {
    return {
      lokasiBerbeda: false,
      alamatMitra: { ...ALAMAT_KOSONG },
      lokasiUtama: { ...ALAMAT_KOSONG },
      lokasiTambahan: [],
      lokasiDihapusIds: [],
    };
  }
  const utama: AlamatPin = {
    wilayah: card.wilayahId,
    kecamatan: card.kecamatan,
    alamat: card.alamat,
    kontak: card.telepon,
    latitude: card.latitude,
    longitude: card.longitude,
    geoAlamat: card.geoAlamat,
  };
  if (!card.lokasiBerbeda || !card.alamatMitra) {
    // Lokasi tambahan tanpa baris alamat mitra tidak bisa terjadi lewat form
    // ini (hapus centang = tambahan di-soft-delete); tetap tampilkan agar
    // tidak hilang diam-diam bila data dibuat dari jalur lain.
    if (card.lokasiTambahan.length === 0) {
      return { lokasiBerbeda: false, alamatMitra: utama, lokasiUtama: { ...utama }, lokasiTambahan: [], lokasiDihapusIds: [] };
    }
  }
  const am = card.alamatMitra;
  return {
    lokasiBerbeda: true,
    alamatMitra: am
      ? { wilayah: am.wilayah, kecamatan: am.kecamatan, alamat: am.alamat, kontak: am.kontak, latitude: null, longitude: null, geoAlamat: null }
      : { ...utama, latitude: null, longitude: null, geoAlamat: null },
    lokasiUtama: utama,
    lokasiDihapusIds: [],
    lokasiTambahan: card.lokasiTambahan.map((l) => ({
      lokasiPengirimanId: l.LokasiPengirimanID,
      label: l.Label,
      wilayah: l.wilayah,
      kecamatan: l.kecamatan,
      alamat: l.alamat,
      kontak: l.kontak,
      latitude: l.latitude,
      longitude: l.longitude,
      geoAlamat: l.geoAlamat,
    })),
  };
}

/**
 * Nilai Balok Besar yang dikirim saat simpan. PMPakis hanya menjual Balok
 * Kecil (isian Besar disembunyikan), tetapi baris logistik dipakai bersama
 * pmpersada (FINAC_PMP_LOGISTIC) — jadi untuk pmpakis kirim nilai TERSIMPAN
 * kartu, bukan 0/null, supaya harga/kapasitas Besar milik pmpersada tidak
 * terhapus dan simpan tanpa perubahan tetap tidak menulis apa pun. Mitra baru
 * pmpakis: 0/null.
 */
export function nilaiBalokBesarUntukSimpan(
  kode: string,
  card: Pick<MitraCard, "hargaBalokBesar" | "kapasitasBalokBesar"> | null,
  isian: { hargaBalokBesar: number; kapasitasBalokBesar: number | null }
): { hargaBalokBesar: number; kapasitasBalokBesar: number | null } {
  if (kode !== "pmpakis") return isian;
  return { hargaBalokBesar: card?.hargaBalokBesar ?? 0, kapasitasBalokBesar: card?.kapasitasBalokBesar ?? null };
}

/**
 * Titik peta halaman /mitra: satu titik per lokasi (utama + tambahan aktif
 * ber-koordinat) untuk mitra aktif. Kartu ganda dari Agen yang sama berbagi
 * pin & lokasi tambahan (dikunci per AgenID), jadi hanya dihitung sekali.
 */
export function titikPetaAgen(cards: MitraCard[]): AgenLocationPoint[] {
  const hasil: AgenLocationPoint[] = [];
  const sudah = new Set<string>();
  for (const c of cards) {
    if (!c.isActive) continue;
    const kunciAgen = `${c.sumber}:${c.agenId}`;
    if (sudah.has(kunciAgen)) continue;
    sudah.add(kunciAgen);
    if (c.latitude != null && c.longitude != null) {
      hasil.push({ kunci: `${kunciAgen}:utama`, agenId: c.agenId, nama: c.nama, label: "Utama", wilayah: c.wilayah, latitude: c.latitude, longitude: c.longitude });
    }
    for (const l of c.lokasiTambahan) {
      if (l.latitude == null || l.longitude == null) continue;
      hasil.push({
        kunci: `${kunciAgen}:${l.LokasiPengirimanID}`,
        agenId: c.agenId,
        nama: c.nama,
        label: l.Label?.trim() || `Lokasi ${l.Urutan}`,
        wilayah: l.wilayahNama ?? l.wilayah,
        latitude: l.latitude,
        longitude: l.longitude,
      });
    }
  }
  return hasil;
}
