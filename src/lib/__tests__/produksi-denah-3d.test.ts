import { test } from "node:test";
import assert from "node:assert/strict";
import { buatBak, buatKolom, denahKosong, type BakElemen, type DenahDokumen, type DerekElemen, type DindingElemen, type PintuElemen } from "../produksi-denah";
import { keDunia, tataBakMeter } from "../produksi-denah-geometri";
import { periksaTeknik } from "../produksi-denah-teknik";
import {
  balokAntara,
  derekTerlaluRendahIds,
  iceCanBak,
  keThree,
  kotakLokalKeDunia,
  kotakThree,
  lubangPelat,
  potongDinding,
  ruangBebasDerek,
  sudutLayarUtara,
} from "../../components/produksi-denah/3d/koordinat";

const dekat = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

test("keThree: denah (x, y, z) → three [x, z, y]", () => {
  assert.deepEqual(keThree(1, 2, 3), [1, 3, 2]);
  assert.deepEqual(keThree(-4.5, 0, -0.7), [-4.5, -0.7, 0]);
});

test("kotakThree: kotak denah + rentang z → pusat & ukuran three", () => {
  const k = kotakThree({ x: 2, y: 4, w: 6, h: 2 }, -0.5, 1.5);
  assert.deepEqual(k.pusat, [5, 0.25, 5]);
  assert.deepEqual(k.ukuran, [6, 1.5, 2]);
});

function bak(opsi: Partial<BakElemen> = {}): BakElemen {
  return buatBak(10, 20, { w: 4, h: 2, kolom: buatKolom(3, { varian: "kecil", jumlahIceCan: 4 }), ...opsi });
}

test("kotakLokalKeDunia: sama dengan keDunia pada dua pojok berlawanan (semua rotasi)", () => {
  for (const rotasi of [0, 90, 180, 270] as const) {
    const b = bak({ rotasi });
    const lokal = { x: 0.3, y: 0.2, w: 0.5, h: 0.4 };
    const k = kotakLokalKeDunia(b, lokal);
    const p = keDunia(b, { x: lokal.x, y: lokal.y });
    const q = keDunia(b, { x: lokal.x + lokal.w, y: lokal.y + lokal.h });
    assert.ok(dekat(k.x, Math.min(p.x, q.x)) && dekat(k.y, Math.min(p.y, q.y)), `rotasi ${rotasi}`);
    assert.ok(dekat(k.w, Math.abs(q.x - p.x)) && dekat(k.h, Math.abs(q.y - p.y)), `rotasi ${rotasi}`);
  }
});

test("iceCanBak: satu instans per can, posisi dari tataBakMeter + keDunia, dasar can = bibir − tinggi", () => {
  const b = bak();
  b.kolom[1] = { ...b.kolom[1], varian: "besar", jumlahIceCan: 2 };
  b.kolom[2] = { ...b.kolom[2], nonaktif: true };
  const hasil = iceCanBak(b);
  assert.equal(hasil.kecil.length, 4 + 4);
  assert.equal(hasil.besar.length, 2);
  const t = tataBakMeter(b);
  const k0 = t.kolom[0];
  const can = hasil.kecil[0];
  const lokal = t.keXY(k0.a0, k0.b0, k0.lebar, k0.panjangCan);
  const pusat = keDunia(b, { x: lokal.x + lokal.w / 2, y: lokal.y + lokal.h / 2 });
  const tinggi = b.iceCan.kecil.tinggiMm / 1000;
  assert.ok(dekat(can.pusat[0], pusat.x) && dekat(can.pusat[2], pusat.y));
  assert.ok(dekat(can.pusat[1] - can.ukuran[1] / 2, t.bibirZ - tinggi));
  assert.equal(can.kolomId, b.kolom[0].id);
  assert.equal(can.nonaktif, false);
  assert.ok(hasil.kecil.slice(4).every((c) => c.nonaktif && c.kolomId === b.kolom[2].id));
});

test("iceCanBak: rotasi 90 menukar ukuran tapak can", () => {
  const b0 = iceCanBak(bak()).kecil[0];
  const b90 = iceCanBak(bak({ rotasi: 90 })).kecil[0];
  assert.ok(dekat(b0.ukuran[0], b90.ukuran[2]) && dekat(b0.ukuran[2], b90.ukuran[0]));
  assert.equal(b0.ukuran[1], b90.ukuran[1]);
});

test("balokAntara: pusat di tengah, panjang & sudut rotasi Y three", () => {
  const r = balokAntara({ x: 0, y: 0 }, { x: 3, y: 4 });
  assert.deepEqual([r.pusat.x, r.pusat.y], [1.5, 2]);
  assert.equal(r.panjang, 5);
  // Rotasi Y three sebesar r.rotY memetakan +x lokal ke arah (dx, dz) = (3, 4)/5.
  const x = Math.cos(r.rotY), z = -Math.sin(r.rotY);
  assert.ok(dekat(x, 0.6) && dekat(z, 0.8));
});

test("potongDinding: pintu bersinggungan memotong dinding setinggi pintu", () => {
  const d = { x: 0, y: 0, w: 10, h: 0.2, rotasi: 0, elevasiM: 0, tinggiM: 4 } as unknown as DindingElemen;
  const p = { x: 4, y: -0.1, w: 1, h: 0.4, rotasi: 0, elevasiM: 0, tinggiM: 2.4 } as unknown as PintuElemen;
  const balok = potongDinding(d, [p]);
  // kiri [0,4] penuh, kanan [5,10] penuh, atas pintu [4,5] dari 2.4 ke 4.
  assert.equal(balok.length, 3);
  const atas = balok.find((b) => dekat(b.zBawah, 2.4))!;
  assert.ok(dekat(atas.kotak.x, 4) && dekat(atas.kotak.w, 1) && dekat(atas.zAtas, 4));
  assert.ok(balok.some((b) => dekat(b.kotak.x, 0) && dekat(b.kotak.w, 4) && b.zBawah === 0 && b.zAtas === 4));
  assert.ok(balok.some((b) => dekat(b.kotak.x, 5) && dekat(b.kotak.w, 5)));
  // Pintu tidak bersinggungan → dinding utuh.
  const jauh = { ...p, y: 5 } as PintuElemen;
  assert.equal(potongDinding(d, [jauh]).length, 1);
  // Dinding vertikal (rotasi 90) dipotong di sumbu y.
  const dv = { x: 0, y: 0, w: 10, h: 0.2, rotasi: 90, elevasiM: 0, tinggiM: 4 } as unknown as DindingElemen;
  const pv = { x: 4.4, y: -0.6, w: 1, h: 0.4, rotasi: 90, elevasiM: 0, tinggiM: 2 } as unknown as PintuElemen;
  const bv = potongDinding(dv, [pv]);
  assert.equal(bv.length, 3);
});

test("lubangPelat: bak di dalam lahan jadi lubang, bertumpuk/keluar lahan dilewati", () => {
  const dok: DenahDokumen = { ...denahKosong(), elemen: [] };
  const a = buatBak(1, 1, { w: 4, h: 2 });
  const b = buatBak(2, 2, { w: 4, h: 2 }); // bertumpuk dengan a
  const c = buatBak(dok.kanvas.lebar - 1, 1, { w: 4, h: 2 }); // keluar lahan
  const d = buatBak(10, 10, { w: 4, h: 2, elevasiM: 0.1 }); // di atas lantai: tidak melubangi
  const lubang = lubangPelat({ ...dok, elemen: [a, b, c, d] });
  assert.equal(lubang.length, 1);
  assert.deepEqual(lubang[0], { x: 1, y: 1, w: 4, h: 2 });
});

test("ruangBebasDerek: dari bibir bak setinggi can tertinggi aktif + 0,20 m", () => {
  const b = bak();
  const r = ruangBebasDerek(b)!;
  const t = tataBakMeter(b);
  assert.ok(dekat(r.zBawah, t.bibirZ));
  assert.ok(dekat(r.zAtas, t.bibirZ + b.iceCan.kecil.tinggiMm / 1000 + 0.2));
  assert.equal(ruangBebasDerek({ ...b, kolom: b.kolom.map((k) => ({ ...k, nonaktif: true })) }), null);
});

test("derekTerlaluRendahIds: hanya derek dengan peringatan aturan 3 dari periksaTeknik", () => {
  const b = bak();
  const derek = (id: string, elevasiM: number): DerekElemen => ({
    id,
    tipe: "derek",
    nama: id,
    x: 9,
    y: 21,
    w: 6,
    h: 0.3,
    rotasi: 0,
    elevasiM,
    tinggiM: 0.3,
    tinggiKaitM: 0.8,
    titikAwal: { x: 9, y: 21 },
    titikAkhir: { x: 15, y: 21 },
    bakIds: [b.id],
  });
  const dok: DenahDokumen = { ...denahKosong(), elemen: [b, derek("rendah", 1.5), derek("tinggi", 5)] };
  const ids = derekTerlaluRendahIds(periksaTeknik(dok));
  assert.deepEqual([...ids], ["rendah"]);
});

test("sudutLayarUtara: proyeksi arah utara ke layar → derajat dari atas, searah jarum jam", () => {
  assert.ok(dekat(sudutLayarUtara({ x: 0, y: 0 }, { x: 0, y: -10 }), 0));
  assert.ok(dekat(sudutLayarUtara({ x: 0, y: 0 }, { x: 10, y: 0 }), 90));
  assert.ok(dekat(sudutLayarUtara({ x: 5, y: 5 }, { x: 0, y: 5 }), 270));
});
