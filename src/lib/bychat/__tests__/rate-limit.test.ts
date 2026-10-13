import { test } from "node:test";
import assert from "node:assert/strict";
import { buatPembatas, ipDari } from "../rate-limit";

test("pembatas: izinkan sampai batas lalu tolak", () => {
  const p = buatPembatas(3, 1000);
  assert.deepEqual([1, 2, 3, 4].map(() => p.coba("a", 100)), [true, true, true, false]);
});
test("pembatas: kunci berbeda tidak saling memengaruhi", () => {
  const p = buatPembatas(1, 1000);
  assert.equal(p.coba("a", 0), true);
  assert.equal(p.coba("b", 0), true);
  assert.equal(p.coba("a", 1), false);
});
test("pembatas: pulih setelah jendela lewat", () => {
  const p = buatPembatas(1, 1000);
  assert.equal(p.coba("a", 0), true);
  assert.equal(p.coba("a", 500), false);
  assert.equal(p.coba("a", 1001), true);
});
test("ipDari: ambil alamat pertama X-Forwarded-For", () => {
  const h = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
  assert.equal(ipDari(h), "1.2.3.4");
  assert.equal(ipDari(new Headers()), "tak-dikenal");
});
