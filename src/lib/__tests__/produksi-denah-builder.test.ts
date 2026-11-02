import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BATAS_RIWAYAT,
  bakBertumpuk,
  bisaRedo,
  bisaUndo,
  buatElemen,
  buatJalur,
  tempelUjungJalur,
  builderReducer,
  kotor,
  namaBerikut,
  namaUnik,
  kapasitasSiklusKg,
  normalisasiUtara,
  snapTitik,
  stateAwal,
  NAMA_TIPE,
  UKURAN_BAWAAN,
  type AksiBuilder,
  type StateBuilder,
} from "../../components/produksi-denah/builder-state";
import { formatCm, formatMeter, formatUkur, panjangSkalaBatang, ukurGaris } from "../../components/produksi-denah/format";
import { HURUF_ALAT, cocokkanPintasan } from "../../components/produksi-denah/pintasan-keyboard";
import { DAFTAR_LAPISAN, idTerlihat, lapisanTersembunyiDari, serialLapisan, uraiLapisan } from "../../components/produksi-denah/lapisan";
import { WARNA_AIR, WARNA_BETON, WARNA_FLUIDA, WARNA_KABEL, WARNA_MESIN } from "../../components/produksi-denah/warna";
import {
  buatBak,
  denahKosong,
  kotakJalur,
  validasiBentukDenah,
  validasiDenah,
  type BakElemen,
  type DenahDokumen,
  type DerekElemen,
  type JalurElemen,
  type MesinElemen,
  type TangkiElemen,
} from "../produksi-denah";

function jalankan(s: StateBuilder, ...aksi: AksiBuilder[]): StateBuilder {
  return aksi.reduce(builderReducer, s);
}

function mesin(x: number, y: number, nama = "Mesin 1"): MesinElemen {
  return {
    tipe: "mesin", id: crypto.randomUUID(), nama, x, y, w: 4, h: 4, rotasi: 0, elevasiM: 0, tinggiM: 1.8,
    kategori: "refrigerasi", jenis: "Kompresor", catatan: "",
  };
}

function dokDengan(...elemen: DenahDokumen["elemen"]): DenahDokumen {
  return { ...denahKosong(), elemen };
}

test("state builder tidak mengimpor React", () => {
  const isi = readFileSync(join(process.cwd(), "src/components/produksi-denah/builder-state.ts"), "utf8");
  assert.doesNotMatch(isi, /from\s+["']react/);
});

test("tambah: elemen masuk dokumen, terpilih, satu entri riwayat", () => {
  const s0 = stateAwal(denahKosong());
  const bak = buatBak(2, 2, { nama: "Bak 1" });
  const s1 = builderReducer(s0, { type: "tambah", elemen: [bak] });
  assert.equal(s1.dok.elemen.length, 1);
  assert.deepEqual(s1.terpilih, [bak.id]);
  assert.equal(s1.lalu.length, 1);
  assert.ok(kotor(s1));
  assert.ok(!kotor(s0));
});

test("pindah: menggeser x/y; derek ikut menggeser kedua titik absolut; elemen terkunci tidak bergeser", () => {
  const derek: DerekElemen = {
    tipe: "derek", id: "d", nama: "Derek 1", x: 0, y: 5, w: 20, h: 1, rotasi: 0, elevasiM: 3.5, tinggiM: 0.3, tinggiKaitM: 0.8,
    titikAwal: { x: 0, y: 5 }, titikAkhir: { x: 20, y: 5 }, bakIds: [],
  };
  const m = { ...mesin(30, 30), terkunci: true };
  const s = jalankan(stateAwal(dokDengan(derek, m)), { type: "pindah", ids: ["d", m.id], dx: 3, dy: -2 });
  const d = s.dok.elemen[0] as DerekElemen;
  assert.deepEqual([d.x, d.y], [3, 3]);
  assert.deepEqual(d.titikAwal, { x: 3, y: 3 });
  assert.deepEqual(d.titikAkhir, { x: 23, y: 3 });
  assert.equal(s.dok.elemen[1], m, "elemen terkunci tidak berubah");
});

test("hapus: elemen hilang, referensi mesinIds dibersihkan, seleksi dirapikan", () => {
  const m = mesin(40, 40);
  const bak = buatBak(2, 2, { nama: "Bak 1", mesinIds: [m.id] });
  let s = stateAwal(dokDengan(bak, m));
  s = jalankan(s, { type: "pilih", ids: [m.id] }, { type: "hapus", ids: [m.id] });
  assert.equal(s.dok.elemen.length, 1);
  assert.deepEqual((s.dok.elemen[0] as BakElemen).mesinIds, []);
  assert.deepEqual(s.terpilih, []);
  assert.deepEqual(validasiDenah(s.dok), []);
});

test("duplikat: ID elemen & kolom baru, nama bak unik, terpilih = salinan, mesin tetap dirujuk", () => {
  const m = mesin(60, 2);
  const bak = buatBak(2, 2, { nama: "Bak 1", mesinIds: [m.id] });
  const s = jalankan(stateAwal(dokDengan(bak, m)), { type: "duplikat", ids: [bak.id], offset: 30 });
  assert.equal(s.dok.elemen.length, 3);
  const salinan = s.dok.elemen[2] as BakElemen;
  assert.notEqual(salinan.id, bak.id);
  assert.equal(salinan.nama, "Bak 2");
  assert.equal(salinan.x, 32);
  assert.equal(salinan.kolom.length, bak.kolom.length);
  const idLama = new Set(bak.kolom.map((k) => k.id));
  assert.ok(salinan.kolom.every((k) => !idLama.has(k.id)), "kolom salinan ber-ID baru");
  assert.deepEqual(salinan.mesinIds, [m.id]);
  assert.deepEqual(s.terpilih, [salinan.id]);
  assert.deepEqual(validasiDenah({ ...s.dok, kanvas: { ...s.dok.kanvas, lebar: 200 } }), []);
});

test("duplikat bersama mesinnya: mesinIds dipetakan ke salinan mesin", () => {
  const m = mesin(60, 2);
  const bak = buatBak(2, 2, { nama: "Bak 1", mesinIds: [m.id] });
  const s = jalankan(stateAwal(dokDengan(bak, m)), { type: "duplikat", ids: [bak.id, m.id] });
  const [bakBaru, mesinBaru] = s.dok.elemen.slice(2);
  assert.deepEqual((bakBaru as BakElemen).mesinIds, [mesinBaru.id]);
});

test("salin + tempel: setiap tempel bergeser bertingkat dan ber-ID baru; potong menghapus", () => {
  const bak = buatBak(2, 2, { nama: "Bak 1" });
  let s = jalankan(stateAwal(dokDengan(bak)), { type: "salin", ids: [bak.id] }, { type: "tempel" }, { type: "tempel" });
  assert.equal(s.dok.elemen.length, 3);
  assert.deepEqual(s.dok.elemen.map((e) => e.x), [2, 4, 6]);
  assert.equal(new Set(s.dok.elemen.map((e) => e.id)).size, 3);
  assert.deepEqual(s.dok.elemen.map((e) => e.nama), ["Bak 1", "Bak 2", "Bak 3"]);
  s = jalankan(s, { type: "potong", ids: [s.dok.elemen[2].id] });
  assert.equal(s.dok.elemen.length, 2);
  assert.equal(s.papanKlip.length, 1);
});

test("undo/redo mengembalikan dokumen IDENTIK (referensi sama)", () => {
  const s0 = stateAwal(denahKosong());
  const bak = buatBak(2, 2, { nama: "Bak 1" });
  const s1 = builderReducer(s0, { type: "tambah", elemen: [bak] });
  const s2 = builderReducer(s1, { type: "pindah", ids: [bak.id], dx: 5, dy: 0 });
  const s3 = builderReducer(s2, { type: "ubahJumlahKolom", bakId: bak.id, n: 40 });
  const u1 = builderReducer(s3, { type: "undo" });
  assert.equal(u1.dok, s2.dok);
  const u3 = jalankan(u1, { type: "undo" }, { type: "undo" });
  assert.equal(u3.dok, s0.dok);
  assert.ok(!kotor(u3), "kembali ke dokumen tersimpan = tidak kotor");
  assert.ok(!bisaUndo(u3));
  const r = jalankan(u3, { type: "redo" }, { type: "redo" }, { type: "redo" });
  assert.equal(r.dok, s3.dok);
  assert.deepEqual(r.dok, s3.dok);
  assert.ok(!bisaRedo(r));
});

test("aksi baru setelah undo membuang tumpukan redo", () => {
  const bak = buatBak(2, 2, { nama: "Bak 1" });
  let s = jalankan(stateAwal(dokDengan(bak)), { type: "pindah", ids: [bak.id], dx: 1, dy: 0 }, { type: "undo" });
  assert.ok(bisaRedo(s));
  s = builderReducer(s, { type: "pindah", ids: [bak.id], dx: 0, dy: 1 });
  assert.ok(!bisaRedo(s));
});

test("batas riwayat: entri terlama dibuang setelah BATAS_RIWAYAT (≥100)", () => {
  assert.ok(BATAS_RIWAYAT >= 100);
  const bak = buatBak(0, 0, { nama: "Bak 1" });
  let s = stateAwal(dokDengan(bak));
  for (let i = 0; i < BATAS_RIWAYAT + 50; i++) s = builderReducer(s, { type: "pindah", ids: [bak.id], dx: 1, dy: 0 });
  assert.equal(s.lalu.length, BATAS_RIWAYAT);
  for (let i = 0; i < BATAS_RIWAYAT + 10; i++) s = builderReducer(s, { type: "undo" });
  assert.equal(s.dok.elemen[0].x, 50, "hanya BATAS_RIWAYAT langkah yang bisa dibatalkan");
});

test("transaksi drag = SATU entri riwayat; batal mengembalikan dokumen awal", () => {
  const bak = buatBak(0, 0, { nama: "Bak 1" });
  const s0 = stateAwal(dokDengan(bak));
  let s = builderReducer(s0, { type: "mulaiTransaksi" });
  for (let w = 21; w <= 40; w++) s = builderReducer(s, { type: "aturKotak", id: bak.id, kotak: { x: 0, y: 0, w, h: 8 } });
  assert.equal(s.lalu.length, 0, "tidak ada entri selama transaksi");
  assert.ok(!bisaUndo(s), "undo dinonaktifkan selama transaksi");
  s = builderReducer(s, { type: "akhiriTransaksi" });
  assert.equal(s.lalu.length, 1);
  assert.equal(s.dok.elemen[0].w, 40);
  assert.equal(builderReducer(s, { type: "undo" }).dok, s0.dok);

  let b = jalankan(s0, { type: "mulaiTransaksi" }, { type: "aturKotak", id: bak.id, kotak: { x: 0, y: 0, w: 30, h: 8 } }, { type: "batalTransaksi" });
  assert.equal(b.dok, s0.dok);
  assert.equal(b.lalu.length, 0);
  b = jalankan(s0, { type: "mulaiTransaksi" }, { type: "akhiriTransaksi" });
  assert.equal(b.lalu.length, 0, "transaksi tanpa perubahan tidak membuat entri");
});

test("gabung: mengetik nama berturut-turut = satu entri", () => {
  const bak = buatBak(0, 0, { nama: "Bak 1" });
  let s = stateAwal(dokDengan(bak));
  for (const nama of ["B", "Ba", "Bak", "Bak A"]) s = builderReducer(s, { type: "ubahElemen", id: bak.id, patch: { nama }, gabung: `${bak.id}:nama` });
  assert.equal(s.lalu.length, 1);
  assert.equal(s.dok.elemen[0].nama, "Bak A");
  s = builderReducer(s, { type: "pilih", ids: [] });
  s = builderReducer(s, { type: "ubahElemen", id: bak.id, patch: { nama: "Bak B" }, gabung: `${bak.id}:nama` });
  assert.equal(s.lalu.length, 2, "seleksi memutus penggabungan");
});

test("ubahJumlahKolom mempertahankan ID kolom; seleksi kolom yang terbuang dirapikan", () => {
  const bak = buatBak(0, 0, { nama: "Bak 1" });
  const terakhir = bak.kolom[35].id;
  let s = jalankan(stateAwal(dokDengan(bak)), { type: "pilihKolom", bakId: bak.id, kolomId: terakhir });
  s = builderReducer(s, { type: "ubahJumlahKolom", bakId: bak.id, n: 30 });
  const b = s.dok.elemen[0] as BakElemen;
  assert.equal(b.kolom.length, 30);
  assert.deepEqual(b.kolom.map((k) => k.id), bak.kolom.slice(0, 30).map((k) => k.id));
  assert.deepEqual(s.kolomTerpilih, []);
});

test("pilihKolom rentang + ubahKolom banyak kolom sekaligus", () => {
  const bak = buatBak(0, 0, { nama: "Bak 1" });
  const s = jalankan(
    stateAwal(dokDengan(bak)),
    { type: "pilihKolom", bakId: bak.id, kolomId: bak.kolom[2].id },
    { type: "pilihKolom", bakId: bak.id, kolomId: bak.kolom[6].id, rentang: true }
  );
  assert.equal(s.kolomTerpilih.length, 5);
  const s2 = builderReducer(s, { type: "ubahKolom", bakId: bak.id, kolomIds: s.kolomTerpilih, patch: { varian: "besar", jumlahIceCan: 18 } });
  const b = s2.dok.elemen[0] as BakElemen;
  assert.deepEqual(b.kolom.slice(0, 8).map((k) => k.varian), ["kecil", "kecil", "besar", "besar", "besar", "besar", "besar", "kecil"]);
  const s3 = builderReducer(s2, { type: "terapkanBawaan", bakId: bak.id });
  assert.ok((s3.dok.elemen[0] as BakElemen).kolom.every((k) => k.varian === "kecil" && k.jumlahIceCan === 36));
});

test("putar: rotasi 90° bertahap; derek memutar titiknya", () => {
  const bak = buatBak(0, 0, { nama: "Bak 1" });
  let s = jalankan(stateAwal(dokDengan(bak)), { type: "putar", ids: [bak.id] });
  assert.equal(s.dok.elemen[0].rotasi, 90);
  s = jalankan(s, { type: "putar", ids: [bak.id] }, { type: "putar", ids: [bak.id] }, { type: "putar", ids: [bak.id] });
  assert.equal(s.dok.elemen[0].rotasi, 0);
  const derek = buatElemen("derek", { x: 0, y: 10, w: 20, h: 1 }, [], { a: { x: 0, y: 10 }, b: { x: 20, y: 10 } }) as DerekElemen;
  const d = builderReducer(stateAwal(dokDengan(derek)), { type: "putar", ids: [derek.id] }).dok.elemen[0] as DerekElemen;
  assert.deepEqual(d.titikAwal, { x: 10, y: 0 });
  assert.deepEqual(d.titikAkhir, { x: 10, y: 20 });
});

test("urutan lapisan, kunci, ratakan", () => {
  const a = mesin(0, 0, "Mesin 1");
  const b = mesin(10, 3, "Mesin 2");
  let s = jalankan(stateAwal(dokDengan(a, b)), { type: "urutan", ids: [a.id], ke: "depan" });
  assert.deepEqual(s.dok.elemen.map((e) => e.id), [b.id, a.id]);
  s = jalankan(s, { type: "ratakan", ids: [a.id, b.id], sisi: "atas" });
  assert.deepEqual(s.dok.elemen.map((e) => e.y), [0, 0]);
  s = jalankan(s, { type: "kunci", ids: [a.id], terkunci: true }, { type: "pindah", ids: [a.id], dx: 5, dy: 5 });
  assert.equal(s.dok.elemen.find((e) => e.id === a.id)!.x, 0);
});

test("nama otomatis bertambah; namaUnik", () => {
  const el = [buatBak(0, 0, { nama: "Bak 1" }), buatBak(30, 0, { nama: "Bak 4" })];
  assert.equal(namaBerikut(el, "bak"), "Bak 5");
  assert.equal(namaBerikut(el, "mesin"), "Mesin 1");
  assert.equal(namaUnik("BAK A", new Set(["bak a"])), "BAK A 2");
  assert.equal(buatElemen("label", { x: 0, y: 0, w: 8, h: 2 }, []).nama, "Label 1");
});

test("buatElemen dinding diluruskan ke sumbu dominan", () => {
  const d = buatElemen("dinding", { x: 0, y: 0, w: 1, h: 1 }, [], { a: { x: 2, y: 3 }, b: { x: 12, y: 5 } });
  assert.deepEqual([d.x, d.y, d.w, d.h], [2, 3, 10, 0.2]);
  assert.deepEqual([d.elevasiM, d.tinggiM], [0, 4]);
});

test("UKURAN_BAWAAN dalam meter & NAMA_TIPE tipe baru", () => {
  assert.deepEqual(UKURAN_BAWAAN, {
    bak: { w: 16, h: 6.5 },
    mesin: { w: 2, h: 2 },
    derek: { w: 16, h: 0.3 },
    dinding: { w: 10, h: 0.2 },
    pintu: { w: 1.2, h: 0.2 },
    area: { w: 6, h: 4 },
    label: { w: 4, h: 1 },
    beton: { w: 2, h: 2 },
    tangki: { w: 2, h: 2 },
    jalur: { w: 1, h: 1 },
  });
  assert.equal(NAMA_TIPE.beton, "Beton");
  assert.equal(NAMA_TIPE.tangki, "Tangki");
  assert.equal(NAMA_TIPE.jalur, "Jalur");
});

test("buatElemen mengisi elevasi/tinggi bawaan spec §3 tiap tipe", () => {
  const k = { x: 1, y: 1, w: 2, h: 2 };
  const el = (t: Parameters<typeof buatElemen>[0]) => buatElemen(t, k, []);
  const m = el("mesin") as MesinElemen;
  assert.deepEqual([m.elevasiM, m.tinggiM, m.kategori], [0, 1.8, "refrigerasi"]);
  const d = el("derek") as DerekElemen;
  assert.deepEqual([d.elevasiM, d.tinggiM, d.tinggiKaitM], [3.5, 0.3, 0.8]);
  const b = el("bak") as BakElemen;
  assert.deepEqual([b.elevasiM, b.tinggiM, b.tebalDindingM], [-0.7, 1, 0.2]);
  assert.deepEqual([el("dinding").tinggiM, el("pintu").tinggiM, el("area").elevasiM], [4, 2.4, 0]);
  const beton = el("beton");
  assert.deepEqual([beton.elevasiM, beton.tinggiM], [-0.5, 0.5]);
  const t = el("tangki") as TangkiElemen;
  assert.deepEqual([t.jenis, t.bentuk, t.tinggiM, t.levelIsiPersen], ["tandon", "kotak", 1.5, 70]);
  const j = el("jalur") as JalurElemen;
  assert.deepEqual([j.jenis, j.fluida, j.diameterMm, j.titik.length], ["pipa", "air-baku", 50, 2]);
  const s = stateAwal(dokDengan(b, m, d, beton, t, j));
  assert.equal(validasiBentukDenah(JSON.parse(JSON.stringify(s.dok))), null);
});

test("bakBertumpuk memperhitungkan pergeseran sementara", () => {
  const a = buatBak(0, 0, { nama: "Bak 1" });
  const b = buatBak(30, 0, { nama: "Bak 2" });
  assert.equal(bakBertumpuk([a, b]).size, 0);
  assert.deepEqual([...bakBertumpuk([a, b], { ids: new Set([b.id]), dx: -15, dy: 0 })].sort(), [a.id, b.id].sort());
});

test("snapTitik membulatkan ke kelipatan langkah snap; nonaktif = presisi 1 cm", () => {
  assert.deepEqual(snapTitik({ x: 1.13, y: 0.87 }, true, 0.25), { x: 1.25, y: 0.75 });
  assert.deepEqual(snapTitik({ x: 1.13, y: 0.87 }, false, 0.25), { x: 1.13, y: 0.87 });
  assert.deepEqual(snapTitik({ x: 1.134, y: 0.866 }, false, 0.25), { x: 1.13, y: 0.87 });
  // Tanpa sisa floating-point (0.1 * 3 !== 0.3).
  assert.deepEqual(snapTitik({ x: 0.27, y: 2.04 }, true, 0.1), { x: 0.3, y: 2 });
  assert.deepEqual(snapTitik({ x: 3.4, y: -0.6 }, true, 1), { x: 3, y: -1 });
});

test("normalisasiUtara: bilangan bulat 0–359 (bulatkan & bungkus)", () => {
  assert.equal(normalisasiUtara(-15), 345);
  assert.equal(normalisasiUtara(360), 0);
  assert.equal(normalisasiUtara(375), 15);
  assert.equal(normalisasiUtara(12.6), 13);
  assert.equal(normalisasiUtara(359.6), 0);
  assert.equal(normalisasiUtara(-720), 0);
  assert.equal(normalisasiUtara(Number.NaN), 0);
});

test("formatMeter & formatCm memakai format angka Indonesia", () => {
  assert.equal(formatMeter(12.5), "12,50 m");
  assert.equal(formatMeter(0), "0,00 m");
  assert.equal(formatMeter(-0.7), "−0,70 m");
  assert.equal(formatMeter(1234.567), "1.234,57 m");
  assert.equal(formatCm(0.88), "88 cm");
  assert.equal(formatCm(0.885), "88,5 cm");
});

test("panjangSkalaBatang: angka bulat terbesar {1,2,5,10,20,50} m yang ≤ 120 px", () => {
  assert.equal(panjangSkalaBatang(20), 5); // 5 m = 100 px; 10 m = 200 px
  assert.equal(panjangSkalaBatang(120), 1);
  assert.equal(panjangSkalaBatang(2), 50);
  assert.equal(panjangSkalaBatang(6), 20);
  assert.equal(panjangSkalaBatang(200), 1); // tetap 1 m walau > 120 px
});

test("kapasitasSiklusKg: Σ ice can × berat varian, kolom nonaktif tidak dihitung", () => {
  const b = buatBak(0, 0, { nama: "Bak 1" });
  const kolom = b.kolom.slice(0, 3).map((k, i) => ({ ...k, varian: (i === 1 ? "besar" : "kecil") as "kecil" | "besar", jumlahIceCan: 10, nonaktif: i === 2 ? true : undefined }));
  assert.equal(kapasitasSiklusKg({ ...b, kolom }), 10 * 25 + 10 * 50);
});

// ---------- Task 5: beton, tangki, ukur, lapisan, warna ----------

test("buatElemen beton & tangki memakai bawaan spec §3", () => {
  const k = { x: 3, y: 4, w: 2.5, h: 1.5 };
  const beton = buatElemen("beton", k, []);
  assert.deepEqual([beton.tipe, beton.elevasiM, beton.tinggiM, beton.x, beton.y, beton.w, beton.h], ["beton", -0.5, 0.5, 3, 4, 2.5, 1.5]);
  assert.equal(beton.nama, "Beton 1");
  const t = buatElemen("tangki", k, [beton]) as TangkiElemen;
  assert.deepEqual([t.tipe, t.jenis, t.bentuk, t.elevasiM, t.tinggiM, t.levelIsiPersen], ["tangki", "tandon", "kotak", 0, 1.5, 70]);
  assert.equal(t.kapasitasM3, undefined);
  assert.equal(t.nama, "Tangki 1");
});

test("pintasan alat: O beton, T tangki, M ukur, E mesin, K label", () => {
  const tekan = (key: string) => cocokkanPintasan({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false });
  assert.deepEqual(tekan("o"), { jenis: "alat", alat: "beton" });
  assert.deepEqual(tekan("t"), { jenis: "alat", alat: "tangki" });
  assert.deepEqual(tekan("m"), { jenis: "alat", alat: "ukur" });
  assert.deepEqual(tekan("e"), { jenis: "alat", alat: "mesin" });
  assert.deepEqual(tekan("k"), { jenis: "alat", alat: "label" });
  assert.equal(HURUF_ALAT.ukur, "M");
  assert.equal(HURUF_ALAT.beton, "O");
  // Huruf alat unik.
  const huruf = Object.values(HURUF_ALAT);
  assert.equal(new Set(huruf).size, huruf.length);
});

test("tombol panah menggeser sebesar langkah snap (Shift = ×10)", () => {
  const panah = (key: string, shiftKey: boolean, langkah: number) => cocokkanPintasan({ key, ctrlKey: false, metaKey: false, shiftKey, altKey: false }, langkah);
  assert.deepEqual(panah("ArrowLeft", false, 0.1), { jenis: "geser", dx: -0.1, dy: 0 });
  assert.deepEqual(panah("ArrowDown", true, 0.1), { jenis: "geser", dx: 0, dy: 1 });
  assert.deepEqual(panah("ArrowRight", true, 0.25), { jenis: "geser", dx: 2.5, dy: 0 });
  assert.deepEqual(panah("ArrowUp", false, 0.5), { jenis: "geser", dx: 0, dy: -0.5 });
});

test("ukurGaris: jarak meter + sudut 0–360° berlawanan jarum jam dari kanan", () => {
  assert.deepEqual(ukurGaris({ x: 0, y: 0 }, { x: 3, y: 0 }), { jarak: 3, sudut: 0 });
  const u = ukurGaris({ x: 1, y: 1 }, { x: 4, y: -3 }); // ke kanan-atas layar
  assert.equal(u.jarak, 5);
  assert.equal(Math.round(u.sudut * 10) / 10, 53.1);
  assert.equal(ukurGaris({ x: 0, y: 0 }, { x: 0, y: 2 }).sudut, 270); // ke bawah layar
  assert.equal(formatUkur({ x: 0, y: 0 }, { x: 12.345, y: 0 }), "12,35 m · 0°");
  assert.equal(formatUkur({ x: 1, y: 1 }, { x: 4, y: -3 }), "5,00 m · 53,1°");
});

test("lapisan tampil: bawaan semua, simpan daftar tersembunyi, data rusak = semua", () => {
  assert.equal(uraiLapisan(null).size, DAFTAR_LAPISAN.length);
  assert.equal(uraiLapisan("bukan json").size, DAFTAR_LAPISAN.length);
  assert.equal(uraiLapisan('{"a":1}').size, DAFTAR_LAPISAN.length);
  const s = uraiLapisan('["air","listrik","tidak-dikenal"]');
  assert.equal(s.has("air"), false);
  assert.equal(s.has("listrik"), false);
  assert.equal(s.has("arsitektur"), true);
  assert.equal(s.size, DAFTAR_LAPISAN.length - 2);
  assert.deepEqual(uraiLapisan(serialLapisan(s)), s);
  assert.equal(serialLapisan(new Set(DAFTAR_LAPISAN.map((l) => l.id))), "[]");
});

test("warna: setiap fluida, kabel, kategori mesin punya hex; beton & air hex", () => {
  const hex = /^#[0-9a-f]{6}$/i;
  const fluida = ["air-baku", "air-pendingin", "air-thawing", "drain", "brine", "nh3-cair", "nh3-gas", "udara"] as const;
  for (const f of fluida) assert.match(WARNA_FLUIDA[f], hex, f);
  assert.equal(Object.keys(WARNA_FLUIDA).length, fluida.length);
  for (const k of ["daya", "kontrol"] as const) assert.match(WARNA_KABEL[k], hex);
  for (const k of ["refrigerasi", "pompa", "listrik", "lainnya"] as const) assert.match(WARNA_MESIN[k], hex);
  assert.match(WARNA_BETON, hex);
  assert.match(WARNA_AIR, hex);
  assert.equal(new Set(Object.values(WARNA_FLUIDA)).size, fluida.length, "warna fluida harus berbeda");
});

test("idTerlihat & lapisanTersembunyiDari: seleksi hanya elemen di lapisan tampil", () => {
  const b = buatBak(0, 0, { nama: "Bak 1" }); // proses
  const m = mesin(20, 0); // refrigerasi
  const beton = buatElemen("beton", { x: 0, y: 10, w: 2, h: 2 }, []); // arsitektur
  const elemen = [b, m, beton];
  const semua = uraiLapisan(null);
  const ids = [b.id, m.id, beton.id, "tidak-ada"];
  assert.deepEqual(idTerlihat(ids, elemen, semua), [b.id, m.id, beton.id]);
  const tanpaRefri = uraiLapisan('["refrigerasi"]');
  assert.deepEqual(idTerlihat(ids, elemen, tanpaRefri), [b.id, beton.id]);
  // Semua terlihat → referensi array yang sama (memo stabil).
  const ids2 = [b.id, beton.id];
  assert.equal(idTerlihat(ids2, elemen, tanpaRefri), ids2);
  assert.deepEqual(lapisanTersembunyiDari(elemen, tanpaRefri), ["refrigerasi"]);
  assert.deepEqual(lapisanTersembunyiDari([b, beton], tanpaRefri), []);
  assert.deepEqual(lapisanTersembunyiDari([m, m], uraiLapisan('["refrigerasi","proses"]')), ["refrigerasi"]);
});

// ---------- Task 6: alat jalur (pipa & kabel) ----------

function jalurUji(titik: { x: number; y: number; z: number }[], extra: Partial<JalurElemen> = {}): JalurElemen {
  return buatJalur(titik, { jenis: "pipa", fluida: "air-baku", diameterMm: 50 }, [], extra.dariId, extra.keId);
}

const T3 = [
  { x: 0, y: 0, z: -0.1 },
  { x: 4, y: 0, z: -0.1 },
  { x: 4, y: 2, z: 0.5 },
];

test("buatJalur: kotak = kotakJalur, elevasi = z terendah, nama Jalur N, dari/ke opsional", () => {
  const j = jalurUji(T3);
  assert.equal(j.tipe, "jalur");
  assert.equal(j.nama, "Jalur 1");
  assert.deepEqual({ x: j.x, y: j.y, w: j.w, h: j.h }, kotakJalur(T3));
  assert.equal(j.elevasiM, -0.1);
  assert.equal(j.rotasi, 0);
  assert.equal("dariId" in j, false);
  assert.equal("keId" in j, false);
  const k = buatJalur(T3, { jenis: "kabel", sistem: "kontrol", diameterMm: 25 }, [j], "m1", undefined);
  assert.deepEqual([k.nama, k.jenis, k.sistem, k.fluida, k.dariId, "keId" in k], ["Jalur 2", "kabel", "kontrol", undefined, "m1", false]);
  assert.equal(validasiBentukDenah(JSON.parse(JSON.stringify(dokDengan(j, k)))), null);
});

test("pindah jalur: semua titik bergeser, z tetap, kotak = kotakJalur", () => {
  const j = jalurUji(T3);
  const s = jalankan(stateAwal(dokDengan(j)), { type: "pindah", ids: [j.id], dx: 1, dy: 2 });
  const b = s.dok.elemen[0] as JalurElemen;
  assert.deepEqual(b.titik, [
    { x: 1, y: 2, z: -0.1 },
    { x: 5, y: 2, z: -0.1 },
    { x: 5, y: 4, z: 0.5 },
  ]);
  assert.deepEqual({ x: b.x, y: b.y, w: b.w, h: b.h }, kotakJalur(b.titik));
});

test("putar jalur: titik diputar 90° searah jarum jam di pusat kotak, z tetap, rotasi tetap 0", () => {
  const j = jalurUji(T3);
  const s = jalankan(stateAwal(dokDengan(j)), { type: "putar", ids: [j.id] });
  const b = s.dok.elemen[0] as JalurElemen;
  // Pusat kotak (2, 1): (x, y) -> (cx − (y − cy), cy + (x − cx)).
  assert.deepEqual(b.titik, [
    { x: 3, y: -1, z: -0.1 },
    { x: 3, y: 3, z: -0.1 },
    { x: 1, y: 3, z: 0.5 },
  ]);
  assert.equal(b.rotasi, 0);
  assert.deepEqual({ x: b.x, y: b.y, w: b.w, h: b.h }, kotakJalur(b.titik));
  // 4 × putar = kembali ke titik semula.
  const s4 = jalankan(s, { type: "putar", ids: [j.id] }, { type: "putar", ids: [j.id] }, { type: "putar", ids: [j.id] });
  assert.deepEqual((s4.dok.elemen[0] as JalurElemen).titik, T3);
});

test("duplikat jalur: ID baru, titik sama + offset, dari/ke ikut dipetakan bila ujungnya ikut disalin", () => {
  const m = mesin(10, 10);
  const j = jalurUji(T3, { dariId: m.id, keId: "lain" });
  const s = jalankan(stateAwal(dokDengan(m, j)), { type: "duplikat", ids: [j.id] });
  const salinan = s.dok.elemen[2] as JalurElemen;
  assert.notEqual(salinan.id, j.id);
  assert.deepEqual(salinan.titik, T3.map((t) => ({ ...t, x: t.x + 2, y: t.y + 2 })));
  assert.equal(salinan.dariId, m.id); // mesin tidak ikut disalin: referensi tetap
  // Salin mesin + jalur bersama: dariId menunjuk salinan mesin.
  const s2 = jalankan(stateAwal(dokDengan(m, j)), { type: "duplikat", ids: [m.id, j.id] });
  const [mSalin, jSalin] = s2.dok.elemen.slice(2) as [MesinElemen, JalurElemen];
  assert.equal(jSalin.dariId, mSalin.id);
});

test("undo mengembalikan titik jalur", () => {
  const j = jalurUji(T3);
  const s = jalankan(stateAwal(dokDengan(j)), { type: "pindah", ids: [j.id], dx: 1, dy: 2 }, { type: "putar", ids: [j.id] }, { type: "undo" }, { type: "undo" });
  assert.deepEqual((s.dok.elemen[0] as JalurElemen).titik, T3);
});

test("balikJalur: urutan titik dibalik, dariId/keId ditukar (field kosong dibuang)", () => {
  const j = jalurUji(T3, { dariId: "a" });
  const s = jalankan(stateAwal(dokDengan(j)), { type: "balikJalur", id: j.id });
  const b = s.dok.elemen[0] as JalurElemen;
  assert.deepEqual(b.titik, [...T3].reverse());
  assert.equal(b.keId, "a");
  assert.equal("dariId" in b, false);
  assert.equal(s.lalu.length, 1);
  const s2 = jalankan(s, { type: "balikJalur", id: j.id });
  assert.deepEqual((s2.dok.elemen[0] as JalurElemen).titik, T3);
  assert.equal((s2.dok.elemen[0] as JalurElemen).dariId, "a");
  // Bukan jalur / terkunci: tidak berubah.
  const t = stateAwal(dokDengan({ ...j, terkunci: true }));
  assert.equal(jalankan(t, { type: "balikJalur", id: j.id }), t);
});

test("ubahElemen titik jalur menghitung ulang x/y/w/h dengan kotakJalur", () => {
  const j = jalurUji(T3);
  const titik = [...T3, { x: -3, y: 7, z: 0 }];
  const s = jalankan(stateAwal(dokDengan(j)), { type: "ubahElemen", id: j.id, patch: { titik } });
  const b = s.dok.elemen[0] as JalurElemen;
  assert.deepEqual({ x: b.x, y: b.y, w: b.w, h: b.h }, kotakJalur(titik));
  assert.equal(b.elevasiM, -0.1);
});

test("aturKotak tidak berlaku untuk jalur", () => {
  const j = jalurUji(T3);
  const s = stateAwal(dokDengan(j));
  assert.equal(jalankan(s, { type: "aturKotak", id: j.id, kotak: { x: 0, y: 0, w: 10, h: 10 } }), s);
});

test("hapus elemen membersihkan dariId/keId jalur yang menunjuknya", () => {
  const m = mesin(10, 10);
  const j = jalurUji(T3, { dariId: m.id, keId: m.id });
  const s = jalankan(stateAwal(dokDengan(m, j)), { type: "hapus", ids: [m.id] });
  const b = s.dok.elemen[0] as JalurElemen;
  assert.equal("dariId" in b, false);
  assert.equal("keId" in b, false);
  assert.deepEqual(validasiDenah(s.dok).filter((g) => g.elemenId === j.id), []);
});

test("tempelUjungJalur: ujung jalur lain (radius) lalu tepi elemen non-jalur di bawah kursor", () => {
  const m = mesin(10, 10); // kotak 10..14
  const lain = jalurUji([
    { x: 0, y: 0, z: 1.2 },
    { x: 5, y: 0, z: 1.2 },
  ]);
  const elemen = [m, lain];
  // Dekat ujung jalur lain: ikut x/y/z ujung itu.
  assert.deepEqual(tempelUjungJalur({ x: 5.1, y: 0.05 }, elemen, 0.2, null), { x: 5, y: 0, z: 1.2, elemenId: lain.id });
  assert.equal(tempelUjungJalur({ x: 5.5, y: 0 }, elemen, 0.2, null), null);
  // Di dalam mesin: proyeksi ke tepi terdekat.
  assert.deepEqual(tempelUjungJalur({ x: 13.5, y: 12 }, elemen, 0.2, m.id), { x: 14, y: 12, elemenId: m.id });
  assert.deepEqual(tempelUjungJalur({ x: 11, y: 10.4 }, elemen, 0.2, m.id), { x: 11, y: 10, elemenId: m.id });
  // Elemen jalur yang dikecualikan (jalur yang sedang digambar) diabaikan.
  assert.equal(tempelUjungJalur({ x: 5, y: 0 }, elemen, 0.2, null, lain.id), null);
});

test("pintasan J = alat jalur", () => {
  const a = cocokkanPintasan({ key: "j", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false });
  assert.deepEqual(a, { jenis: "alat", alat: "jalur" });
  assert.equal(HURUF_ALAT.jalur, "J");
});
