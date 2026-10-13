import { test } from "node:test";
import assert from "node:assert/strict";
import { buatToken, formatTokenValid, urlTautan, bolehPakaiUlang, hitungKedaluwarsa, PANJANG_TOKEN, MASA_BERLAKU_HARI } from "../tautan-util";

test("buatToken: panjang 10, hanya alfanumerik tanpa karakter ambigu (I, O, l)", () => {
  for (let i = 0; i < 200; i++) {
    const t = buatToken();
    assert.equal(t.length, PANJANG_TOKEN);
    assert.match(t, /^[0-9A-HJ-NP-Za-km-z]{10}$/);
  }
});
test("buatToken: tidak berulang (1000 token unik)", () => {
  assert.equal(new Set(Array.from({ length: 1000 }, buatToken)).size, 1000);
});
test("formatTokenValid: hanya 10 karakter alfanumerik", () => {
  assert.equal(formatTokenValid("aB3dE5gH7j"), true);
  assert.equal(formatTokenValid("pendek"), false);
  assert.equal(formatTokenValid("aB3dE5gH7j1"), false);
  assert.equal(formatTokenValid("aB3dE5gH7!"), false);
  assert.equal(formatTokenValid("../../etc/"), false);
  assert.equal(formatTokenValid(undefined), false);
  assert.equal(formatTokenValid(1234567890), false);
});
test("urlTautan: tanpa garis miring ganda", () => {
  assert.equal(urlTautan("https://dash.pabrikespmp.com/", "aB3dE5gH7j"), "https://dash.pabrikespmp.com/kartu/aB3dE5gH7j");
  assert.equal(urlTautan("https://dash.pabrikespmp.com", "aB3dE5gH7j"), "https://dash.pabrikespmp.com/kartu/aB3dE5gH7j");
});
test("hitungKedaluwarsa: 30 hari ke depan", () => {
  const s = new Date("2026-10-13T00:00:00Z");
  assert.equal((hitungKedaluwarsa(s).getTime() - s.getTime()) / 86400000, MASA_BERLAKU_HARI);
});
test("bolehPakaiUlang: ya bila sisa >= 7 hari; tidak bila hampir habis atau dicabut", () => {
  const s = new Date("2026-10-13T00:00:00Z");
  assert.equal(bolehPakaiUlang(new Date("2026-11-01T00:00:00Z"), false, s), true);
  assert.equal(bolehPakaiUlang(new Date("2026-10-18T00:00:00Z"), false, s), false);
  assert.equal(bolehPakaiUlang(new Date("2026-10-10T00:00:00Z"), false, s), false);
  assert.equal(bolehPakaiUlang(new Date("2026-11-20T00:00:00Z"), true, s), false);
});
