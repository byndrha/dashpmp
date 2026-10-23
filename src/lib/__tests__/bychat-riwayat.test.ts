import { test } from "node:test";
import assert from "node:assert/strict";
import { fakturLunasEsBalok, rentangRiwayat, sejakWib, susunRiwayat, urutTerbaru } from "../bychat/riwayat-util";

test("rentang tak dikenal jatuh ke 90 hari", () => {
  assert.equal(rentangRiwayat(30), 30);
  assert.equal(rentangRiwayat("365"), 365);
  assert.equal(rentangRiwayat(7), 90);
  assert.equal(rentangRiwayat(undefined), 90);
});

test("urut terbaru ke terlama", () => {
  const r = urutTerbaru([
    { tanggal: "2026-10-01", noDokumen: "A" },
    { tanggal: "2026-10-20", noDokumen: "B" },
    { tanggal: "2026-10-20", noDokumen: "C" },
  ]);
  assert.deepEqual(r.map((x) => x.noDokumen), ["C", "B", "A"]);
});

test("faktur lunas Es Balok: bukan outstanding, bernilai > 0, dalam rentang", () => {
  const r = fakturLunasEsBalok(
    [
      { noDokumen: "1", tanggal: "2026-10-10", nilai: 100 },
      { noDokumen: "2", tanggal: "2026-10-12", nilai: 100 }, // outstanding
      { noDokumen: "3", tanggal: "2026-10-14", nilai: 0 }, // retur penuh
      { noDokumen: "4", tanggal: "2026-01-01", nilai: 100 }, // di luar rentang
    ],
    new Set(["2"]),
    "2026-07-25"
  );
  assert.deepEqual(r.map((x) => x.noDokumen), ["1"]);
});

test("susunRiwayat menjumlah total", () => {
  const r = susunRiwayat(
    30,
    [
      { noDokumen: "P1", tanggal: "2026-10-01", jumlah: 50, untuk: [], catatan: null },
      { noDokumen: "P2", tanggal: "2026-10-02", jumlah: 70, untuk: [], catatan: null },
    ],
    []
  );
  assert.equal(r.totalPembayaran, 120);
  assert.equal(r.pembayaran[0].noDokumen, "P2");
  assert.equal(sejakWib(0, new Date("2026-10-23T00:00:00Z")), "2026-10-23");
});
