import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bangunPetaAliasKompetitor,
  petaAliasKompetitorDisetujui,
  resolveAliasKompetitor,
} from "../kompetitor-alias";
import { pecahTeksKompetitor } from "../mitra-lokasi";

const peta = petaAliasKompetitorDisetujui();

test("alias → nama resmi: \"Es atlas\" → \"Atlas\"", () => {
  assert.deepEqual(resolveAliasKompetitor(peta, "Es atlas"), { jenis: "kanonik", nama: "Atlas" });
});
test("abaikan: \"Belum ada kompetitor\" (dan aliasnya) dibuang", () => {
  assert.deepEqual(resolveAliasKompetitor(peta, "Belum ada kompetitor"), { jenis: "abaikan" });
  assert.deepEqual(resolveAliasKompetitor(peta, "Tidak ada kompetitor"), { jenis: "abaikan" });
});
test("tidak dikenal: \"khasanah\" (beda dengan \"kasanah\") → ditambahkan apa adanya", () => {
  assert.deepEqual(resolveAliasKompetitor(peta, "khasanah"), { jenis: "tidak-dikenal" });
  assert.deepEqual(resolveAliasKompetitor(peta, "kasanah"), { jenis: "kanonik", nama: "kasanah" });
});
test("tanpa beda huruf besar-kecil & spasi berlebih", () => {
  assert.deepEqual(resolveAliasKompetitor(peta, "  ES   ATLAS "), { jenis: "kanonik", nama: "Atlas" });
  assert.deepEqual(resolveAliasKompetitor(peta, "belum ADA kompetitor"), { jenis: "abaikan" });
  assert.deepEqual(resolveAliasKompetitor(peta, "atlas"), { jenis: "kanonik", nama: "Atlas" });
});
test("teks pengajuan lama utuh: pecah lalu resolve", () => {
  const hasil = pecahTeksKompetitor("Es atlas, Belum ada kompetitor; khasanah").map((p) => resolveAliasKompetitor(peta, p));
  assert.deepEqual(hasil, [{ jenis: "kanonik", nama: "Atlas" }, { jenis: "abaikan" }, { jenis: "tidak-dikenal" }]);
});
test("bangunPetaAliasKompetitor: ejaan ganda di dua entri & entri tanpa nama → galat", () => {
  const { galat } = bangunPetaAliasKompetitor([
    { nama: "A", alias: ["x"] },
    { nama: "B", alias: ["X "] },
    { nama: "" },
  ]);
  assert.equal(galat.length, 2);
  assert.match(galat[0], /dua entri/);
});
