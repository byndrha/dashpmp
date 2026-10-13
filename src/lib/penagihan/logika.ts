import { extractPhones } from "@/lib/bychat/phone";

// Logika murni penagihan otomatis (tanpa DB/HTTP): jendela waktu WIB,
// pemilihan kandidat, penjadwalan berjeda, validasi pengaturan.

export type ModePenagihan = "pratinjau" | "otomatis";

export interface Pengaturan {
  hari: number[]; // 1 = Senin ... 7 = Minggu
  jamMulai: string; // "HH:MM" WIB
  jamSelesai: string;
  jedaMinDtk: number;
  jedaMaksDtk: number;
  jedaPanjangTiap: number; // jeda panjang setiap N pesan
  jedaPanjangDtk: number;
  batasHarian: number;
  minHariLewat: number;
  minPiutang: number;
  ulangHari: number; // jarak minimal antar penagihan satu mitra
  mode: ModePenagihan;
}

export const PENGATURAN_AWAL: Pengaturan = {
  hari: [1, 2, 3, 4, 5, 6],
  jamMulai: "09:00",
  jamSelesai: "16:00",
  jedaMinDtk: 20,
  jedaMaksDtk: 60,
  jedaPanjangTiap: 10,
  jedaPanjangDtk: 300,
  batasHarian: 100,
  minHariLewat: 7,
  minPiutang: 100000,
  ulangHari: 7,
  mode: "pratinjau",
};

const WIB_MS = 7 * 3600 * 1000;

export function waktuWib(d: Date): { tanggal: string; hari: number; menit: number } {
  const g = new Date(d.getTime() + WIB_MS);
  const dow = g.getUTCDay();
  return { tanggal: g.toISOString().slice(0, 10), hari: dow === 0 ? 7 : dow, menit: g.getUTCHours() * 60 + g.getUTCMinutes() };
}

const menitDari = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function dalamJendela(now: Date, p: Pengaturan): boolean {
  const w = waktuWib(now);
  return p.hari.includes(w.hari) && w.menit >= menitDari(p.jamMulai) && w.menit < menitDari(p.jamSelesai);
}

export interface KandidatMentah {
  mitraId: string;
  nama: string;
  kontak: string | null; // kolom telepon mentah dari ERP
  total: number;
  jumlahFaktur: number;
  hariLewatMaks: number;
}
export interface Kandidat extends KandidatMentah {
  nomor: string; // kanonik 62...
}
export interface KonteksPilih {
  jumlahMitraPerNomor: Map<string, number>; // nomor kanonik -> berapa mitra memakainya (SELURUH mitra, bukan hanya yang berpiutang)
  optout: Set<string>; // nomor kanonik
  terakhirDitagih: Map<string, Date>; // mitraId -> waktu terakhir
  sekarang: Date;
}

export function pilihKandidat(
  rows: KandidatMentah[],
  p: Pengaturan,
  k: KonteksPilih
): { terpilih: Kandidat[]; dilewati: { mitraId: string; nama: string; alasan: string }[] } {
  const dilewati: { mitraId: string; nama: string; alasan: string }[] = [];
  const lolos: Kandidat[] = [];
  for (const r of rows) {
    const lewat = (alasan: string) => dilewati.push({ mitraId: r.mitraId, nama: r.nama, alasan });
    // Belum memenuhi kriteria = memang bukan kandidat (tidak dicatat sebagai "dilewati").
    if (r.hariLewatMaks < p.minHariLewat) continue;
    if (r.total < p.minPiutang) continue;
    const nomorList = extractPhones(r.kontak);
    if (nomorList.length === 0) {
      lewat("Nomor kosong/tidak valid");
      continue;
    }
    if (nomorList.length > 1) {
      lewat("Lebih dari satu nomor di data mitra");
      continue;
    }
    const nomor = nomorList[0];
    if ((k.jumlahMitraPerNomor.get(nomor) ?? 0) > 1) {
      lewat("Nomor dipakai lebih dari satu mitra");
      continue;
    }
    if (k.optout.has(nomor)) {
      lewat("Opt-out");
      continue;
    }
    const terakhir = k.terakhirDitagih.get(r.mitraId);
    if (terakhir && (k.sekarang.getTime() - terakhir.getTime()) / 86400000 < p.ulangHari) {
      lewat(`Sudah ditagih < ${p.ulangHari} hari lalu`);
      continue;
    }
    lolos.push({ ...r, nomor });
  }
  lolos.sort((a, b) => b.hariLewatMaks - a.hariLewatMaks || b.total - a.total || a.mitraId.localeCompare(b.mitraId));
  const terpilih = lolos.slice(0, p.batasHarian);
  for (const x of lolos.slice(p.batasHarian)) dilewati.push({ mitraId: x.mitraId, nama: x.nama, alasan: "Melebihi batas harian" });
  return { terpilih, dilewati };
}

// Jadwal rencana: pesan pertama pada `mulai`, lalu jeda acak min..maks; setiap
// `jedaPanjangTiap` pesan ditambah jeda panjang. Jadwal yang melewati jam
// selesai (hari WIB yang sama) dibuang -> kandidat itu ditagih pada ronde berikut.
export function susunJadwal(jumlah: number, mulai: Date, p: Pengaturan, rng: () => number = Math.random): Date[] {
  const hasil: Date[] = [];
  const w = waktuWib(mulai);
  const akhir = new Date(`${w.tanggal}T00:00:00Z`).getTime() - WIB_MS + menitDari(p.jamSelesai) * 60000;
  let t = mulai.getTime();
  for (let i = 0; i < jumlah; i++) {
    if (i > 0) {
      t += (p.jedaMinDtk + rng() * (p.jedaMaksDtk - p.jedaMinDtk)) * 1000;
      if (i % p.jedaPanjangTiap === 0) t += p.jedaPanjangDtk * 1000;
    }
    if (t >= akhir) break;
    hasil.push(new Date(t));
  }
  return hasil;
}

export const MAKS_GAGAL_BERUNTUN = 3;
export const JEDA_AUTOPAUSE_MENIT = 60;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function validasiPengaturan(i: Partial<Pengaturan>): { ok: true; nilai: Pengaturan } | { ok: false; galat: string } {
  const p = { ...PENGATURAN_AWAL, ...i } as Pengaturan;
  const hari = Array.from(new Set((p.hari ?? []).map(Number))).sort();
  if (hari.length === 0 || hari.some((h) => !Number.isInteger(h) || h < 1 || h > 7)) return { ok: false, galat: "Pilih minimal satu hari (Senin–Minggu)." };
  if (!HHMM.test(p.jamMulai) || !HHMM.test(p.jamSelesai)) return { ok: false, galat: "Jam harus berformat HH:MM." };
  if (menitDari(p.jamMulai) >= menitDari(p.jamSelesai)) return { ok: false, galat: "Jam mulai harus lebih awal dari jam selesai." };
  const rentang = (v: number, min: number, maks: number, nama: string) =>
    !Number.isFinite(v) || v < min || v > maks ? `${nama} harus antara ${min} dan ${maks}.` : null;
  const galat =
    rentang(p.jedaMinDtk, 5, 3600, "Jeda minimum (detik)") ??
    rentang(p.jedaMaksDtk, p.jedaMinDtk, 3600, "Jeda maksimum (detik)") ??
    rentang(p.jedaPanjangTiap, 1, 1000, "Jeda panjang tiap (pesan)") ??
    rentang(p.jedaPanjangDtk, 0, 7200, "Lama jeda panjang (detik)") ??
    rentang(p.batasHarian, 1, 1000, "Batas harian") ??
    rentang(p.minHariLewat, 0, 365, "Minimal hari lewat jatuh tempo") ??
    rentang(p.minPiutang, 0, 1e12, "Minimal piutang") ??
    rentang(p.ulangHari, 1, 90, "Jarak antar penagihan (hari)");
  if (galat) return { ok: false, galat };
  if (p.mode !== "pratinjau" && p.mode !== "otomatis") return { ok: false, galat: "Mode tidak dikenal." };
  return { ok: true, nilai: { ...p, hari } };
}
