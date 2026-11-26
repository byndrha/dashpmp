// Penilaian kelayakan driver (Driver Health Check) — modul murni, tanpa
// akses DB, dipakai bersama oleh klien (pratinjau hasil) dan server
// (keputusan final yang disimpan). Semua tanggal berupa string
// "YYYY-MM-DD" menurut kalender WIB.
import { getNaiveWibNow } from "./business-date";

/** Batas tekanan darah yang lolos, inklusif di kedua ujung. */
export const BATAS_TENSI = { sistolikMin: 90, sistolikMaks: 159, diastolikMin: 60, diastolikMaks: 99 } as const;

/** SIM yang habis dalam ≤ sekian hari tetap lolos tetapi diberi peringatan. */
export const HARI_PERINGATAN_SIM = 30;

export interface SimDriver {
  jenisSim: string;
  nomorSim: string | null;
  berlakuHingga: string | null /* YYYY-MM-DD */;
}

export interface MasukanHealthCheck {
  sistolik: number | null;
  diastolik: number | null;
  kadarAlkohol: number | null;
  pandanganLolos: boolean | null;
  simDibawa: boolean;
  sims: SimDriver[];
}

export interface HasilHealthCheck {
  lolos: boolean;
  alasanGagal: string[];
  simTerbaik: SimDriver | null;
  peringatan: string[];
}

const fmtAngka = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 3 });

/** Selisih hari kalender (b − a) dari dua tanggal "YYYY-MM-DD". */
function selisihHari(aISO: string, bISO: string): number {
  const keUtc = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((keUtc(bISO) - keUtc(aISO)) / 86_400_000);
}

/** Status masa berlaku satu SIM terhadap tanggal WIB hari ini. */
export function statusSim(
  s: SimDriver,
  hariIniISO: string,
): "berlaku" | "hampir_habis" | "kedaluwarsa" | "tanpa_tanggal" {
  if (!s.berlakuHingga) return "tanpa_tanggal";
  const berlaku = s.berlakuHingga.slice(0, 10);
  if (berlaku < hariIniISO) return "kedaluwarsa";
  return selisihHari(hariIniISO, berlaku) <= HARI_PERINGATAN_SIM ? "hampir_habis" : "berlaku";
}

/** Nilai satu health check: lolos hanya bila semua syarat terpenuhi. */
export function nilaiHealthCheck(m: MasukanHealthCheck, hariIniISO: string): HasilHealthCheck {
  const alasanGagal: string[] = [];
  const peringatan: string[] = [];

  // Tekanan darah
  if (m.sistolik == null || m.diastolik == null) {
    alasanGagal.push("Tekanan darah belum diisi");
  } else {
    const b = BATAS_TENSI;
    const sistolikOk = m.sistolik >= b.sistolikMin && m.sistolik <= b.sistolikMaks;
    const diastolikOk = m.diastolik >= b.diastolikMin && m.diastolik <= b.diastolikMaks;
    if (!sistolikOk || !diastolikOk) {
      alasanGagal.push(
        `Tekanan darah ${m.sistolik}/${m.diastolik} di luar batas ` +
          `${b.sistolikMin}–${b.sistolikMaks} / ${b.diastolikMin}–${b.diastolikMaks}`,
      );
    }
  }

  // Alkohol — harus tepat 0
  if (m.kadarAlkohol == null) {
    alasanGagal.push("Kadar alkohol belum diisi");
  } else if (m.kadarAlkohol !== 0) {
    alasanGagal.push(`Kadar alkohol ${fmtAngka(m.kadarAlkohol)} (normal = 0)`);
  }

  // Fokus pandangan
  if (m.pandanganLolos == null) alasanGagal.push("Fokus pandangan belum diisi");
  else if (!m.pandanganLolos) alasanGagal.push("Fokus pandangan tidak lolos");

  // SIM — pilih yang masih berlaku dengan masa berlaku terjauh
  let simTerbaik: SimDriver | null = null;
  for (const s of m.sims) {
    const st = statusSim(s, hariIniISO);
    if (st !== "berlaku" && st !== "hampir_habis") continue;
    if (!simTerbaik || (s.berlakuHingga as string) > (simTerbaik.berlakuHingga as string)) simTerbaik = s;
  }
  if (!simTerbaik) {
    alasanGagal.push("Tidak ada SIM yang masih berlaku");
  } else if (statusSim(simTerbaik, hariIniISO) === "hampir_habis") {
    const sisa = selisihHari(hariIniISO, simTerbaik.berlakuHingga as string);
    peringatan.push(
      sisa === 0
        ? `SIM ${simTerbaik.jenisSim} habis berlaku hari ini`
        : `SIM ${simTerbaik.jenisSim} habis berlaku dalam ${sisa} hari`,
    );
  }
  if (!m.simDibawa) alasanGagal.push("SIM fisik tidak dibawa");

  return { lolos: alasanGagal.length === 0, alasanGagal, simTerbaik, peringatan };
}

/** Driver boleh berangkat bila health check terbaru lolos atau diambil alih. */
export function layakBerangkat(terbaru: { Lolos: boolean; AmbilAlih: boolean } | null): boolean {
  if (!terbaru) return false;
  return terbaru.Lolos || terbaru.AmbilAlih;
}

/** Tanggal kalender WIB hari ini ("YYYY-MM-DD"), tanpa aturan rollover. */
export function hariIniWibISO(now: Date = new Date()): string {
  return getNaiveWibNow(now).toISOString().slice(0, 10);
}
