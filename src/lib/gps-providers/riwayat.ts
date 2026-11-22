// Jejak rute AKTUAL satu armada pada rentang waktu tertentu, diambil langsung
// dari riwayat milik provider GPS (bukan dari armada_gps_riwayat kita, yang
// hanya terisi saat dashboard dibuka). Endpoint ditemukan lewat penelusuran
// situs web provider 2026-11-23 — bukan API resmi, jadi bisa berubah:
//
//   SoloFleet  POST /ReportDailyDetail/getVehicleDetailJsonWithoutZoneCalcFilterevery1minCalc
//              body { ddl: <vehicleid, mis. "PP48">, startdatetime/enddatetime: ISO UTC,
//                     interval: "0", timezone: "7", ArchiveType: "liveserver", ... }
//              -> { detail: [{ gpstimeISO (epoch detik), y, x, spd, IP1, ... }] }
//              ±1 titik/menit, ±100 ms, menjangkau minimal seminggu ke belakang.
//   Hino       GET  {trip_api}/position-details/geometry?vehicleId&deviceId&startDate&endDate
//              -> { data: { geometry: GeoJSON LineString [lng, lat] } } — tanpa jam.
//
// Sesi login & daftar kendaraan disimpan di memori proses beberapa menit
// supaya permintaan jejak berikutnya tidak login ulang.

import { login as loginSolofleet } from "@/lib/gps-providers/solofleet";
import { login as loginHino } from "@/lib/gps-providers/hino-connect";
import { normalizePlate } from "@/lib/gps-providers/types";

export type SumberJejak = "solofleet" | "hino";

export interface TitikJejak {
  lat: number;
  lng: number;
  // Epoch ms — null untuk Hino (geometri tanpa cap waktu).
  t: number | null;
  spd: number | null;
}

export interface JejakProvider {
  sumber: SumberJejak;
  titik: TitikJejak[];
}

const SOLOFLEET = "https://www.solofleet.com";
const HINO_API = "https://be-pub-sg-hino.gazellecomputing.com";
const SESI_MS = 15 * 60 * 1000;
const DAFTAR_MS = 30 * 60 * 1000;
const BATAS_WAKTU_MS = 12_000;

type Sesi = { nilai: string; kedaluwarsa: number };
const sesiCache = new Map<string, Sesi>();

async function sesi(sumber: SumberJejak, perusahaanId: number, segarkan = false): Promise<string> {
  const kunci = `${sumber}:${perusahaanId}`;
  const ada = sesiCache.get(kunci);
  if (!segarkan && ada && ada.kedaluwarsa > Date.now()) return ada.nilai;
  const nilai = sumber === "solofleet" ? await loginSolofleet(perusahaanId) : await loginHino(perusahaanId);
  sesiCache.set(kunci, { nilai, kedaluwarsa: Date.now() + SESI_MS });
  return nilai;
}

function denganBatasWaktu(init: RequestInit = {}): RequestInit {
  return { ...init, signal: AbortSignal.timeout(BATAS_WAKTU_MS) };
}

// ---------- Daftar kendaraan per provider (plat -> id provider) ----------

type IdSolofleet = { vehicleid: string };
type IdHino = { vehicleId: string; deviceId: string };
const daftarCache = new Map<string, { peta: Map<string, IdSolofleet | IdHino>; kedaluwarsa: number }>();

async function daftarSolofleet(perusahaanId: number): Promise<Map<string, IdSolofleet>> {
  const kunci = `solofleet:${perusahaanId}`;
  const ada = daftarCache.get(kunci);
  if (ada && ada.kedaluwarsa > Date.now()) return ada.peta as Map<string, IdSolofleet>;
  const ambil = async (cookie: string) =>
    fetch(`${SOLOFLEET}/Vehicle/vehiclelivewithoutzonetripNewModelCondense`, denganBatasWaktu({ headers: { Cookie: cookie } }));
  let r = await ambil(await sesi("solofleet", perusahaanId));
  if (!(r.headers.get("content-type") ?? "").includes("json")) r = await ambil(await sesi("solofleet", perusahaanId, true));
  if (!r.ok) throw new Error(`Daftar kendaraan SoloFleet gagal (${r.status})`);
  const data = (await r.json()) as { vehicles?: { alias: string; vehicleid: string }[] };
  const peta = new Map<string, IdSolofleet>();
  for (const v of data.vehicles ?? []) if (v.alias && v.vehicleid) peta.set(normalizePlate(v.alias), { vehicleid: v.vehicleid });
  daftarCache.set(kunci, { peta, kedaluwarsa: Date.now() + DAFTAR_MS });
  return peta;
}

async function daftarHino(perusahaanId: number): Promise<Map<string, IdHino>> {
  const kunci = `hino:${perusahaanId}`;
  const ada = daftarCache.get(kunci);
  if (ada && ada.kedaluwarsa > Date.now()) return ada.peta as Map<string, IdHino>;
  const ambil = async (token: string) =>
    fetch(
      `${HINO_API}/mapproxy/map/clusters`,
      denganBatasWaktu({
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          boundingBox: {
            topLeftCorner: { lon: 103.0977934375, lat: -1.9072132966240953 },
            bottomRightCorner: { lon: 114.89710984375, lat: -11.798864459079624 },
          },
          fleets: [],
          deviceListMaxLen: 100,
          zoomLevel: 7,
          hideExpired: true,
        }),
      })
    );
  let r = await ambil(await sesi("hino", perusahaanId));
  if (r.status === 401 || r.status === 403) r = await ambil(await sesi("hino", perusahaanId, true));
  if (!r.ok) throw new Error(`Daftar kendaraan Hino gagal (${r.status})`);
  const data = (await r.json()) as { data?: { devices?: { plate: string; vehicleId: string; deviceId: string }[] }[] };
  const peta = new Map<string, IdHino>();
  for (const d of (data.data ?? []).flatMap((c) => c.devices ?? [])) {
    if (d.plate && d.vehicleId) peta.set(normalizePlate(d.plate), { vehicleId: d.vehicleId, deviceId: d.deviceId });
  }
  daftarCache.set(kunci, { peta, kedaluwarsa: Date.now() + DAFTAR_MS });
  return peta;
}

// ---------- Riwayat ----------

async function jejakSolofleet(perusahaanId: number, id: IdSolofleet, dari: Date, sampai: Date): Promise<TitikJejak[]> {
  const body = JSON.stringify({
    ddl: id.vehicleid,
    startdatetime: dari.toISOString(),
    enddatetime: sampai.toISOString(),
    withzone: "withoutzone",
    interval: "0",
    addadasdms: false,
    timezone: "7",
    ArchiveType: "liveserver",
  });
  const ambil = async (cookie: string) =>
    fetch(
      `${SOLOFLEET}/ReportDailyDetail/getVehicleDetailJsonWithoutZoneCalcFilterevery1minCalc`,
      denganBatasWaktu({ method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json; charset=utf-8" }, body })
    );
  let r = await ambil(await sesi("solofleet", perusahaanId));
  if (!(r.headers.get("content-type") ?? "").includes("json")) r = await ambil(await sesi("solofleet", perusahaanId, true));
  if (!r.ok) throw new Error(`Riwayat SoloFleet gagal (${r.status})`);
  let data: unknown = await r.json();
  if (typeof data === "string") data = JSON.parse(data);
  const detail = ((data as { detail?: unknown[] })?.detail ?? []) as {
    gpstimeISO?: number;
    y?: number;
    x?: number;
    spd?: number | null;
  }[];
  return detail
    .filter((p) => typeof p.y === "number" && typeof p.x === "number" && p.y !== 0 && p.x !== 0)
    .map((p) => ({ lat: p.y!, lng: p.x!, t: p.gpstimeISO ? p.gpstimeISO * 1000 : null, spd: p.spd ?? null }))
    .sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
}

async function jejakHino(perusahaanId: number, id: IdHino, dari: Date, sampai: Date): Promise<TitikJejak[]> {
  const qs = new URLSearchParams({
    vehicleId: id.vehicleId,
    deviceId: id.deviceId,
    startDate: dari.toISOString(),
    endDate: sampai.toISOString(),
  });
  const ambil = async (token: string) =>
    fetch(
      `${HINO_API}/trip/position-details/geometry?${qs}`,
      denganBatasWaktu({ headers: { Accept: "application/json", Authorization: `Bearer ${token}` } })
    );
  let r = await ambil(await sesi("hino", perusahaanId));
  if (r.status === 401 || r.status === 403) r = await ambil(await sesi("hino", perusahaanId, true));
  if (!r.ok) throw new Error(`Riwayat Hino gagal (${r.status})`);
  const data = (await r.json()) as { data?: { geometry?: { coordinates?: [number, number][] } } };
  return (data.data?.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng, t: null, spd: null }));
}

/**
 * Jejak aktual satu kendaraan (dicocokkan lewat plat) pada [dari, sampai].
 * SoloFleet didahulukan (punya cap waktu & kecepatan); Hino dipakai bila
 * kendaraan tidak ada di SoloFleet atau jejaknya kosong. Null bila plat ini
 * tidak terdaftar di provider mana pun (armada tanpa alat GPS).
 */
export async function ambilJejakAktual(
  perusahaanId: number,
  platNomor: string,
  dari: Date,
  sampai: Date
): Promise<JejakProvider | null> {
  const plat = normalizePlate(platNomor);
  const galat: string[] = [];
  let terdaftar: SumberJejak | null = null;

  try {
    const id = (await daftarSolofleet(perusahaanId)).get(plat);
    if (id) {
      terdaftar = "solofleet";
      const titik = await jejakSolofleet(perusahaanId, id, dari, sampai);
      if (titik.length >= 2) return { sumber: "solofleet", titik };
    }
  } catch (err) {
    galat.push(err instanceof Error ? err.message : String(err));
  }
  try {
    const id = (await daftarHino(perusahaanId)).get(plat);
    if (id) {
      terdaftar ??= "hino";
      const titik = await jejakHino(perusahaanId, id, dari, sampai);
      if (titik.length >= 2) return { sumber: "hino", titik };
    }
  } catch (err) {
    galat.push(err instanceof Error ? err.message : String(err));
  }
  // Galat provider hanya dilempar bila tidak ada jawaban sah sama sekali —
  // "terdaftar tapi kosong" (truk tidak bergerak / alat mati) tetap hasil.
  if (galat.length && !terdaftar) throw new Error(galat.join("; "));
  if (!terdaftar) return null;
  return { sumber: terdaftar, titik: [] };
}
