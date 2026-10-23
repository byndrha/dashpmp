// Logika murni riwayat pembayaran/faktur lunas mitra (tanpa akses database).

export const RENTANG_RIWAYAT_HARI = [30, 90, 180, 365] as const;
export type RentangRiwayat = (typeof RENTANG_RIWAYAT_HARI)[number];
export const RENTANG_RIWAYAT_DEFAULT: RentangRiwayat = 90;

export function rentangRiwayat(v: unknown): RentangRiwayat {
  const n = Number(v);
  return (RENTANG_RIWAYAT_HARI as readonly number[]).includes(n) ? (n as RentangRiwayat) : RENTANG_RIWAYAT_DEFAULT;
}

export interface PembayaranRiwayat {
  noDokumen: string;
  tanggal: string; // yyyy-MM-dd
  jumlah: number;
  untuk: string[]; // nomor faktur yang dilunasi (kosong bila sumber data tak mencatat alokasi)
  catatan: string | null;
}

export interface FakturLunasRiwayat {
  noDokumen: string;
  tanggal: string; // tanggal faktur
  nilai: number;
  tanggalLunas: string | null; // pembayaran terakhir yang tercatat; null bila tak diketahui
}

export interface RiwayatMitra {
  hari: RentangRiwayat;
  sejak: string; // yyyy-MM-dd
  pembayaran: PembayaranRiwayat[];
  fakturLunas: FakturLunasRiwayat[];
  totalPembayaran: number;
  totalFakturLunas: number;
}

export function sejakWib(hari: number, now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600 * 1000 - hari * 86400000).toISOString().slice(0, 10);
}

// Terbaru -> terlama; seri tanggal sama diurutkan menurun menurut nomor dokumen.
export function urutTerbaru<T extends { tanggal: string; noDokumen: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.tanggal.localeCompare(a.tanggal) || b.noDokumen.localeCompare(a.noDokumen));
}

// Es Balok tidak menyimpan status lunas per faktur: faktur lunas = pesanan
// bernilai > 0 pada rentang yang TIDAK ada di daftar outstanding FIFO.
export function fakturLunasEsBalok(
  pesanan: { noDokumen: string; tanggal: string; nilai: number }[],
  outstandingNoDokumen: Set<string>,
  sejak: string
): FakturLunasRiwayat[] {
  return urutTerbaru(
    pesanan
      .filter((p) => p.nilai > 0 && p.tanggal >= sejak && !outstandingNoDokumen.has(p.noDokumen))
      .map((p) => ({ noDokumen: p.noDokumen, tanggal: p.tanggal, nilai: p.nilai, tanggalLunas: null }))
  );
}

export function susunRiwayat(hari: RentangRiwayat, pembayaran: PembayaranRiwayat[], fakturLunas: FakturLunasRiwayat[]): RiwayatMitra {
  const p = urutTerbaru(pembayaran);
  const f = urutTerbaru(fakturLunas);
  return {
    hari,
    sejak: sejakWib(hari),
    pembayaran: p,
    fakturLunas: f,
    totalPembayaran: p.reduce((s, x) => s + x.jumlah, 0),
    totalFakturLunas: f.reduce((s, x) => s + x.nilai, 0),
  };
}
