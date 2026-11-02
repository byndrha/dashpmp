import { test } from "node:test";
import assert from "node:assert/strict";
import { buatBak, buatKolom, denahKosong } from "../produksi-denah";
import { batasElemen } from "../../components/produksi-denah/3d/koordinat";
import { gabungKotak, hasilUkur3D, kotakAdegan, posisiPreset, rentangPotongan, zoomOrtografis } from "../../components/produksi-denah/3d/kamera";

const dekat = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const KOTAK_60x40 = { x: 0, y: 0, w: 60, h: 40, zBawah: 0, zAtas: 0 };

test("posisiPreset atas: target di pusat kotak 60×40, posisi tepat di atas target", () => {
  const { posisi, target } = posisiPreset("atas", KOTAK_60x40);
  assert.deepEqual(target, [30, 0, 20]);
  assert.ok(dekat(posisi[0], 30) && dekat(posisi[2], 20), `posisi ${posisi}`);
  assert.ok(posisi[1] > target[1]);
});

test("posisiPreset iso: posisi di +x, +y, +z relatif target", () => {
  const { posisi, target } = posisiPreset("iso", KOTAK_60x40);
  assert.deepEqual(target, [30, 0, 20]);
  assert.ok(posisi[0] > target[0] && posisi[1] > target[1] && posisi[2] > target[2], `posisi ${posisi}`);
});

test("posisiPreset depan: dari selatan (+z three), sejajar x target, sedikit di atas", () => {
  const { posisi, target } = posisiPreset("depan", KOTAK_60x40);
  assert.ok(dekat(posisi[0], target[0]));
  assert.ok(posisi[2] > target[2] && posisi[1] >= target[1]);
});

test("posisiPreset: target = pusat 3D (elevasi tengah) dan seluruh kotak masuk pandangan", () => {
  const kotak = { x: 10, y: 4, w: 2, h: 6, zBawah: -1, zAtas: 3 };
  const fov = 45;
  for (const preset of ["iso", "atas", "depan", "fokus"] as const) {
    const { posisi, target } = posisiPreset(preset, kotak, { fovDerajat: fov, aspek: 0.5 });
    assert.deepEqual(target, [11, 1, 7], preset);
    const jarak = Math.hypot(posisi[0] - target[0], posisi[1] - target[1], posisi[2] - target[2]);
    const r = Math.hypot(2, 6, 4) / 2;
    // fov horizontal (aspek 0,5) lebih sempit → itu yang menentukan.
    const fovH = 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * 0.5);
    assert.ok(jarak >= r / Math.sin(fovH / 2) - 1e-9, `${preset}: jarak ${jarak}`);
  }
});

test("posisiPreset fokus: elemen kecil tidak membuat kamera menempel", () => {
  const { posisi, target } = posisiPreset("fokus", { x: 1, y: 1, w: 0.05, h: 0.05, zBawah: 0, zAtas: 0.05 });
  assert.ok(Math.hypot(posisi[0] - target[0], posisi[1] - target[1], posisi[2] - target[2]) >= 2);
  assert.ok(posisi[0] > target[0] && posisi[1] > target[1] && posisi[2] > target[2]);
});

test("gabungKotak: membungkus semua batas; kosong → null", () => {
  assert.equal(gabungKotak([]), null);
  const g = gabungKotak([
    { kotak: { x: 1, y: 2, w: 3, h: 4 }, zBawah: -1, zAtas: 2 },
    { kotak: { x: -2, y: 5, w: 1, h: 3 }, zBawah: 0, zAtas: 5 },
  ]);
  assert.deepEqual(g, { x: -2, y: 2, w: 6, h: 6, zBawah: -1, zAtas: 5 });
});

test("kotakAdegan: lahan + pelat + semua elemen (termasuk yang menjorok keluar / tertanam)", () => {
  const d = denahKosong();
  assert.deepEqual(kotakAdegan(d), { x: 0, y: 0, w: 60, h: 40, zBawah: -0.2, zAtas: 0 });
  const b = buatBak(55, 30, { w: 10, h: 4, elevasiM: -1.5, kolom: buatKolom(2, { varian: "kecil", jumlahIceCan: 2 }) });
  d.elemen.push(b);
  const bb = batasElemen(b);
  const k = kotakAdegan(d);
  assert.ok(dekat(k.w, bb.kotak.x + bb.kotak.w) && dekat(k.zBawah, Math.min(-0.2, bb.zBawah)) && dekat(k.zAtas, Math.max(0, bb.zAtas)));
});

test("zoomOrtografis: piksel per meter agar kotak muat (dengan margin)", () => {
  const z = zoomOrtografis(KOTAK_60x40, 1200, 400);
  assert.ok(z * 40 <= 400 && z * 60 <= 1200);
  assert.ok(z * 40 >= 400 * 0.8);
  assert.ok(zoomOrtografis({ ...KOTAK_60x40, w: 0, h: 0 }, 0, 0) > 0);
});

test("rentangPotongan: horizontal = rentang elevasi, vertikal = rentang x / y denah", () => {
  const k = { x: -1, y: 2, w: 10, h: 5, zBawah: -2, zAtas: 4 };
  assert.deepEqual(rentangPotongan("horizontal", k), { min: -2, maks: 4 });
  assert.deepEqual(rentangPotongan("x", k), { min: -1, maks: 9 });
  assert.deepEqual(rentangPotongan("y", k), { min: 2, maks: 7 });
});

test("hasilUkur3D: jarak 3D, Δ horizontal (bidang lantai), Δ tinggi (sumbu y three)", () => {
  const h = hasilUkur3D([0, 0, 0], [3, 2, 4]);
  assert.ok(dekat(h.jarak, Math.hypot(3, 2, 4)));
  assert.ok(dekat(h.horizontal, 5));
  assert.ok(dekat(h.tinggi, 2));
  assert.ok(dekat(hasilUkur3D([1, 5, 1], [1, 2, 1]).tinggi, 3), "Δ tinggi selalu positif");
});
