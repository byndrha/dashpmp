import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apakahKunciFisikEsBalok,
  contentDispositionInline,
  MAKS_UKURAN_BERKAS,
  rapikanNamaBerkas,
  validasiBerkas,
  validasiKunciBerkas,
  type KonteksAkses,
} from "../mitra-berkas";

const PMP: KonteksAkses = { eskristalKode: "mkesindo", pmpScope: true, pmpDeployment: true };
const DEMO: KonteksAkses = { eskristalKode: "demokristal", pmpScope: false, pmpDeployment: true };

test("validasiBerkas menerima JPG/PNG/WEBP/PDF sampai 5 MB", () => {
  assert.deepEqual(validasiBerkas({ type: "image/jpeg", size: 1000 }), { ok: true, ext: "jpg" });
  assert.deepEqual(validasiBerkas({ type: "image/png", size: MAKS_UKURAN_BERKAS }), { ok: true, ext: "png" });
  assert.deepEqual(validasiBerkas({ type: "image/webp", size: 10 }), { ok: true, ext: "webp" });
  assert.deepEqual(validasiBerkas({ type: "application/pdf", size: 10 }), { ok: true, ext: "pdf" });
});

test("validasiBerkas menolak .txt, berkas 6 MB, dan berkas kosong dengan pesan Indonesia", () => {
  assert.deepEqual(validasiBerkas({ type: "text/plain", size: 10 }), { ok: false, error: "Format berkas harus JPG, PNG, WEBP, atau PDF" });
  assert.deepEqual(validasiBerkas({ type: "image/jpeg", size: 6 * 1024 * 1024 }), { ok: false, error: "Ukuran berkas maksimal 5 MB" });
  assert.deepEqual(validasiBerkas({ type: "image/jpeg", size: 0 }), { ok: false, error: "Berkas kosong" });
  assert.equal(validasiBerkas({ type: "image/svg+xml", size: 10 }).ok, false);
});

test("pasangan fisik Es Balok: pmpakis+logistik bukan kunci fisik", () => {
  for (const k of ["pmputra", "pmpersada", "pmpakis"]) assert.equal(apakahKunciFisikEsBalok(k, "utama"), true);
  assert.equal(apakahKunciFisikEsBalok("pmputra", "logistik"), true);
  assert.equal(apakahKunciFisikEsBalok("pmpersada", "logistik"), true);
  assert.equal(apakahKunciFisikEsBalok("pmpakis", "logistik"), false);
  assert.equal(apakahKunciFisikEsBalok("mkesindo", "utama"), false);
});

test("Es Kristal: kode harus sama dengan currentEskristalKode dan sumber utama", () => {
  const ok = validasiKunciBerkas({ kode: "mkesindo", sumber: "utama", partnerId: "BP0001", jenis: "nik" }, PMP);
  assert.deepEqual(ok, { ok: true, kunci: { perusahaanKode: "mkesindo", sumber: "utama", partnerId: "BP0001" }, jenis: "nik" });
  assert.deepEqual(validasiKunciBerkas({ kode: "mkesindo", sumber: "logistik", partnerId: "BP0001", jenis: "nik" }, PMP), {
    ok: false, status: 400, error: "Sumber mitra Es Kristal harus 'utama'",
  });
  // Akun tenant demo tidak boleh menyentuh mkesindo.
  assert.equal(validasiKunciBerkas({ kode: "mkesindo", sumber: "utama", partnerId: "BP0001", jenis: "sk" }, DEMO).ok, false);
  assert.equal(validasiKunciBerkas({ kode: "demokristal", sumber: "utama", partnerId: "BP0001", jenis: "sk" }, DEMO).ok, true);
});

test("Es Balok: butuh scope PMP dan deployment PMP, kode fisik saja", () => {
  assert.equal(validasiKunciBerkas({ kode: "pmpersada", sumber: "logistik", partnerId: "AG01", jenis: "sk" }, PMP).ok, true);
  const tanpaScope = validasiKunciBerkas({ kode: "pmputra", sumber: "utama", partnerId: "AG01", jenis: "sk" }, DEMO);
  assert.deepEqual(tanpaScope, { ok: false, status: 403, error: "Anda tidak berhak mengakses mitra perusahaan ini" });
  const bukanDeployPmp = validasiKunciBerkas({ kode: "pmputra", sumber: "utama", partnerId: "AG01", jenis: "sk" }, { ...PMP, pmpDeployment: false });
  assert.equal(bukanDeployPmp.ok, false);
  const bukanFisik = validasiKunciBerkas({ kode: "pmpakis", sumber: "logistik", partnerId: "AG01", jenis: "sk" }, PMP);
  assert.equal(bukanFisik.ok, false);
  assert.equal(validasiKunciBerkas({ kode: "lainnya", sumber: "utama", partnerId: "AG01", jenis: "sk" }, PMP).ok, false);
});

test("partnerId & jenis divalidasi ketat (aman untuk path folder Drive)", () => {
  const dasar = { kode: "mkesindo", sumber: "utama", jenis: "nik" };
  for (const partnerId of ["", "../x", "a/b", "A".repeat(17), null, 5, "BP 01", "BP'01"]) {
    const h = validasiKunciBerkas({ ...dasar, partnerId }, PMP);
    assert.deepEqual(h, { ok: false, status: 400, error: "ID mitra tidak valid" }, String(partnerId));
  }
  assert.equal(validasiKunciBerkas({ ...dasar, partnerId: "A".repeat(16) }, PMP).ok, true);
  assert.deepEqual(validasiKunciBerkas({ ...dasar, partnerId: "BP01", jenis: "ktp" }, PMP), {
    ok: false, status: 400, error: "Jenis berkas harus 'nik' atau 'sk'",
  });
  assert.equal(validasiKunciBerkas({ ...dasar, partnerId: "BP01", sumber: null }, PMP).ok, false);
});

test("rapikanNamaBerkas membuang path & karakter kontrol", () => {
  assert.equal(rapikanNamaBerkas("C:\\fakepath\\ktp budi.jpg", "nik.jpg"), "ktp budi.jpg");
  assert.equal(rapikanNamaBerkas("../../a\"b.pdf", "sk.pdf"), "ab.pdf");
  assert.equal(rapikanNamaBerkas("", "sk.pdf"), "sk.pdf");
  assert.equal(rapikanNamaBerkas("x".repeat(300), "sk.pdf").length, 120);
});

test("contentDispositionInline selalu inline dan aman untuk nama non-ASCII", () => {
  assert.equal(contentDispositionInline("sk.pdf"), `inline; filename="sk.pdf"; filename*=UTF-8''sk.pdf`);
  const h = contentDispositionInline("SK Budi é.pdf");
  assert.ok(h.startsWith(`inline; filename="SK Budi _.pdf"`));
  assert.ok(h.includes("filename*=UTF-8''SK%20Budi%20%C3%A9.pdf"));
});
