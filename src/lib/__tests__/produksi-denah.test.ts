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
  BATAS_ELEMEN,
  BATAS_KOLOM_PER_BAK,
  BATAS_ICE_CAN_PER_KOLOM,
  type BakElemen,
  type DenahDokumen,
  type MesinElemen,
} from "../produksi-denah";
import { bolehEditDenah } from "../permissions";

function mesin(x: number, y: number, nama = "Kompresor 1"): MesinElemen {
  return { tipe: "mesin", id: crypto.randomUUID(), nama, x, y, w: 4, h: 4, rotasi: 0, jenis: "Kompresor Amonia", catatan: "" };
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
  const m = mesin(60, 0);
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
    tipe: "derek" as const, id: crypto.randomUUID(), nama: "Derek 1", x: 0, y: 30, w: 40, h: 1, rotasi: 0 as const,
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
  const m1 = mesin(60, 0);
  const m2 = mesin(60, 10, "Kompresor 2");
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
  const m = mesin(60, 0);
  const a = buatBak(0, 0, { nama: "BAK 1", mesinIds: [m.id] });
  assert.equal(validasiBentukDenah(JSON.parse(JSON.stringify(dok(a, m)))), null);
});

test("validasiBentukDenah: menolak non-objek, skemaVersi salah, ukuran berlebihan", () => {
  assert.ok(validasiBentukDenah(null));
  assert.ok(validasiBentukDenah("x"));
  assert.ok(validasiBentukDenah([]));
  assert.ok(validasiBentukDenah({ ...denahKosong(), skemaVersi: 2 }));
  assert.ok(validasiBentukDenah({ ...denahKosong(), elemen: "bukan array" }));
  assert.ok(validasiBentukDenah({ ...denahKosong(), kanvas: { lebar: "x", tinggi: 1, ukuranGrid: 1 } }));
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
