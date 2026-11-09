import { test } from "node:test";
import assert from "node:assert/strict";
import { buatBak, buatKolom, denahKosong, type BakElemen, type DenahDokumen } from "../produksi-denah";
import {
  AMBANG,
  adalahAmbilSendiri,
  batalAdalahTandaiBabonan,
  cocokkanHarian,
  validasiKoreksiMuatan,
  ROLLOVER_PANEN_JAM,
  cocokkanMuatan,
  estimasiCanJadi,
  hitungKematangan,
  keadaanPabrik,
  keadaanRek,
  peringatanDari,
  ringkasStok,
  shiftDari,
  tahapDari,
  tanggalBisnisNaive,
  tanggalBisnisPanen,
  validasiPanen,
  type IsianAktif,
  type KeadaanRek,
  type MaintenanceAktif,
  type MuatanInput,
} from "../produksi-operasional";

const JAM = 3_600_000;
const SEKARANG = new Date("2026-11-09T10:00:00+07:00");
const lalu = (jam: number) => new Date(SEKARANG.getTime() - jam * JAM).toISOString();

function bakUji(n = 3, jumlahIceCan = 36): BakElemen {
  return buatBak(0, 0, { nama: "Bak 2", kolom: buatKolom(n, { varian: "kecil", jumlahIceCan }) });
}

function isian(bak: BakElemen, kolomIdx: number, opsi: Partial<IsianAktif> = {}): IsianAktif {
  return {
    id: crypto.randomUUID(),
    kolomId: bak.kolom[kolomIdx].id,
    bakId: bak.id,
    jenis: "produksi",
    varian: "kecil",
    jumlahAwal: 36,
    sisa: 36,
    pecah: 0,
    mulaiAt: lalu(12),
    durasiBekuJam: 24,
    diisiOlehNama: "Andi",
    ...opsi,
  };
}

function mt(kolomId: string, jam: number): MaintenanceAktif {
  return { id: crypto.randomUUID(), kolomId, mulaiAt: lalu(jam), catatan: "ganti can", dibukaOlehNama: "Budi" };
}

function armada(id: string, jumlah: number): MuatanInput {
  return { jenis: "armada", kendaraanErpId: id, plat: `S ${id} UH`, agenId: null, agenNama: null, jumlah };
}

test("konstanta", () => {
  assert.equal(ROLLOVER_PANEN_JAM, 14);
  assert.equal(AMBANG.terlambatTambahJam, 12);
  assert.equal(AMBANG.panenBelumSiapPersen, 75);
});

test("kematangan dan tahap", () => {
  const t0 = new Date("2026-11-09T00:00:00Z");
  assert.equal(hitungKematangan(t0, 24, new Date(t0.getTime() + 12 * JAM)), 50);
  assert.equal(hitungKematangan(t0, 24, t0), 0);
  assert.equal(hitungKematangan(t0, 24, new Date(t0.getTime() + 30 * JAM)), 100);
  assert.equal(hitungKematangan(t0, 24, new Date(t0.getTime() - JAM)), 0);
  assert.equal(tahapDari(0), "air");
  assert.equal(tahapDari(1), "mulai");
  assert.equal(tahapDari(49), "mulai");
  assert.equal(tahapDari(50), "kristal");
  assert.equal(tahapDari(74), "kristal");
  assert.equal(tahapDari(75), "siap");
  assert.equal(tahapDari(99), "siap");
  assert.equal(tahapDari(100), "jadi");
});

test("shift", () => {
  const s = (jam: string) => shiftDari(new Date(`2026-11-09T${jam}:00+07:00`));
  assert.equal(s("07:00"), 1);
  assert.equal(s("14:59"), 1);
  assert.equal(s("15:00"), 2);
  assert.equal(s("22:59"), 2);
  assert.equal(s("23:00"), 3);
  assert.equal(s("06:59"), 3);
});

test("tanggal bisnis 13:59 vs 14:00", () => {
  assert.equal(tanggalBisnisPanen(new Date("2026-11-09T13:59:00+07:00")), "2026-11-09");
  assert.equal(tanggalBisnisPanen(new Date("2026-11-09T14:00:00+07:00")), "2026-11-10");
  assert.equal(tanggalBisnisPanen(new Date("2026-11-09T00:30:00+07:00")), "2026-11-09");
  assert.equal(tanggalBisnisNaive(new Date("2026-11-09T13:59:00Z")), "2026-11-09");
  assert.equal(tanggalBisnisNaive(new Date("2026-11-09T14:00:00Z")), "2026-11-10");
  assert.equal(tanggalBisnisNaive(new Date("2026-11-30T23:00:00Z")), "2026-12-01");
});

test("validasi panen produksi", () => {
  assert.equal(validasiPanen("produksi", 36, { muatan: [armada("1", 20), armada("2", 14)], babonan: 2, pecah: 0 }), null);
  const kurang = validasiPanen("produksi", 36, { muatan: [armada("1", 20), armada("2", 13)], babonan: 2, pecah: 0 });
  assert.ok(kurang);
  assert.match(kurang, /36/);
  assert.match(kurang, /35/);
  assert.notEqual(validasiPanen("produksi", 36, { muatan: [armada("1", 20), armada("1", 14)], babonan: 2, pecah: 0 }), null);
  assert.notEqual(validasiPanen("produksi", 36, { muatan: [armada("1", 40), armada("2", -4)], babonan: 0, pecah: 0 }), null);
  assert.notEqual(validasiPanen("produksi", 36, { muatan: [armada("1", 34), armada("2", 0)], babonan: 2, pecah: 0 }), null);
  assert.notEqual(validasiPanen("produksi", 36, { muatan: [armada("1", 34)], babonan: 3, pecah: -1 }), null);
  const pembeli: MuatanInput = { jenis: "pembeli", kendaraanErpId: null, plat: "  ", agenId: null, agenNama: null, jumlah: 14 };
  assert.notEqual(validasiPanen("produksi", 36, { muatan: [armada("1", 20), pembeli], babonan: 2, pecah: 0 }), null);
  assert.equal(
    validasiPanen("produksi", 36, { muatan: [armada("1", 20), { ...pembeli, plat: "W 1 X" }], babonan: 2, pecah: 0 }),
    null,
  );
});

test("validasi panen babonan", () => {
  assert.equal(validasiPanen("babonan", 2, { muatan: [armada("1", 1)], babonan: 0, pecah: 0 }), null);
  assert.notEqual(validasiPanen("babonan", 2, { muatan: [armada("1", 3)], babonan: 0, pecah: 0 }), null);
  assert.notEqual(validasiPanen("babonan", 2, { muatan: [armada("1", 1)], babonan: 1, pecah: 0 }), null);
});

test("keadaan rek", () => {
  const bak = bakUji();
  const kolom = bak.kolom[0];
  const produksi = isian(bak, 0, { sisa: 34, mulaiAt: lalu(12), durasiBekuJam: 24 });
  const babonan = isian(bak, 0, { jenis: "babonan", jumlahAwal: 2, sisa: 2, mulaiAt: lalu(30), durasiBekuJam: null });

  const k = keadaanRek(bak, kolom, [produksi, babonan], null, SEKARANG);
  assert.equal(k.utama, "berisi");
  assert.equal(k.pct, 50);
  assert.equal(k.tahap, "kristal");
  assert.equal(k.babonan, 2);
  assert.equal(k.canKosong, 0);
  assert.equal(k.kapasitas, 36);
  assert.equal(k.usiaMenit, 720);
  assert.equal(k.estimasiMatang, new Date(SEKARANG.getTime() + 12 * JAM).toISOString());
  assert.equal(k.isianBabonan?.id, babonan.id);

  const hb = keadaanRek(bak, kolom, [babonan], null, SEKARANG);
  assert.equal(hb.utama, "babonan");
  assert.equal(hb.canKosong, 34);
  assert.equal(hb.pct, null);
  assert.equal(hb.tahap, null);
  assert.equal(hb.estimasiMatang, null);

  const kosong = keadaanRek(bak, kolom, [], null, SEKARANG);
  assert.equal(kosong.utama, "kosong");
  assert.equal(kosong.canKosong, 36);

  // isian milik kolom lain diabaikan
  assert.equal(keadaanRek(bak, kolom, [isian(bak, 1)], null, SEKARANG).utama, "kosong");

  assert.equal(keadaanRek(bak, { ...kolom, nonaktif: true }, [produksi], mt(kolom.id, 1), SEKARANG).utama, "nonaktif");
  assert.equal(keadaanRek(bak, kolom, [babonan], mt(kolom.id, 1), SEKARANG).utama, "maintenance");

  const muda = isian(bak, 0, { sisa: 10, mulaiAt: lalu(2) });
  const tua = isian(bak, 0, { sisa: 10, mulaiAt: lalu(18) });
  const dua = keadaanRek(bak, kolom, [muda, tua], null, SEKARANG);
  assert.equal(dua.pct, 75);
  assert.equal(dua.tahap, "siap");
  assert.equal(dua.isianProduksi[0].id, tua.id);
  assert.equal(dua.canKosong, 16);

  // durasi null → snapshot dari bak (kecil 24 jam bawaan)
  const tanpaDurasi = keadaanRek(bak, kolom, [isian(bak, 0, { durasiBekuJam: null, mulaiAt: lalu(6) })], null, SEKARANG);
  assert.equal(tanpaDurasi.pct, 25);
});

test("keadaan pabrik", () => {
  const bak = bakUji(3);
  const denah: DenahDokumen = { ...denahKosong(), elemen: [bak] };
  const hasil = keadaanPabrik(denah, [isian(bak, 1)], [mt(bak.kolom[2].id, 1)], SEKARANG);
  assert.deepEqual(
    hasil.map((k) => k.utama),
    ["kosong", "berisi", "maintenance"],
  );
  assert.deepEqual(
    hasil.map((k) => k.nomor),
    [1, 2, 3],
  );
});

test("ringkas stok", () => {
  const bak = bakUji(5);
  bak.kolom[4] = { ...bak.kolom[4], nonaktif: true };
  const denah: DenahDokumen = { ...denahKosong(), elemen: [bak] };
  const daftar = [
    isian(bak, 0, { sisa: 30, mulaiAt: SEKARANG.toISOString() }), // air
    isian(bak, 1, { sisa: 34, mulaiAt: lalu(12) }), // kristal → proses
    isian(bak, 1, { jenis: "babonan", sisa: 2, jumlahAwal: 2, mulaiAt: lalu(30) }),
    isian(bak, 2, { sisa: 36, mulaiAt: lalu(30) }), // jadi → matang
  ];
  const keadaan = keadaanPabrik(denah, daftar, [mt(bak.kolom[3].id, 1)], SEKARANG);
  const r = ringkasStok(denah, keadaan, SEKARANG);
  assert.equal(r.air, 30);
  assert.equal(r.proses, 34);
  assert.equal(r.matang, 36);
  assert.equal(r.babonan, 2);
  assert.equal(r.maintenance, 36);
  assert.equal(r.sehat, 36 * 4 - 36);
  assert.deepEqual(r.perBak, [{ bakId: bak.id, nama: "Bak 2", kapasitas: 36 * 4, terisi: 30 + 34 + 2 + 36 }]);
});

test("estimasi can jadi 6/12 jam", () => {
  const bak = bakUji(4);
  const denah: DenahDokumen = { ...denahKosong(), elemen: [bak] };
  const daftar = [
    isian(bak, 0, { sisa: 30, mulaiAt: lalu(30) }), // sudah jadi
    isian(bak, 1, { sisa: 20, mulaiAt: lalu(20) }), // jadi dalam 4 jam
    isian(bak, 2, { sisa: 10, mulaiAt: lalu(13) }), // jadi dalam 11 jam
    isian(bak, 3, { sisa: 5, mulaiAt: lalu(1) }), // 23 jam lagi
    isian(bak, 3, { jenis: "babonan", sisa: 2, jumlahAwal: 2, mulaiAt: lalu(40) }), // Babonan tidak dihitung
  ];
  const keadaan = keadaanPabrik(denah, daftar, [], SEKARANG);
  assert.deepEqual(estimasiCanJadi(keadaan, SEKARANG, 6), { total: 50, sudahJadi: 30 });
  assert.deepEqual(estimasiCanJadi(keadaan, SEKARANG, 12), { total: 60, sudahJadi: 30 });
});

test("cocokkan muatan", () => {
  const p = (id: string, kecil: number, besar: number) => ({
    kendaraanErpId: id,
    plat: `S ${id}`,
    kecil,
    besar,
    jumlahPanen: 3,
    operator: ["Andi"],
  });
  const d = (id: string, kecil: number, besar: number) => ({ kendaraanErpId: id, plat: `S ${id}`, kecil, besar, noDo: [`DO-${id}`] });
  const hasil = cocokkanMuatan(
    [p("1", 0, 306), p("2", 10, 10), p("4", 5, 0), p("5", 12, 7), p("6", 0, 5)],
    [d("1", 0, 302), d("2", 10, 10), d("3", 4, 0), d("5", 10, 10), d("6", 0, 9)],
  );
  const per = Object.fromEntries(hasil.map((b) => [b.kendaraanErpId, b]));
  assert.equal(per["1"].status, "panen-lebih");
  assert.equal(per["1"].selisihBesar, 4);
  assert.equal(per["1"].selisihKecil, 0);
  assert.equal(per["2"].status, "cocok");
  assert.equal(per["3"].status, "hanya-do");
  assert.deepEqual(per["3"].noDo, ["DO-3"]);
  assert.deepEqual(per["3"].operator, []);
  assert.equal(per["4"].status, "hanya-panen");
  assert.equal(per["5"].status, "panen-lebih");
  assert.equal(per["5"].selisihKecil, 2);
  assert.equal(per["5"].selisihBesar, -3);
  assert.equal(per["6"].status, "do-lebih");
  assert.deepEqual(
    hasil.map((b) => b.kendaraanErpId),
    ["1", "5", "4", "6", "3", "2"],
  );
});

test("peringatan", () => {
  const bak = bakUji(6);
  const denah: DenahDokumen = { ...denahKosong(), elemen: [bak] };
  const daftar = [
    isian(bak, 0, { mulaiAt: lalu(37), durasiBekuJam: 24 }),
    isian(bak, 1, { mulaiAt: lalu(35), durasiBekuJam: 24 }),
    isian(bak, 2, { jenis: "babonan", sisa: 2, mulaiAt: lalu(49) }),
    isian(bak, 3, { jenis: "babonan", sisa: 2, mulaiAt: lalu(47) }),
  ];
  const keadaan: KeadaanRek[] = keadaanPabrik(denah, daftar, [mt(bak.kolom[4].id, 73)], SEKARANG);
  const kolom5 = bak.kolom[5].id;
  const hasil = peringatanDari({
    keadaan,
    kosongSejak: { [kolom5]: lalu(7) },
    panenBelumSiap: [
      { kolomId: bak.kolom[1].id, panenAt: lalu(2), persen: 70 },
      { kolomId: bak.kolom[1].id, panenAt: lalu(2), persen: 80 },
      { kolomId: bak.kolom[1].id, panenAt: lalu(30), persen: 60 },
    ],
    selisih: cocokkanMuatan(
      [{ kendaraanErpId: "1", plat: "S 1", kecil: 0, besar: 10, jumlahPanen: 1, operator: [] }],
      [
        { kendaraanErpId: "1", plat: "S 1", kecil: 0, besar: 8, noDo: [] },
        { kendaraanErpId: "2", plat: "S 2", kecil: 3, besar: 0, noDo: [] },
      ],
    ),
    sekarang: SEKARANG,
    label: (id) => `Bak 2 – Rek ${bak.kolom.findIndex((k) => k.id === id) + 1}`,
  });
  const kode = (k: string) => hasil.filter((p) => p.kode === k);
  assert.equal(kode("TERLAMBAT_PANEN").length, 1);
  assert.equal(kode("TERLAMBAT_PANEN")[0].kolomId, bak.kolom[0].id);
  assert.match(kode("TERLAMBAT_PANEN")[0].pesan, /Rek 1/);
  assert.equal(kode("BABONAN_LAMA").length, 1);
  assert.equal(kode("BABONAN_LAMA")[0].kolomId, bak.kolom[2].id);
  assert.equal(kode("MAINTENANCE_LAMA").length, 1);
  assert.equal(kode("MAINTENANCE_LAMA")[0].kolomId, bak.kolom[4].id);
  assert.equal(kode("KOSONG_LAMA").length, 1);
  assert.equal(kode("KOSONG_LAMA")[0].kolomId, kolom5);
  assert.equal(kode("PANEN_BELUM_SIAP").length, 1);
  assert.equal(kode("SELISIH_MUATAN").length, 2);
  assert.equal(kode("SELISIH_MUATAN")[0].kolomId, null);

  // kosongSejak hanya berlaku untuk rek yang memang kosong
  const tidak = peringatanDari({
    keadaan,
    kosongSejak: { [bak.kolom[0].id]: lalu(7), [kolom5]: lalu(5) },
    panenBelumSiap: [],
    selisih: [],
    sekarang: SEKARANG,
    label: () => "x",
  });
  assert.equal(tidak.filter((p) => p.kode === "KOSONG_LAMA").length, 0);
});

test("ringkas stok per isian: 34 jadi + 2 baru diisi air", () => {
  const bak = bakUji(1);
  const denah: DenahDokumen = { ...denahKosong(), elemen: [bak] };
  const daftar = [
    isian(bak, 0, { sisa: 34, jumlahAwal: 34, mulaiAt: lalu(30) }), // jadi
    isian(bak, 0, { sisa: 2, jumlahAwal: 2, mulaiAt: SEKARANG.toISOString() }), // air
  ];
  const keadaan = keadaanPabrik(denah, daftar, [], SEKARANG);
  assert.equal(keadaan[0].tahap, "jadi"); // tahap rek tetap dari isian tertua
  const r = ringkasStok(denah, keadaan, SEKARANG);
  assert.equal(r.matang, 34);
  assert.equal(r.air, 2);
  assert.equal(r.proses, 0);
});

test("validasi koreksi muatan", () => {
  assert.equal(validasiKoreksiMuatan(34, [armada("1", 20), armada("2", 14)]), null);
  assert.match(validasiKoreksiMuatan(34, [armada("1", 20), armada("2", 13)]) ?? "", /34 can/);
  assert.match(validasiKoreksiMuatan(34, [armada("1", 20), armada("1", 14)]) ?? "", /dua kali/);
  assert.match(validasiKoreksiMuatan(34, [armada("1", 34), armada("2", 0)]) ?? "", /lebih dari 0/);
  assert.match(validasiKoreksiMuatan(34, []) ?? "", /minimal satu/);
  assert.match(validasiKoreksiMuatan(0, []) ?? "", /tidak memuat/);
  const pembeli: MuatanInput = { jenis: "pembeli", kendaraanErpId: null, plat: " ", agenId: null, agenNama: null, jumlah: 34 };
  assert.match(validasiKoreksiMuatan(34, [pembeli]) ?? "", /Plat/);
});

test("adalahAmbilSendiri", () => {
  assert.equal(adalahAmbilSendiri("Ambil Sendiri"), true);
  assert.equal(adalahAmbilSendiri("  ambil   SENDIRI "), true);
  assert.equal(adalahAmbilSendiri("S 9805 UH"), false);
  assert.equal(adalahAmbilSendiri(null), false);
  assert.equal(adalahAmbilSendiri("Ambil Sendiri 2"), false);
});

test("cocokkan harian: DO Ambil Sendiri dicocokkan dengan kendaraan pembeli", () => {
  const p = (id: string, plat: string, kecil: number, besar: number) => ({ kendaraanErpId: id, plat, kecil, besar, jumlahPanen: 1, operator: [] });
  const d = (id: string, plat: string, kecil: number, besar: number) => ({ kendaraanErpId: id, plat, kecil, besar, noDo: [`DO-${id}`] });
  const { baris, pembeli } = cocokkanHarian(
    [p("1", "S 1", 10, 0)],
    [{ kecil: 5, besar: 2 }, { kecil: 3, besar: 0 }],
    [d("1", "S 1", 10, 0), d("AS", "Ambil Sendiri", 8, 1)],
  );
  assert.deepEqual(baris.map((b) => b.kendaraanErpId), ["1"]);
  assert.equal(baris[0].status, "cocok");
  assert.equal(pembeli.panenKecil, 8);
  assert.equal(pembeli.panenBesar, 2);
  assert.equal(pembeli.doKecil, 8);
  assert.equal(pembeli.doBesar, 1);
  assert.equal(pembeli.selisihKecil, 0);
  assert.equal(pembeli.selisihBesar, 1);
  assert.equal(pembeli.cocok, false);
  assert.deepEqual(pembeli.noDo, ["DO-AS"]);

  // Peringatan: satu SELISIH_MUATAN untuk kendaraan pembeli, bukan untuk "Ambil Sendiri" sebagai armada.
  const hasil = peringatanDari({
    keadaan: [],
    kosongSejak: {},
    panenBelumSiap: [],
    selisih: baris,
    selisihPembeli: pembeli,
    sekarang: SEKARANG,
    label: () => "x",
  });
  const selisih = hasil.filter((x) => x.kode === "SELISIH_MUATAN");
  assert.equal(selisih.length, 1);
  assert.match(selisih[0].pesan, /Kendaraan pembeli/);

  // Cocok → tanpa peringatan; tanpa pembeli & tanpa DO Ambil Sendiri juga cocok.
  const kosong = cocokkanHarian([], [], [d("1", "S 1", 4, 0)]);
  assert.equal(kosong.pembeli.cocok, true);
  assert.equal(kosong.baris[0].status, "hanya-do");
  assert.equal(
    peringatanDari({ keadaan: [], kosongSejak: {}, panenBelumSiap: [], selisih: [], selisihPembeli: kosong.pembeli, sekarang: SEKARANG, label: () => "x" }).length,
    0,
  );
});

test("label batal panen: Tandai Babonan memakai aturan server", () => {
  // Log baru (persen + jenisIsian dicatat).
  assert.equal(batalAdalahTandaiBabonan({ dimuat: 0, keBabonan: 3, pecah: 0, persen: null, jenisIsian: "produksi" }), true);
  // Panen sungguhan seluruhnya ke Babonan/pecah (persen terisi) bukan Tandai Babonan.
  assert.equal(batalAdalahTandaiBabonan({ dimuat: 0, keBabonan: 30, pecah: 6, persen: 100, jenisIsian: "produksi" }), false);
  assert.equal(batalAdalahTandaiBabonan({ dimuat: 0, keBabonan: 0, pecah: 0, persen: null, jenisIsian: "babonan" }), false);
  assert.equal(batalAdalahTandaiBabonan({ dimuat: 5, keBabonan: 0, pecah: 0, persen: null, jenisIsian: "babonan" }), false);
  // Log lama: heuristik lama.
  assert.equal(batalAdalahTandaiBabonan({ dimuat: 0, keBabonan: 3, pecah: 0 }), true);
  assert.equal(batalAdalahTandaiBabonan({ dimuat: 4, keBabonan: 3, pecah: 0 }), false);
  assert.equal(batalAdalahTandaiBabonan(null), false);
});
