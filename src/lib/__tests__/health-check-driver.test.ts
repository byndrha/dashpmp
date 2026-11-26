import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hariIniWibISO,
  layakBerangkat,
  nilaiHealthCheck,
  statusSim,
  type MasukanHealthCheck,
  type SimDriver,
} from "../health-check-driver";

const HARI = "2026-11-26";

const simB1: SimDriver = { jenisSim: "B1", nomorSim: "123", berlakuHingga: "2027-01-01" };

function masukan(ubah: Partial<MasukanHealthCheck> = {}): MasukanHealthCheck {
  return {
    sistolik: 120,
    diastolik: 80,
    kadarAlkohol: 0,
    pandanganLolos: true,
    simDibawa: true,
    sims: [simB1],
    ...ubah,
  };
}

const sim = (berlakuHingga: string | null): SimDriver => ({ jenisSim: "B1", nomorSim: "123", berlakuHingga });

test("lolos semua", () => {
  const h = nilaiHealthCheck(masukan(), HARI);
  assert.equal(h.lolos, true);
  assert.deepEqual(h.alasanGagal, []);
  assert.equal(h.simTerbaik?.jenisSim, "B1");
  assert.deepEqual(h.peringatan, []);
});

test("batas tensi inklusif", () => {
  assert.equal(nilaiHealthCheck(masukan({ sistolik: 159, diastolik: 99 }), HARI).lolos, true);
  const tinggi = nilaiHealthCheck(masukan({ sistolik: 160, diastolik: 80 }), HARI);
  assert.equal(tinggi.lolos, false);
  assert.ok(tinggi.alasanGagal.some((a) => a.includes("160/80")));
  assert.equal(nilaiHealthCheck(masukan({ sistolik: 120, diastolik: 100 }), HARI).lolos, false);
  assert.equal(nilaiHealthCheck(masukan({ sistolik: 90, diastolik: 60 }), HARI).lolos, true);
  assert.equal(nilaiHealthCheck(masukan({ sistolik: 89, diastolik: 70 }), HARI).lolos, false);
  assert.equal(nilaiHealthCheck(masukan({ sistolik: 120, diastolik: 59 }), HARI).lolos, false);
});

test("alkohol", () => {
  assert.equal(nilaiHealthCheck(masukan({ kadarAlkohol: 0 }), HARI).lolos, true);
  const h = nilaiHealthCheck(masukan({ kadarAlkohol: 0.01 }), HARI);
  assert.equal(h.lolos, false);
  assert.ok(h.alasanGagal.some((a) => a.toLowerCase().includes("alkohol")));
  assert.ok(h.alasanGagal.some((a) => a.includes("0,01")));
});

test("input kosong", () => {
  const tensi = nilaiHealthCheck(masukan({ sistolik: null }), HARI);
  assert.equal(tensi.lolos, false);
  assert.ok(tensi.alasanGagal.some((a) => a.toLowerCase().includes("tekanan darah")));
  assert.equal(nilaiHealthCheck(masukan({ diastolik: null }), HARI).lolos, false);
  assert.equal(nilaiHealthCheck(masukan({ kadarAlkohol: null }), HARI).lolos, false);
  assert.equal(nilaiHealthCheck(masukan({ pandanganLolos: null }), HARI).lolos, false);
  assert.equal(nilaiHealthCheck(masukan({ pandanganLolos: false }), HARI).lolos, false);
});

test("SIM", () => {
  assert.equal(nilaiHealthCheck(masukan({ sims: [sim(HARI)] }), HARI).lolos, true);
  const lewat = nilaiHealthCheck(masukan({ sims: [sim("2026-11-25")] }), HARI);
  assert.equal(lewat.lolos, false);
  assert.ok(lewat.alasanGagal.some((a) => a.includes("SIM")));
  assert.equal(lewat.simTerbaik, null);
  assert.equal(nilaiHealthCheck(masukan({ sims: [sim(null)] }), HARI).lolos, false);
  const tidakDibawa = nilaiHealthCheck(masukan({ simDibawa: false }), HARI);
  assert.equal(tidakDibawa.lolos, false);
  assert.ok(tidakDibawa.alasanGagal.some((a) => a.includes("SIM")));
  assert.equal(nilaiHealthCheck(masukan({ sims: [] }), HARI).lolos, false);
});

test("simTerbaik memilih masa berlaku terjauh", () => {
  const h = nilaiHealthCheck(
    masukan({
      sims: [
        { jenisSim: "A", nomorSim: "1", berlakuHingga: "2026-12-01" },
        { jenisSim: "B2", nomorSim: "2", berlakuHingga: "2028-05-01" },
        { jenisSim: "C", nomorSim: "3", berlakuHingga: "2026-01-01" },
        { jenisSim: "B1", nomorSim: "4", berlakuHingga: null },
      ],
    }),
    HARI,
  );
  assert.equal(h.lolos, true);
  assert.equal(h.simTerbaik?.jenisSim, "B2");
  assert.deepEqual(h.peringatan, []);
});

test("peringatan SIM", () => {
  const h = nilaiHealthCheck(masukan({ sims: [sim("2026-12-20")] }), HARI);
  assert.equal(h.lolos, true);
  assert.equal(h.peringatan.length, 1);
  assert.ok(h.peringatan[0].includes("24"));
});

test("statusSim", () => {
  assert.equal(statusSim(sim("2026-12-26"), HARI), "hampir_habis");
  assert.equal(statusSim(sim("2026-12-27"), HARI), "berlaku");
  assert.equal(statusSim(sim(HARI), HARI), "hampir_habis");
  assert.equal(statusSim(sim("2026-11-25"), HARI), "kedaluwarsa");
  assert.equal(statusSim(sim(null), HARI), "tanpa_tanggal");
});

test("layakBerangkat", () => {
  assert.equal(layakBerangkat(null), false);
  assert.equal(layakBerangkat({ Lolos: true, AmbilAlih: false }), true);
  assert.equal(layakBerangkat({ Lolos: false, AmbilAlih: true }), true);
  assert.equal(layakBerangkat({ Lolos: false, AmbilAlih: false }), false);
});

test("hariIniWibISO", () => {
  // 2026-11-25 18:00 UTC = 2026-11-26 01:00 WIB
  assert.equal(hariIniWibISO(new Date("2026-11-25T18:00:00Z")), "2026-11-26");
  // 2026-11-26 16:59 UTC = 2026-11-26 23:59 WIB
  assert.equal(hariIniWibISO(new Date("2026-11-26T16:59:00Z")), "2026-11-26");
  assert.match(hariIniWibISO(), /^\d{4}-\d{2}-\d{2}$/);
});
