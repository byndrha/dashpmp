// Uji integrasi transaksi aksi Produksi Es Balok — Operasional
// (src/lib/queries/produksi-operasional.ts) terhadap Postgres direktori.
//
// HANYA memakai perusahaan_kode 'uji-operasional'. before()/after() menghapus
// setiap baris 'uji-operasional' dari semua tabel produksi_* (anak dulu, lalu
// induk). Kode perusahaan lain tidak pernah disentuh.
//
// Usage: npx tsx --test scripts/uji-produksi-operasional.ts
import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { getPgPool } from "../src/lib/pg";
import { buatBak, buatKolom, denahKosong, type DenahDokumen } from "../src/lib/produksi-denah";
import { tanggalBisnisPanen, type MuatanInput } from "../src/lib/produksi-operasional";
import { getKolomIsiIdsUntukKode } from "../src/lib/queries/produksi-denah";
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
  mulaiMaintenance,
  panen,
  selesaiMaintenance,
  setKendaraanAktif,
  tandaiBabonan,
  type KodeGalatProduksi,
  type Pelaku,
} from "../src/lib/queries/produksi-operasional";

const KODE = "uji-operasional";
const operator: Pelaku = { akunId: "uji-1", nama: "Uji", peran: "operator" };
const admin: Pelaku = { akunId: "uji-admin", nama: "Uji Admin", peran: "admin" };

const armadaA: MuatanInput = { jenis: "armada", kendaraanErpId: "uji-armada-a", plat: "S 1111 UJ", agenId: null, agenNama: null, jumlah: 0 };
const armadaB: MuatanInput = { jenis: "armada", kendaraanErpId: "uji-armada-b", plat: "S 2222 UJ", agenId: null, agenNama: null, jumlah: 0 };
const muat = (k: MuatanInput, jumlah: number): MuatanInput => ({ ...k, jumlah });

let kolom1 = "";
let kolom2 = "";
let kolom3 = "";
let panenBabonanId = "";

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

type BarisIsian = { id: string; jenis: string; sisa: number; jumlah_awal: number; pecah: number; selesai_at: Date | null };

async function isianKolom(kolomId: string, aktif = true): Promise<BarisIsian[]> {
  const { rows } = await pg().query<BarisIsian>(
    `SELECT id::text, jenis, sisa, jumlah_awal, pecah, selesai_at FROM produksi_kolom_isi
      WHERE perusahaan_kode = $1 AND kolom_id = $2 ${aktif ? "AND selesai_at IS NULL" : ""} ORDER BY id`,
    [KODE, kolomId],
  );
  return rows;
}

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
  const kolom = buatKolom(3, { varian: "kecil", jumlahIceCan: 36 });
  kolom[2] = { ...kolom[2], nonaktif: true };
  [kolom1, kolom2, kolom3] = kolom.map((k) => k.id);
  const bak = buatBak(1, 1, { nama: "BAK UJI", kolom, durasiBekuJam: { kecil: 24, besar: 32 } });
  const denah: DenahDokumen = { ...denahKosong(), elemen: [bak] };
  await pg().query(
    `INSERT INTO produksi_denah (perusahaan_kode, versi, data, updated_by, updated_at) VALUES ($1, 1, $2::jsonb, 'uji', now())`,
    [KODE, JSON.stringify(denah)],
  );
});

after(async () => {
  try {
    await bersihkan();
    const { rows } = await pg().query<{ n: string }>(
      `SELECT count(*) AS n FROM produksi_kolom_isi WHERE perusahaan_kode = 'uji-operasional'`,
    );
    console.log(`sisa baris produksi_kolom_isi 'uji-operasional' setelah bersih: ${rows[0].n}`);
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

  await mundurkan(isianId, 25);
  const hasil = await panen(
    KODE,
    { isianId, muatan: [muat(armadaA, 20), muat(armadaB, 14)], babonan: 2, pecah: 0, isiUlang: true, konfirmasiBelumSiap: false },
    operator,
  );
  assert.ok(hasil.isianBaruId);

  const semua = await isianKolom(kolom1, false);
  const lama = semua.find((r) => r.id === isianId)!;
  assert.ok(lama.selesai_at, "isian lama harus selesai");
  assert.equal(lama.sisa, 0);
  const aktif = await isianKolom(kolom1);
  const babonan = aktif.find((r) => r.jenis === "babonan")!;
  assert.equal(babonan.sisa, 2);
  const baru = aktif.find((r) => r.jenis === "produksi")!;
  assert.equal(baru.id, hasil.isianBaruId);
  assert.equal(baru.sisa, 34);

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

  const data = await getDataPabrik(KODE);
  assert.ok(data.denah);
  const isianK1 = data.isian.filter((i) => i.kolomId === kolom1);
  assert.equal(isianK1.length, 2);
  assert.ok(isianK1.every((i) => i.diisiOlehNama === "Uji"));
});

test("panen ganda ditolak", async () => {
  const [produksi] = (await isianKolom(kolom1)).filter((r) => r.jenis === "produksi");
  await mundurkan(produksi.id, 25);
  const input = { isianId: produksi.id, muatan: [muat(armadaA, 34)], babonan: 0, pecah: 0, isiUlang: false, konfirmasiBelumSiap: false };
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
  const input = { isianId, muatan: [muat(armadaB, 36)], babonan: 0, pecah: 0, isiUlang: false, konfirmasiBelumSiap: false };
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

test("isi air menolak jumlah di luar can kosong", async () => {
  // kolom1 berisi Babonan 2 → can kosong 34.
  await harapGalat(isiAir(KODE, kolom1, 35, operator), "KAPASITAS");
  await harapGalat(isiAir(KODE, kolom1, 0, operator), "VALIDASI");
});

test("maintenance", async () => {
  const { isianId } = await isiAir(KODE, kolom2, null, operator);
  await harapGalat(mulaiMaintenance(KODE, kolom2, "ganti seal", operator), "VALIDASI");
  await mundurkan(isianId, 25);
  const { isianBaruId } = await panen(
    KODE,
    { isianId, muatan: [muat(armadaB, 36)], babonan: 0, pecah: 0, isiUlang: false, konfirmasiBelumSiap: false },
    operator,
  );
  assert.equal(isianBaruId, null);
  await mulaiMaintenance(KODE, kolom2, "ganti seal", operator);
  await harapGalat(isiAir(KODE, kolom2, null, operator), "VALIDASI");
  const data = await getDataPabrik(KODE);
  assert.ok(data.maintenance.some((m) => m.kolomId === kolom2 && m.dibukaOlehNama === "Uji" && m.catatan === "ganti seal"));
  assert.equal(data.kosongSejak[kolom2], undefined);
  await selesaiMaintenance(KODE, kolom2, operator);
  await harapGalat(selesaiMaintenance(KODE, kolom2, operator), "KEADAAN_BERUBAH");
  const isi = await isiAir(KODE, kolom2, null, operator);
  assert.ok(isi.isianId);
});

test("koreksi dan batal hanya admin", async () => {
  const [produksi] = await isianKolom(kolom2);
  await harapGalat(koreksiIsian(KODE, produksi.id, { sisa: 30 }, "salah hitung", operator), "VALIDASI");
  await harapGalat(koreksiIsian(KODE, produksi.id, { sisa: 30 }, "  ", admin), "VALIDASI");
  await koreksiIsian(KODE, produksi.id, { sisa: 30 }, "salah hitung", admin);
  const [sesudah] = await isianKolom(kolom2);
  assert.equal(sesudah.sisa, 30);
  assert.equal(sesudah.jumlah_awal, 30);
  const [logKoreksi] = await getLog(KODE, { dari: new Date(Date.now() - 600_000).toISOString(), sampai: new Date(Date.now() + 60_000).toISOString(), aksi: "koreksi_isian" }, 5);
  assert.equal(logKoreksi.alasan, "salah hitung");
  assert.equal(logKoreksi.peran, "admin");
  assert.equal((logKoreksi.sebelum as { sisa: number }).sisa, 36);
  assert.equal((logKoreksi.sesudah as { sisa: number }).sisa, 30);

  // Panen 1 can dari Babonan kolom1, lalu dibatalkan → sisa Babonan kembali 2.
  const [babonan] = await isianKolom(kolom1);
  const { panenId } = await panen(
    KODE,
    { isianId: babonan.id, muatan: [muat(armadaA, 1)], babonan: 0, pecah: 0, isiUlang: false, konfirmasiBelumSiap: false },
    operator,
  );
  panenBabonanId = panenId;
  assert.equal((await isianKolom(kolom1))[0].sisa, 1);
  await harapGalat(batalkanPanen(KODE, panenId, "salah kendaraan", operator), "VALIDASI");
  await harapGalat(batalkanPanen(KODE, panenId, "", admin), "VALIDASI");
  await batalkanPanen(KODE, panenId, "salah kendaraan", admin);
  assert.equal((await isianKolom(kolom1))[0].sisa, 2);
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
  await tandaiBabonan(KODE, produksi.id, 3, operator);
  const aktif = await isianKolom(kolom2);
  assert.equal(aktif.find((r) => r.jenis === "produksi")!.sisa, 27);
  assert.equal(aktif.find((r) => r.jenis === "babonan")!.sisa, 3);
  await harapGalat(buangBabonan(KODE, kolom2, 4, "leleh", operator), "KEADAAN_BERUBAH");
  await buangBabonan(KODE, kolom2, 1, "leleh", operator);
  assert.equal((await isianKolom(kolom2)).find((r) => r.jenis === "babonan")!.sisa, 2);
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
  const riwayat = await getRiwayatOperator(KODE, operator.akunId, new Date(Date.now() - 3_600_000).toISOString());
  assert.ok(riwayat.length > 0 && riwayat.every((r) => r.akunNama === "Uji"));
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
