import { test } from "node:test";
import assert from "node:assert/strict";
import { nilaiBalokBesarUntukSimpan } from "../mitra-es-balok-form";

const isian = { hargaBalokBesar: 7000, kapasitasBalokBesar: 30 };

test("pmpakis: nilai Balok Besar tersimpan kartu dipertahankan (logistik dipakai bersama pmpersada)", () => {
  assert.deepEqual(
    nilaiBalokBesarUntukSimpan("pmpakis", { hargaBalokBesar: 12500, kapasitasBalokBesar: 40 }, { hargaBalokBesar: 0, kapasitasBalokBesar: null }),
    { hargaBalokBesar: 12500, kapasitasBalokBesar: 40 }
  );
  // Kapasitas null tersimpan tetap null, tidak diganti isian form.
  assert.deepEqual(nilaiBalokBesarUntukSimpan("pmpakis", { hargaBalokBesar: 0, kapasitasBalokBesar: null }, isian), {
    hargaBalokBesar: 0,
    kapasitasBalokBesar: null,
  });
});

test("pmpakis mitra baru: Balok Besar 0/null", () => {
  assert.deepEqual(nilaiBalokBesarUntukSimpan("pmpakis", null, isian), { hargaBalokBesar: 0, kapasitasBalokBesar: null });
});

test("pmpersada/pmputra: isian form dipakai apa adanya", () => {
  const card = { hargaBalokBesar: 12500, kapasitasBalokBesar: 40 };
  assert.deepEqual(nilaiBalokBesarUntukSimpan("pmpersada", card, isian), isian);
  assert.deepEqual(nilaiBalokBesarUntukSimpan("pmputra", null, isian), isian);
});
