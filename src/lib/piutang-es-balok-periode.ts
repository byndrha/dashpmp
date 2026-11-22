// Periode halaman Piutang Es Balok — SATU sumber untuk render server, Server
// Action, dan isian tanggal di browser, supaya angka awal halaman sama persis
// dengan angka setelah menekan "Terapkan".
//
// - Tanggal kalender diambil menurut WIB (Asia/Jakarta), bukan UTC: sebelum
//   jam 07.00 WIB, toISOString() masih menunjuk hari kemarin.
// - Batas query dibangun sebagai tengah malam UTC: ERP menyimpan Tanggal
//   sebagai WIB "naif" dan driver mssql mengirim Date sebagai UTC — sama
//   dengan monthsWindow() tabel Tren Pergerakan Piutang Bulanan.
// Modul biasa tanpa akses DB — aman diimpor dari komponen klien.

const FORMAT_WIB = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" });

export function hariIniWibISO(): string {
  return FORMAT_WIB.format(new Date()); // YYYY-MM-DD
}

// Bawaan halaman: tanggal 1 bulan berjalan s.d. hari ini (WIB).
export function periodeBawaanPiutang(): { awalISO: string; akhirISO: string } {
  const akhirISO = hariIniWibISO();
  return { awalISO: `${akhirISO.slice(0, 8)}01`, akhirISO };
}

// [awal, akhir+1 hari) sebagai tengah malam UTC — akhir inklusif.
export function rentangQueryPiutang(awalISO: string, akhirISO: string): { start: Date; end: Date } {
  const start = new Date(`${awalISO}T00:00:00Z`);
  const end = new Date(`${akhirISO}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}
