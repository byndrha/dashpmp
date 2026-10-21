import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTOH_TEMPLAT, MAKS_PANJANG_TEMPLAT, renderTemplat, TEMPLAT_AWAL, validasiTemplat } from "../templat";
import { validasiPengaturan } from "../logika";

test("renderTemplat: semua variabel terisi", () => {
  const t = renderTemplat(TEMPLAT_AWAL, CONTOH_TEMPLAT);
  assert.match(t, /^Yth\. Toko Maju Jaya,/);
  assert.match(t, /Rp 1\.250\.000 \(3 faktur\)/);
  assert.match(t, /BCA 1234567890 a\.n\. PT Contoh/);
  assert.match(t, /tanpa login\): https:\/\/dash\.example\.com\/kartu\/aB3dE5gH7j/);
  assert.match(t, /Terima kasih\.$/);
});

test("renderTemplat: baris dengan variabel kosong dibuang dan baris kosong dirapikan", () => {
  const t = renderTemplat(TEMPLAT_AWAL, { ...CONTOH_TEMPLAT, rekening: "", tautan: "" });
  assert.doesNotMatch(t, /transfer/i);
  assert.doesNotMatch(t, /tanpa login/);
  assert.doesNotMatch(t, /\n{3,}/);
  assert.match(t, /faktur\)\.\n\nMohon dicek/);
});

test("renderTemplat: nilai tidak diproses ulang dan simbol $ aman", () => {
  const t = renderTemplat("{mitra} {total}", { ...CONTOH_TEMPLAT, mitra: "{pt} $& Toko", total: "Rp 1" });
  assert.equal(t, "{pt} $& Toko Rp 1");
});

test("validasiTemplat: menolak kosong, variabel asing, dan terlalu panjang", () => {
  assert.equal(validasiTemplat(TEMPLAT_AWAL), null);
  assert.ok(validasiTemplat("   "));
  assert.match(validasiTemplat("Halo {nama}") ?? "", /\{nama\}/);
  assert.ok(validasiTemplat("x".repeat(MAKS_PANJANG_TEMPLAT + 1)));
});

test("validasiPengaturan: templat tidak valid ditolak, bawaan lolos", () => {
  assert.equal(validasiPengaturan({}).ok, true);
  assert.equal(validasiPengaturan({ templatPesan: "Halo {salah}" }).ok, false);
});
