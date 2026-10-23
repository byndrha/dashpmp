import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalisasiMitraForm,
  pecahTeksKompetitor,
  pilihLokasiStop,
  rencanakanLokasiTambahan,
  saringNikMasukan,
  tandaiLokasiDihapus,
  type AlamatFields,
  type MitraAlamatForm,
  type PinFields,
} from "../mitra-lokasi";
import { mitraKeAlamatForm } from "../mitra-form";
import type { MitraRow } from "../queries/mitra";

const alamat = (o: Partial<AlamatFields & PinFields> = {}): AlamatFields & PinFields => ({
  wilayah: "Malang", kecamatan: "Klojen", alamat: "Jl. Ijen 1", kontak: "081234567890",
  latitude: -7.97, longitude: 112.63, geoAlamat: "Jl. Ijen, Malang", ...o,
});
const form = (o: Partial<MitraAlamatForm> = {}): MitraAlamatForm => ({
  lokasiBerbeda: false,
  alamatMitra: alamat(),
  lokasiUtama: alamat({ wilayah: "Batu", alamat: "Jl. Diponegoro 5", latitude: -7.87, longitude: 112.52, geoAlamat: "Batu" }),
  lokasiTambahan: [],
  lokasiDihapusIds: [],
  ...o,
});
const tambahan = {
  lokasiPengirimanId: null, label: "Gudang", wilayah: "Pakis", kecamatan: "Pakis", alamat: "Jl. Raya Pakis",
  kontak: null, latitude: -7.95, longitude: 112.7, geoAlamat: null,
};

test("normalisasiMitraForm: tidak dicentang → utama = alamatMitra (termasuk pin), alamatMitra null, tambahan []", () => {
  const r = normalisasiMitraForm(form());
  assert.deepEqual(r, { utama: alamat(), alamatMitra: null, tambahan: [], dihapusIds: [], hapusSemuaTambahan: true });
});
test("normalisasiMitraForm: tidak dicentang tapi tambahan terisi → tambahan dibuang", () => {
  const r = normalisasiMitraForm(form({ lokasiTambahan: [tambahan] }));
  assert.deepEqual(r.tambahan, []);
  assert.equal(r.alamatMitra, null);
});
test("normalisasiMitraForm: dicentang → utama = lokasiUtama, alamatMitra tanpa pin", () => {
  const f = form({ lokasiBerbeda: true, lokasiTambahan: [tambahan] });
  const r = normalisasiMitraForm(f);
  assert.deepEqual(r.utama, f.lokasiUtama);
  assert.deepEqual(r.alamatMitra, { wilayah: "Malang", kecamatan: "Klojen", alamat: "Jl. Ijen 1", kontak: "081234567890" });
  assert.equal("latitude" in (r.alamatMitra as object), false);
  assert.deepEqual(r.tambahan, [tambahan]);
});
test("normalisasiMitraForm: wilayah utama kosong/spasi → throw \"Wilayah lokasi utama wajib diisi\"", () => {
  const pesan = { message: "Wilayah lokasi utama wajib diisi" };
  assert.throws(() => normalisasiMitraForm(form({ alamatMitra: alamat({ wilayah: null }) })), pesan);
  assert.throws(() => normalisasiMitraForm(form({ alamatMitra: alamat({ wilayah: "" }) })), pesan);
  assert.throws(() => normalisasiMitraForm(form({ alamatMitra: alamat({ wilayah: "   " }) })), pesan);
  // dicentang: yang divalidasi wilayah lokasiUtama, bukan alamatMitra
  assert.throws(() => normalisasiMitraForm(form({ lokasiBerbeda: true, lokasiUtama: alamat({ wilayah: " " }) })), pesan);
  assert.doesNotThrow(() => normalisasiMitraForm(form({ lokasiBerbeda: true, alamatMitra: alamat({ wilayah: null }) })));
});

const snapshot = { wilayah: "Snap", kecamatan: "S", alamat: "Jl. Snapshot", kontak: null, latitude: -7.1, longitude: 112.1 };
const dipilih = alamat({ wilayah: "Dipilih", alamat: "Jl. Dipilih", latitude: -7.2, longitude: 112.2 });
const utama = alamat({ wilayah: "Utama", alamat: "Jl. Utama", latitude: -7.3, longitude: 112.3 });

test("pilihLokasiStop: snapshot ada → sumber \"snapshot\", walau dipilih/utama berbeda", () => {
  const r = pilihLokasiStop({ snapshot, dipilih, lokasiDipilihId: 9, utama });
  assert.deepEqual(r, { ...snapshot, sumber: "snapshot" });
});
test("pilihLokasiStop: lokasiDipilihId ada, dipilih tanpa pin → latitude/longitude null, sumber \"dipilih\" (TIDAK jatuh ke pin utama)", () => {
  const r = pilihLokasiStop({ snapshot: null, dipilih: { ...dipilih, latitude: null, longitude: null }, lokasiDipilihId: 9, utama });
  assert.deepEqual(r, {
    wilayah: "Dipilih", kecamatan: "Klojen", alamat: "Jl. Dipilih", kontak: "081234567890",
    latitude: null, longitude: null, sumber: "dipilih",
  });
});
test("pilihLokasiStop: lokasiDipilihId ada tapi baris dipilih hilang → field null kecuali kontak (jatuh ke utama), sumber \"dipilih\"", () => {
  const r = pilihLokasiStop({ snapshot: null, dipilih: null, lokasiDipilihId: 9, utama });
  assert.deepEqual(r, { wilayah: null, kecamatan: null, alamat: null, kontak: utama.kontak, latitude: null, longitude: null, sumber: "dipilih" });
});
test("pilihLokasiStop: dipilih tanpa kontak → kontak utama, koordinat tetap null (pin TIDAK jatuh ke utama)", () => {
  for (const kontak of [null, "", "   "]) {
    const r = pilihLokasiStop({
      snapshot: null, dipilih: { ...dipilih, kontak, latitude: null, longitude: null },
      lokasiDipilihId: 9, utama: { ...utama, kontak: "0899-UTAMA" },
    });
    assert.deepEqual(r, {
      wilayah: "Dipilih", kecamatan: "Klojen", alamat: "Jl. Dipilih", kontak: "0899-UTAMA",
      latitude: null, longitude: null, sumber: "dipilih",
    });
  }
});
test("pilihLokasiStop: lokasiDipilihId null → utama", () => {
  const r = pilihLokasiStop({ snapshot: null, dipilih, lokasiDipilihId: null, utama });
  assert.deepEqual(r, {
    wilayah: "Utama", kecamatan: "Klojen", alamat: "Jl. Utama", kontak: "081234567890",
    latitude: -7.3, longitude: 112.3, sumber: "utama",
  });
});

test("pecahTeksKompetitor: pemisah , ; baris baru dan kata \"dan\", dedupe tanpa beda huruf", () => {
  // "es kristal jaya" BUKAN duplikat huruf-besar-kecil dari "Kristal Jaya" (ada kata "es");
  // penyatuan ejaan ganda semacam itu dilakukan manual saat tinjauan migrasi (spec §migrasi).
  assert.deepEqual(
    pecahTeksKompetitor("Kristal Jaya, es kristal jaya; Tirta dan Segar\nKristal Jaya"),
    ["Kristal Jaya", "es kristal jaya", "Tirta", "Segar"],
  );
  assert.deepEqual(pecahTeksKompetitor("Kristal Jaya, KRISTAL JAYA\r\nkristal jaya"), ["Kristal Jaya"]);
  assert.deepEqual(pecahTeksKompetitor("Tirta DAN Segar;;, Dandang"), ["Tirta", "Segar", "Dandang"]);
});
test("pecahTeksKompetitor: kosong → []", () => {
  assert.deepEqual(pecahTeksKompetitor(null), []);
  assert.deepEqual(pecahTeksKompetitor("  "), []);
});

test("saringNikMasukan: tanpa hak ubah, properti nik hilang sama sekali", () => {
  const masukan = { namaPenanggungJawab: "Budi", nik: "3507123412341234", kompetitorIds: [1] };
  const tanpaHak = saringNikMasukan(masukan, false);
  assert.equal("nik" in tanpaHak, false);
  assert.equal(JSON.stringify(tanpaHak).includes("3507123412341234"), false);
  assert.deepEqual(tanpaHak, { namaPenanggungJawab: "Budi", kompetitorIds: [1] });
  // masukan asli tidak diubah
  assert.equal(masukan.nik, "3507123412341234");
});

test("saringNikMasukan: dengan hak ubah, nik diteruskan (termasuk null = kosongkan)", () => {
  assert.equal(saringNikMasukan({ nik: "123" }, true).nik, "123");
  assert.equal(saringNikMasukan({ nik: null }, true).nik, null);
});

test("normalisasiMitraForm: lokasiDihapusIds diteruskan (dedupe); dicentang → hapusSemuaTambahan false", () => {
  const r = normalisasiMitraForm(form({ lokasiBerbeda: true, lokasiDihapusIds: [7, 7, 9] }));
  assert.deepEqual(r.dihapusIds, [7, 9]);
  assert.equal(r.hapusSemuaTambahan, false);
});
test("normalisasiMitraForm: lokasiDihapusIds tidak dikirim (client lama) → []; bentuk salah → throw", () => {
  const f = form({ lokasiBerbeda: true }) as Partial<MitraAlamatForm>;
  delete f.lokasiDihapusIds;
  assert.deepEqual(normalisasiMitraForm(f as MitraAlamatForm).dihapusIds, []);
  for (const buruk of [["1"], [0], [1.5], "1"] as unknown[]) {
    assert.throws(() => normalisasiMitraForm(form({ lokasiDihapusIds: buruk as number[] })), {
      message: "Daftar lokasi yang dihapus tidak valid.",
    });
  }
});

const milik = [
  { id: 10, aktif: true },
  { id: 11, aktif: true },
  { id: 12, aktif: true },
  { id: 5, aktif: false },
];

test("rencanakanLokasiTambahan: form basi (lokasi 12 tidak dikirim & tidak diminta hapus) → 12 dibiarkan", () => {
  const r = rencanakanLokasiTambahan({ milik, idInput: [10, 11], idDiminta: [], hapusSemuaAktif: false });
  assert.deepEqual(r, { dihapus: [], dipertahankan: [12] });
});
test("rencanakanLokasiTambahan: hanya ID yang diminta yang dihapus; ID sudah terhapus diabaikan", () => {
  const r = rencanakanLokasiTambahan({ milik, idInput: [10], idDiminta: [11, 5], hapusSemuaAktif: false });
  assert.deepEqual(r, { dihapus: [11], dipertahankan: [12] });
});
test("rencanakanLokasiTambahan: hapus centang → semua lokasi aktif dihapus, termasuk yang tidak dikenal form", () => {
  const r = rencanakanLokasiTambahan({ milik, idInput: [], idDiminta: [10], hapusSemuaAktif: true });
  assert.deepEqual(r, { dihapus: [10, 11, 12], dipertahankan: [] });
});
test("rencanakanLokasiTambahan: ID diminta hapus bukan milik mitra → throw", () => {
  assert.throws(() => rencanakanLokasiTambahan({ milik, idInput: [], idDiminta: [99], hapusSemuaAktif: false }), {
    message: /bukan milik mitra ini/,
  });
});
test("rencanakanLokasiTambahan: ID input tidak aktif / ganda / sekaligus dihapus → throw", () => {
  assert.throws(() => rencanakanLokasiTambahan({ milik, idInput: [5], idDiminta: [], hapusSemuaAktif: false }), {
    message: /tidak ditemukan atau sudah dihapus/,
  });
  assert.throws(() => rencanakanLokasiTambahan({ milik, idInput: [10, 10], idDiminta: [], hapusSemuaAktif: false }), {
    message: /muncul dua kali/,
  });
  assert.throws(() => rencanakanLokasiTambahan({ milik, idInput: [10], idDiminta: [10], hapusSemuaAktif: false }), {
    message: /diubah sekaligus dihapus/,
  });
});

test("tandaiLokasiDihapus: ID tersimpan ditambahkan tanpa duplikat, baris baru diabaikan", () => {
  const baris = [
    { ...tambahan, lokasiPengirimanId: 3 },
    { ...tambahan, lokasiPengirimanId: null },
    { ...tambahan, lokasiPengirimanId: 4 },
  ];
  assert.deepEqual(tandaiLokasiDihapus([4], baris), [4, 3]);
  assert.deepEqual(tandaiLokasiDihapus(undefined, []), []);
});

const barisMitra = (o: Partial<MitraRow>): MitraRow =>
  ({
    BusinessPartnerID: "X1", Name: "Uji", Wilayah: "Malang", Kecamatan: "Klojen", Alamat: "Jl. Utama 1",
    Kontak: "0811", Latitude: -7.9, Longitude: 112.6, GeoAlamat: "Geo",
    LokasiBerbeda: false, AlamatMitra: null, LokasiTambahan: [], ...o,
  }) as MitraRow;

test("mitraKeAlamatForm: lokasi tambahan tanpa baris AlamatMitra → tetap dicentang, tambahan dipertahankan, alamat mitra = utama", () => {
  const f = mitraKeAlamatForm(
    barisMitra({
      LokasiTambahan: [
        { LokasiPengirimanID: 8, Urutan: 2, Label: "Gudang", IsDeleted: false, wilayah: "Batu", kecamatan: null,
          alamat: "Jl. Gudang", kontak: null, latitude: null, longitude: null, geoAlamat: null },
      ],
    })
  );
  assert.equal(f.lokasiBerbeda, true);
  assert.equal(f.lokasiTambahan.length, 1);
  assert.equal(f.lokasiTambahan[0].lokasiPengirimanId, 8);
  assert.deepEqual(f.alamatMitra, { wilayah: "Malang", kecamatan: "Klojen", alamat: "Jl. Utama 1", kontak: "0811", latitude: null, longitude: null, geoAlamat: null });
  assert.equal(f.lokasiUtama.alamat, "Jl. Utama 1");
  assert.deepEqual(f.lokasiDihapusIds, []);
});
test("mitraKeAlamatForm: tanpa AlamatMitra & tanpa tambahan → tidak dicentang", () => {
  const f = mitraKeAlamatForm(barisMitra({}));
  assert.equal(f.lokasiBerbeda, false);
  assert.deepEqual(f.lokasiTambahan, []);
});
