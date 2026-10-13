import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPhones, normalizePhone, phoneMatches, last9 } from "../phone";

test("normalizePhone: 08.. → 62..", () => {
  assert.equal(normalizePhone("081234567890"), "6281234567890");
});
test("normalizePhone: +62 dan 62 sama", () => {
  assert.equal(normalizePhone("+6281234567890"), "6281234567890");
  assert.equal(normalizePhone("6281234567890"), "6281234567890");
});
test("normalizePhone: pemisah spasi, strip, titik, kurung diabaikan", () => {
  assert.equal(normalizePhone("0812-3456-7890"), "6281234567890");
  assert.equal(normalizePhone("(0812) 3456 7890"), "6281234567890");
  assert.equal(normalizePhone("+62 812.3456.7890"), "6281234567890");
});
test("normalizePhone: tanpa 0 di depan (8xxxxxxxxx)", () => {
  assert.equal(normalizePhone("81234567890"), "6281234567890");
});
test("normalizePhone: 0062 prefix internasional", () => {
  assert.equal(normalizePhone("0062812345678"), "62812345678");
});
test("normalizePhone: kosong/terlalu pendek/aneh → null", () => {
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone(undefined), null);
  assert.equal(normalizePhone("-"), null);
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone("0000000000"), null);
});
test("normalizePhone: nomor non-Indonesia ditolak (hanya 62)", () => {
  assert.equal(normalizePhone("+14155552671"), null);
});
test("extractPhones: dua nomor dipisah / , ; atau baris baru", () => {
  assert.deepEqual(extractPhones("081234567890 / 082345678901"), ["6281234567890", "6282345678901"]);
  assert.deepEqual(extractPhones("081234567890, 082345678901"), ["6281234567890", "6282345678901"]);
  assert.deepEqual(extractPhones("081234567890;082345678901"), ["6281234567890", "6282345678901"]);
  assert.deepEqual(extractPhones("081234567890\n082345678901"), ["6281234567890", "6282345678901"]);
});
test("extractPhones: nomor sama dua kali hanya muncul sekali", () => {
  assert.deepEqual(extractPhones("081234567890 / +6281234567890"), ["6281234567890"]);
});
test("extractPhones: kolom kosong → []", () => {
  assert.deepEqual(extractPhones(null), []);
  assert.deepEqual(extractPhones("  "), []);
});
test("extractPhones: teks campur nama ('Pak Budi 0812...') tetap terbaca", () => {
  assert.deepEqual(extractPhones("Pak Budi 081234567890"), ["6281234567890"]);
});
test("phoneMatches: cocok persis setelah normalisasi", () => {
  assert.equal(phoneMatches("0812-3456-7890", "+6281234567890"), true);
  assert.equal(phoneMatches("081234567890 / 082345678901", "6282345678901"), true);
  assert.equal(phoneMatches("081234567890", "6281234567891"), false);
  assert.equal(phoneMatches(null, "6281234567890"), false);
});
test("phoneMatches: nomor LID/kosong tidak pernah cocok", () => {
  assert.equal(phoneMatches("081234567890", ""), false);
  assert.equal(phoneMatches("081234567890", null), false);
});
test("last9: 9 digit terakhir untuk prefilter SQL", () => {
  assert.equal(last9("6281234567890"), "234567890");
  assert.equal(last9("123"), null);
});
