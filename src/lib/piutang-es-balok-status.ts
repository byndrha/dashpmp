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
export type PiutangTerbukaRingkas = [outstanding: number, maxDaysOverdue: number];

export interface RingkasanPiutangTerbuka {
  agen: Record<string, PiutangTerbukaRingkas>; // key: AgenID
  dokumen: Record<string, PiutangTerbukaRingkas>; // key: `${AgenID}|${NoDokumen}`
}

export function ringkasPiutangTerbuka(
  rows: { agenId: string; noDokumen: string; outstanding: number; daysOverdue: number }[]
): RingkasanPiutangTerbuka {
  const agen: Record<string, PiutangTerbukaRingkas> = {};
  const dokumen: Record<string, PiutangTerbukaRingkas> = {};
  const add = (map: Record<string, PiutangTerbukaRingkas>, key: string, outstanding: number, days: number) => {
    const cur = map[key];
    map[key] = cur ? [cur[0] + outstanding, Math.max(cur[1], days)] : [outstanding, days];
  };
  for (const r of rows) {
    add(agen, r.agenId, r.outstanding, r.daysOverdue);
    add(dokumen, `${r.agenId}|${r.noDokumen}`, r.outstanding, r.daysOverdue);
  }
  for (const map of [agen, dokumen]) for (const k in map) map[k][0] = Math.round(map[k][0]);
  return { agen, dokumen };
}
