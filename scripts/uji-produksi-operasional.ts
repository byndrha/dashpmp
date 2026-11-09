// Uji integrasi transaksi aksi Produksi Es Balok — Operasional
// (src/lib/queries/produksi-operasional.ts) terhadap Postgres direktori.
//
// HANYA memakai perusahaan_kode uji (KODE_UJI, bawaan 'uji-operasional-2';
// wajib berawalan 'uji-'). before()/after() menghapus setiap baris kode uji
// itu dari semua tabel produksi_* (anak dulu, lalu
// induk). Kode perusahaan lain tidak pernah disentuh.
//
// Usage: npx tsx --test scripts/uji-produksi-operasional.ts
import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { getPgPool } from "../src/lib/pg";
import { buatBak, buatKolom, denahKosong, type DenahDokumen } from "../src/lib/produksi-denah";
import { keadaanPabrik, PESAN_SLOT_BELUM_SIAP, tanggalBisnisPanen, type MuatanInput } from "../src/lib/produksi-operasional";
import { GalatSimpanDenah, getDenahUntukKode, getKolomIsiIdsUntukKode, getKolomTerkunciUntukKode, simpanDenahUntukKode } from "../src/lib/queries/produksi-denah";
import {
  batalkanPanen,
  buangBabonan,
  GalatAksiProduksi,
  getDataPabrik,
  getKendaraanAktif,
  getLog,
  getMuatanHarian,
  getRiwayatOperator,
  isiAir,
  koreksiIsian,
  koreksiMuatan,
  mulaiMaintenance,
  panen,
  perbaikiRusak,
  selesaiMaintenance,
  setKendaraanAktif,
  tandaiBabonan,
  tandaiRusak,
  type KodeGalatProduksi,
  type Pelaku,
} from "../src/lib/queries/produksi-operasional";

// Bisa diganti lewat env KODE_UJI (mis. bila sesi yatim masih mengunci baris
// kode uji lama). Selalu berawalan "uji-" agar tidak pernah menyentuh pabrik nyata.
const KODE = process.env.KODE_UJI ?? "uji-operasional-2";
if (!KODE.startsWith("uji-")) throw new Error(`KODE_UJI harus berawalan "uji-" (sekarang ${KODE}).`);
const operator: Pelaku = { akunId: "uji-1", nama: "Uji", peran: "operator" };
const admin: Pelaku = { akunId: "uji-admin", nama: "Uji Admin", peran: "admin" };

const armadaA: MuatanInput = { jenis: "armada", kendaraanErpId: "uji-armada-a", plat: "S 1111 UJ", agenId: null, agenNama: null, jumlah: 0 };
const armadaB: MuatanInput = { jenis: "armada", kendaraanErpId: "uji-armada-b", plat: "S 2222 UJ", agenId: null, agenNama: null, jumlah: 0 };
const muat = (k: MuatanInput, jumlah: number): MuatanInput => ({ ...k, jumlah });
const rentang = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const tanpa = (daftar: number[], buang: number[]) => daftar.filter((s) => !buang.includes(s));

let kolom1 = "";
let kolom2 = "";
let kolom3 = "";
let kolom4 = "";
let kolom5 = "";
let kolom6 = "";
let kolom7 = "";
let bakId = "";
let panenBabonanId = "";
let panenPertamaId = "";

const pg = () => getPgPool();

async function bersihkan() {
  const c = pg();
  await c.query(
    `DELETE FROM produksi_muatan WHERE panen_id IN (SELECT id FROM produksi_panen WHERE perusahaan_kode = $1)`,
    [KODE],
  );
  await c.query(`DELETE FROM produksi_panen WHERE perusahaan_kode = $1`, [KODE]);
  await c.query(
    `DELETE FROM produksi_babonan_keluar WHERE isian_id IN (SELECT id FROM produksi_kolom_isi WHERE perusahaan_kode = $1)`,
    [KODE],
  );
  await c.query(`DELETE FROM produksi_kolom_isi WHERE perusahaan_kode = $1`, [KODE]);
  await c.query(`DELETE FROM produksi_maintenance WHERE perusahaan_kode = $1`, [KODE]);
  await c.query(`DELETE FROM produksi_slot_rusak WHERE perusahaan_kode = $1`, [KODE]);
  await c.query(`DELETE FROM produksi_kendaraan_aktif WHERE perusahaan_kode = $1`, [KODE]);
  await c.query(`DELETE FROM produksi_log WHERE perusahaan_kode = $1`, [KODE]);
  await c.query(`DELETE FROM produksi_denah WHERE perusahaan_kode = $1`, [KODE]);
}

async function mundurkan(isianId: string, jam: number) {
  await pg().query(
    `UPDATE produksi_kolom_isi SET mulai_at = mulai_at - make_interval(hours => $2)
      WHERE id = $1 AND perusahaan_kode = $3`,
    [isianId, jam, KODE],
  );
}

type BarisIsian = {
  id: string;
  jenis: string;
  sisa: number;
  jumlah_awal: number;
  pecah: number;
  selesai_at: Date | null;
  slot: number[];
  slot_pecah: number[];
};

async function isianKolom(kolomId: string, aktif = true): Promise<BarisIsian[]> {
  const { rows } = await pg().query<BarisIsian>(
    `SELECT id::text, jenis, sisa, jumlah_awal, pecah, selesai_at, slot, slot_pecah FROM produksi_kolom_isi
      WHERE perusahaan_kode = $1 AND kolom_id = $2 ${aktif ? "AND selesai_at IS NULL" : ""} ORDER BY id`,
    [KODE, kolomId],
  );
  return rows;
}

async function rusakAktif(kolomId: string): Promise<number[]> {
  const { rows } = await pg().query<{ slot: number }>(
    `SELECT slot FROM produksi_slot_rusak WHERE perusahaan_kode = $1 AND kolom_id = $2 AND selesai_at IS NULL ORDER BY slot`,
    [KODE, kolomId],
  );
  return rows.map((r) => r.slot);
}

async function panenBaris(panenId: string) {
  const { rows } = await pg().query<{
    dimuat: number;
    ke_babonan: number;
    pecah: number;
    slot_dimuat: number[];
    slot_babonan: number[];
    slot_pecah: number[];
    dibatalkan_at: Date | null;
  }>(
    `SELECT dimuat, ke_babonan, pecah, slot_dimuat, slot_babonan, slot_pecah, dibatalkan_at FROM produksi_panen WHERE id = $1`,
    [panenId],
  );
  return rows[0];
}

const jendelaLog = () => ({ dari: new Date(Date.now() - 600_000).toISOString(), sampai: new Date(Date.now() + 60_000).toISOString() });

async function jumlahLog(): Promise<number> {
  const { rows } = await pg().query<{ n: string }>(`SELECT count(*) AS n FROM produksi_log WHERE perusahaan_kode = $1`, [KODE]);
  return Number(rows[0].n);
}

async function harapGalat(p: Promise<unknown>, kode: KodeGalatProduksi | KodeGalatProduksi[]) {
  const daftar = Array.isArray(kode) ? kode : [kode];
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof GalatAksiProduksi, `bukan GalatAksiProduksi: ${String(err)}`);
    assert.ok(daftar.includes(err.kodeGalat), `kodeGalat ${err.kodeGalat}, diharapkan ${daftar.join("/")}`);
    return true;
  });
}

before(async () => {
  await bersihkan();
  const kolom = buatKolom(7, { varian: "kecil", jumlahIceCan: 36 });
  kolom[2] = { ...kolom[2], nonaktif: true };
  [kolom1, kolom2, kolom3, kolom4, kolom5, kolom6, kolom7] = kolom.map((k) => k.id);
  const bak = buatBak(1, 1, { nama: "BAK UJI", kolom, durasiBekuJam: { kecil: 24, besar: 32 } });
  bakId = bak.id;
  const denah: DenahDokumen = { ...denahKosong(), elemen: [bak] };
  await pg().query(
    `INSERT INTO produksi_denah (perusahaan_kode, versi, data, updated_by, updated_at) VALUES ($1, 1, $2::jsonb, 'uji', now())`,
    [KODE, JSON.stringify(denah)],
  );
});

after(async () => {
  try {
    await bersihkan();
    const { rows } = await pg().query<{ t: string; n: string }>(
      `SELECT 'kolom_isi' AS t, count(*) AS n FROM produksi_kolom_isi WHERE perusahaan_kode = $1
       UNION ALL SELECT 'panen', count(*) FROM produksi_panen WHERE perusahaan_kode = $1
       UNION ALL SELECT 'maintenance', count(*) FROM produksi_maintenance WHERE perusahaan_kode = $1
       UNION ALL SELECT 'slot_rusak', count(*) FROM produksi_slot_rusak WHERE perusahaan_kode = $1
       UNION ALL SELECT 'kendaraan_aktif', count(*) FROM produksi_kendaraan_aktif WHERE perusahaan_kode = $1
       UNION ALL SELECT 'log', count(*) FROM produksi_log WHERE perusahaan_kode = $1
       UNION ALL SELECT 'denah', count(*) FROM produksi_denah WHERE perusahaan_kode = $1`,
      [KODE],
    );
    console.log(`sisa baris '${KODE}' setelah bersih: ${rows.map((r) => `${r.t}=${r.n}`).join(", ")}`);
  } finally {
    await pg().end();
  }
});

test("isi air lalu panen dengan babonan dan isi ulang", async () => {
  const logAwal = await jumlahLog();
  const { isianId } = await isiAir(KODE, kolom1, null, operator);
  const [awal] = await isianKolom(kolom1);
  assert.equal(awal.id, isianId);
  assert.equal(awal.jumlah_awal, 36);
  assert.equal(awal.sisa, 36);
  assert.deepEqual(awal.slot, rentang(1, 36));

  await mundurkan(isianId, 25);
  const hasil = await panen(
    KODE,
    { isianId, muatan: [muat(armadaA, 20), muat(armadaB, 14)], slotBabonan: [35, 36], slotPecah: [], isiUlang: true, konfirmasiBelumSiap: false },
    operator,
  );
  assert.ok(hasil.isianBaruId);
  panenPertamaId = hasil.panenId;

  const semua = await isianKolom(kolom1, false);
  const lama = semua.find((r) => r.id === isianId)!;
  assert.ok(lama.selesai_at, "isian lama harus selesai");
  assert.equal(lama.sisa, 0);
  assert.deepEqual(lama.slot, []);
  const aktif = await isianKolom(kolom1);
  const babonan = aktif.find((r) => r.jenis === "babonan")!;
  assert.equal(babonan.sisa, 2);
  assert.deepEqual(babonan.slot, [35, 36]);
  const baru = aktif.find((r) => r.jenis === "produksi")!;
  assert.equal(baru.id, hasil.isianBaruId);
  assert.equal(baru.sisa, 34);
  assert.deepEqual(baru.slot, rentang(1, 34));
  const pn = await panenBaris(hasil.panenId);
  assert.deepEqual(pn.slot_dimuat, rentang(1, 34));
  assert.deepEqual(pn.slot_babonan, [35, 36]);
  assert.deepEqual(pn.slot_pecah, []);
  assert.equal(pn.dimuat, 34);
  assert.equal(pn.ke_babonan, 2);

  const muatan = await pg().query(`SELECT jumlah FROM produksi_muatan WHERE panen_id = $1`, [hasil.panenId]);
  assert.equal(muatan.rowCount, 2);

  const harian = await getMuatanHarian(KODE, tanggalBisnisPanen(new Date()));
  const a = harian.armada.find((m) => m.kendaraanErpId === armadaA.kendaraanErpId)!;
  const b = harian.armada.find((m) => m.kendaraanErpId === armadaB.kendaraanErpId)!;
  assert.equal(a.kecil, 20);
  assert.equal(a.besar, 0);
  assert.equal(b.kecil, 14);
  assert.equal(a.jumlahPanen, 1);
  assert.deepEqual(a.operator, ["Uji"]);
  assert.equal(harian.ringkasan.dimuat, 34);
  assert.equal(harian.ringkasan.keBabonan, 2);

  assert.equal(await jumlahLog(), logAwal + 2);
  const log = await getLog(KODE, { dari: new Date(Date.now() - 3_600_000).toISOString(), sampai: new Date(Date.now() + 60_000).toISOString() }, 10);
  assert.deepEqual(log.slice(0, 2).map((l) => l.aksi), ["panen", "isi_air"]);
  assert.equal(log[0].bakNama, "BAK UJI");
  assert.equal(log[0].kolomNomor, 1);
  assert.equal(log[0].akunNama, "Uji");
  assert.deepEqual((log[0].sebelum as { slot: number[] }).slot, rentang(1, 36));
  assert.deepEqual((log[0].sesudah as { slotBabonan: number[] }).slotBabonan, [35, 36]);
  assert.deepEqual((log[1].sesudah as { slot: number[] }).slot, rentang(1, 36));

  const data = await getDataPabrik(KODE);
  assert.ok(data.denah);
  const isianK1 = data.isian.filter((i) => i.kolomId === kolom1);
  assert.equal(isianK1.length, 2);
  assert.ok(isianK1.every((i) => i.diisiOlehNama === "Uji"));
  assert.deepEqual(isianK1.find((i) => i.jenis === "babonan")!.slot, [35, 36]);
  assert.deepEqual(isianK1.find((i) => i.jenis === "babonan")!.slotPecah, []);
  assert.deepEqual(data.rusak, []);
});

test("panen ganda ditolak", async () => {
  const [produksi] = (await isianKolom(kolom1)).filter((r) => r.jenis === "produksi");
  await mundurkan(produksi.id, 25);
  const input = { isianId: produksi.id, muatan: [muat(armadaA, 34)], slotBabonan: [], slotPecah: [], isiUlang: false, konfirmasiBelumSiap: false };
  const hasil = await Promise.allSettled([panen(KODE, input, operator), panen(KODE, input, operator)]);
  const sukses = hasil.filter((h) => h.status === "fulfilled");
  const gagal = hasil.filter((h): h is PromiseRejectedResult => h.status === "rejected");
  assert.equal(sukses.length, 1);
  assert.equal(gagal.length, 1);
  const err = gagal[0].reason;
  assert.ok(err instanceof GalatAksiProduksi, String(err));
  assert.ok(["KEADAAN_BERUBAH", "VALIDASI"].includes(err.kodeGalat));
  assert.match(err.message, /Uji/);
});

test("babonan mengunci kolom denah", async () => {
  const aktif = await isianKolom(kolom1);
  assert.deepEqual(aktif.map((r) => r.jenis), ["babonan"]);
  const ids = await getKolomIsiIdsUntukKode(KODE);
  assert.ok(ids.has(kolom1));
});

test("panen belum siap butuh konfirmasi", async () => {
  const { isianId } = await isiAir(KODE, kolom2, null, operator);
  await mundurkan(isianId, 2);
  const input = { isianId, muatan: [muat(armadaB, 36)], slotBabonan: [], slotPecah: [], isiUlang: false, konfirmasiBelumSiap: false };
  await harapGalat(panen(KODE, input, operator), "BELUM_SIAP");
  const { panenId } = await panen(KODE, { ...input, konfirmasiBelumSiap: true }, operator);
  const { rows } = await pg().query<{ persen_saat_panen: number }>(`SELECT persen_saat_panen FROM produksi_panen WHERE id = $1`, [panenId]);
  assert.ok(rows[0].persen_saat_panen < 75);
  const data = await getDataPabrik(KODE);
  assert.ok(data.panenBelumSiap.some((p) => p.kolomId === kolom2 && p.persen < 75));
  assert.ok(data.kosongSejak[kolom2], "kolom 2 kosong harus punya kosongSejak");
});

test("isi air ditolak untuk kolom nonaktif atau hilang", async () => {
  await harapGalat(isiAir(KODE, kolom3, null, operator), "KOLOM_TIDAK_SAH");
  await harapGalat(isiAir(KODE, crypto.randomUUID(), null, operator), "KOLOM_TIDAK_SAH");
});

test("isi air menolak slot di luar slot kosong", async () => {
  // kolom1 berisi Babonan [35, 36] → slot kosong 1..34.
  await harapGalat(isiAir(KODE, kolom1, [35], operator), "KEADAAN_BERUBAH");
  await harapGalat(isiAir(KODE, kolom1, [34, 36], operator), "KEADAAN_BERUBAH");
  await harapGalat(isiAir(KODE, kolom1, [37], operator), "VALIDASI");
  await harapGalat(isiAir(KODE, kolom1, [0], operator), "VALIDASI");
  await harapGalat(isiAir(KODE, kolom1, [1, 1], operator), "VALIDASI");
  await harapGalat(isiAir(KODE, kolom1, [1.5], operator), "VALIDASI");
  await harapGalat(isiAir(KODE, kolom1, [], operator), "VALIDASI");
  assert.deepEqual((await isianKolom(kolom1)).map((r) => r.jenis), ["babonan"]);
  // Rek terisi sebagian dengan slot kosong tetap punya kosongSejak (urutan tugas isi air).
  const data = await getDataPabrik(KODE);
  assert.ok(data.kosongSejak[kolom1], "rek sebagian kosong harus punya kosongSejak");
});

test("maintenance", async () => {
  const { isianId } = await isiAir(KODE, kolom2, null, operator);
  await harapGalat(mulaiMaintenance(KODE, kolom2, "ganti seal", operator), "VALIDASI");
  await mundurkan(isianId, 25);
  const { isianBaruId } = await panen(
    KODE,
    { isianId, muatan: [muat(armadaB, 36)], slotBabonan: [], slotPecah: [], isiUlang: false, konfirmasiBelumSiap: false },
    operator,
  );
  assert.equal(isianBaruId, null);
  await mulaiMaintenance(KODE, kolom2, "ganti seal", operator);
  await harapGalat(isiAir(KODE, kolom2, null, operator), "VALIDASI");

  // Maintenance terbuka mengunci kolom denah seperti isian aktif (kolom2 kini tanpa isian).
  assert.equal((await getKolomIsiIdsUntukKode(KODE)).has(kolom2), false);
  assert.ok((await getKolomTerkunciUntukKode(KODE)).has(kolom2));
  const tersimpan = await getDenahUntukKode(KODE);
  assert.ok(tersimpan && !tersimpan.rusak);
  const ubahan: DenahDokumen = structuredClone(tersimpan.data);
  for (const e of ubahan.elemen) {
    if (e.tipe !== "bak") continue;
    e.kolom = e.kolom.map((k) => (k.id === kolom2 ? { ...k, jumlahIceCan: 30 } : k));
  }
  await assert.rejects(simpanDenahUntukKode(KODE, ubahan, tersimpan.versi, "uji"), (err: unknown) => {
    assert.ok(err instanceof GalatSimpanDenah, String(err));
    assert.equal(err.kodeGalat, "KOLOM_TERKUNCI");
    return true;
  });
  assert.equal((await getDenahUntukKode(KODE))?.versi, tersimpan.versi);

  const data = await getDataPabrik(KODE);
  assert.ok(data.maintenance.some((m) => m.kolomId === kolom2 && m.dibukaOlehNama === "Uji" && m.catatan === "ganti seal"));
  assert.equal(data.kosongSejak[kolom2], undefined);
  await selesaiMaintenance(KODE, kolom2, operator);
  await harapGalat(selesaiMaintenance(KODE, kolom2, operator), "KEADAAN_BERUBAH");
  const isi = await isiAir(KODE, kolom2, null, operator);
  assert.ok(isi.isianId);
  assert.deepEqual((await isianKolom(kolom2))[0].slot, rentang(1, 36));
});

test("koreksi dan batal hanya admin", async () => {
  const [produksi] = await isianKolom(kolom2);
  await harapGalat(koreksiIsian(KODE, produksi.id, { slot: rentang(1, 30) }, "salah hitung", operator), "VALIDASI");
  await harapGalat(koreksiIsian(KODE, produksi.id, { slot: rentang(1, 30) }, "  ", admin), "VALIDASI");
  await harapGalat(koreksiIsian(KODE, produksi.id, { slot: [1, 37] }, "salah hitung", admin), "KAPASITAS");
  await harapGalat(koreksiIsian(KODE, produksi.id, { slot: [1, 1] }, "salah hitung", admin), "VALIDASI");
  await koreksiIsian(KODE, produksi.id, { slot: rentang(1, 30) }, "salah hitung", admin);
  const [sesudah] = await isianKolom(kolom2);
  assert.equal(sesudah.sisa, 30);
  assert.equal(sesudah.jumlah_awal, 30);
  assert.deepEqual(sesudah.slot, rentang(1, 30));
  const [logKoreksi] = await getLog(KODE, { dari: new Date(Date.now() - 600_000).toISOString(), sampai: new Date(Date.now() + 60_000).toISOString(), aksi: "koreksi_isian" }, 5);
  assert.equal(logKoreksi.alasan, "salah hitung");
  assert.equal(logKoreksi.peran, "admin");
  assert.equal((logKoreksi.sebelum as { sisa: number }).sisa, 36);
  assert.equal((logKoreksi.sesudah as { sisa: number }).sisa, 30);
  assert.deepEqual((logKoreksi.sesudah as { slot: number[] }).slot, rentang(1, 30));

  // Panen slot 35 dari Babonan kolom1, lalu dibatalkan → slot Babonan kembali [35, 36].
  const [babonan] = await isianKolom(kolom1);
  const { panenId } = await panen(
    KODE,
    { isianId: babonan.id, muatan: [muat(armadaA, 1)], slotBabonan: [], slotPecah: [], slotDimuat: [35], isiUlang: false, konfirmasiBelumSiap: false },
    operator,
  );
  panenBabonanId = panenId;
  assert.equal((await isianKolom(kolom1))[0].sisa, 1);
  assert.deepEqual((await isianKolom(kolom1))[0].slot, [36]);
  assert.deepEqual((await panenBaris(panenId)).slot_dimuat, [35]);
  await harapGalat(batalkanPanen(KODE, panenId, "salah kendaraan", operator), "VALIDASI");
  await harapGalat(batalkanPanen(KODE, panenId, "", admin), "VALIDASI");
  await batalkanPanen(KODE, panenId, "salah kendaraan", admin);
  assert.equal((await isianKolom(kolom1))[0].sisa, 2);
  assert.deepEqual((await isianKolom(kolom1))[0].slot, [35, 36]);
  await harapGalat(batalkanPanen(KODE, panenId, "lagi", admin), "KEADAAN_BERUBAH");
  const { rows } = await pg().query<{ dibatalkan_at: Date | null; alasan_batal: string }>(
    `SELECT dibatalkan_at, alasan_batal FROM produksi_panen WHERE id = $1`,
    [panenBabonanId],
  );
  assert.ok(rows[0].dibatalkan_at);
  assert.equal(rows[0].alasan_batal, "salah kendaraan");
  const [logBatal] = await getLog(KODE, { dari: new Date(Date.now() - 600_000).toISOString(), sampai: new Date(Date.now() + 60_000).toISOString(), aksi: "batal_panen" }, 5);
  assert.ok(logBatal.sebelum && logBatal.sesudah);
});

test("tandai babonan, buang babonan, dan ringkasan harian", async () => {
  const [produksi] = await isianKolom(kolom2);
  await tandaiBabonan(KODE, produksi.id, [28, 29, 30], operator);
  const aktif = await isianKolom(kolom2);
  assert.equal(aktif.find((r) => r.jenis === "produksi")!.sisa, 27);
  assert.deepEqual(aktif.find((r) => r.jenis === "produksi")!.slot, rentang(1, 27));
  assert.equal(aktif.find((r) => r.jenis === "babonan")!.sisa, 3);
  assert.deepEqual(aktif.find((r) => r.jenis === "babonan")!.slot, [28, 29, 30]);
  await harapGalat(tandaiBabonan(KODE, produksi.id, [30], operator), "KEADAAN_BERUBAH");
  await harapGalat(tandaiBabonan(KODE, produksi.id, [], operator), "VALIDASI");
  await harapGalat(buangBabonan(KODE, kolom2, [1], "leleh", operator), "KEADAAN_BERUBAH");
  await harapGalat(buangBabonan(KODE, kolom2, [30, 30], "leleh", operator), "VALIDASI");
  await buangBabonan(KODE, kolom2, [30], "leleh", operator);
  const bab2 = (await isianKolom(kolom2)).find((r) => r.jenis === "babonan")!;
  assert.equal(bab2.sisa, 2);
  assert.deepEqual(bab2.slot, [28, 29]);
  const harian = await getMuatanHarian(KODE, tanggalBisnisPanen(new Date()));
  assert.equal(harian.ringkasan.babonanDibuang, 1);
  // Panen Babonan yang dibatalkan tidak ikut dihitung.
  assert.equal(harian.armada.find((m) => m.kendaraanErpId === armadaA.kendaraanErpId)!.kecil, 20 + 34);
});

test("kendaraan aktif per akun", async () => {
  assert.equal(await getKendaraanAktif(operator.akunId, KODE), null);
  await setKendaraanAktif(operator.akunId, KODE, { jenis: "pembeli", kendaraanErpId: null, plat: "L 9 UJ", agenId: null, agenNama: "Agen Uji" });
  const k = await getKendaraanAktif(operator.akunId, KODE);
  assert.equal(k?.plat, "L 9 UJ");
  assert.equal(k?.agenNama, "Agen Uji");
  assert.equal(await getKendaraanAktif(operator.akunId, "kode-lain-uji"), null);
  // Upsert per (akun_id, perusahaan_kode): set ulang menimpa baris yang sama.
  await setKendaraanAktif(operator.akunId, KODE, { jenis: "armada", kendaraanErpId: "uji-armada-a", plat: "S 1111 UJ", agenId: null, agenNama: null });
  const k2 = await getKendaraanAktif(operator.akunId, KODE);
  assert.equal(k2?.jenis, "armada");
  assert.equal(k2?.kendaraanErpId, "uji-armada-a");
  const { rows: nKa } = await pg().query<{ n: string }>(
    `SELECT count(*) AS n FROM produksi_kendaraan_aktif WHERE akun_id = $1 AND perusahaan_kode = $2`,
    [operator.akunId, KODE],
  );
  assert.equal(Number(nKa[0].n), 1);
  const riwayat = await getRiwayatOperator(KODE, operator.akunId, new Date(Date.now() - 3_600_000).toISOString());
  assert.ok(riwayat.length > 0 && riwayat.every((r) => r.akunNama === "Uji"));
});

test("koreksi kendaraan muatan (admin)", async () => {
  const baru = [muat(armadaB, 34)];
  await harapGalat(koreksiMuatan(KODE, panenPertamaId, baru, "salah kendaraan", operator), "VALIDASI");
  await harapGalat(koreksiMuatan(KODE, panenPertamaId, baru, " ", admin), "VALIDASI");
  // Σ muatan harus = dimuat (34), kendaraan unik, jumlah > 0.
  await harapGalat(koreksiMuatan(KODE, panenPertamaId, [muat(armadaB, 33)], "salah kendaraan", admin), "VALIDASI");
  await harapGalat(koreksiMuatan(KODE, panenPertamaId, [muat(armadaB, 20), muat(armadaB, 14)], "salah kendaraan", admin), "VALIDASI");
  await harapGalat(koreksiMuatan(KODE, panenPertamaId, [muat(armadaB, 34), muat(armadaA, 0)], "salah kendaraan", admin), "VALIDASI");
  // Scope perusahaan: panen pabrik lain tidak ditemukan.
  await harapGalat(koreksiMuatan("kode-lain-uji", panenPertamaId, baru, "salah kendaraan", admin), "TIDAK_DITEMUKAN");
  // Panen yang sudah dibatalkan tidak bisa dikoreksi.
  await harapGalat(koreksiMuatan(KODE, panenBabonanId, [muat(armadaB, 1)], "salah kendaraan", admin), "KEADAAN_BERUBAH");

  const sebelum = await getMuatanHarian(KODE, tanggalBisnisPanen(new Date()));
  const aSebelum = sebelum.armada.find((m) => m.kendaraanErpId === armadaA.kendaraanErpId)!.kecil;
  const bSebelum = sebelum.armada.find((m) => m.kendaraanErpId === armadaB.kendaraanErpId)!.kecil;
  const { rows: panenSebelum } = await pg().query(`SELECT dimuat, ke_babonan, pecah, isian_id FROM produksi_panen WHERE id = $1`, [panenPertamaId]);

  await koreksiMuatan(KODE, panenPertamaId, baru, "salah kendaraan", admin);

  const { rows: muatanBaru } = await pg().query<{ kendaraan_erp_id: string; jumlah: number }>(
    `SELECT kendaraan_erp_id, jumlah FROM produksi_muatan WHERE panen_id = $1 ORDER BY id`,
    [panenPertamaId],
  );
  assert.deepEqual(muatanBaru, [{ kendaraan_erp_id: armadaB.kendaraanErpId, jumlah: 34 }]);
  const { rows: panenSesudah } = await pg().query(`SELECT dimuat, ke_babonan, pecah, isian_id FROM produksi_panen WHERE id = $1`, [panenPertamaId]);
  assert.deepEqual(panenSesudah, panenSebelum, "panen (dimuat, babonan, isian) tidak berubah");

  const sesudah = await getMuatanHarian(KODE, tanggalBisnisPanen(new Date()));
  assert.equal(sesudah.armada.find((m) => m.kendaraanErpId === armadaA.kendaraanErpId)!.kecil, aSebelum - 20);
  assert.equal(sesudah.armada.find((m) => m.kendaraanErpId === armadaB.kendaraanErpId)!.kecil, bSebelum + 20);
  assert.equal(sesudah.ringkasan.dimuat, sebelum.ringkasan.dimuat);

  const [logK] = await getLog(
    KODE,
    { dari: new Date(Date.now() - 600_000).toISOString(), sampai: new Date(Date.now() + 60_000).toISOString(), aksi: "koreksi_muatan" },
    5,
  );
  assert.equal(logK.alasan, "salah kendaraan");
  assert.equal(logK.peran, "admin");
  assert.equal(logK.bakNama, "BAK UJI");
  const sbl = logK.sebelum as { dimuat: number; muatan: { kendaraanErpId: string; jumlah: number }[] };
  const ssd = logK.sesudah as { dimuat: number; muatan: { kendaraanErpId: string; jumlah: number }[] };
  assert.equal(sbl.dimuat, 34);
  assert.deepEqual(sbl.muatan.map((m) => [m.kendaraanErpId, m.jumlah]), [[armadaA.kendaraanErpId, 20], [armadaB.kendaraanErpId, 14]]);
  assert.deepEqual(ssd.muatan.map((m) => [m.kendaraanErpId, m.jumlah]), [[armadaB.kendaraanErpId, 34]]);

  // Log batal_panen kini mencatat persen + jenisIsian (label Tandai Babonan di layar log).
  const [logBatal] = await getLog(
    KODE,
    { dari: new Date(Date.now() - 600_000).toISOString(), sampai: new Date(Date.now() + 60_000).toISOString(), aksi: "batal_panen" },
    5,
  );
  const sb = logBatal.sebelum as Record<string, unknown>;
  assert.ok("persen" in sb);
  assert.equal(sb.jenisIsian, "babonan");
});

test("isi ulang melewati babonan dan rusak", async () => {
  await tandaiRusak(KODE, kolom4, [3], "retak", operator);
  assert.deepEqual(await rusakAktif(kolom4), [3]);
  const { isianId } = await isiAir(KODE, kolom4, null, operator);
  const [isi] = await isianKolom(kolom4);
  assert.equal(isi.id, isianId);
  assert.deepEqual(isi.slot, tanpa(rentang(1, 36), [3]));
  assert.equal(isi.sisa, 35);

  await mundurkan(isianId, 25);
  const { isianBaruId } = await panen(
    KODE,
    { isianId, muatan: [muat(armadaA, 33)], slotBabonan: [35, 36], slotPecah: [], isiUlang: true, konfirmasiBelumSiap: false },
    operator,
  );
  const aktif = await isianKolom(kolom4);
  const baru = aktif.find((r) => r.id === isianBaruId)!;
  assert.deepEqual(baru.slot, tanpa(rentang(1, 34), [3]));
  assert.equal(baru.sisa, 33);
  assert.deepEqual(aktif.find((r) => r.jenis === "babonan")!.slot, [35, 36]);
  assert.deepEqual(await rusakAktif(kolom4), [3]);

  const data = await getDataPabrik(KODE);
  const r = data.rusak.find((x) => x.kolomId === kolom4)!;
  assert.equal(r.slot, 3);
  assert.equal(r.catatan, "retak");
  const [logRusak] = await getLog(KODE, { ...jendelaLog(), aksi: "tandai_rusak" }, 5);
  assert.deepEqual((logRusak.sesudah as { slot: number[] }).slot, [3]);
});

test("slot basi ditolak", async () => {
  // kolom4: produksi [1,2,4..34], Babonan [35,36], rusak 3.
  const aktif = await isianKolom(kolom4);
  const prod = aktif.find((r) => r.jenis === "produksi")!;
  const bab = aktif.find((r) => r.jenis === "babonan")!;
  await mundurkan(prod.id, 25);
  const dasar = { isianId: prod.id, slotPecah: [] as number[], isiUlang: false, konfirmasiBelumSiap: false };
  await harapGalat(panen(KODE, { ...dasar, muatan: [muat(armadaA, 32)], slotBabonan: [35] }, operator), "KEADAAN_BERUBAH");
  await harapGalat(panen(KODE, { ...dasar, muatan: [muat(armadaA, 32)], slotBabonan: [], slotPecah: [3] }, operator), "KEADAAN_BERUBAH");
  await harapGalat(panen(KODE, { ...dasar, muatan: [muat(armadaA, 40)], slotBabonan: [] }, operator), "KEADAAN_BERUBAH");
  await harapGalat(panen(KODE, { ...dasar, muatan: [muat(armadaA, 10)], slotBabonan: [] }, operator), "VALIDASI");
  await harapGalat(panen(KODE, { ...dasar, muatan: [muat(armadaA, 32)], slotBabonan: [99] }, operator), "VALIDASI");
  await harapGalat(panen(KODE, { ...dasar, muatan: [muat(armadaA, 31)], slotBabonan: [1, 1] }, operator), "VALIDASI");
  await harapGalat(panen(KODE, { ...dasar, muatan: [muat(armadaA, 31)], slotBabonan: [1], slotPecah: [1] }, operator), "VALIDASI");
  await harapGalat(
    panen(
      KODE,
      { isianId: bab.id, muatan: [muat(armadaA, 1)], slotBabonan: [], slotPecah: [], slotDimuat: [1], isiUlang: false, konfirmasiBelumSiap: false },
      operator,
    ),
    "KEADAAN_BERUBAH",
  );
  const sesudah = await isianKolom(kolom4);
  assert.deepEqual(sesudah.map((r) => r.slot), aktif.map((r) => r.slot));
});

test("tandai rusak pada slot berisi ditolak", async () => {
  const aktif = await isianKolom(kolom4);
  const prod = aktif.find((r) => r.jenis === "produksi")!;
  await harapGalat(tandaiRusak(KODE, kolom4, [1], "retak", operator), "KEADAAN_BERUBAH");
  await harapGalat(tandaiRusak(KODE, kolom4, [35], "retak", operator), "KEADAAN_BERUBAH");
  await harapGalat(tandaiRusak(KODE, kolom4, [3], "retak", operator), "KEADAAN_BERUBAH");
  await harapGalat(tandaiRusak(KODE, kolom4, [37], "retak", operator), "VALIDASI");
  await harapGalat(tandaiRusak(KODE, kolom4, [], "retak", operator), "VALIDASI");
  await harapGalat(tandaiRusak(KODE, kolom3, [1], "retak", operator), "KOLOM_TIDAK_SAH");
  await harapGalat(isiAir(KODE, kolom4, [3], operator), "KEADAAN_BERUBAH");
  // Koreksi admin tidak boleh menempati slot rusak atau slot isian lain.
  await harapGalat(koreksiIsian(KODE, prod.id, { slot: [...prod.slot, 3] }, "salah hitung", admin), "KEADAAN_BERUBAH");
  await harapGalat(koreksiIsian(KODE, prod.id, { slot: [...prod.slot, 35] }, "salah hitung", admin), "KEADAAN_BERUBAH");
  assert.deepEqual(await rusakAktif(kolom4), [3]);
});

test("perbaiki rusak", async () => {
  await harapGalat(perbaikiRusak(KODE, kolom4, [5], operator), "KEADAAN_BERUBAH");
  await perbaikiRusak(KODE, kolom4, [3], operator);
  assert.deepEqual(await rusakAktif(kolom4), []);
  await harapGalat(perbaikiRusak(KODE, kolom4, [3], operator), "KEADAAN_BERUBAH");
  const { rows } = await pg().query<{ selesai_at: Date | null; ditutup_oleh_akun_id: string | null }>(
    `SELECT selesai_at, ditutup_oleh_akun_id FROM produksi_slot_rusak WHERE perusahaan_kode = $1 AND kolom_id = $2`,
    [KODE, kolom4],
  );
  assert.equal(rows.length, 1);
  assert.ok(rows[0].selesai_at);
  assert.equal(rows[0].ditutup_oleh_akun_id, operator.akunId);
  assert.equal((await getDataPabrik(KODE)).rusak.filter((r) => r.kolomId === kolom4).length, 0);
  const [logPerbaiki] = await getLog(KODE, { ...jendelaLog(), aksi: "perbaiki_rusak" }, 5);
  assert.deepEqual((logPerbaiki.sebelum as { slot: number[] }).slot, [3]);
  // Slot yang sudah diperbaiki terisi lagi oleh Isi Air.
  const { isianId } = await isiAir(KODE, kolom4, null, operator);
  assert.deepEqual((await isianKolom(kolom4)).find((r) => r.id === isianId)!.slot, [3]);
});

test("slot rusak mengunci kolom denah", async () => {
  await tandaiRusak(KODE, kolom6, [5], "bocor", operator);
  assert.equal((await getKolomIsiIdsUntukKode(KODE)).has(kolom6), false);
  assert.ok((await getKolomTerkunciUntukKode(KODE)).has(kolom6));
  const tersimpan = await getDenahUntukKode(KODE);
  assert.ok(tersimpan && !tersimpan.rusak);
  const ubahan: DenahDokumen = structuredClone(tersimpan.data);
  for (const e of ubahan.elemen) {
    if (e.tipe !== "bak") continue;
    e.kolom = e.kolom.map((k) => (k.id === kolom6 ? { ...k, jumlahIceCan: 30 } : k));
  }
  await assert.rejects(simpanDenahUntukKode(KODE, ubahan, tersimpan.versi, "uji"), (err: unknown) => {
    assert.ok(err instanceof GalatSimpanDenah, String(err));
    assert.equal(err.kodeGalat, "KOLOM_TERKUNCI");
    return true;
  });
  await perbaikiRusak(KODE, kolom6, [5], operator);
  assert.equal((await getKolomTerkunciUntukKode(KODE)).has(kolom6), false);
});

test("slot tidak ganda saat aksi bersamaan", async () => {
  const cekSatuSukses = (hasil: PromiseSettledResult<unknown>[], boleh: KodeGalatProduksi[]) => {
    assert.equal(hasil.filter((h) => h.status === "fulfilled").length, 1);
    const gagal = hasil.filter((h): h is PromiseRejectedResult => h.status === "rejected");
    assert.equal(gagal.length, 1);
    assert.ok(gagal[0].reason instanceof GalatAksiProduksi, String(gagal[0].reason));
    assert.ok(boleh.includes(gagal[0].reason.kodeGalat), gagal[0].reason.kodeGalat);
  };
  // Slot eksplisit sama dari dua operator → yang kedua basi.
  cekSatuSukses(
    await Promise.allSettled([isiAir(KODE, kolom5, rentang(1, 36), operator), isiAir(KODE, kolom5, rentang(1, 36), operator)]),
    ["KEADAAN_BERUBAH", "VALIDASI"],
  );
  // Bawaan (semua slot kosong) dari dua operator → yang kedua mendapati rek penuh.
  cekSatuSukses(
    await Promise.allSettled([isiAir(KODE, kolom6, null, operator), isiAir(KODE, kolom6, null, operator)]),
    ["KEADAAN_BERUBAH", "VALIDASI", "KAPASITAS"],
  );
  const [prod5] = await isianKolom(kolom5);
  cekSatuSukses(
    await Promise.allSettled([tandaiBabonan(KODE, prod5.id, [36], operator), tandaiBabonan(KODE, prod5.id, [36], operator)]),
    ["KEADAAN_BERUBAH", "VALIDASI"],
  );
  for (const k of [kolom5, kolom6]) {
    const semua = (await isianKolom(k)).flatMap((r) => r.slot);
    assert.equal(new Set(semua).size, semua.length, `slot ganda di ${k}`);
    assert.equal(semua.length, 36);
  }
  const a5 = await isianKolom(kolom5);
  assert.deepEqual(a5.find((r) => r.jenis === "produksi")!.slot, rentang(1, 35));
  assert.deepEqual(a5.find((r) => r.jenis === "babonan")!.slot, [36]);
});

test("batal panen mengembalikan slot", async () => {
  const dariLog = async () => (await getLog(KODE, { ...jendelaLog(), aksi: "batal_panen" }, 1))[0].sesudah as { dikembalikan: boolean };
  // 1. Batal Tandai Babonan → slot 36 kembali ke isian produksi, Babonan selesai.
  const { rows: tandai } = await pg().query<{ id: string }>(
    `SELECT id::text FROM produksi_panen WHERE perusahaan_kode = $1 AND kolom_id = $2 AND dibatalkan_at IS NULL ORDER BY id DESC LIMIT 1`,
    [KODE, kolom5],
  );
  await batalkanPanen(KODE, tandai[0].id, "salah tandai", admin);
  assert.equal((await dariLog()).dikembalikan, true);
  let aktif = await isianKolom(kolom5);
  assert.deepEqual(aktif.map((r) => r.jenis), ["produksi"]);
  assert.deepEqual(aktif[0].slot, rentang(1, 36));
  assert.equal(aktif[0].sisa, 36);

  // 2. Panen produksi dengan Babonan [36] + pecah [35], isi ulang slot dimuat.
  await mundurkan(aktif[0].id, 25);
  const { isianBaruId } = await panen(
    KODE,
    { isianId: aktif[0].id, muatan: [muat(armadaB, 34)], slotBabonan: [36], slotPecah: [35], isiUlang: true, konfirmasiBelumSiap: false },
    operator,
  );
  aktif = await isianKolom(kolom5);
  let bab = aktif.find((r) => r.jenis === "babonan")!;
  assert.deepEqual(bab.slot, [35, 36]);
  assert.deepEqual(bab.slot_pecah, [35]);
  assert.equal(bab.pecah, 1);
  assert.equal(bab.sisa, 2);
  assert.deepEqual(aktif.find((r) => r.id === isianBaruId)!.slot, rentang(1, 34));

  // 3. Es pecah tidak bisa dimuat; panen Babonan slot 36 lalu batal → kembali.
  const panenBab = (slotDimuat: number[]) =>
    panen(
      KODE,
      { isianId: bab.id, muatan: [muat(armadaB, slotDimuat.length)], slotBabonan: [], slotPecah: [], slotDimuat, isiUlang: false, konfirmasiBelumSiap: false },
      operator,
    );
  await harapGalat(panenBab([35]), "VALIDASI");
  const pb1 = await panenBab([36]);
  bab = (await isianKolom(kolom5)).find((r) => r.jenis === "babonan")!;
  assert.deepEqual(bab.slot, [35]);
  assert.deepEqual(bab.slot_pecah, [35]);
  await batalkanPanen(KODE, pb1.panenId, "salah kendaraan", admin);
  assert.equal((await dariLog()).dikembalikan, true);
  bab = (await isianKolom(kolom5)).find((r) => r.jenis === "babonan")!;
  assert.deepEqual(bab.slot, [35, 36]);
  assert.deepEqual(bab.slot_pecah, [35]);
  assert.equal(bab.sisa, 2);

  // 4. Slot dimuat sudah terisi lagi → batal hanya menandai.
  const pb2 = await panenBab([36]);
  const isi36 = await isiAir(KODE, kolom5, null, operator);
  assert.deepEqual((await isianKolom(kolom5)).find((r) => r.id === isi36.isianId)!.slot, [36]);
  await batalkanPanen(KODE, pb2.panenId, "salah kendaraan", admin);
  assert.equal((await dariLog()).dikembalikan, false);
  assert.ok((await panenBaris(pb2.panenId)).dibatalkan_at);
  bab = (await isianKolom(kolom5)).find((r) => r.jenis === "babonan")!;
  assert.deepEqual(bab.slot, [35]);

  // 5. Buang Babonan pecah → isian Babonan selesai.
  await buangBabonan(KODE, kolom5, [35], "pecah", operator);
  const semua = await isianKolom(kolom5, false);
  const babSelesai = semua.find((r) => r.id === bab.id)!;
  assert.ok(babSelesai.selesai_at);
  assert.deepEqual(babSelesai.slot, []);
  assert.deepEqual(babSelesai.slot_pecah, []);
  assert.equal(babSelesai.pecah, 0);
});

test("slot belum siap: isian aktif tanpa slot menolak aksi slot sampai dikoreksi", async () => {
  // Meniru baris sebelum backfill slot can / tulisan kontainer lama: sisa 36, slot '{}'.
  const { rows } = await pg().query<{ id: string }>(
    `INSERT INTO produksi_kolom_isi
       (perusahaan_kode, kolom_id, mulai_at, jenis, bak_id, varian, jumlah_awal, sisa, pecah, durasi_beku_jam, diisi_oleh_akun_id, slot, slot_pecah)
     VALUES ($1, $2, now() - interval '25 hours', 'produksi', $3, 'kecil', 36, 36, 0, 24, $4, '{}', '{}')
     RETURNING id::text AS id`,
    [KODE, kolom7, bakId, operator.akunId],
  );
  const isianId = rows[0].id;
  const harapBelumSiap = (p: Promise<unknown>) =>
    assert.rejects(p, (err: unknown) => {
      assert.ok(err instanceof GalatAksiProduksi, `bukan GalatAksiProduksi: ${String(err)}`);
      assert.equal(err.kodeGalat, "KEADAAN_BERUBAH");
      assert.equal(err.message, PESAN_SLOT_BELUM_SIAP);
      return true;
    });
  const logAwal = await jumlahLog();

  // Tanpa penjaga: Isi Air menimpa rek penuh, panen menutup isian dengan Σ=0.
  await harapBelumSiap(isiAir(KODE, kolom7, null, operator));
  await harapBelumSiap(isiAir(KODE, kolom7, [1], operator));
  await harapBelumSiap(
    panen(
      KODE,
      { isianId, muatan: [muat(armadaA, 36)], slotBabonan: [], slotPecah: [], isiUlang: false, konfirmasiBelumSiap: true },
      operator,
    ),
  );
  await harapBelumSiap(tandaiRusak(KODE, kolom7, [1], "bocor", operator));
  await harapBelumSiap(tandaiBabonan(KODE, isianId, [1], operator));
  const [tetap] = await isianKolom(kolom7);
  assert.equal(tetap.id, isianId);
  assert.equal(tetap.sisa, 36);
  assert.deepEqual(tetap.slot, []);
  assert.equal(await jumlahLog(), logAwal);

  // Keadaan murni menandai rek ini; tidak ada tugas isi air/panen untuknya.
  const data = await getDataPabrik(KODE);
  const rek = keadaanPabrik(data.denah!, data.isian, data.maintenance, new Date(data.sekarang), data.rusak).find((k) => k.kolomId === kolom7)!;
  assert.equal(rek.slotBelumSiap, true);
  assert.deepEqual(rek.slotKosong, []);

  // Jalur perbaikan admin tetap boleh: koreksi slot → rek kembali normal (penuh).
  await koreksiIsian(KODE, isianId, { slot: rentang(1, 36) }, "catat slot sebelum backfill", admin);
  const [diperbaiki] = await isianKolom(kolom7);
  assert.deepEqual(diperbaiki.slot, rentang(1, 36));
  assert.equal(diperbaiki.sisa, 36);
  assert.equal(diperbaiki.jumlah_awal, 36);
  await harapGalat(isiAir(KODE, kolom7, null, operator), "KAPASITAS");

  // Tutup isian uji agar rek kosong untuk uji berikutnya.
  await koreksiIsian(KODE, isianId, { slot: [] }, "bersihkan uji", admin);
  assert.equal((await isianKolom(kolom7)).length, 0);
});

test("koreksi isian: slotDiharapkan basi ditolak (dialog terbuka saat rek berubah)", async () => {
  const { isianId } = await isiAir(KODE, kolom7, null, operator);
  // Operator mengubah slot isian saat dialog admin masih terbuka.
  await tandaiBabonan(KODE, isianId, [36], operator);
  const dasarBasi = rentang(1, 36);

  // Tanpa penjaga koreksi ini lolos (hanya mengecilkan) dan mengubah data diam-diam.
  await harapGalat(koreksiIsian(KODE, isianId, { slot: rentang(1, 34), slotDiharapkan: dasarBasi }, "salah hitung", admin), "KEADAAN_BERUBAH");
  await harapGalat(koreksiIsian(KODE, isianId, { slot: rentang(1, 34), slotDiharapkan: [1, 1] }, "salah hitung", admin), "VALIDASI");
  let prod = (await isianKolom(kolom7)).find((r) => r.id === isianId)!;
  assert.deepEqual(prod.slot, rentang(1, 35));

  // slotDiharapkan sama dengan slot terkini (urutan bebas) → diterima.
  await koreksiIsian(KODE, isianId, { slot: rentang(1, 34), slotDiharapkan: [...rentang(1, 35)].reverse() }, "salah hitung", admin);
  prod = (await isianKolom(kolom7)).find((r) => r.id === isianId)!;
  assert.deepEqual(prod.slot, rentang(1, 34));
  assert.equal(prod.sisa, 34);

  // Bersihkan: tutup produksi + buang Babonan.
  await koreksiIsian(KODE, isianId, { slot: [], slotDiharapkan: rentang(1, 34) }, "bersihkan uji", admin);
  await buangBabonan(KODE, kolom7, [36], "bersihkan uji", operator);
  assert.equal((await isianKolom(kolom7)).length, 0);
});

test("invarian slot", async () => {
  const q = async (sql: string) => Number((await pg().query<{ n: string }>(sql, [KODE])).rows[0].n);
  assert.equal(await q(`SELECT count(*) AS n FROM produksi_kolom_isi WHERE perusahaan_kode = $1 AND cardinality(slot) <> sisa`), 0);
  assert.equal(
    await q(`SELECT count(*) AS n FROM produksi_kolom_isi WHERE perusahaan_kode = $1
              AND (cardinality(slot_pecah) <> pecah OR NOT slot_pecah <@ slot OR (jenis = 'produksi' AND slot_pecah <> '{}'))`),
    0,
  );
  assert.equal(
    await q(`SELECT count(*) AS n FROM (
               SELECT ki.kolom_id, s FROM produksi_kolom_isi ki, unnest(ki.slot) s
                WHERE ki.perusahaan_kode = $1 AND ki.selesai_at IS NULL
                GROUP BY ki.kolom_id, s HAVING count(*) > 1) x`),
    0,
  );
  assert.equal(
    await q(`SELECT count(*) AS n FROM produksi_kolom_isi ki, unnest(ki.slot) s
              WHERE ki.perusahaan_kode = $1 AND (s < 1 OR s > 36)`),
    0,
  );
  assert.equal(
    await q(`SELECT count(*) AS n FROM produksi_slot_rusak r
              JOIN produksi_kolom_isi ki ON ki.perusahaan_kode = r.perusahaan_kode AND ki.kolom_id = r.kolom_id
                                        AND ki.selesai_at IS NULL AND r.slot = ANY(ki.slot)
              WHERE r.perusahaan_kode = $1 AND r.selesai_at IS NULL`),
    0,
  );
  assert.equal(
    await q(`SELECT count(*) AS n FROM produksi_panen WHERE perusahaan_kode = $1
              AND (cardinality(slot_dimuat) <> dimuat OR cardinality(slot_babonan) <> ke_babonan OR cardinality(slot_pecah) <> pecah)`),
    0,
  );
});

test("invarian jumlah", async () => {
  const { rows } = await pg().query<{ id: string; jumlah_awal: number; sisa: number; keluar: string }>(
    `SELECT ki.id::text, ki.jumlah_awal, ki.sisa,
            COALESCE((SELECT sum(p.dimuat + p.ke_babonan + p.pecah) FROM produksi_panen p
                       WHERE p.isian_id = ki.id AND p.dibatalkan_at IS NULL), 0) AS keluar
       FROM produksi_kolom_isi ki
      WHERE ki.perusahaan_kode = $1 AND ki.jenis = 'produksi' AND ki.selesai_at IS NOT NULL`,
    [KODE],
  );
  assert.ok(rows.length >= 3);
  for (const r of rows) assert.equal(r.jumlah_awal, r.sisa + Number(r.keluar), `isian ${r.id}`);
  const { rows: muatanSah } = await pg().query<{ selisih: string }>(
    `SELECT count(*) AS selisih FROM produksi_panen p
      WHERE p.perusahaan_kode = $1
        AND p.dimuat <> COALESCE((SELECT sum(m.jumlah) FROM produksi_muatan m WHERE m.panen_id = p.id), 0)`,
    [KODE],
  );
  assert.equal(Number(muatanSah[0].selisih), 0);
});
