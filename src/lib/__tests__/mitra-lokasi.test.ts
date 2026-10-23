import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalisasiMitraForm,
  pecahTeksKompetitor,
  pilihLokasiStop,
  saringNikMasukan,
  type AlamatFields,
  type MitraAlamatForm,
  type PinFields,
} from "../mitra-lokasi";

const alamat = (o: Partial<AlamatFields & PinFields> = {}): AlamatFields & PinFields => ({
  wilayah: "Malang", kecamatan: "Klojen", alamat: "Jl. Ijen 1", kontak: "081234567890",
  latitude: -7.97, longitude: 112.63, geoAlamat: "Jl. Ijen, Malang", ...o,
});
const form = (o: Partial<MitraAlamatForm> = {}): MitraAlamatForm => ({
  lokasiBerbeda: false,
  alamatMitra: alamat(),
  lokasiUtama: alamat({ wilayah: "Batu", alamat: "Jl. Diponegoro 5", latitude: -7.87, longitude: 112.52, geoAlamat: "Batu" }),
  lokasiTambahan: [],
  ...o,
});
const tambahan = {
  lokasiPengirimanId: null, label: "Gudang", wilayah: "Pakis", kecamatan: "Pakis", alamat: "Jl. Raya Pakis",
  kontak: null, latitude: -7.95, longitude: 112.7, geoAlamat: null,
};

test("normalisasiMitraForm: tidak dicentang → utama = alamatMitra (termasuk pin), alamatMitra null, tambahan []", () => {
  const r = normalisasiMitraForm(form());
  assert.deepEqual(r, { utama: alamat(), alamatMitra: null, tambahan: [] });
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
