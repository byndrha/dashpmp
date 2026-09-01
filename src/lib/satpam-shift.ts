import { getNaiveWibNow } from "@/lib/business-date";

export type SatpamShiftType = "SHIFT1" | "SHIFT2" | "SHIFT3" | "LONG_MALAM" | "LONG_PAGI";

export const SATPAM_SHIFT_LIST: SatpamShiftType[] = ["SHIFT1", "SHIFT2", "SHIFT3", "LONG_MALAM", "LONG_PAGI"];

export const SATPAM_SHIFT_LABEL: Record<SatpamShiftType, string> = {
  SHIFT1: "Shift 1 (06:00–13:59)",
  SHIFT2: "Shift 2 (14:00–21:59)",
  SHIFT3: "Shift 3 (22:00–05:59)",
  LONG_MALAM: "Long Shift Malam (18:00–05:59)",
  LONG_PAGI: "Long Shift Pagi (06:00–17:59)",
};

// startHour/endHour dalam jam WIB. crossesMidnight = true berarti endHour
// jatuh di TanggalUsaha + 1 hari, bukan hari yang sama.
const SATPAM_SHIFT_HOURS: Record<SatpamShiftType, { startHour: number; endHour: number; crossesMidnight: boolean }> = {
  SHIFT1: { startHour: 6, endHour: 14, crossesMidnight: false },
  SHIFT2: { startHour: 14, endHour: 22, crossesMidnight: false },
  SHIFT3: { startHour: 22, endHour: 6, crossesMidnight: true },
  LONG_MALAM: { startHour: 18, endHour: 6, crossesMidnight: true },
  LONG_PAGI: { startHour: 6, endHour: 18, crossesMidnight: false },
};

// Jendela waktu aktual [start, end) untuk satu baris jadwal, sebagai
// naive-WIB Date (raw UTC-component values = jam dinding WIB) — pola yang
// sama seperti getShiftWindow di report-shift.ts, TAPI TanggalUsaha di sini
// artinya tanggal kalender SAAT SHIFT MULAI (dihitung maju), bukan tanggal
// bisnis dengan rollover mundur seperti report-shift.ts. Jangan disamakan.
export function getSatpamShiftWindow(tanggalUsaha: Date, shiftType: SatpamShiftType): { start: Date; end: Date } {
  const { startHour, endHour, crossesMidnight } = SATPAM_SHIFT_HOURS[shiftType];
  const y = tanggalUsaha.getUTCFullYear();
  const m = tanggalUsaha.getUTCMonth();
  const d = tanggalUsaha.getUTCDate();
  return {
    start: new Date(Date.UTC(y, m, d, startHour, 0, 0)),
    end: new Date(Date.UTC(y, m, d + (crossesMidnight ? 1 : 0), endHour, 0, 0)),
  };
}

export interface SatpamJadwalRow {
  jadwalJagaId: number;
  tanggalUsaha: Date;
  shiftType: SatpamShiftType;
  satpamAkunId: number;
}

// Baris mana saja (dari kandidat yang sudah diambil pemanggil — biasanya
// untuk TanggalUsaha hari ini DAN kemarin, supaya shift semalam yang masih
// berjalan ikut tertangkap) yang jendelanya mencakup `now`. Bisa
// mengembalikan 0, 1, atau lebih dari 1 baris (Long Shift bisa tumpang
// tindih dengan shift reguler di titik pergantian) — TIDAK ada asumsi
// "maksimal satu". `now` default ke getNaiveWibNow(), BUKAN `new Date()` —
// getSatpamShiftWindow di atas membangun start/end sebagai naive-WIB, jadi
// `now` yang dibandingkan terhadapnya harus naive-WIB juga, kalau tidak
// perbandingannya meleset ~7 jam (lihat Global Constraints).
export function getSatpamOnDutyNow(rows: SatpamJadwalRow[], now: Date = getNaiveWibNow()): SatpamJadwalRow[] {
  return rows.filter((row) => {
    const { start, end } = getSatpamShiftWindow(row.tanggalUsaha, row.shiftType);
    return now >= start && now < end;
  });
}
