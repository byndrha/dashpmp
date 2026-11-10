import { test } from "node:test";
import assert from "node:assert/strict";
import { buatBak, buatKolom, denahKosong, type BakElemen, type DenahDokumen, type DerekElemen, type DindingElemen, type PintuElemen } from "../produksi-denah";
import { keDunia, tataBakMeter } from "../produksi-denah-geometri";
import { periksaTeknik } from "../produksi-denah-teknik";
import {
  balokAntara,
  BATAS_INSTANS_ICE_CAN,
  hitungInstansIceCan,
  derekTerlaluRendah,
  kunciDerekBak,
  iceCanBak,
  keThree,
  kotakLokalKeDunia,
  kotakThree,
  lubangPelat,
  SUSUT_LUBANG_PELAT,
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

test("lubangPelat: bak di dalam lahan jadi lubang (susut 1 mm), bertumpuk dilewati, keluar lahan di-clamp", () => {
  const dok: DenahDokumen = { ...denahKosong(), elemen: [] };
  const L = dok.kanvas.lebar;
  const s = SUSUT_LUBANG_PELAT;
  const a = buatBak(1, 1, { w: 4, h: 2 });
  const b = buatBak(2, 2, { w: 4, h: 2 }); // bertumpuk dengan a
  const c = buatBak(L - 1, 10, { w: 4, h: 2 }); // menjulur keluar lahan → di-clamp
  const d = buatBak(10, 10, { w: 4, h: 2, elevasiM: 0.1 }); // di atas lantai: tidak melubangi
  const lubang = lubangPelat({ ...dok, elemen: [a, b, c, d] });
  assert.equal(lubang.length, 2);
  const samaKotak = (k: { x: number; y: number; w: number; h: number }, x: number, y: number, w: number, h: number) =>
    assert.ok(dekat(k.x, x) && dekat(k.y, y) && dekat(k.w, w) && dekat(k.h, h), JSON.stringify(k));
  samaKotak(lubang[0], 1 + s, 1 + s, 4 - 2 * s, 2 - 2 * s);
  samaKotak(lubang[1], L - 1 + s, 10 + s, 1 - 2 * s, 2 - 2 * s);
});

test("lubangPelat: dua bak berdampingan berbagi tepi → dua lubang terpisah", () => {
  const dok: DenahDokumen = { ...denahKosong(), elemen: [] };
  const a = buatBak(5, 5, { w: 4, h: 2 });
  const b = buatBak(9, 5, { w: 4, h: 2 }); // tepi kanan a = tepi kiri b
  const c = buatBak(5, 7, { w: 4, h: 2 }); // tepi bawah a = tepi atas c
  const lubang = lubangPelat({ ...dok, elemen: [a, b, c] });
  assert.equal(lubang.length, 3);
  // Celah 2 mm di antara lubang: tidak bersinggungan.
  assert.ok(lubang[1].x - (lubang[0].x + lubang[0].w) > 0);
  assert.ok(lubang[2].y - (lubang[0].y + lubang[0].h) > 0);
});

test("lubangPelat: bak menempel x=0 tetap berlubang (di-clamp ke dalam pelat)", () => {
  const dok: DenahDokumen = { ...denahKosong(), elemen: [] };
  const a = buatBak(0, 3, { w: 4, h: 2 });
  const lubang = lubangPelat({ ...dok, elemen: [a] });
  assert.equal(lubang.length, 1);
  assert.ok(lubang[0].x > 0 && dekat(lubang[0].x, SUSUT_LUBANG_PELAT));
  assert.ok(dekat(lubang[0].x + lubang[0].w, 4 - SUSUT_LUBANG_PELAT));
});

test("ruangBebasDerek: dari bibir bak setinggi can tertinggi aktif + 0,20 m", () => {
  const b = bak();
  const r = ruangBebasDerek(b)!;
  const t = tataBakMeter(b);
  assert.ok(dekat(r.zBawah, t.bibirZ));
  assert.ok(dekat(r.zAtas, t.bibirZ + b.iceCan.kecil.tinggiMm / 1000 + 0.2));
  assert.equal(ruangBebasDerek({ ...b, kolom: b.kolom.map((k) => ({ ...k, nonaktif: true })) }), null);
});

test("derekTerlaluRendah: per pasangan derek–bak dari kode aturan 3 periksaTeknik", () => {
  // Bak A dangkal (bibir +0,30), bak B lebih tinggi (bibir +1,30); satu derek melayani keduanya.
  const a = bak({ id: "A" });
  const b = buatBak(10, 24, { id: "B", w: 4, h: 2, elevasiM: 0.3, kolom: buatKolom(3, { varian: "kecil", jumlahIceCan: 4 }) });
  const derek = (id: string, elevasiM: number, bakIds: string[]): DerekElemen => ({
    id,
    tipe: "derek",
    nama: id,
    x: 11,
    y: 19,
    w: 0.3,
    h: 8,
    rotasi: 0,
    elevasiM,
    tinggiM: 0.3,
    tinggiKaitM: 0.8,
    titikAwal: { x: 11, y: 19 },
    titikAkhir: { x: 11, y: 27 },
    bakIds,
  });
  // Kait = 2,8 − 0,8 = 2,0: A butuh 0,3+0,75+0,2 = 1,25 (lolos), B butuh 2,25 (gagal).
  const dok: DenahDokumen = { ...denahKosong(), elemen: [a, b, derek("d1", 2.8, ["A", "B"]), derek("d2", 5, ["A", "B"])] };
  const hasil = periksaTeknik(dok);
  assert.ok(hasil.some((g) => g.kode === "derek-terlalu-rendah"));
  assert.deepEqual([...derekTerlaluRendah(hasil)], [kunciDerekBak("d1", "B")]);
  // pesan hanya tampilan: peringatan lain tanpa kode yang cocok diabaikan.
  assert.equal(derekTerlaluRendah([{ elemenId: "d1", pesan: "kait terlalu rendah", tingkat: "peringatan", elemenTerkaitIds: ["A"] }]).size, 0);
});

test("sudutLayarUtara: proyeksi arah utara ke layar → derajat dari atas, searah jarum jam", () => {
  assert.ok(dekat(sudutLayarUtara({ x: 0, y: 0 }, { x: 0, y: -10 }), 0));
  assert.ok(dekat(sudutLayarUtara({ x: 0, y: 0 }, { x: 10, y: 0 }), 90));
  assert.ok(dekat(sudutLayarUtara({ x: 5, y: 5 }, { x: 0, y: 5 }), 270));
});

test("hitungInstansIceCan: jumlah ice can semua kolom bak (termasuk nonaktif), tipe lain diabaikan", () => {
  const a = buatBak(1, 1, { kolom: buatKolom(3, { varian: "kecil", jumlahIceCan: 10 }) });
  a.kolom[0] = { ...a.kolom[0], nonaktif: true };
  const b = buatBak(20, 1, { kolom: buatKolom(2, { varian: "besar", jumlahIceCan: 5 }) });
  assert.equal(hitungInstansIceCan([a, b]), 40);
  assert.equal(hitungInstansIceCan([a, b]), iceCanBak(a).kecil.length + iceCanBak(b).besar.length);
  assert.equal(BATAS_INSTANS_ICE_CAN, 200_000);
});

test("iceCanBak: kolom tegak menukar ukuran tapak dibanding mendatar", () => {
  // Varian besar (190 × 380 mm): ice can kecil bawaan persegi sehingga penukaran tapak tak terlihat.
  const dasar = () => bak({ kolom: buatKolom(3, { varian: "besar", jumlahIceCan: 4 }) });
  const m = iceCanBak(dasar()).besar[0];
  const b = dasar();
  b.kolom[0] = { ...b.kolom[0], orientasiCan: "tegak" };
  const t = iceCanBak(b).besar[0];
  assert.ok(dekat(m.ukuran[0], t.ukuran[2]) && dekat(m.ukuran[2], t.ukuran[0]));
  assert.ok(!dekat(m.ukuran[0], t.ukuran[0]));
});
