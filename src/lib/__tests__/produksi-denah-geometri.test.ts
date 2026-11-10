import { test } from "node:test";
import assert from "node:assert/strict";
import { buatBak, denahKosong, type BetonElemen, type DerekElemen, type JalurElemen } from "../produksi-denah";
import {
  garisRel,
  keDunia,
  potongSegmenKotak,
  pusatElemen,
  segmenJalur,
  segmenTertanam,
  tataBakMeter,
} from "../produksi-denah-geometri";

const dekat = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test("tataBakMeter: bak bawaan 36 kolom kecil × 36 can muat dengan angka spec", () => {
  const t = tataBakMeter(buatBak(0, 0));
  dekat(t.butuhA, 0.06 + 36 * 0.25);
  dekat(t.butuhA, 9.06);
  dekat(t.ruangA, 9.3);
  dekat(t.butuhB, 0 + 36 * 0.19);
  dekat(t.butuhB, 6.84);
  dekat(t.ruangB, 6.9);
  dekat(t.bibirZ, 0.3);
  dekat(t.lantaiDalamZ, -1.0);
  dekat(t.brineZ, 0.25);
  assert.equal(t.kolom.length, 36);
  const k0 = t.kolom.find((k) => k.indeks === 0)!;
  dekat(k0.a0, 0.2 + 0.06);
  dekat(k0.b0, 0.2 + 0);
  dekat(k0.lebar, 0.19);
  dekat(k0.panjangCan, 0.19);
  dekat(k0.jarakCan, 0);
  assert.equal(k0.jumlah, 36);
  assert.equal(k0.posisi, 0);
  const k1 = t.kolom.find((k) => k.indeks === 1)!;
  dekat(k1.a0, 0.2 + 0.06 + 0.25);
});

test("tataBakMeter: arahNomor mundur → kolom indeks 0 punya a0 terbesar", () => {
  const t = tataBakMeter(buatBak(0, 0, { arahNomor: "mundur" }));
  const k0 = t.kolom.find((k) => k.indeks === 0)!;
  assert.equal(k0.posisi, 35);
  for (const k of t.kolom) if (k.indeks !== 0) assert.ok(k.a0 < k0.a0);
});

test("tataBakMeter: kolom besar memakai lebar 0,40 (diganti) dan panjang 0,38; a0 menjumlah lebar campuran", () => {
  const bak = buatBak(0, 0);
  bak.kolom = bak.kolom.slice(0, 3).map((k, i) => ({ ...k, varian: i === 1 ? ("besar" as const) : ("kecil" as const), jumlahIceCan: i === 1 ? 20 : 36 }));
  bak.iceCan.besar = { ...bak.iceCan.besar, lebarMm: 400 };
  const t = tataBakMeter(bak);
  const k1 = t.kolom.find((k) => k.indeks === 1)!;
  dekat(k1.lebar, 0.4);
  dekat(k1.panjangCan, 0.38);
  assert.equal(k1.varian, "besar");
  const k2 = t.kolom.find((k) => k.indeks === 2)!;
  dekat(k2.a0, 0.2 + 0.06 + 0.25 + 0.46);
  dekat(t.butuhA, 0.06 + 0.25 + 0.46 + 0.25);
  // 20 can besar (20 × 0,38 = 7,6) lebih panjang daripada 36 can kecil (36 × 0,19 = 6,84)
  dekat(t.butuhB, 0 + Math.max(36 * 0.19, 20 * 0.38));
  dekat(t.butuhB, 7.6);
  // bawaan besar: lebar 190 mm, panjang 380 mm
  const t2 = tataBakMeter(buatBak(0, 0, { varianBawaan: "besar" }));
  dekat(t2.kolom[0].lebar, 0.19);
  dekat(t2.kolom[0].panjangCan, 0.38);
});

test("tataBakMeter: keXY memetakan (a,b) ke x/y lokal sesuai orientasi", () => {
  const h = tataBakMeter(buatBak(0, 0));
  assert.deepEqual(h.keXY(1, 2, 3, 4), { x: 1, y: 2, w: 3, h: 4 });
  const v = tataBakMeter(buatBak(0, 0, { orientasiKolom: "vertikal", w: 6.5, h: 16 }));
  assert.deepEqual(v.keXY(1, 2, 3, 4), { x: 2, y: 1, w: 4, h: 3 });
  dekat(v.ruangA, 15.6);
  dekat(v.ruangB, 6.1);
});

test("tataBakMeter: nonaktif diteruskan", () => {
  const bak = buatBak(0, 0);
  bak.kolom[3] = { ...bak.kolom[3], nonaktif: true };
  const t = tataBakMeter(bak);
  assert.equal(t.kolom.find((k) => k.indeks === 3)!.nonaktif, true);
  assert.equal(t.kolom.find((k) => k.indeks === 2)!.nonaktif, false);
  assert.equal(t.kolom[3].kolomId, bak.kolom[3].id);
});

test("pusatElemen & keDunia: rotasi 90 sama dengan SVG translate(x y) rotate(90 w/2 h/2)", () => {
  const bak = buatBak(10, 20, { w: 4, h: 2 });
  assert.deepEqual(pusatElemen(bak), { x: 12, y: 21 });
  // rotasi 0: hanya translasi
  assert.deepEqual(keDunia(bak, { x: 0, y: 0 }), { x: 10, y: 20 });
  const r90 = { ...bak, rotasi: 90 as const };
  // SVG rotate(90) (y ke bawah): (dx, dy) → (−dy, dx) di sekitar pusat (2,1) lokal.
  // pojok lokal (0,0): d=(−2,−1) → (1,−2) → lokal (3,−1) → dunia (13,19)
  const p = keDunia(r90, { x: 0, y: 0 });
  dekat(p.x, 13);
  dekat(p.y, 19);
  // pojok lokal (4,2): d=(2,1) → (−1,2) → lokal (1,3) → dunia (11,23)
  const q = keDunia(r90, { x: 4, y: 2 });
  dekat(q.x, 11);
  dekat(q.y, 23);
  // pojok hasil berada di kotakElemen efektif (x 11..13, y 19..23)
  const r180 = keDunia({ ...bak, rotasi: 180 }, { x: 0, y: 0 });
  dekat(r180.x, 14);
  dekat(r180.y, 22);
  const r270 = keDunia({ ...bak, rotasi: 270 }, { x: 0, y: 0 });
  dekat(r270.x, 11);
  dekat(r270.y, 23);
});

function derek(opsi: Partial<DerekElemen>): DerekElemen {
  return {
    id: "d1", nama: "D", tipe: "derek", x: 0, y: 0, w: 10, h: 2, rotasi: 0, elevasiM: 3.5, tinggiM: 0.3,
    titikAwal: { x: 0, y: 0 }, titikAkhir: { x: 0, y: 0 }, bakIds: [], tinggiKaitM: 0.8, ...opsi,
  };
}

test("garisRel: pakai titik bila diatur, kalau sama pakai garis tengah sisi terpanjang", () => {
  assert.deepEqual(garisRel(derek({ titikAwal: { x: 1, y: 1 }, titikAkhir: { x: 5, y: 1 } })), { a: { x: 1, y: 1 }, b: { x: 5, y: 1 } });
  assert.deepEqual(garisRel(derek({})), { a: { x: 0, y: 1 }, b: { x: 10, y: 1 } });
  assert.deepEqual(garisRel(derek({ w: 2, h: 10 })), { a: { x: 1, y: 0 }, b: { x: 1, y: 10 } });
});

function jalur(titik: JalurElemen["titik"]): JalurElemen {
  return {
    id: "j1", nama: "J", tipe: "jalur", jenis: "pipa", fluida: "air-baku", diameterMm: 50, titik,
    x: 0, y: 0, w: 1, h: 1, rotasi: 0, elevasiM: 0, tinggiM: 0.05,
  };
}

test("segmenJalur: pasangan titik berurutan dengan panjang 3D", () => {
  const s = segmenJalur(jalur([{ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }, { x: 3, y: 4, z: -2 }]));
  assert.equal(s.length, 2);
  dekat(s[0].panjang, 5);
  dekat(s[1].panjang, 2);
  assert.deepEqual(s[1].a, { x: 3, y: 4, z: 0 });
  assert.equal(segmenJalur(jalur([{ x: 0, y: 0, z: 0 }])).length, 0);
});

test("segmenTertanam: pelat 0,2 menanam z −0,1, bukan z −0,3 kecuali di dalam beton", () => {
  const dok = denahKosong();
  assert.equal(dok.kanvas.pelatLantai.tebalM, 0.2);
  const seg = (z: number, x2 = 5) => ({ a: { x: 1, y: 1, z }, b: { x: x2, y: 1, z }, panjang: x2 - 1 });
  assert.equal(segmenTertanam(seg(-0.1), dok), true);
  assert.equal(segmenTertanam(seg(-0.3), dok), false);
  assert.equal(segmenTertanam(seg(0.1), dok), false);
  const beton: BetonElemen = { id: "b1", nama: "Pondasi", tipe: "beton", x: 0, y: 0, w: 6, h: 2, rotasi: 0, elevasiM: -0.5, tinggiM: 0.5 };
  const dokBeton = { ...dok, elemen: [beton] };
  assert.equal(segmenTertanam(seg(-0.3), dokBeton), true);
  // ujung di luar kotak beton → tidak tertanam
  assert.equal(segmenTertanam(seg(-0.3, 8), dokBeton), false);
  // di bawah dasar beton → tidak
  assert.equal(segmenTertanam(seg(-0.6), dokBeton), false);
});

test("potongSegmenKotak: lolos dan potong", () => {
  const kotak = { x: 0, y: 0, w: 2, h: 2, zBawah: 0, zAtas: 1 };
  assert.equal(potongSegmenKotak({ x: -1, y: 1, z: 0.5 }, { x: 3, y: 1, z: 0.5 }, kotak), true);
  assert.equal(potongSegmenKotak({ x: -1, y: 1, z: 1.5 }, { x: 3, y: 1, z: 1.5 }, kotak), false);
  assert.equal(potongSegmenKotak({ x: -1, y: 3, z: 0.5 }, { x: 3, y: 3, z: 0.5 }, kotak), false);
  // diagonal menembus sudut atas
  assert.equal(potongSegmenKotak({ x: -1, y: 1, z: 2 }, { x: 1, y: 1, z: 0 }, kotak), true);
  // segmen berhenti sebelum kotak
  assert.equal(potongSegmenKotak({ x: -3, y: 1, z: 0.5 }, { x: -1, y: 1, z: 0.5 }, kotak), false);
});

test("tataBakMeter: orientasi can per kolom menukar lebar dan panjangCan", () => {
  const bak = buatBak(0, 0);
  // Varian besar (190 × 380 mm) dipakai karena ice can kecil bawaan persegi (tak terbedakan saat ditukar).
  bak.kolom = bak.kolom.slice(0, 2).map((k, i) => ({ ...k, varian: "besar" as const, jumlahIceCan: i === 0 ? 10 : 30, ...(i === 1 ? { orientasiCan: "tegak" as const } : {}) }));
  const t = tataBakMeter(bak);
  const [a, b] = t.kolom;
  dekat(a.lebar, 0.19);
  dekat(a.panjangCan, 0.38);
  assert.equal(a.orientasi, "mendatar");
  dekat(b.lebar, 0.38);
  dekat(b.panjangCan, 0.19);
  assert.equal(b.orientasi, "tegak");
  dekat(b.a0, a.a0 + 0.19 + 0.06);
  dekat(t.butuhA, 0.06 + 0.25 + 0.44);
  dekat(t.butuhB, 0 + Math.max(10 * 0.38, 30 * 0.19));
});

test("tataBakMeter: tanpa orientasiCan hasilnya sama dengan perilaku lama (beku)", () => {
  const bak = buatBak(0, 0);
  bak.kolom = bak.kolom.slice(0, 3).map((k, i) => ({ ...k, varian: i === 1 ? ("besar" as const) : ("kecil" as const), jumlahIceCan: 5 + i }));
  const t = tataBakMeter(bak);
  const beku = [
    { a0: 0.26, lebar: 0.19, panjangCan: 0.19, jumlah: 5 },
    { a0: 0.26 + 0.25, lebar: bak.iceCan.besar.lebarMm / 1000, panjangCan: bak.iceCan.besar.panjangMm / 1000, jumlah: 6 },
  ];
  for (let i = 0; i < 2; i++) {
    dekat(t.kolom[i].a0, beku[i].a0);
    dekat(t.kolom[i].lebar, beku[i].lebar);
    dekat(t.kolom[i].panjangCan, beku[i].panjangCan);
    assert.equal(t.kolom[i].jumlah, beku[i].jumlah);
    assert.equal(t.kolom[i].orientasi, "mendatar");
  }
  dekat(t.kolom[0].b0, 0.2);
  dekat(t.butuhB, 0 + Math.max(5 * 0.19, 6 * (beku[1].panjangCan + 0), 7 * 0.19));
});
