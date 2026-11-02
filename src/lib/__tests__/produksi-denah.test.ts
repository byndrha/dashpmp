import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buatBak,
  buatKolom,
  denahKosong,
  kolomTerkunciBerubah,
  nomoriUlangKolom,
  ringkasDenah,
  ubahJumlahKolom,
  validasiDenah,
  validasiBentukDenah,
  migrasiDenah,
  lapisanElemen,
  kotakJalur,
  PRESET_ICE_CAN,
  ICE_CAN_DIMENSI_BAWAAN,
  BATAS_ELEMEN,
  BATAS_KOLOM_PER_BAK,
  BATAS_ICE_CAN_PER_KOLOM,
  BATAS_UKURAN_GRID,
  type BakElemen,
  type DenahDokumen,
  type DerekElemen,
  type JalurElemen,
  type MesinElemen,
  type TangkiElemen,
  type BetonElemen,
} from "../produksi-denah";
import { bolehEditDenah } from "../permissions";

function mesin(x: number, y: number, nama = "Kompresor 1"): MesinElemen {
  return {
    tipe: "mesin", id: crypto.randomUUID(), nama, x, y, w: 4, h: 4, rotasi: 0, elevasiM: 0, tinggiM: 1.8,
    kategori: "refrigerasi", jenis: "Kompresor Amonia", catatan: "",
  };
}

function dok(...elemen: DenahDokumen["elemen"]): DenahDokumen {
  return { ...denahKosong(), elemen };
}

// ---------- buatKolom ----------

test("buatKolom: nomor berurutan dari 1 dan ID unik", () => {
  const k = buatKolom(5, { varian: "kecil", jumlahIceCan: 36 });
  assert.deepEqual(k.map((x) => x.nomor), [1, 2, 3, 4, 5]);
  assert.equal(new Set(k.map((x) => x.id)).size, 5);
  assert.ok(k.every((x) => x.varian === "kecil" && x.jumlahIceCan === 36));
});

test("buatKolom: mulaiNomor dihormati", () => {
  const k = buatKolom(3, { varian: "besar", jumlahIceCan: 18 }, 31);
  assert.deepEqual(k.map((x) => x.nomor), [31, 32, 33]);
});

// ---------- ubahJumlahKolom ----------

test("ubahJumlahKolom: 36→30 membuang 6 kolom terakhir, ID 30 pertama tetap", () => {
  const bak = buatBak(0, 0, { kolom: buatKolom(36, { varian: "kecil", jumlahIceCan: 36 }) });
  const hasil = ubahJumlahKolom(bak, 30);
  assert.equal(hasil.kolom.length, 30);
  assert.deepEqual(hasil.kolom.map((k) => k.id), bak.kolom.slice(0, 30).map((k) => k.id));
});

test("ubahJumlahKolom: 30→36 menambah 6 baru, ID 30 pertama tetap", () => {
  const bak = buatBak(0, 0, { kolom: buatKolom(30, { varian: "kecil", jumlahIceCan: 36 }) });
  const hasil = ubahJumlahKolom(bak, 36);
  assert.equal(hasil.kolom.length, 36);
  assert.deepEqual(hasil.kolom.slice(0, 30).map((k) => k.id), bak.kolom.map((k) => k.id));
  assert.deepEqual(hasil.kolom.slice(30).map((k) => k.nomor), [31, 32, 33, 34, 35, 36]);
  assert.equal(new Set(hasil.kolom.map((k) => k.id)).size, 36);
});

test("ubahJumlahKolom: kurangi lalu tambah lagi tidak mengubah ID kolom yang tetap ada", () => {
  const bak = buatBak(0, 0, { kolom: buatKolom(36, { varian: "kecil", jumlahIceCan: 36 }) });
  const bolakBalik = ubahJumlahKolom(ubahJumlahKolom(bak, 20), 36);
  assert.deepEqual(bolakBalik.kolom.slice(0, 20).map((k) => k.id), bak.kolom.slice(0, 20).map((k) => k.id));
});

test("ubahJumlahKolom: kolom baru memakai varian & ice can bawaan bak", () => {
  const bak = buatBak(0, 0, { varianBawaan: "besar", iceCanPerKolomBawaan: 18, kolom: buatKolom(2, { varian: "kecil", jumlahIceCan: 36 }) });
  const hasil = ubahJumlahKolom(bak, 3);
  assert.equal(hasil.kolom[2].varian, "besar");
  assert.equal(hasil.kolom[2].jumlahIceCan, 18);
});

test("nomoriUlangKolom: nomor 1..n sesuai urutan, ID tetap", () => {
  const bak = buatBak(0, 0, { kolom: buatKolom(3, { varian: "kecil", jumlahIceCan: 36 }, 10) });
  const hasil = nomoriUlangKolom(bak);
  assert.deepEqual(hasil.kolom.map((k) => k.nomor), [1, 2, 3]);
  assert.deepEqual(hasil.kolom.map((k) => k.id), bak.kolom.map((k) => k.id));
});

// ---------- validasiDenah ----------

test("validasiDenah: denah kosong & denah valid → []", () => {
  assert.deepEqual(validasiDenah(denahKosong()), []);
  const m = mesin(50, 0);
  const a = buatBak(0, 0, { nama: "BAK 1", mesinIds: [m.id] });
  const b = buatBak(0, a.h + 1, { nama: "BAK 2" });
  assert.deepEqual(validasiDenah(dok(a, b, m)), []);
});

test("validasiDenah: nama bak kosong", () => {
  const a = buatBak(0, 0, { nama: "   " });
  const g = validasiDenah(dok(a));
  assert.ok(g.some((x) => x.elemenId === a.id && /nama/i.test(x.pesan)), JSON.stringify(g));
});

test("validasiDenah: nama bak ganda (abaikan besar-kecil & spasi)", () => {
  const a = buatBak(0, 0, { nama: "BAK 1" });
  const b = buatBak(0, 20, { nama: " bak 1 " });
  const g = validasiDenah(dok(a, b));
  assert.ok(g.some((x) => /ganda|sama/i.test(x.pesan)), JSON.stringify(g));
});

test("validasiDenah: bak bertumpuk", () => {
  const a = buatBak(0, 0, { nama: "BAK 1" });
  const b = buatBak(2, 2, { nama: "BAK 2" });
  const g = validasiDenah(dok(a, b));
  assert.ok(g.some((x) => /tumpuk/i.test(x.pesan)), JSON.stringify(g));
});

test("validasiDenah: bak bersentuhan tepi tidak dianggap bertumpuk", () => {
  const a = buatBak(0, 0, { nama: "BAK 1" });
  const b = buatBak(a.w, 0, { nama: "BAK 2" });
  assert.deepEqual(validasiDenah(dok(a, b)), []);
});

test("validasiDenah: elemen keluar kanvas", () => {
  const d = denahKosong();
  const a = buatBak(d.kanvas.lebar - 2, 0, { nama: "BAK 1" });
  const m = mesin(-1, 0);
  const g = validasiDenah(dok(a, m));
  assert.ok(g.some((x) => x.elemenId === a.id && /kanvas/i.test(x.pesan)), JSON.stringify(g));
  assert.ok(g.some((x) => x.elemenId === m.id && /kanvas/i.test(x.pesan)), JSON.stringify(g));
});

test("validasiDenah: mesinIds menunjuk elemen yang tidak ada", () => {
  const a = buatBak(0, 0, { nama: "BAK 1", mesinIds: ["tidak-ada"] });
  const g = validasiDenah(dok(a));
  assert.ok(g.some((x) => x.elemenId === a.id && /mesin/i.test(x.pesan)), JSON.stringify(g));
});

test("validasiDenah: bakIds derek menunjuk elemen yang tidak ada", () => {
  const derek = {
    tipe: "derek" as const, id: crypto.randomUUID(), nama: "Derek 1", x: 0, y: 30, w: 40, h: 0.3, rotasi: 0 as const,
    elevasiM: 3.5, tinggiM: 0.3, tinggiKaitM: 0.8,
    titikAwal: { x: 0, y: 30 }, titikAkhir: { x: 40, y: 30 }, bakIds: ["hilang"],
  };
  const g = validasiDenah(dok(derek));
  assert.ok(g.some((x) => x.elemenId === derek.id && /bak/i.test(x.pesan)), JSON.stringify(g));
});

test("validasiDenah: jumlah kolom 0 dan jumlah ice can ≤ 0", () => {
  const kosong = buatBak(0, 0, { nama: "BAK 1", kolom: [] });
  const isi = buatBak(0, 20, { nama: "BAK 2", kolom: buatKolom(2, { varian: "kecil", jumlahIceCan: 36 }) });
  isi.kolom[1] = { ...isi.kolom[1], jumlahIceCan: 0 };
  const g = validasiDenah(dok(kosong, isi));
  assert.ok(g.some((x) => x.elemenId === kosong.id && /kolom/i.test(x.pesan)), JSON.stringify(g));
  assert.ok(g.some((x) => x.kolomId === isi.kolom[1].id && /ice can/i.test(x.pesan)), JSON.stringify(g));
});

test("validasiDenah: durasi beku ≤ 0", () => {
  const a = buatBak(0, 0, { nama: "BAK 1", durasiBekuJam: { kecil: 0, besar: 32 } });
  const g = validasiDenah(dok(a));
  assert.ok(g.some((x) => x.elemenId === a.id && /durasi/i.test(x.pesan)), JSON.stringify(g));
});

test("validasiDenah: ID elemen/kolom ganda", () => {
  const a = buatBak(0, 0, { nama: "BAK 1" });
  const b = { ...buatBak(0, 20, { nama: "BAK 2" }), id: a.id };
  const g = validasiDenah(dok(a, b));
  assert.ok(g.some((x) => /ID/i.test(x.pesan)), JSON.stringify(g));
});

// ---------- kolomTerkunciBerubah ----------

function denahDuaBak(): { d: DenahDokumen; a: BakElemen; b: BakElemen } {
  const a = buatBak(0, 0, { nama: "BAK 1", kolom: buatKolom(10, { varian: "kecil", jumlahIceCan: 36 }) });
  const b = buatBak(0, 20, { nama: "BAK 2", kolom: buatKolom(10, { varian: "besar", jumlahIceCan: 18 }) });
  return { d: dok(a, b), a, b };
}

function ganti(d: DenahDokumen, bak: BakElemen): DenahDokumen {
  return { ...d, elemen: d.elemen.map((e) => (e.id === bak.id ? bak : e)) };
}

test("kolomTerkunciBerubah: lama null → []", () => {
  const { d, a } = denahDuaBak();
  assert.deepEqual(kolomTerkunciBerubah(null, d, new Set([a.kolom[0].id])), []);
});

test("kolomTerkunciBerubah: kolom berisi es dihapus → galat menyebut nama bak & nomor", () => {
  const { d, a } = denahDuaBak();
  const baru = ganti(d, ubahJumlahKolom(a, 8)); // buang kolom 9 & 10
  const g = kolomTerkunciBerubah(d, baru, new Set([a.kolom[9].id]));
  assert.equal(g.length, 1);
  assert.equal(g[0].kolomId, a.kolom[9].id);
  assert.match(g[0].pesan, /BAK 1/);
  assert.match(g[0].pesan, /\b10\b/);
});

test("kolomTerkunciBerubah: kolom tanpa es dihapus → tidak galat", () => {
  const { d, a } = denahDuaBak();
  const baru = ganti(d, ubahJumlahKolom(a, 8));
  assert.deepEqual(kolomTerkunciBerubah(d, baru, new Set([a.kolom[0].id])), []);
});

test("kolomTerkunciBerubah: bak induk dihapus → galat", () => {
  const { d, a, b } = denahDuaBak();
  const baru = dok(b);
  const g = kolomTerkunciBerubah(d, baru, new Set([a.kolom[3].id]));
  assert.equal(g.length, 1);
  assert.match(g[0].pesan, /BAK 1/);
  assert.match(g[0].pesan, /\b4\b/);
});

test("kolomTerkunciBerubah: varian/jumlahIceCan/ukuran/nonaktif berubah → galat", () => {
  const { d, a } = denahDuaBak();
  const ubah = (patch: Partial<BakElemen["kolom"][number]>) => {
    const k = [...a.kolom];
    k[2] = { ...k[2], ...patch };
    return kolomTerkunciBerubah(d, ganti(d, { ...a, kolom: k }), new Set([a.kolom[2].id]));
  };
  for (const patch of [{ varian: "besar" as const }, { jumlahIceCan: 30 }, { ukuranIceCan: "60x30" }, { nonaktif: true }]) {
    const g = ubah(patch);
    assert.equal(g.length, 1, JSON.stringify(patch));
    assert.match(g[0].pesan, /BAK 1/);
    assert.match(g[0].pesan, /\b3\b/);
  }
});

test("kolomTerkunciBerubah: catatan berubah, nonaktif undefined→false → tidak galat", () => {
  const { d, a } = denahDuaBak();
  const k = [...a.kolom];
  k[2] = { ...k[2], catatan: "baru", nonaktif: false };
  assert.deepEqual(kolomTerkunciBerubah(d, ganti(d, { ...a, kolom: k }), new Set([a.kolom[2].id])), []);
});

test("kolomTerkunciBerubah: pindah posisi bak / ganti nama / nomori ulang → tidak galat", () => {
  const { d, a } = denahDuaBak();
  const dinomori = { ...a, kolom: a.kolom.map((k, i) => ({ ...k, nomor: 100 + i })) };
  const baru = ganti(d, { ...dinomori, x: 50, y: 40, nama: "BAK UTARA", rotasi: 90 });
  assert.deepEqual(kolomTerkunciBerubah(d, baru, new Set(a.kolom.map((k) => k.id))), []);
});

test("kolomTerkunciBerubah: kolom berisi es dipindah ke bak lain → galat", () => {
  const { d, a, b } = denahDuaBak();
  const pindah = a.kolom[0];
  const baru = ganti(ganti(d, { ...a, kolom: a.kolom.slice(1) }), { ...b, kolom: [...b.kolom, pindah] });
  const g = kolomTerkunciBerubah(d, baru, new Set([pindah.id]));
  assert.equal(g.length, 1);
  assert.match(g[0].pesan, /BAK 1/);
});

// ---------- ringkasDenah ----------

test("ringkasDenah: hitung bak, kolom, ice can per varian, mesin", () => {
  const m1 = mesin(50, 0);
  const m2 = mesin(50, 10, "Kompresor 2");
  const a = buatBak(0, 0, { nama: "BAK 1", kolom: buatKolom(3, { varian: "kecil", jumlahIceCan: 36 }) });
  const b = buatBak(0, 20, { nama: "BAK 2", kolom: buatKolom(2, { varian: "besar", jumlahIceCan: 18 }) });
  b.kolom[1] = { ...b.kolom[1], nonaktif: true }; // kolom nonaktif tidak dihitung kapasitasnya
  assert.deepEqual(ringkasDenah(dok(a, b, m1, m2)), {
    jumlahBak: 2,
    jumlahKolom: 5,
    iceCanKecil: 108,
    iceCanBesar: 18,
    jumlahMesin: 2,
  });
  assert.deepEqual(ringkasDenah(denahKosong()), { jumlahBak: 0, jumlahKolom: 0, iceCanKecil: 0, iceCanBesar: 0, jumlahMesin: 0 });
});

// ---------- validasiBentukDenah (input mentah dari client) ----------

test("validasiBentukDenah: dokumen sah lolos", () => {
  const m = mesin(50, 0);
  const a = buatBak(0, 0, { nama: "BAK 1", mesinIds: [m.id] });
  assert.equal(validasiBentukDenah(JSON.parse(JSON.stringify(dok(a, m)))), null);
});

test("validasiBentukDenah: menolak non-objek, skemaVersi salah, ukuran berlebihan", () => {
  assert.ok(validasiBentukDenah(null));
  assert.ok(validasiBentukDenah("x"));
  assert.ok(validasiBentukDenah([]));
  assert.ok(validasiBentukDenah({ ...denahKosong(), skemaVersi: 1 }));
  assert.ok(validasiBentukDenah({ ...denahKosong(), elemen: "bukan array" }));
  assert.ok(validasiBentukDenah({ ...denahKosong(), kanvas: { ...denahKosong().kanvas, lebar: "x" } }));
  const banyak = Array.from({ length: BATAS_ELEMEN + 1 }, (_, i) => mesin(i, 0, `M${i}`));
  assert.ok(validasiBentukDenah({ ...denahKosong(), elemen: banyak }));
  const bakBesar = buatBak(0, 0, { kolom: buatKolom(BATAS_KOLOM_PER_BAK + 1, { varian: "kecil", jumlahIceCan: 36 }) });
  assert.ok(validasiBentukDenah(dok(bakBesar)));
  const bakCan = buatBak(0, 0, { kolom: buatKolom(1, { varian: "kecil", jumlahIceCan: BATAS_ICE_CAN_PER_KOLOM + 1 }) });
  assert.ok(validasiBentukDenah(dok(bakCan)));
});

test("validasiBentukDenah: menolak tipe elemen tak dikenal & varian salah", () => {
  assert.ok(validasiBentukDenah({ ...denahKosong(), elemen: [{ ...mesin(0, 0), tipe: "roket" }] }));
  const a = buatBak(0, 0);
  const rusak = { ...a, kolom: [{ ...a.kolom[0], varian: "sedang" }] };
  assert.ok(validasiBentukDenah({ ...denahKosong(), elemen: [rusak] }));
});

// ---------- bolehEditDenah ----------

test("bolehEditDenah: superadmin & direktur boleh; peran butuh produksi.canEdit", () => {
  assert.equal(bolehEditDenah({ isSuperAdmin: true, accountScope: "pmpersada", permissions: {} }), true);
  assert.equal(bolehEditDenah({ isSuperAdmin: false, accountScope: "direktur", permissions: {} }), true);
  assert.equal(bolehEditDenah({ isSuperAdmin: false, accountScope: "pmpersada", permissions: { produksi: { canView: true, canEdit: true } } }), true);
  assert.equal(bolehEditDenah({ isSuperAdmin: false, accountScope: "pmpersada", permissions: { produksi: { canView: true, canEdit: false } } }), false);
  assert.equal(bolehEditDenah({ isSuperAdmin: false, accountScope: "pmpakis", permissions: {} }), false);
  assert.equal(bolehEditDenah({ isSuperAdmin: false, accountScope: "pmpakis" }), false);
});

// ---------- v2: bawaan, preset ----------

test("denahKosong v2: 60×40 m, grid 20, snap 0.1, utara 0, pelat 0.2", () => {
  assert.deepEqual(denahKosong(), {
    skemaVersi: 2,
    kanvas: { lebar: 60, tinggi: 40, ukuranGrid: 20, langkahSnapM: 0.1, utaraDerajat: 0, pelatLantai: { tebalM: 0.2 } },
    elemen: [],
  });
});

test("buatBak v2: bawaan meter & ice can", () => {
  const b = buatBak(1, 2);
  assert.deepEqual([b.w, b.h, b.elevasiM, b.tinggiM, b.tebalDindingM, b.levelBrineM, b.jarakAntarKolomMm, b.jarakAntarCanMm], [16, 6.5, -0.7, 1, 0.2, 0.95, 60, 40]);
  assert.deepEqual(b.iceCan.kecil, { panjangMm: 120, lebarMm: 360, tinggiMm: 750, beratKg: 25, presetId: "pasar-25" });
  assert.deepEqual(b.iceCan.besar, { panjangMm: 240, lebarMm: 360, tinggiMm: 750, beratKg: 50 });
  assert.notEqual(b.iceCan.kecil, ICE_CAN_DIMENSI_BAWAAN.kecil, "ice can bak tidak berbagi objek dengan bawaan");
});

test("PRESET_ICE_CAN: 11 baris, pasar-25 = 120×360×750 25 kg", () => {
  assert.equal(PRESET_ICE_CAN.length, 11);
  assert.deepEqual(PRESET_ICE_CAN.map((p) => p.id), [
    "pasar-5", "pasar-10", "pasar-15", "pasar-20", "pasar-25", "pasar-50", "pasar-100", "fao-25", "fao-50", "fao-136", "kustom",
  ]);
  const p25 = PRESET_ICE_CAN.find((p) => p.id === "pasar-25")!;
  assert.deepEqual([p25.label, p25.panjangMm, p25.lebarMm, p25.tinggiMm, p25.beratKg], ["Pasar 25 kg", 120, 360, 750, 25]);
  const f136 = PRESET_ICE_CAN.find((p) => p.id === "fao-136")!;
  assert.deepEqual([f136.panjangMm, f136.lebarMm, f136.tinggiMm, f136.beratKg], [280, 560, 1220, 136]);
});

// ---------- migrasiDenah ----------

function dokV1() {
  return {
    skemaVersi: 1,
    kanvas: { lebar: 120, tinggi: 80, ukuranGrid: 20 },
    elemen: [
      {
        tipe: "bak", id: "bak-1", nama: "BAK 1", x: 4, y: 20, w: 27, h: 8, rotasi: 0,
        orientasiKolom: "horizontal", arahNomor: "maju", varianBawaan: "kecil", iceCanPerKolomBawaan: 36,
        durasiBekuJam: { kecil: 24, besar: 32 }, kolomPerPanen: 1, mesinIds: ["m-1"], catatan: "",
        kolom: [
          { id: "k-1", nomor: 1, varian: "kecil", jumlahIceCan: 36 },
          { id: "k-2", nomor: 2, varian: "besar", jumlahIceCan: 18 },
        ],
      },
      { tipe: "derek", id: "d-1", nama: "Derek 1", x: 2, y: 9.5, w: 28, h: 1, rotasi: 0, titikAwal: { x: 2, y: 10 }, titikAkhir: { x: 30, y: 10 }, bakIds: ["bak-1"] },
      { tipe: "mesin", id: "m-1", nama: "Kompresor 1", x: 40, y: 2, w: 4, h: 4, rotasi: 90, jenis: "Kompresor Amonia", catatan: "" },
    ],
  };
}

test("migrasiDenah v1→v2: skala 0,5 m per unit, grid ×2, ID tetap, bawaan terisi", () => {
  const d = migrasiDenah(dokV1());
  assert.equal(d.skemaVersi, 2);
  assert.deepEqual(d.kanvas, { lebar: 60, tinggi: 40, ukuranGrid: 40, langkahSnapM: 0.1, utaraDerajat: 0, pelatLantai: { tebalM: 0.2 } });
  const [bak, derek, mesinM] = d.elemen as [BakElemen, DerekElemen, MesinElemen];
  assert.deepEqual([bak.x, bak.y, bak.w, bak.h], [2, 10, 13.5, 4]);
  assert.deepEqual(d.elemen.map((e) => e.id), ["bak-1", "d-1", "m-1"]);
  assert.deepEqual(bak.kolom.map((k) => k.id), ["k-1", "k-2"]);
  assert.deepEqual(bak.iceCan, ICE_CAN_DIMENSI_BAWAAN);
  assert.deepEqual([bak.elevasiM, bak.tinggiM, bak.tebalDindingM, bak.levelBrineM, bak.jarakAntarKolomMm, bak.jarakAntarCanMm], [-0.7, 1, 0.2, 0.95, 60, 40]);
  assert.deepEqual(derek.titikAwal, { x: 1, y: 5 });
  assert.deepEqual(derek.titikAkhir, { x: 15, y: 5 });
  assert.deepEqual([derek.elevasiM, derek.tinggiKaitM, derek.tinggiM], [3.5, 0.8, 0.3]);
  assert.deepEqual([mesinM.x, mesinM.w, mesinM.rotasi, mesinM.kategori, mesinM.tinggiM, mesinM.elevasiM], [20, 2, 90, "refrigerasi", 1.8, 0]);
  assert.equal(validasiBentukDenah(d), null, "hasil migrasi lolos bentuk v2");
});

test("migrasiDenah v1 tidak mengubah objek masukan", () => {
  const raw = dokV1();
  const salinan = structuredClone(raw);
  migrasiDenah(raw);
  assert.deepEqual(raw, salinan);
});

test("migrasiDenah(v2 lengkap) = identitas", () => {
  const m = mesin(50, 0);
  const a = buatBak(0, 0, { nama: "BAK 1", mesinIds: [m.id] });
  const d = dok(a, m);
  assert.deepEqual(migrasiDenah(structuredClone(d)), d);
});

test("migrasiDenah v2: field opsional yang hilang dilengkapi bawaan", () => {
  const a = buatBak(0, 0, { nama: "BAK 1" }) as Partial<BakElemen>;
  delete a.iceCan;
  delete a.levelBrineM;
  const raw = { skemaVersi: 2, kanvas: { lebar: 30, tinggi: 20, ukuranGrid: 20 }, elemen: [a] };
  const d = migrasiDenah(raw);
  assert.deepEqual(d.kanvas, { lebar: 30, tinggi: 20, ukuranGrid: 20, langkahSnapM: 0.1, utaraDerajat: 0, pelatLantai: { tebalM: 0.2 } });
  const b = d.elemen[0] as BakElemen;
  assert.deepEqual(b.iceCan, ICE_CAN_DIMENSI_BAWAAN);
  assert.equal(b.levelBrineM, 0.95);
});

test("migrasiDenah: bentuk lain melempar Error", () => {
  assert.throws(() => migrasiDenah(null));
  assert.throws(() => migrasiDenah("x"));
  assert.throws(() => migrasiDenah({ skemaVersi: 3, kanvas: {}, elemen: [] }));
  assert.throws(() => migrasiDenah({ skemaVersi: 1, kanvas: { lebar: 1, tinggi: 1, ukuranGrid: 1 }, elemen: "x" }));
});

// ---------- validasiBentukDenah v2: field baru ----------

function jalur(patch: Partial<JalurElemen> = {}): JalurElemen {
  return {
    tipe: "jalur", id: crypto.randomUUID(), nama: "Pipa 1", x: 1, y: 1, w: 4, h: 0.05, rotasi: 0, elevasiM: -0.1, tinggiM: 0.05,
    jenis: "pipa", fluida: "air-baku", diameterMm: 50,
    titik: [{ x: 1, y: 1, z: -0.1 }, { x: 5, y: 1, z: -0.1 }],
    ...patch,
  };
}

test("validasiBentukDenah v2: menerima jalur, tangki, beton yang sah", () => {
  const t: TangkiElemen = {
    tipe: "tangki", id: crypto.randomUUID(), nama: "Tandon 1", x: 10, y: 10, w: 2, h: 2, rotasi: 0, elevasiM: 0, tinggiM: 1.5,
    jenis: "tandon", bentuk: "kotak", levelIsiPersen: 70,
  };
  const b: BetonElemen = { tipe: "beton", id: crypto.randomUUID(), nama: "Beton 1", x: 20, y: 10, w: 2, h: 2, rotasi: 0, elevasiM: -0.5, tinggiM: 0.5 };
  const kabel = jalur({ jenis: "kabel", sistem: "daya", diameterMm: 25 });
  delete kabel.fluida;
  assert.equal(validasiBentukDenah(JSON.parse(JSON.stringify(dok(jalur(), kabel, t, b)))), null);
});

test("validasiBentukDenah v2: menolak fluida tak dikenal, titik NaN, utara di luar 0–359, kategori salah", () => {
  assert.ok(validasiBentukDenah(dok(jalur({ fluida: "minyak" as never }))));
  assert.ok(validasiBentukDenah(dok(jalur({ titik: [{ x: 1, y: 1, z: NaN }, { x: 2, y: 1, z: 0 }] }))));
  const banyakTitik = Array.from({ length: 1001 }, (_, i) => ({ x: i * 0.01, y: 1, z: 0 }));
  assert.ok(validasiBentukDenah(dok(jalur({ titik: banyakTitik }))));
  assert.ok(validasiBentukDenah({ ...denahKosong(), kanvas: { ...denahKosong().kanvas, utaraDerajat: 360 } }));
  assert.ok(validasiBentukDenah({ ...denahKosong(), kanvas: { ...denahKosong().kanvas, utaraDerajat: -1 } }));
  assert.ok(validasiBentukDenah({ ...denahKosong(), kanvas: { ...denahKosong().kanvas, langkahSnapM: "x" } }));
  assert.ok(validasiBentukDenah(dok({ ...mesin(0, 0), kategori: "nuklir" as never })));
  assert.ok(validasiBentukDenah(dok({ ...mesin(0, 0), elevasiM: undefined as never })));
  const bak = buatBak(0, 0);
  assert.ok(validasiBentukDenah(dok({ ...bak, iceCan: { ...bak.iceCan, kecil: { ...bak.iceCan.kecil, tinggiMm: Infinity } } })));
});

// ---------- lapisanElemen & kotakJalur ----------

test("lapisanElemen: pemetaan spec §4", () => {
  const tangki = (jenis: TangkiElemen["jenis"]): TangkiElemen => ({
    tipe: "tangki", id: "t", nama: "T", x: 0, y: 0, w: 1, h: 1, rotasi: 0, elevasiM: 0, tinggiM: 1, jenis, bentuk: "kotak", levelIsiPersen: 70,
  });
  const beton: BetonElemen = { tipe: "beton", id: "b", nama: "B", x: 0, y: 0, w: 1, h: 1, rotasi: 0, elevasiM: -0.5, tinggiM: 0.5 };
  assert.equal(lapisanElemen(tangki("filling")), "proses");
  assert.equal(lapisanElemen(tangki("thawing")), "proses");
  assert.equal(lapisanElemen(tangki("tandon")), "air");
  assert.equal(lapisanElemen(jalur({ fluida: "nh3-gas" })), "refrigerasi");
  assert.equal(lapisanElemen(jalur({ fluida: "brine" })), "refrigerasi");
  assert.equal(lapisanElemen(jalur({ fluida: "drain" })), "air");
  assert.equal(lapisanElemen(jalur({ jenis: "kabel", fluida: undefined, sistem: "kontrol" })), "listrik");
  assert.equal(lapisanElemen(beton), "arsitektur");
  assert.equal(lapisanElemen(buatBak(0, 0)), "proses");
  assert.equal(lapisanElemen({ ...mesin(0, 0), kategori: "pompa" }), "air");
  assert.equal(lapisanElemen({ ...mesin(0, 0), kategori: "listrik" }), "listrik");
  assert.equal(lapisanElemen({ ...mesin(0, 0), kategori: "lainnya" }), "lainnya");
  assert.equal(lapisanElemen(mesin(0, 0)), "refrigerasi");
});

test("kotakJalur: kotak pembungkus, sisi minimum 0,05 dipusatkan", () => {
  assert.deepEqual(kotakJalur([{ x: 1, y: 2, z: 0 }, { x: 5, y: 4, z: -1 }, { x: 3, y: 1, z: 0 }]), { x: 1, y: 1, w: 4, h: 3 });
  const k = kotakJalur([{ x: 1, y: 2, z: 0 }, { x: 5, y: 2, z: 0 }]);
  assert.equal(k.x, 1);
  assert.equal(k.w, 4);
  assert.ok(Math.abs(k.y - 1.975) < 1e-9 && Math.abs(k.h - 0.05) < 1e-9, JSON.stringify(k));
});

// ---------- kolomTerkunciBerubah: dimensi ice can ----------

test("kolomTerkunciBerubah: dimensi ice can varian yang berisi es tidak boleh diubah", () => {
  const { d, a } = denahDuaBak(); // BAK 1 = kolom kecil semua
  const baru = ganti(d, { ...a, iceCan: { ...a.iceCan, kecil: { ...a.iceCan.kecil, tinggiMm: 800 } } });
  const g = kolomTerkunciBerubah(d, baru, new Set([a.kolom[0].id]));
  assert.equal(g.length, 1, JSON.stringify(g));
  assert.equal(g[0].elemenId, a.id);
  assert.match(g[0].pesan, /dimensi ice can Kecil tidak boleh diubah/);
  assert.match(g[0].pesan, /BAK 1/);
});

test("kolomTerkunciBerubah: ubah dimensi Kecil saat hanya kolom Besar berisi es → tidak galat", () => {
  const a = buatBak(0, 0, { nama: "BAK 1", kolom: buatKolom(4, { varian: "besar", jumlahIceCan: 18 }) });
  const d = dok(a);
  const baru = ganti(d, { ...a, iceCan: { ...a.iceCan, kecil: { ...a.iceCan.kecil, tinggiMm: 800 } } });
  assert.deepEqual(kolomTerkunciBerubah(d, baru, new Set([a.kolom[0].id])), []);
  const baruBesar = ganti(d, { ...a, iceCan: { ...a.iceCan, besar: { ...a.iceCan.besar, beratKg: 45 } } });
  const g = kolomTerkunciBerubah(d, baruBesar, new Set([a.kolom[0].id]));
  assert.equal(g.length, 1);
  assert.match(g[0].pesan, /dimensi ice can Besar/);
});

// ---------- Perbaikan tinjauan akhir ----------

function jalurDariTitik(titik: JalurElemen["titik"]): JalurElemen {
  return jalur({ titik, ...kotakJalur(titik) });
}

test("validasiDenah: jalur tepat di tepi kanvas (x=0, y=tinggi) sah; titik di luar tetap galat", () => {
  const { lebar, tinggi } = denahKosong().kanvas;
  const keluar = (j: JalurElemen) => validasiDenah(dok(j)).some((g) => /keluar dari batas kanvas/.test(g.pesan));
  assert.equal(keluar(jalurDariTitik([{ x: 0, y: 1, z: 0.5 }, { x: 0, y: 5, z: 0.5 }])), false, "sepanjang x=0");
  assert.equal(keluar(jalurDariTitik([{ x: 1, y: tinggi, z: 0.5 }, { x: 5, y: tinggi, z: 0.5 }])), false, "sepanjang y=tinggi");
  assert.equal(keluar(jalurDariTitik([{ x: lebar, y: 0, z: 0 }, { x: lebar, y: tinggi, z: 0 }])), false, "sepanjang x=lebar");
  assert.equal(keluar(jalurDariTitik([{ x: -0.1, y: 1, z: 0.5 }, { x: 3, y: 1, z: 0.5 }])), true, "x=-0,1");
  assert.equal(keluar(jalurDariTitik([{ x: 1, y: 1, z: 0 }, { x: 1, y: tinggi + 0.1, z: 0 }])), true, "y>tinggi");
});

test("validasiBentukDenah: jarak bak, diameter jalur, langkah snap — tanda & batas", () => {
  const b = buatBak(2, 2);
  assert.ok(validasiBentukDenah(dok({ ...b, jarakAntarKolomMm: -1 })), "jarak kolom negatif");
  assert.ok(validasiBentukDenah(dok({ ...b, jarakAntarCanMm: -0.5 })), "jarak can negatif");
  assert.equal(validasiBentukDenah(dok({ ...b, jarakAntarKolomMm: 0, jarakAntarCanMm: 0 })), null, "jarak 0 sah");
  assert.ok(validasiBentukDenah(dok(jalur({ diameterMm: 0 }))), "diameter 0");
  assert.ok(validasiBentukDenah(dok(jalur({ diameterMm: -10 }))), "diameter negatif");
  const kv = denahKosong().kanvas;
  assert.ok(validasiBentukDenah({ ...denahKosong(), kanvas: { ...kv, langkahSnapM: 0 } }), "snap 0");
  assert.ok(validasiBentukDenah({ ...denahKosong(), kanvas: { ...kv, langkahSnapM: -0.1 } }), "snap negatif");
  assert.ok(validasiBentukDenah({ ...denahKosong(), kanvas: { ...kv, langkahSnapM: 10.5 } }), "snap > 10");
  assert.equal(validasiBentukDenah({ ...denahKosong(), kanvas: { ...kv, langkahSnapM: 10 } }), null, "snap 10 sah");
});

test("migrasiDenah v1: ukuranGrid ×2 di-clamp ke BATAS_UKURAN_GRID", () => {
  const raw = dokV1();
  raw.kanvas.ukuranGrid = 150;
  const d = migrasiDenah(raw);
  assert.equal(d.kanvas.ukuranGrid, BATAS_UKURAN_GRID);
  assert.equal(validasiBentukDenah(d), null);
  const kecil = dokV1();
  kecil.kanvas.ukuranGrid = 30;
  assert.equal(migrasiDenah(kecil).kanvas.ukuranGrid, 60);
});
