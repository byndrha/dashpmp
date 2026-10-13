import { test } from "node:test";
import assert from "node:assert/strict";
import { PENGATURAN_AWAL as P, dalamJendela, pilihKandidat, susunJadwal, validasiPengaturan, waktuWib, type KandidatMentah, type KonteksPilih } from "../logika";

// 2026-10-14 adalah hari Rabu. 10:00 WIB = 03:00 UTC.
const RABU_10 = new Date("2026-10-14T03:00:00Z");

test("waktuWib: tanggal, hari ISO, menit", () => {
  assert.deepEqual(waktuWib(RABU_10), { tanggal: "2026-10-14", hari: 3, menit: 600 });
  assert.equal(waktuWib(new Date("2026-10-18T03:00:00Z")).hari, 7); // Minggu
  assert.equal(waktuWib(new Date("2026-10-13T20:00:00Z")).tanggal, "2026-10-14"); // 03:00 WIB hari berikutnya
});
test("dalamJendela: dalam jam dan hari → ya", () => assert.equal(dalamJendela(RABU_10, P), true));
test("dalamJendela: sebelum jam mulai / tepat jam selesai → tidak", () => {
  assert.equal(dalamJendela(new Date("2026-10-14T01:59:00Z"), P), false); // 08:59
  assert.equal(dalamJendela(new Date("2026-10-14T09:00:00Z"), P), false); // 16:00
  assert.equal(dalamJendela(new Date("2026-10-14T08:59:00Z"), P), true); // 15:59
});
test("dalamJendela: hari tidak dipilih (Minggu) → tidak", () => assert.equal(dalamJendela(new Date("2026-10-18T03:00:00Z"), P), false));

const mk = (id: string, o: Partial<KandidatMentah> = {}): KandidatMentah => ({
  mitraId: id, nama: `Mitra ${id}`, kontak: "081234567890", total: 500000, jumlahFaktur: 3, hariLewatMaks: 10, ...o,
});
const ctx = (o: Partial<KonteksPilih> = {}): KonteksPilih => ({
  jumlahMitraPerNomor: new Map(), optout: new Set(), terakhirDitagih: new Map(), sekarang: RABU_10, ...o,
});

test("pilihKandidat: memenuhi kriteria → terpilih dengan nomor kanonik", () => {
  const r = pilihKandidat([mk("1")], P, ctx());
  assert.equal(r.terpilih.length, 1);
  assert.equal(r.terpilih[0].nomor, "6281234567890");
});
test("pilihKandidat: di bawah kriteria hari/piutang → bukan kandidat (tidak masuk daftar dilewati)", () => {
  const r = pilihKandidat([mk("1", { hariLewatMaks: 3 }), mk("2", { total: 50000 })], P, ctx());
  assert.equal(r.terpilih.length, 0);
  assert.equal(r.dilewati.length, 0);
});
test("pilihKandidat: nomor kosong / ganda di data / dipakai >1 mitra / opt-out → dilewati dengan alasan", () => {
  const r = pilihKandidat(
    [mk("1", { kontak: "" }), mk("2", { kontak: "081234567890 / 082345678901" }), mk("3", { kontak: "081111111111" }), mk("4", { kontak: "082222222222" })],
    P,
    ctx({ jumlahMitraPerNomor: new Map([["6281111111111", 2]]), optout: new Set(["6282222222222"]) })
  );
  assert.equal(r.terpilih.length, 0);
  assert.deepEqual(r.dilewati.map((d) => d.alasan), [
    "Nomor kosong/tidak valid",
    "Lebih dari satu nomor di data mitra",
    "Nomor dipakai lebih dari satu mitra",
    "Opt-out",
  ]);
});
test("pilihKandidat: baru ditagih < ulangHari → dilewati; lewat ulangHari → boleh", () => {
  const baru = new Date(RABU_10.getTime() - 2 * 86400000);
  const lama = new Date(RABU_10.getTime() - 8 * 86400000);
  assert.equal(pilihKandidat([mk("1")], P, ctx({ terakhirDitagih: new Map([["1", baru]]) })).terpilih.length, 0);
  assert.equal(pilihKandidat([mk("1")], P, ctx({ terakhirDitagih: new Map([["1", lama]]) })).terpilih.length, 1);
});
test("pilihKandidat: urut paling lama lewat lalu terbesar; dipotong batas harian", () => {
  const rows = [mk("a", { hariLewatMaks: 10, total: 100000 }), mk("b", { hariLewatMaks: 30, total: 100000 }), mk("c", { hariLewatMaks: 30, total: 900000 })];
  const r = pilihKandidat(rows, { ...P, batasHarian: 2 }, ctx());
  assert.deepEqual(r.terpilih.map((x) => x.mitraId), ["c", "b"]);
  assert.deepEqual(r.dilewati.map((x) => [x.mitraId, x.alasan]), [["a", "Melebihi batas harian"]]);
});

test("susunJadwal: pertama = mulai; jeda antar pesan dalam rentang; jeda panjang tiap N", () => {
  const p = { ...P, jedaMinDtk: 20, jedaMaksDtk: 60, jedaPanjangTiap: 3, jedaPanjangDtk: 300 };
  const j = susunJadwal(7, RABU_10, p, () => 0.5); // jeda tepat 40 dtk
  assert.equal(j[0].getTime(), RABU_10.getTime());
  assert.equal(j[1].getTime() - j[0].getTime(), 40000);
  assert.equal(j[2].getTime() - j[1].getTime(), 40000);
  assert.equal(j[3].getTime() - j[2].getTime(), 340000); // i=3 → jeda panjang
  assert.equal(j[6].getTime() - j[5].getTime(), 340000);
});
test("susunJadwal: acak selalu dalam [min,maks]", () => {
  const j = susunJadwal(200, RABU_10, { ...P, jedaPanjangTiap: 1000 });
  for (let i = 1; i < j.length; i++) {
    const d = (j[i].getTime() - j[i - 1].getTime()) / 1000;
    assert.ok(d >= 20 && d <= 60, `jeda ${d}`);
  }
});
test("susunJadwal: dipotong saat melewati jam selesai", () => {
  const dekat = new Date("2026-10-14T08:58:00Z"); // 15:58 WIB, selesai 16:00
  const j = susunJadwal(10, dekat, { ...P, jedaMinDtk: 50, jedaMaksDtk: 50 }, () => 0.5);
  assert.equal(j.length, 3); // 15:58:00, 15:58:50, 15:59:40; berikutnya 16:00:30 dibuang
});

test("validasiPengaturan: nilai awal sah", () => assert.equal(validasiPengaturan({}).ok, true));
test("validasiPengaturan: tolak hari kosong, jam terbalik, jeda maks < min, batas di luar rentang, mode asing", () => {
  assert.equal(validasiPengaturan({ hari: [] }).ok, false);
  assert.equal(validasiPengaturan({ jamMulai: "17:00", jamSelesai: "09:00" }).ok, false);
  assert.equal(validasiPengaturan({ jamMulai: "9:00" }).ok, false);
  assert.equal(validasiPengaturan({ jedaMinDtk: 60, jedaMaksDtk: 30 }).ok, false);
  assert.equal(validasiPengaturan({ jedaMinDtk: 1 }).ok, false);
  assert.equal(validasiPengaturan({ batasHarian: 0 }).ok, false);
  assert.equal(validasiPengaturan({ hari: [8] }).ok, false);
  assert.equal(validasiPengaturan({ mode: "asal" as never }).ok, false);
});
test("validasiPengaturan: hari diurutkan dan dedupe", () => {
  const r = validasiPengaturan({ hari: [3, 1, 3] });
  assert.equal(r.ok && r.nilai.hari.join(","), "1,3");
});
