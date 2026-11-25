import { test } from "node:test";
import assert from "node:assert/strict";
import { analisisJejak, arahMataAngin, tempatkanCatatan, type MasukanAnalisis } from "../analisis-jejak";

// Rute lurus ke timur dari pabrik di lintang -7.86. 0,001° bujur ≈ 110 m.
const pabrik = { lat: -7.86, lng: 111.46 };
const a = { id: 1, nama: "A", nomor: 1, lat: -7.86, lng: 111.47 };
const b = { id: 2, nama: "B", nomor: 2, lat: -7.86, lng: 111.48 };
const rencana = [pabrik, { lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }, pabrik];
const T0 = Date.parse("2026-11-25T00:00:00Z");
const mnt = (n: number) => T0 + n * 60_000;
const iso = (n: number) => new Date(mnt(n)).toISOString();

function masukan(ubah: Partial<MasukanAnalisis>): MasukanAnalisis {
  return { titik: [], waktu: [], kecepatan: [], berhenti: [], tujuan: [a, b], pabrik, rencana, final: true, ...ubah };
}

test("arahMataAngin", () => {
  assert.equal(arahMataAngin(pabrik, { lat: -7.86, lng: 111.47 }), "timur");
  assert.equal(arahMataAngin(pabrik, { lat: -7.85, lng: 111.46 }), "utara");
  assert.equal(arahMataAngin(pabrik, { lat: -7.87, lng: 111.45 }), "barat daya");
});

test("singgah 950 m di timur pin B tanpa singgah di B → drop_meleset", () => {
  const r = analisisJejak(
    masukan({
      titik: [[-7.86, 111.47], [-7.86, 111.48], [-7.86, 111.4886]],
      waktu: [mnt(5), mnt(10), mnt(15)],
      kecepatan: [0, 20, 0],
      berhenti: [
        { lat: -7.86, lng: 111.47, mulai: iso(5), selesai: iso(9), menit: 4 },
        { lat: -7.86, lng: 111.4886, mulai: iso(15), selesai: iso(22), menit: 7 },
      ],
    })
  );
  assert.equal(r.bongkarPerTujuan.get(1)?.length, 1);
  const m = r.masalahPerTujuan.get(2) ?? [];
  assert.equal(m[0]?.jenis, "drop_meleset");
  if (m[0]?.jenis === "drop_meleset") {
    assert.equal(m[0].arah, "timur");
    assert.ok(Math.abs(m[0].jarakM - 950) < 30, String(m[0].jarakM));
  }
  assert.equal(r.kandidatDrop.get(iso(15))?.id, 2);
  assert.equal(r.kunjungan.get(2), iso(15));
  // Singgah kandidat tidak dicatat dua kali sebagai baris berhenti biasa.
  assert.ok(!r.catatan.some((c) => c.jenis === "berhenti" && c.b.mulai === iso(15)));
});

test("tanpa singgah: hanya_melintas vs tidak_didatangi; tidak dinilai sebelum final", () => {
  const titik: [number, number][] = [[-7.86, 111.47], [-7.8603, 111.4795]];
  const r = analisisJejak(masukan({ titik, waktu: [mnt(1), mnt(2)], kecepatan: [30, 30] }));
  assert.equal(r.masalahPerTujuan.get(1)?.[0]?.jenis, "hanya_melintas");
  assert.equal(r.masalahPerTujuan.get(2)?.[0]?.jenis, "hanya_melintas");
  const jauh = analisisJejak(masukan({ titik: [[-7.86, 111.46]], waktu: [mnt(1)], kecepatan: [0] }));
  assert.equal(jauh.masalahPerTujuan.get(2)?.[0]?.jenis, "tidak_didatangi");
  const berlangsung = analisisJejak(masukan({ titik: [[-7.86, 111.46]], waktu: [mnt(1)], kecepatan: [0], final: false }));
  assert.equal(berlangsung.masalahPerTujuan.get(2), undefined);
});

test("pin mitra di area pabrik ditandai", () => {
  const r = analisisJejak(masukan({ tujuan: [{ ...a, lat: pabrik.lat, lng: pabrik.lng + 0.001 }] }));
  assert.equal(r.masalahPerTujuan.get(1)?.[0]?.jenis, "pin_di_pabrik");
});

test("segmen keluar jalur: titik > 300 m dari rencana ≥ 2 mnt, singgah di dalamnya ikut segmen", () => {
  const titik: [number, number][] = [[-7.86, 111.47], [-7.865, 111.475], [-7.87, 111.475], [-7.865, 111.475], [-7.86, 111.48]];
  const r = analisisJejak(
    masukan({
      titik,
      waktu: [mnt(0), mnt(2), mnt(4), mnt(12), mnt(14)],
      kecepatan: [20, 20, 0, 20, 20],
      berhenti: [{ lat: -7.87, lng: 111.475, mulai: iso(4), selesai: iso(11), menit: 7 }],
      // Tanpa tujuan supaya singgah itu tidak dianggap kandidat drop.
      tujuan: [],
    })
  );
  const seg = r.catatan.filter((c) => c.jenis === "keluar_jalur");
  assert.equal(seg.length, 1);
  if (seg[0].jenis === "keluar_jalur") {
    assert.equal(seg[0].mulai, iso(2));
    assert.ok(seg[0].maksM > 1000);
    assert.equal(seg[0].singgah.length, 1);
  }
  assert.ok(!r.catatan.some((c) => c.jenis === "berhenti"));
  assert.equal(r.segmenKeluar.length, 1);
});

test("sinyal hilang, ngebut, urutan berbeda, penempatan catatan", () => {
  const r = analisisJejak(
    masukan({
      titik: [[-7.86, 111.48], [-7.86, 111.47], [-7.86, 111.465], [-7.86, 111.4645]],
      waktu: [mnt(0), mnt(20), mnt(21), mnt(22)],
      kecepatan: [0, 0, 75, 80],
      berhenti: [
        { lat: -7.86, lng: 111.48, mulai: iso(0), selesai: iso(5), menit: 5 },
        { lat: -7.86, lng: 111.47, mulai: iso(20), selesai: iso(25), menit: 5 },
      ],
    })
  );
  assert.deepEqual(r.urutanAktual?.map((t) => t.nomor), [2, 1]);
  assert.ok(r.catatan.some((c) => c.jenis === "sinyal_hilang" && c.menit === 20));
  const ngebut = r.catatan.find((c) => c.jenis === "ngebut");
  assert.equal(ngebut?.jenis === "ngebut" ? ngebut.maksKmj : null, 80);
  const sisipan = tempatkanCatatan(r);
  // Sinyal hilang dimulai menit 0 = saat di B (kunjungan pertama) → setelah kartu B.
  assert.ok(sisipan.get(2)?.some((c) => c.jenis === "sinyal_hilang"));
  assert.ok(sisipan.get(1)?.some((c) => c.jenis === "ngebut"));
});
