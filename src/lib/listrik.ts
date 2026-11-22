// Modul Kelistrikan tahap 1 (docs/riset/2026-11-22-riset-kelistrikan.md):
// tipe & perhitungan murni, aman dipakai di client. Satu meter utama PLN per
// perusahaan; operator mencatat angka di meter (stand) + foto, minimal di
// batas WBP (17.00 & 22.00 WIB). Selisih stand antar-pembacaan memisahkan
// WBP (17→22) dan LWBP (22 kemarin → 17 hari ini) walaupun meter tidak
// menampilkan register WBP/LWBP terpisah.
//
// Semua waktu disimpan sebagai instan UTC sejati (timestamptz) dan hanya
// dikonversi ke WIB saat menentukan slot / menampilkan.

export type SlotListrik = "mulai_wbp" | "akhir_wbp" | "lain";
export type SumberBacaan = "manual" | "otomatis";

export interface PengaturanListrik {
  golongan: string | null;
  dayaKva: number | null;
  faktorKali: number | null;
  hargaLwbp: number | null; // Rp per kWh di luar beban puncak
  faktorK: number | null; // harga WBP = K × harga LWBP
  jamWbpMulai: number; // jam WIB
  jamWbpSelesai: number;
  registerTerpisah: boolean; // meter menampilkan stand LWBP & WBP sendiri-sendiri
  diubahOlehNama: string | null;
  diubahAt: string | null;
}

export const PENGATURAN_BAWAAN: PengaturanListrik = {
  golongan: null,
  dayaKva: null,
  faktorKali: null,
  hargaLwbp: null,
  faktorK: null,
  jamWbpMulai: 17,
  jamWbpSelesai: 22,
  registerTerpisah: false,
  diubahOlehNama: null,
  diubahAt: null,
};

export interface BacaanMeter {
  id: string;
  waktu: string; // ISO, instan UTC
  slot: SlotListrik;
  kwhTotal: number | null;
  kwhLwbp: number | null;
  kwhWbp: number | null;
  kvarh: number | null;
  fotoPath: string | null;
  sumber: SumberBacaan;
  catatan: string | null;
  olehNama: string;
}

/** Stand total: register tunggal, atau LWBP + WBP bila meter memisahkannya. */
export function standTotal(
  b: Pick<BacaanMeter, "kwhTotal" | "kwhLwbp" | "kwhWbp">
): number | null {
  if (b.kwhTotal != null) return b.kwhTotal;
  if (b.kwhLwbp != null && b.kwhWbp != null) return b.kwhLwbp + b.kwhWbp;
  return null;
}

// Pembacaan di luar ±TOLERANSI dari jam batas WBP dicatat sebagai "lain"
// (mis. pergantian shift) — tetap dipakai untuk riwayat & validasi stand.
export const TOLERANSI_SLOT_MENIT = 60;
// Di dalam jendela slot, selisih > ini ditandai "terlambat".
export const TEPAT_WAKTU_MENIT = 20;

const FORMAT_WIB = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Tanggal (YYYY-MM-DD) dan menit-dalam-hari menurut jam dinding WIB. */
export function wib(d: Date | string): { tanggal: string; menit: number } {
  const bagian = Object.fromEntries(
    FORMAT_WIB.formatToParts(new Date(d)).map((p) => [p.type, p.value])
  );
  return {
    tanggal: `${bagian.year}-${bagian.month}-${bagian.day}`,
    menit: Number(bagian.hour) * 60 + Number(bagian.minute),
  };
}

export function slotDari(
  d: Date | string,
  p: Pick<PengaturanListrik, "jamWbpMulai" | "jamWbpSelesai">
): SlotListrik {
  const { menit } = wib(d);
  if (Math.abs(menit - p.jamWbpMulai * 60) <= TOLERANSI_SLOT_MENIT)
    return "mulai_wbp";
  if (Math.abs(menit - p.jamWbpSelesai * 60) <= TOLERANSI_SLOT_MENIT)
    return "akhir_wbp";
  return "lain";
}

export function geserTanggal(iso: string, hari: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + hari);
  return d.toISOString().slice(0, 10);
}

export type StatusSlot =
  | {
      status: "tercatat";
      bacaan: BacaanMeter;
      selisihMenit: number;
      tepat: boolean;
    }
  | { status: "kosong" }
  | { status: "belum_waktunya" }
  // Sebelum pembacaan pertama perusahaan ini — pencatatan belum dimulai,
  // tidak dihitung sebagai terlewat.
  | { status: "belum_dimulai" };

export interface HariListrik {
  tanggal: string;
  mulai: StatusSlot;
  akhir: StatusSlot;
  // Pemakaian dalam satuan register (sebelum faktor kali) — null bila
  // pembacaan pembatasnya tidak lengkap.
  lwbpRegister: number | null;
  wbpRegister: number | null;
  kvarhRegister: number | null;
  // Sudah dikali faktor kali (null bila faktor kali belum diisi).
  lwbpKwh: number | null;
  wbpKwh: number | null;
  totalKwh: number | null;
  biaya: number | null;
  faktorDaya: number | null;
}

function pilihSlot(
  daftar: BacaanMeter[],
  tanggal: string,
  slot: SlotListrik,
  jam: number
): BacaanMeter | null {
  let terbaik: BacaanMeter | null = null;
  let jarak = Infinity;
  for (const b of daftar) {
    if (b.slot !== slot) continue;
    const w = wib(b.waktu);
    if (w.tanggal !== tanggal) continue;
    const s = Math.abs(w.menit - jam * 60);
    if (s < jarak) {
      jarak = s;
      terbaik = b;
    }
  }
  return terbaik;
}

function statusSlot(
  b: BacaanMeter | null,
  tanggal: string,
  jam: number,
  sekarang: { tanggal: string; menit: number },
  mulai: { tanggal: string; menit: number } | null
): StatusSlot {
  if (b) {
    const selisih = wib(b.waktu).menit - jam * 60;
    return {
      status: "tercatat",
      bacaan: b,
      selisihMenit: selisih,
      tepat: Math.abs(selisih) <= TEPAT_WAKTU_MENIT,
    };
  }
  if (
    !mulai ||
    tanggal < mulai.tanggal ||
    (tanggal === mulai.tanggal && jam * 60 + TOLERANSI_SLOT_MENIT < mulai.menit)
  ) {
    return { status: "belum_dimulai" };
  }
  const belum =
    tanggal > sekarang.tanggal ||
    (tanggal === sekarang.tanggal &&
      sekarang.menit < jam * 60 + TOLERANSI_SLOT_MENIT);
  return belum ? { status: "belum_waktunya" } : { status: "kosong" };
}

function selisih(
  a: number | null | undefined,
  b: number | null | undefined
): number | null {
  return a != null && b != null ? a - b : null;
}

/**
 * Rekap per hari (terbaru dulu). LWBP hari D = stand 17.00 D − stand 22.00
 * D−1; WBP hari D = stand 22.00 D − stand 17.00 D. kVArh dari 22.00 ke
 * 22.00. Biaya hanya bila faktor kali, harga LWBP, dan K sudah diisi.
 */
export function rekapHarian(
  bacaan: BacaanMeter[],
  p: PengaturanListrik,
  sekarangMs: number,
  jumlahHari: number,
  pertamaIso: string | null
): HariListrik[] {
  const sekarang = wib(new Date(sekarangMs));
  const mulai = pertamaIso ? wib(pertamaIso) : null;
  const hasil: HariListrik[] = [];
  for (let i = 0; i < jumlahHari; i++) {
    const tanggal = geserTanggal(sekarang.tanggal, -i);
    const kemarin = geserTanggal(tanggal, -1);
    const b17 = pilihSlot(bacaan, tanggal, "mulai_wbp", p.jamWbpMulai);
    const b22 = pilihSlot(bacaan, tanggal, "akhir_wbp", p.jamWbpSelesai);
    const b22Kemarin = pilihSlot(bacaan, kemarin, "akhir_wbp", p.jamWbpSelesai);

    const lwbpRegister = selisih(
      b17 && standTotal(b17),
      b22Kemarin && standTotal(b22Kemarin)
    );
    const wbpRegister = selisih(b22 && standTotal(b22), b17 && standTotal(b17));
    const kvarhRegister = selisih(b22?.kvarh, b22Kemarin?.kvarh);

    const kali = p.faktorKali;
    const lwbpKwh =
      kali != null && lwbpRegister != null ? lwbpRegister * kali : null;
    const wbpKwh =
      kali != null && wbpRegister != null ? wbpRegister * kali : null;
    const totalKwh =
      lwbpKwh != null && wbpKwh != null ? lwbpKwh + wbpKwh : null;
    const biaya =
      lwbpKwh != null &&
      wbpKwh != null &&
      p.hargaLwbp != null &&
      p.faktorK != null
        ? lwbpKwh * p.hargaLwbp + wbpKwh * p.hargaLwbp * p.faktorK
        : null;
    const kvarhKwh =
      kali != null && kvarhRegister != null ? kvarhRegister * kali : null;
    const faktorDaya =
      totalKwh != null && kvarhKwh != null && totalKwh > 0
        ? totalKwh / Math.sqrt(totalKwh ** 2 + kvarhKwh ** 2)
        : null;

    hasil.push({
      tanggal,
      mulai: statusSlot(b17, tanggal, p.jamWbpMulai, sekarang, mulai),
      akhir: statusSlot(b22, tanggal, p.jamWbpSelesai, sekarang, mulai),
      lwbpRegister,
      wbpRegister,
      kvarhRegister,
      lwbpKwh,
      wbpKwh,
      totalKwh,
      biaya,
      faktorDaya,
    });
  }
  return hasil;
}

/**
 * Tandai pembacaan yang lonjakannya tidak wajar: laju (register per jam)
 * sejak pembacaan sebelumnya > 3× median laju seluruh interval. Butuh
 * minimal 6 interval supaya mediannya berarti.
 */
export function bacaanTidakWajar(bacaan: BacaanMeter[]): Set<string> {
  const urut = [...bacaan].sort((a, b) => a.waktu.localeCompare(b.waktu));
  const laju: { id: string; v: number }[] = [];
  for (let i = 1; i < urut.length; i++) {
    const a = standTotal(urut[i - 1]);
    const b = standTotal(urut[i]);
    const jam =
      (new Date(urut[i].waktu).getTime() -
        new Date(urut[i - 1].waktu).getTime()) /
      3_600_000;
    if (a == null || b == null || jam < 0.25) continue;
    laju.push({ id: urut[i].id, v: (b - a) / jam });
  }
  const tanda = new Set<string>();
  if (laju.length < 6) return tanda;
  const nilai = laju.map((l) => l.v).sort((x, y) => x - y);
  const median = nilai[Math.floor(nilai.length / 2)];
  if (median <= 0) return tanda;
  for (const l of laju) if (l.v > median * 3) tanda.add(l.id);
  return tanda;
}

export const LABEL_SLOT: Record<SlotListrik, string> = {
  mulai_wbp: "Awal WBP",
  akhir_wbp: "Akhir WBP",
  lain: "Tambahan",
};

export function jamLabel(jam: number): string {
  return `${String(jam).padStart(2, "0")}.00`;
}
