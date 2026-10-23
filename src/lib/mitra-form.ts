// Pemetaan MitraRow → isian form alamat/lokasi Mitra Es Kristal. Client-safe
// (hanya impor tipe dari lapisan query), dipakai form dan skrip verifikasi.
import type { AlamatFields, MitraAlamatForm, PinFields } from "@/lib/mitra-lokasi";
import type { MitraRow } from "@/lib/queries/mitra";

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

// Bentuk form alamat dari MitraRow (atau kosong untuk mitra baru). Kolom ERP
// (Alamat/Wilayah/Kecamatan/Kontak + pin) SELALU = lokasi utama (spec §5):
// tanpa centang, itu juga alamat mitra; dengan centang, alamat mitra dari
// DashboardMitraAlamat (tanpa pin).
export function mitraKeAlamatForm(row: MitraRow | null): MitraAlamatForm {
  if (!row) {
    return { lokasiBerbeda: false, alamatMitra: { ...ALAMAT_KOSONG }, lokasiUtama: { ...ALAMAT_KOSONG }, lokasiTambahan: [] };
  }
  const utama: AlamatPin = {
    wilayah: row.Wilayah,
    kecamatan: row.Kecamatan,
    alamat: row.Alamat,
    kontak: row.Kontak,
    latitude: row.Latitude,
    longitude: row.Longitude,
    geoAlamat: row.GeoAlamat,
  };
  if (!row.LokasiBerbeda || !row.AlamatMitra) {
    return { lokasiBerbeda: false, alamatMitra: utama, lokasiUtama: { ...utama }, lokasiTambahan: [] };
  }
  return {
    lokasiBerbeda: true,
    alamatMitra: { ...row.AlamatMitra, latitude: null, longitude: null, geoAlamat: null },
    lokasiUtama: utama,
    lokasiTambahan: row.LokasiTambahan.map((l) => ({
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
