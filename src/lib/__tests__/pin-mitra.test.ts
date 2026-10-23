import { test } from "node:test";
import assert from "node:assert/strict";
import { daftarPinMitra, pinTerdekat } from "../pin-mitra";

const utama = { latitude: -7.97, longitude: 112.63 };
const tambahan = [
  { label: "Gudang Pasar", latitude: -7.95, longitude: 112.7 },
  { label: null, latitude: null, longitude: null },
  { label: "  ", latitude: -7.9, longitude: 112.6 },
];

test("daftarPinMitra: utama + tambahan berkoordinat, label kosong → \"Lokasi N\"", () => {
  assert.deepEqual(daftarPinMitra(utama, tambahan), [
    { lat: -7.97, lng: 112.63, label: "Utama" },
    { lat: -7.95, lng: 112.7, label: "Gudang Pasar" },
    { lat: -7.9, lng: 112.6, label: "Lokasi 4" },
  ]);
});
test("daftarPinMitra: utama tanpa pin → hanya tambahan; semua kosong → []", () => {
  assert.deepEqual(daftarPinMitra({ latitude: null, longitude: null }, tambahan.slice(0, 1)), [
    { lat: -7.95, lng: 112.7, label: "Gudang Pasar" },
  ]);
  assert.deepEqual(daftarPinMitra(null, []), []);
});
test("pinTerdekat: memilih lokasi tambahan bila posisi di dekatnya (jarak ke utama jauh)", () => {
  const pins = daftarPinMitra(utama, tambahan);
  // ±30 m dari Gudang Pasar, ±7 km dari utama.
  const r = pinTerdekat(pins, { lat: -7.95027, lng: 112.7 });
  assert.ok(r);
  assert.equal(r.pin.label, "Gudang Pasar");
  assert.ok(r.jarakMeter < 100, `jarak ${r.jarakMeter}`);
});
test("pinTerdekat: tanpa pin → null", () => {
  assert.equal(pinTerdekat([], { lat: 0, lng: 0 }), null);
});
