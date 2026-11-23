// Ambang umur & status piutang Es Balok — modul tanpa impor DB supaya bisa
// dipakai Client Component (kartu per Agen) sekaligus query server
// (piutang-invoice-outstanding.ts mengekspor ulang dari sini).
//
// daysOverdue = hari lewat "jatuh tempo" asumsi (Tanggal pesanan + 14 hari),
// lihat piutang-invoice-outstanding.ts.

export type EsBalokAgingBucket = "Belum Jatuh Tempo" | "1-30 Hari" | "31-60 Hari" | "61-90 Hari" | ">90 Hari";

export type EsBalokPiutangStatus = "Sehat" | "Perhatian" | "Kritis";

export const ES_BALOK_JATUH_TEMPO_HARI = 14;

// Ported verbatim from aging.ts:95-101's CASE thresholds.
export function esBalokAgingBucket(daysOverdue: number): EsBalokAgingBucket {
  if (daysOverdue <= 0) return "Belum Jatuh Tempo";
  if (daysOverdue <= 30) return "1-30 Hari";
  if (daysOverdue <= 60) return "31-60 Hari";
  if (daysOverdue <= 90) return "61-90 Hari";
  return ">90 Hari";
}

// Ported verbatim from aging.ts:50-55's STATUS_CASE (Sehat <=30, Perhatian
// <=60, else Kritis); null (tidak ada piutang terbuka) -> Sehat.
export function esBalokStatus(daysOverdue: number | null): EsBalokPiutangStatus {
  if (daysOverdue === null) return "Sehat";
  if (daysOverdue <= 30) return "Sehat";
  if (daysOverdue <= 60) return "Perhatian";
  return "Kritis";
}

// Ringkasan piutang terbuka untuk kartu per Agen — dikirim ke klien sebagai
// pengganti ribuan baris EsBalokInvoiceRow (~1 MB untuk PMPutra). Nilai =
// [sisa outstanding (dibulatkan), hari lewat jatuh tempo terburuk]. utama &
// logistik digabung: outstanding dijumlah, umur diambil yang terburuk.
// Entri `dokumen` juga membawa tanggal pesanan (yyyy-MM-dd) — dipakai tampilan
// "Semua belum lunas" di kartu per Agen, yang menampilkan pesanan terbuka di
// luar rentang tanggal yang sedang dipilih.
export type PiutangTerbukaRingkas = [outstanding: number, maxDaysOverdue: number, tanggal?: string];

export interface RingkasanPiutangTerbuka {
  agen: Record<string, PiutangTerbukaRingkas>; // key: AgenID — FIFO per sumber
  dokumen: Record<string, PiutangTerbukaRingkas>; // key: `${AgenID}|${NoDokumen}`
  // Hutang BERSIH per Agen (utama + logistik digabung, dasar yang sama dengan
  // Sisa Hutang & panel ringkasan) beserta umur terburuk tagihan yang belum
  // tertutup — lihat getUmurPiutangBersih().perAgen. Agen yang bersihnya
  // lunas/tabungan tidak ada di sini. Status Sehat/Perhatian/Kritis kartu
  // memakai INI, bukan `agen` (FIFO).
  bersih?: Record<string, PiutangTerbukaRingkas>;
}

export function ringkasPiutangTerbuka(
  rows: { agenId: string; noDokumen: string; outstanding: number; daysOverdue: number; tanggal?: string }[],
  bersih?: Record<string, PiutangTerbukaRingkas>
): RingkasanPiutangTerbuka {
  const agen: Record<string, PiutangTerbukaRingkas> = {};
  const dokumen: Record<string, PiutangTerbukaRingkas> = {};
  const add = (map: Record<string, PiutangTerbukaRingkas>, key: string, outstanding: number, days: number) => {
    const cur = map[key];
    // Diperbarui di tempat (bukan tuple baru) supaya tanggal di indeks 2 tetap ada.
    if (cur) {
      cur[0] += outstanding;
      cur[1] = Math.max(cur[1], days);
    } else map[key] = [outstanding, days];
  };
  for (const r of rows) {
    add(agen, r.agenId, r.outstanding, r.daysOverdue);
    const kunci = `${r.agenId}|${r.noDokumen}`;
    add(dokumen, kunci, r.outstanding, r.daysOverdue);
    // Tanggal terlama bila satu NoDokumen muncul di utama & logistik.
    const tgl = dokumen[kunci][2];
    if (r.tanggal && (!tgl || r.tanggal < tgl)) dokumen[kunci][2] = r.tanggal;
  }
  for (const map of [agen, dokumen]) for (const k in map) map[k][0] = Math.round(map[k][0]);
  return { agen, dokumen, bersih };
}
