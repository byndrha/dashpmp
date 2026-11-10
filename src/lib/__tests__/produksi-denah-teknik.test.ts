import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buatBak,
  denahKosong,
  validasiDenah,
  type BakElemen,
  type DenahDokumen,
  type DenahElemen,
  type DerekElemen,
  type GalatDenah,
  type JalurElemen,
} from "../produksi-denah";
import { periksaTeknik } from "../produksi-denah-teknik";

function dok(...elemen: DenahElemen[]): DenahDokumen {
  return { ...denahKosong(), elemen };
}

function bak(opsi: Partial<BakElemen> = {}): BakElemen {
  return buatBak(2, 2, { id: "b1", nama: "Bak 1", ...opsi });
}

function derek(opsi: Partial<DerekElemen> = {}): DerekElemen {
  return {
    id: "d1", nama: "Derek 1", tipe: "derek", x: 1, y: 4.5, w: 20, h: 1, rotasi: 0, elevasiM: 3.5, tinggiM: 0.3,
    titikAwal: { x: 1, y: 5 }, titikAkhir: { x: 21, y: 5 }, bakIds: ["b1"], tinggiKaitM: 0.8,
    ...opsi,
  };
}

function jalur(id: string, titik: JalurElemen["titik"], opsi: Partial<JalurElemen> = {}): JalurElemen {
  return {
    id, nama: id, tipe: "jalur", jenis: "pipa", fluida: "air-baku", diameterMm: 50, titik,
    x: 0, y: 0, w: 1, h: 1, rotasi: 0, elevasiM: 0, tinggiM: 0.05,
    ...opsi,
  };
}

const pesan = (g: GalatDenah[]) => g.map((x) => x.pesan).join("\n");
const ada = (g: GalatDenah[], teks: string) => assert.ok(pesan(g).includes(teks), `tidak ditemukan "${teks}" dalam:\n${pesan(g)}`);
const tidakAda = (g: GalatDenah[], teks: string) => assert.ok(!pesan(g).includes(teks), `tak terduga "${teks}" dalam:\n${pesan(g)}`);

test("periksaTeknik: bak bawaan + derek bawaan yang melintas → nol peringatan", () => {
  assert.deepEqual(periksaTeknik(dok(bak())), []);
  assert.deepEqual(periksaTeknik(dok(bak(), derek())), []);
});

test("periksaTeknik: semua hasil bertingkat peringatan dan menyertakan elemenId", () => {
  const g = periksaTeknik(dok(bak({ w: 8, tinggiM: 0.8, levelBrineM: 0.3 }), derek({ elevasiM: 1.0, titikAwal: { x: 1, y: 30 }, titikAkhir: { x: 21, y: 30 } })));
  assert.ok(g.length >= 4);
  for (const x of g) {
    assert.equal(x.tingkat, "peringatan");
    assert.ok(x.elemenId);
  }
});

test("aturan 1: bak lebar 8 → kolom tidak muat (kurang 1,46 m)", () => {
  const g = periksaTeknik(dok(bak({ w: 8 })));
  ada(g, "Bak 1");
  ada(g, "36 kolom butuh 9,06 m, ruang dalam 7,60 m (kurang 1,46 m)");
  assert.equal(g.length, 1);
  assert.equal(g[0].elemenId, "b1");
});

test("aturan 1: sumbu sepanjang kolom (ice can per kolom) juga diperiksa", () => {
  const g = periksaTeknik(dok(bak({ h: 5.5 })));
  // butuh 0 + 36 × 0,19 = 6,84; ruang 5,5 − 0,4 = 5,10
  ada(g, "butuh 6,84 m, ruang dalam 5,10 m (kurang 1,74 m)");
});

test("aturan 2a: tinggiM 0,8 → ice can menyentuh dasar bak", () => {
  const g = periksaTeknik(dok(bak({ tinggiM: 0.8, levelBrineM: 0.8 })));
  ada(g, "menyentuh dasar bak");
  tidakAda(periksaTeknik(dok(bak())), "menyentuh dasar bak");
});

test("aturan 2b: levelBrineM 1,03 → brine terlalu rendah, terendam 60%", () => {
  // dasar can = bibir 0,3 − 1,19 = −0,89; brine = −1,2 + 1,03 = −0,17 → (−0,17 + 0,89) / 1,19 = 60,5%
  const g = periksaTeknik(dok(bak({ levelBrineM: 1.03 })));
  ada(g, "brine terlalu rendah, ice can hanya terendam 60%");
  // 85% tepat lolos: brine = dasar can + 0,85 × 1,19 → levelBrineM = 0,31 + 1,0115
  tidakAda(periksaTeknik(dok(bak({ levelBrineM: 0.31 + 0.85 * 1.19 + 0.001 }))), "brine terlalu rendah");
});

test("aturan 2: hanya varian kolom aktif yang dipakai", () => {
  const b = bak();
  b.iceCan.besar = { ...b.iceCan.besar, tinggiMm: 1400 };
  b.kolom[0] = { ...b.kolom[0], varian: "besar", jumlahIceCan: 18, nonaktif: true };
  tidakAda(periksaTeknik(dok(b)), "menyentuh dasar bak");
  b.kolom[0] = { ...b.kolom[0], nonaktif: false };
  ada(periksaTeknik(dok(b)), "menyentuh dasar bak");
});

test("aturan 3: derek elevasi 2,24 untuk bak bawaan → kurang 25 cm", () => {
  // butuh bibir 0,3 + can 1,19 + 0,2 = 1,69; kait = 2,24 − 0,8 = 1,44
  const g = periksaTeknik(dok(bak(), derek({ elevasiM: 2.24 })));
  ada(g, "kurang 25 cm");
  const x = g.find((y) => y.pesan.includes("kurang 25 cm"))!;
  assert.equal(x.elemenId, "d1");
  assert.deepEqual(x.elemenTerkaitIds, ["b1"]);
  // tepat 1,69 + 0,8 = 2,49 lolos
  assert.deepEqual(periksaTeknik(dok(bak(), derek({ elevasiM: 2.49 }))), []);
});

test("aturan 4: rel derek tidak memotong bak yang dilayani", () => {
  const g = periksaTeknik(dok(bak(), derek({ titikAwal: { x: 1, y: 30 }, titikAkhir: { x: 21, y: 30 } })));
  ada(g, "tidak melintasi bak");
  assert.equal(g[0].elemenId, "d1");
  assert.deepEqual(g[0].elemenTerkaitIds, ["b1"]);
});

test("aturan 5: pipa menembus bak tanpa dari/ke bak → peringatan; dari/ke bak atau di atas bibir → lolos", () => {
  // Bak (2,2)-(11.7,9.3), z −1,2…+0,3.
  const tembus = jalur("j1", [{ x: 0, y: 5, z: 0 }, { x: 20, y: 5, z: 0 }], { dariId: "m1", keId: "m2" });
  const g = periksaTeknik(dok(bak(), tembus, mesin("m1", 0), mesin("m2", 20)));
  ada(g, "menembus bak");
  const x = g.find((y) => y.pesan.includes("menembus bak"))!;
  assert.equal(x.elemenId, "j1");
  assert.deepEqual(x.elemenTerkaitIds, ["b1"]);

  const keBak = jalur("j1", [{ x: 0, y: 5, z: 0 }, { x: 10, y: 5, z: 0 }], { dariId: "m1", keId: "b1" });
  tidakAda(periksaTeknik(dok(bak(), keBak, mesin("m1", 0))), "menembus bak");

  // Tepat di bibir (z = +0,3) — menyentuh, tidak menembus.
  const diBibir = jalur("j1", [{ x: 0, y: 5, z: 0.3 }, { x: 20, y: 5, z: 0.3 }], { dariId: "m1", keId: "m2" });
  tidakAda(periksaTeknik(dok(bak(), diBibir, mesin("m1", 0), mesin("m2", 20))), "menembus bak");
});

function mesin(id: string, x: number): DenahElemen {
  return { id, nama: id, tipe: "mesin", x, y: 4, w: 1, h: 1, rotasi: 0, elevasiM: 0, tinggiM: 1.8, jenis: "Pompa", catatan: "", kategori: "pompa" };
}

test("aturan 6: jalur NH3 tertanam di pelat → peringatan; air tertanam → tidak", () => {
  const titik = [{ x: 30, y: 20, z: -0.1 }, { x: 40, y: 20, z: -0.1 }];
  const nh3 = jalur("j1", titik, { fluida: "nh3-gas", dariId: "m1", keId: "m2" });
  const g = periksaTeknik(dok(nh3, mesin("m1", 30), mesin("m2", 40)));
  ada(g, "tertanam di beton");
  assert.equal(g.find((y) => y.pesan.includes("tertanam"))!.elemenId, "j1");

  const air = jalur("j1", titik, { fluida: "air-baku", dariId: "m1", keId: "m2" });
  tidakAda(periksaTeknik(dok(air, mesin("m1", 30), mesin("m2", 40))), "tertanam");

  const nh3Terlihat = jalur("j1", [{ x: 30, y: 20, z: 1 }, { x: 40, y: 20, z: 1 }], { fluida: "nh3-gas", dariId: "m1", keId: "m2" });
  tidakAda(periksaTeknik(dok(nh3Terlihat, mesin("m1", 30), mesin("m2", 40))), "tertanam");
});

test("aturan 7: ujung jalur menggantung vs bertemu jalur lain (toleransi 0,05)", () => {
  const a = jalur("j1", [{ x: 30, y: 20, z: 1 }, { x: 40, y: 20, z: 1 }]);
  const g = periksaTeknik(dok(a));
  assert.equal(g.filter((y) => y.pesan.includes("menggantung")).length, 2);
  assert.equal(g[0].elemenId, "j1");

  // Ujung akhir j1 bertemu titik awal j2 (selisih 0,04 m); ujung j2 punya keId.
  const b = jalur("j2", [{ x: 40.04, y: 20, z: 1 }, { x: 40, y: 25, z: 1 }], { keId: "m1" });
  const a2 = jalur("j1", a.titik, { dariId: "m1" });
  assert.deepEqual(periksaTeknik(dok(a2, b, mesin("m1", 45))), []);

  // Selisih 0,1 m → menggantung.
  const jauh = jalur("j2", [{ x: 40.1, y: 20, z: 1 }, { x: 40, y: 25, z: 1 }], { keId: "m1" });
  ada(periksaTeknik(dok(a2, jauh, mesin("m1", 45))), "menggantung");
});

test("validasiDenah: dokumen yang hanya memicu peringatan → []", () => {
  const d = dok(bak({ w: 13.5, levelBrineM: 0.7 }), derek({ elevasiM: 1.8 }), jalur("j1", [{ x: 30, y: 20, z: -0.1 }, { x: 40, y: 20, z: -0.1 }], { fluida: "nh3-gas" }));
  assert.ok(periksaTeknik(d).length > 0);
  assert.deepEqual(validasiDenah(d), []);
});

test("galat baru: jalur 1 titik, diameter 0, dariId tak ada, levelBrineM > tinggiM", () => {
  ada(validasiDenah(dok(jalur("j1", [{ x: 1, y: 1, z: 0 }]))), "minimal 2 titik");
  ada(validasiDenah(dok(jalur("j1", [{ x: 1, y: 1, z: 0 }, { x: 2, y: 1, z: 0 }], { diameterMm: 0 }))), "Diameter");
  ada(validasiDenah(dok(jalur("j1", [{ x: 1, y: 1, z: 0 }, { x: 2, y: 1, z: 0 }], { dariId: "hantu" }))), "menunjuk elemen yang tidak ada");
  ada(validasiDenah(dok(jalur("j1", [{ x: 1, y: 1, z: 0 }, { x: 2, y: 1, z: 0 }], { keId: "hantu" }))), "menunjuk elemen yang tidak ada");
  ada(validasiDenah(dok(bak({ levelBrineM: 1.6 }))), "Level brine");
  // galat tidak bertingkat peringatan
  for (const x of validasiDenah(dok(bak({ levelBrineM: 1.6 })))) assert.notEqual(x.tingkat, "peringatan");
});

test("galat baru: dimensi ice can ≤ 0, tinggiM ≤ 0 tipe ber-volume, utara, tangki, dinding bak", () => {
  const b = bak();
  b.iceCan.kecil = { ...b.iceCan.kecil, tinggiMm: 0 };
  ada(validasiDenah(dok(b)), "ice can Kecil");
  const b2 = bak();
  b2.iceCan.besar = { ...b2.iceCan.besar, beratKg: -1 };
  ada(validasiDenah(dok(b2)), "ice can Besar");

  ada(validasiDenah(dok(mesin("m1", 1), { ...mesin("m2", 5), tinggiM: 0 } as DenahElemen)), "Tinggi");
  // area, label, jalur dikecualikan
  const area: DenahElemen = { id: "a1", nama: "Area", tipe: "area", x: 1, y: 1, w: 2, h: 2, rotasi: 0, elevasiM: 0, tinggiM: 0 };
  const label: DenahElemen = { id: "l1", nama: "Label", tipe: "label", x: 5, y: 1, w: 2, h: 1, rotasi: 0, elevasiM: 0, tinggiM: 0, teks: "x" };
  const j = jalur("j1", [{ x: 1, y: 10, z: 0 }, { x: 2, y: 10, z: 0 }], { tinggiM: 0 });
  assert.deepEqual(validasiDenah(dok(area, label, j)), []);

  const d = dok();
  d.kanvas.utaraDerajat = 360;
  ada(validasiDenah(d), "utara");

  const tangki: DenahElemen = { id: "t1", nama: "Tandon", tipe: "tangki", x: 1, y: 1, w: 2, h: 2, rotasi: 0, elevasiM: 0, tinggiM: 1.5, jenis: "tandon", bentuk: "kotak", levelIsiPersen: 120 };
  ada(validasiDenah(dok(tangki)), "Level isi");
  ada(validasiDenah(dok(bak({ tebalDindingM: -0.1 }))), "Tebal dinding");
  assert.deepEqual(validasiDenah(dok(bak())), []);
});
