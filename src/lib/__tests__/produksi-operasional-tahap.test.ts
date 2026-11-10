import test from "node:test";
import assert from "node:assert/strict";
import { BATAS_BAWAH_TAHAP, hitungKematangan, mulaiUntukTahap, tahapDari, type Tahap } from "../produksi-operasional";

const TAHAP: Tahap[] = ["air", "mulai", "kristal", "siap", "jadi"];
const SEKARANG = new Date("2026-11-10T03:00:00Z");

test("mulaiUntukTahap: tiap tahap jatuh tepat di batas bawahnya untuk berbagai durasi", () => {
  for (const durasi of [18, 24, 32, 36.5, 48]) {
    for (const t of TAHAP) {
      const mulai = mulaiUntukTahap(t, durasi, SEKARANG);
      const pct = hitungKematangan(mulai, durasi, SEKARANG);
      assert.equal(pct, BATAS_BAWAH_TAHAP[t], `${t} @ ${durasi} jam`);
      assert.equal(tahapDari(pct), t, `tahap ${t} @ ${durasi} jam`);
    }
  }
});

test("mulaiUntukTahap: tetap di tahap yang sama beberapa menit kemudian, kecuali tahap jadi yang memang puncak", () => {
  const durasi = 24;
  for (const t of TAHAP) {
    const nanti = new Date(SEKARANG.getTime() + 5 * 60_000);
    const pct = hitungKematangan(mulaiUntukTahap(t, durasi, SEKARANG), durasi, nanti);
    assert.equal(tahapDari(pct), t, t);
  }
});

test("mulaiUntukTahap: tidak pernah di masa depan", () => {
  for (const t of TAHAP) assert.ok(mulaiUntukTahap(t, 24, SEKARANG).getTime() <= SEKARANG.getTime());
});
