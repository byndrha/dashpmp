import { test } from "node:test";
import assert from "node:assert/strict";
import { kelompokkanDo, type BarisDo } from "../queries/produksi-do-erp";

function baris(noDo: string, tanggalIso: string, kecil: number, besar: number, kendaraanErpId = "K1", plat = "S 9805 UH"): BarisDo {
  return { noDo, tanggal: new Date(tanggalIso), kendaraanErpId, plat, kecil, besar };
}

test("DO dikelompokkan dengan tanggalBisnisNaive", () => {
  const rows = [baris("DO/1", "2026-11-09T13:59:00Z", 10, 1), baris("DO/2", "2026-11-09T14:00:00Z", 20, 2)];

  const hariIni = kelompokkanDo(rows, "2026-11-09");
  assert.equal(hariIni.length, 1);
  assert.deepEqual(hariIni[0].noDo, ["DO/1"]);
  assert.equal(hariIni[0].kecil, 10);

  const besok = kelompokkanDo(rows, "2026-11-10");
  assert.equal(besok.length, 1);
  assert.deepEqual(besok[0].noDo, ["DO/2"]);
  assert.equal(besok[0].besar, 2);
});

test("dua DO untuk kendaraan sama dijumlahkan", () => {
  const rows = [
    baris("DO/1", "2026-11-09T08:00:00Z", 100, 5),
    baris("DO/2", "2026-11-09T09:00:00Z", 50, 7),
    baris("DO/3", "2026-11-09T09:30:00Z", 3, 4, "K2", "S 8807 UG"),
  ];
  const hasil = kelompokkanDo(rows, "2026-11-09");
  assert.equal(hasil.length, 2);
  const k1 = hasil.find((d) => d.kendaraanErpId === "K1");
  assert.ok(k1);
  assert.equal(k1.plat, "S 9805 UH");
  assert.equal(k1.kecil, 150);
  assert.equal(k1.besar, 12);
  assert.deepEqual([...k1.noDo].sort(), ["DO/1", "DO/2"]);
});

test("satu DO dengan beberapa pemesanan tidak menggandakan noDo", () => {
  const rows = [baris("DO/1", "2026-11-09T08:00:00Z", 100, 0), baris("DO/1", "2026-11-09T08:00:00Z", 40, 0)];
  const hasil = kelompokkanDo(rows, "2026-11-09");
  assert.equal(hasil[0].kecil, 140);
  assert.deepEqual(hasil[0].noDo, ["DO/1"]);
});
