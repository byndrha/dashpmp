// Pemeriksaan teknik denah produksi Es Balok (spec v2 §5, aturan 1–7).
// Hasilnya PERINGATAN: ditampilkan & disorot di builder, tidak pernah
// memblokir Simpan dan tidak dipanggil server saat menyimpan (galat pemblokir
// tetap di validasiDenah). CLIENT-SAFE & murni: tanpa impor server.
// Geometri memakai produksi-denah-geometri (sama dengan kanvas 2D & 3D).

import { kotakElemen, type BakElemen, type DenahDokumen, type DenahElemen, type Fluida, type GalatDenah, type JalurElemen, type Titik3D } from "./produksi-denah";
import { garisRel, potongSegmenKotak, segmenJalur, segmenTertanam, tataBakMeter } from "./produksi-denah-geometri";

/** Ruang bebas minimum antara dasar ice can terangkat dan bibir bak (aturan 3). */
export const RUANG_BEBAS_DEREK_M = 0.2;
/** Bagian tinggi ice can yang minimal terendam brine (aturan 2b). */
export const RENDAM_MIN = 0.85;
/** Toleransi ujung jalur bertemu jalur lain (aturan 7). */
export const TOLERANSI_UJUNG_M = 0.05;
/**
 * Kotak bak dikecilkan sebanyak ini di tiap sisi untuk aturan 5, agar pipa
 * yang hanya menempel/bertumpu di bibir atau dinding luar tidak dianggap
 * menembus (potongSegmenKotak memakai interval tertutup).
 */
const SUSUT_BAK_M = 0.01;
const EPS = 1e-6;
const FLUIDA_NH3: ReadonlySet<Fluida> = new Set<Fluida>(["nh3-cair", "nh3-gas"]);

const fmt2 = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const meter = (v: number) => `${fmt2.format(v)} m`;
const elevasi = (v: number) => `${v < -0.005 ? "−" : "+"}${fmt2.format(Math.abs(v))} m`;

function nama(e: DenahElemen): string {
  return e.nama.trim() || e.tipe;
}

function peringatan(elemenId: string, pesan: string, elemenTerkaitIds?: string[]): GalatDenah {
  return elemenTerkaitIds ? { elemenId, pesan, tingkat: "peringatan", elemenTerkaitIds } : { elemenId, pesan, tingkat: "peringatan" };
}

/** Tinggi (m) ice can tertinggi di antara varian yang dipakai kolom aktif; null bila tidak ada kolom aktif. */
function tinggiCanAktif(bak: BakElemen): number | null {
  let maks: number | null = null;
  for (const k of bak.kolom) {
    if (k.nonaktif) continue;
    const t = bak.iceCan[k.varian].tinggiMm / 1000;
    maks = maks === null ? t : Math.max(maks, t);
  }
  return maks;
}

function periksaBak(bak: BakElemen, hasil: GalatDenah[]): void {
  if (bak.kolom.length === 0) return;
  const t = tataBakMeter(bak);
  const n = nama(bak);

  // 1. Ice can tidak muat di bak.
  if (t.butuhA > t.ruangA + EPS) {
    hasil.push(peringatan(bak.id, `${n}: ${bak.kolom.length} kolom butuh ${meter(t.butuhA)}, ruang dalam ${meter(t.ruangA)} (kurang ${meter(t.butuhA - t.ruangA)}).`));
  }
  if (t.butuhB > t.ruangB + EPS) {
    hasil.push(peringatan(bak.id, `${n}: deret ice can terpanjang butuh ${meter(t.butuhB)}, ruang dalam ${meter(t.ruangB)} (kurang ${meter(t.butuhB - t.ruangB)}).`));
  }

  // 2. Ice can vs kedalaman & brine (bibir can sejajar bibir bak).
  const tinggiCan = tinggiCanAktif(bak);
  if (tinggiCan === null || !(tinggiCan > 0)) return;
  const dasarCan = t.bibirZ - tinggiCan;
  if (dasarCan < t.lantaiDalamZ - EPS) {
    hasil.push(peringatan(bak.id, `${n}: ice can menyentuh dasar bak (dasar ice can ${elevasi(dasarCan)}, lantai dalam bak ${elevasi(t.lantaiDalamZ)}).`));
  }
  const rendam = Math.min(1, Math.max(0, (t.brineZ - dasarCan) / tinggiCan));
  if (rendam < RENDAM_MIN - EPS) {
    const persen = Math.floor(rendam * 100 + EPS);
    hasil.push(peringatan(bak.id, `${n}: brine terlalu rendah, ice can hanya terendam ${persen}% (minimal ${Math.round(RENDAM_MIN * 100)}%).`));
  }
}

function jarakTitikSegmen(p: Titik3D, a: Titik3D, b: Titik3D): number {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const l2 = dx * dx + dy * dy + dz * dz;
  const u = l2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / l2)) : 0;
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy), p.z - (a.z + u * dz));
}

/** Ujung bertemu jalur lain: dekat titik atau segmen jalur lain (toleransi 0,05 m). */
function bertemuJalurLain(p: Titik3D, sendiri: JalurElemen, semua: readonly JalurElemen[]): boolean {
  for (const j of semua) {
    if (j.id === sendiri.id || j.titik.length === 0) continue;
    if (j.titik.length === 1) {
      if (jarakTitikSegmen(p, j.titik[0], j.titik[0]) <= TOLERANSI_UJUNG_M + EPS) return true;
      continue;
    }
    for (let i = 1; i < j.titik.length; i++) {
      if (jarakTitikSegmen(p, j.titik[i - 1], j.titik[i]) <= TOLERANSI_UJUNG_M + EPS) return true;
    }
  }
  return false;
}

/**
 * Peringatan teknik (spec v2 §5 aturan 1–7). Semua hasil bertingkat
 * "peringatan" dan menyertakan elemenId (plus elemenTerkaitIds bila ada elemen
 * lain yang terlibat). Elemen dengan data rusak (mis. jalur < 2 titik) dilewati;
 * itu urusan validasiDenah.
 */
export function periksaTeknik(dok: DenahDokumen): GalatDenah[] {
  const hasil: GalatDenah[] = [];
  const byId = new Map(dok.elemen.map((e) => [e.id, e]));
  const daftarBak = dok.elemen.filter((e): e is BakElemen => e.tipe === "bak");
  const daftarJalur = dok.elemen.filter((e): e is JalurElemen => e.tipe === "jalur");

  for (const bak of daftarBak) periksaBak(bak, hasil);

  for (const e of dok.elemen) {
    if (e.tipe !== "derek") continue;
    const kaitZ = e.elevasiM - e.tinggiKaitM;
    const rel = garisRel(e);
    for (const bid of e.bakIds) {
      const bak = byId.get(bid);
      if (bak?.tipe !== "bak") continue;
      // 3. Derek terlalu rendah.
      const tinggiCan = tinggiCanAktif(bak);
      if (tinggiCan !== null) {
        const butuh = bak.elevasiM + bak.tinggiM + tinggiCan + RUANG_BEBAS_DEREK_M;
        if (kaitZ < butuh - EPS) {
          const kurangCm = Math.max(1, Math.round((butuh - kaitZ) * 100));
          hasil.push(
            peringatan(e.id, `${nama(e)}: kait terlalu rendah untuk ${nama(bak)} — dasar kait ${elevasi(kaitZ)}, butuh ${elevasi(butuh)} (kurang ${kurangCm} cm).`, [bak.id])
          );
        }
      }
      // 4. Rel tidak melintasi bak yang dilayaninya (2D).
      const k = kotakElemen(bak);
      if (!potongSegmenKotak({ ...rel.a, z: 0 }, { ...rel.b, z: 0 }, { ...k, zBawah: 0, zAtas: 0 })) {
        hasil.push(peringatan(e.id, `${nama(e)}: rel tidak melintasi bak ${nama(bak)} yang dilayaninya.`, [bak.id]));
      }
    }
  }

  for (const j of daftarJalur) {
    if (j.titik.length < 2) continue;
    const segmen = segmenJalur(j);
    const jenis = j.jenis === "kabel" ? "Kabel" : "Pipa";

    // 5. Menembus bak yang bukan ujungnya.
    for (const bak of daftarBak) {
      if (bak.id === j.dariId || bak.id === j.keId) continue;
      const k = kotakElemen(bak);
      const kotak = {
        x: k.x + SUSUT_BAK_M,
        y: k.y + SUSUT_BAK_M,
        w: k.w - 2 * SUSUT_BAK_M,
        h: k.h - 2 * SUSUT_BAK_M,
        zBawah: bak.elevasiM + SUSUT_BAK_M,
        zAtas: bak.elevasiM + bak.tinggiM - SUSUT_BAK_M,
      };
      if (kotak.w <= 0 || kotak.h <= 0 || kotak.zAtas <= kotak.zBawah) continue;
      if (segmen.some((s) => potongSegmenKotak(s.a, s.b, kotak))) {
        hasil.push(peringatan(j.id, `${jenis} ${nama(j)} menembus bak ${nama(bak)} padahal tidak berujung di bak itu.`, [bak.id]));
      }
    }

    // 6. NH3 tertanam di beton.
    if (j.jenis === "pipa" && j.fluida && FLUIDA_NH3.has(j.fluida) && segmen.some((s) => segmenTertanam(s, dok))) {
      hasil.push(peringatan(j.id, `Pipa NH3 ${nama(j)} tertanam di beton — pipa amonia sebaiknya terlihat untuk inspeksi.`));
    }

    // 7. Ujung menggantung.
    const ujung: [string, Titik3D, string | undefined][] = [
      ["awal", j.titik[0], j.dariId],
      ["akhir", j.titik[j.titik.length - 1], j.keId],
    ];
    for (const [sebut, p, ref] of ujung) {
      if (ref) continue;
      if (bertemuJalurLain(p, j, daftarJalur)) continue;
      hasil.push(peringatan(j.id, `Ujung ${sebut} ${jenis.toLowerCase()} ${nama(j)} menggantung (tidak tersambung ke elemen atau jalur lain).`));
    }
  }

  return hasil;
}
