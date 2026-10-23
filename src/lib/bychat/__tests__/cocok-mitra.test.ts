import { test } from "node:test";
import assert from "node:assert/strict";
import { cocokkanNomorKeMitra } from "../cocok-mitra";

const kandidat = [
  { id: "BP-A", kontak: ["0811-1111-1111", null] },
  // Kontak utama lain; nomor percakapan hanya ada di kontak lokasi tambahan.
  { id: "BP-B", kontak: ["0822 2222 2222", "", "Gudang: 0812-3456-7890 / 0813 0000 0000"] },
  { id: "BP-C", kontak: [null] },
];

test("cocokkanNomorKeMitra: cocok lewat kontak lokasi tambahan (kolom multi-nomor)", () => {
  assert.deepEqual(cocokkanNomorKeMitra("+62 812 3456 7890", kandidat), ["BP-B"]);
});
test("cocokkanNomorKeMitra: cocok lewat kontak utama", () => {
  assert.deepEqual(cocokkanNomorKeMitra("6281111111111", kandidat), ["BP-A"]);
});
test("cocokkanNomorKeMitra: hanya 8 digit terakhir sama (digit ke-9 beda) → tidak cocok", () => {
  // 6281234567890 vs 6281934567890: 8 digit terakhir "34567890" sama, last9 berbeda.
  assert.deepEqual(cocokkanNomorKeMitra("081934567890", kandidat), []);
});
test("cocokkanNomorKeMitra: nomor tidak valid → []; beberapa mitra cocok → semua, tanpa duplikat", () => {
  assert.deepEqual(cocokkanNomorKeMitra("12345", kandidat), []);
  const ganda = [
    { id: "X", kontak: ["081234567890", "0812-3456-7890"] },
    { id: "Y", kontak: ["+6281234567890"] },
  ];
  assert.deepEqual(cocokkanNomorKeMitra("081234567890", ganda), ["X", "Y"]);
});
