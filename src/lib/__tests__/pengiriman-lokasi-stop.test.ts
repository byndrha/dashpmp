import { test } from "node:test";
import assert from "node:assert/strict";
import { alamatUntukDeliveryOrder, pilihanLokasiStopTampil, ADDRESS_DELIVERY_MAKS } from "../mitra-lokasi";

const pilihan = [{ id: null, label: "Utama — Jl. Ijen 1" }, { id: 7, label: "Gudang Pasar — Jl. Pasar 2" }];

test("alamatUntukDeliveryOrder: NULL → string kosong (perilaku lama)", () => {
  assert.equal(alamatUntukDeliveryOrder(null), "");
});

test("alamatUntukDeliveryOrder: dipotong ke 150 karakter", () => {
  const panjang = "x".repeat(400);
  assert.equal(alamatUntukDeliveryOrder(panjang).length, ADDRESS_DELIVERY_MAKS);
  assert.equal(alamatUntukDeliveryOrder("Jl. Pasar 2"), "Jl. Pasar 2");
});

test("pilihanLokasiStopTampil: Draft, belum beku, >1 lokasi → tampil", () => {
  assert.deepEqual(pilihanLokasiStopTampil(pilihan, false, true), pilihan);
});

test("pilihanLokasiStopTampil: mitra satu lokasi → tanpa pemilih", () => {
  assert.equal(pilihanLokasiStopTampil(null, false, true), null);
  assert.equal(pilihanLokasiStopTampil([pilihan[0]], false, true), null);
});

test("pilihanLokasiStopTampil: sudah dibekukan → tanpa pemilih", () => {
  assert.equal(pilihanLokasiStopTampil(pilihan, true, true), null);
});

test("pilihanLokasiStopTampil: Jadwal bukan Draft → tanpa pemilih", () => {
  assert.equal(pilihanLokasiStopTampil(pilihan, false, false), null);
});
