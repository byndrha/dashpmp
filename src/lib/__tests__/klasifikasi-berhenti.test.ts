import { test } from "node:test";
import assert from "node:assert/strict";
import { klasifikasiBerhenti, jarakM, jarakKeGarisM, formatJarakM } from "../klasifikasi-berhenti";

// Sekitar Ponorogo. 0,001° lintang ≈ 111 m.
const pabrik = { lat: -7.86, lng: 111.46 };
const nunung = { id: 1, nama: "Nunung", nomor: 1, lat: -7.87, lng: 111.47 };
const ayik = { id: 2, nama: "Ayik", nomor: 2, lat: -7.9, lng: 111.47 };
const rencana = [pabrik, { lat: nunung.lat, lng: nunung.lng }, { lat: ayik.lat, lng: ayik.lng }, pabrik];
const waktu = { mulai: "2026-11-25T03:00:00Z", selesai: "2026-11-25T03:12:00Z", menit: 12 };

test("jarakM: 0,001° lintang ≈ 111 m", () => {
  const d = jarakM({ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 });
  assert.ok(Math.abs(d - 111.2) < 1, String(d));
});

test("berhenti 100 m dari mitra → bongkar di mitra itu", () => {
  const [h] = klasifikasiBerhenti([{ ...waktu, lat: nunung.lat + 0.0009, lng: nunung.lng }], [nunung, ayik], pabrik, rencana);
  assert.equal(h.jenis, "bongkar");
  assert.equal(h.tujuan?.nama, "Nunung");
  assert.ok(h.jarakTujuanM! < 200);
});

test("berhenti dekat pabrik → pabrik", () => {
  const [h] = klasifikasiBerhenti([{ ...waktu, lat: pabrik.lat + 0.001, lng: pabrik.lng }], [nunung, ayik], pabrik, rencana);
  assert.equal(h.jenis, "pabrik");
});

test("berhenti di tengah ruas rencana (bukan mitra) → di_jalur", () => {
  // Titik tengah ruas Nunung→Ayik (3,3 km), ±1,6 km dari keduanya.
  const [h] = klasifikasiBerhenti([{ ...waktu, lat: -7.885, lng: 111.4702 }], [nunung, ayik], pabrik, rencana);
  assert.equal(h.jenis, "di_jalur");
  assert.ok(h.jarakRencanaM! < 300);
});

test("berhenti jauh dari rute rencana → menyimpang, dengan jarak ke rute", () => {
  const [h] = klasifikasiBerhenti([{ ...waktu, lat: -7.885, lng: 111.5 }], [nunung, ayik], pabrik, rencana);
  assert.equal(h.jenis, "menyimpang");
  assert.ok(h.jarakRencanaM! > 3000, String(h.jarakRencanaM));
});

test("tanpa garis rencana: bukan mitra/pabrik → menyimpang; jarak rencana null", () => {
  const [h] = klasifikasiBerhenti([{ ...waktu, lat: -7.885, lng: 111.4702 }], [nunung, ayik], pabrik, []);
  assert.equal(h.jenis, "menyimpang");
  assert.equal(h.jarakRencanaM, null);
});

test("jarakKeGarisM & formatJarakM", () => {
  assert.equal(jarakKeGarisM({ lat: 0, lng: 0 }, []), null);
  assert.equal(formatJarakM(85.4), "85 m");
  assert.equal(formatJarakM(1250), "1,3 km");
});
