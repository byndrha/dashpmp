// Kotak pencarian /mkesindo/pemesanan — aman dipakai di browser & server.
//
// Nomor dokumen ERP MKEsindo berbentuk `MKE/SO/003655/2026-11/003/001`:
// kode jenis, nomor urut, PERIODE (tahun-bulan), lalu kode cabang/seri.
// Nomor urut DIULANG setiap bulan dan per cabang (dicek live 2026-11-21:
// MKE/SO/000012 ada di 2026-06 s.d. 2026-11, dan dua kali di 2026-08 untuk
// seri 003 & 004). Karena itu:
//   - angka saja ("3646", "si 3646") dicari di data yang sedang tampil
//     (sesuai filter tanggal) — tanpa periode tidak bisa dipastikan bulan apa;
//   - nomor berperiode ("MKE/SI/003449/2026-11/…", "si 3449/2026-11") dicari
//     ke server di semua tanggal, karena dokumennya bisa saja di luar filter.
// Selain bentuk nomor, ketikan dianggap nama mitra.

export type KodeDokumen = "SO" | "DO" | "SI" | "SR";
export const KODE_DOKUMEN: KodeDokumen[] = ["SO", "DO", "SI", "SR"];

export type KueriPemesanan =
  | { jenis: "kosong" }
  | { jenis: "nama"; teks: string }
  | {
      jenis: "dokumen";
      kode: KodeDokumen | null; // null = semua jenis
      nomor: number;
      periode: string | null; // "2026-11"
      seri: string | null; // sisa nomor setelah periode, mis. "003/001"
      teks: string; // ketikan asli (huruf kecil) — angka saja juga dicocokkan ke nama
    };

// Contoh yang dikenali: "3646", "003646", "si3646", "SI 3646", "SI/3646",
// "MKE/SI/3646", "si 3449/2026-11", "MKE/SI/003449/2026-11/003/001".
const POLA_DOKUMEN =
  /^(?:MKE\s*\/?\s*)?(SO|DO|SI|SR)?\s*[/\-\s]?\s*(\d{1,7})(?:\s*[/\s]\s*(\d{4})-(\d{1,2})(?:\s*\/\s*(.+))?)?$/i;

export function parseKueriPemesanan(input: string): KueriPemesanan {
  const teks = input.trim().replace(/\s+/g, " ");
  if (!teks) return { jenis: "kosong" };
  const m = POLA_DOKUMEN.exec(teks);
  if (m) {
    const nomor = Number(m[2]);
    if (Number.isSafeInteger(nomor) && nomor > 0) {
      return {
        jenis: "dokumen",
        kode: m[1] ? (m[1].toUpperCase() as KodeDokumen) : null,
        nomor,
        periode: m[3] ? `${m[3]}-${m[4].padStart(2, "0")}` : null,
        seri: m[5] ? m[5].replace(/\s+/g, "").toUpperCase() : null,
        teks: teks.toLowerCase(),
      };
    }
  }
  return { jenis: "nama", teks: teks.toLowerCase() };
}

interface BagianNomor {
  kode: string;
  nomor: number;
  periode: string;
  seri: string;
}

function pecahNomor(voucherNo: string): BagianNomor | null {
  const p = voucherNo.trim().toUpperCase().split("/");
  if (p.length < 3) return null;
  return { kode: p[1], nomor: Number(p[2]), periode: p[3] ?? "", seri: p.slice(4).join("/") };
}

export function nomorCocok(voucherNo: string | null | undefined, kueri: Extract<KueriPemesanan, { jenis: "dokumen" }>): boolean {
  if (!voucherNo) return false;
  const b = pecahNomor(voucherNo);
  if (!b || b.nomor !== kueri.nomor) return false;
  if (kueri.kode && b.kode !== kueri.kode) return false;
  if (kueri.periode && b.periode !== kueri.periode) return false;
  if (kueri.seri && !b.seri.startsWith(kueri.seri)) return false;
  return true;
}

export interface NomorDokumenPesanan {
  CustomerName: string;
  VoucherNo: string;
  DoVoucherNo: string | null;
  SiVoucherNo: string | null;
  SrVoucherNo: string | null;
}

export function nomorPerKode(row: NomorDokumenPesanan): Record<KodeDokumen, string | null> {
  return { SO: row.VoucherNo, DO: row.DoVoucherNo, SI: row.SiVoucherNo, SR: row.SrVoucherNo };
}

// Hasil pencocokan satu pesanan: null = tidak cocok; [] = cocok lewat nama;
// selain itu daftar dokumen yang nomornya cocok (untuk disorot di kartu).
export function cocokkanPesanan(row: NomorDokumenPesanan, kueri: KueriPemesanan): KodeDokumen[] | null {
  if (kueri.jenis === "kosong") return [];
  if (kueri.jenis === "nama") return row.CustomerName.toLowerCase().includes(kueri.teks) ? [] : null;
  const nomor = nomorPerKode(row);
  const kena = KODE_DOKUMEN.filter((k) => nomorCocok(nomor[k], kueri));
  if (kena.length) return kena;
  // Angka saja (tanpa kode & periode) bisa juga bagian nama mitra ("Toko 88").
  if (!kueri.kode && !kueri.periode && row.CustomerName.toLowerCase().includes(kueri.teks)) return [];
  return null;
}

// Pola LIKE untuk pencarian server (hanya bila kueri berperiode). Nomor urut
// di ERP selalu 6 digit berawalan nol.
export function polaLikeDokumen(kode: KodeDokumen, kueri: Extract<KueriPemesanan, { jenis: "dokumen" }>): string {
  const nomor = String(kueri.nomor).padStart(6, "0");
  const seri = kueri.seri ? `/${kueri.seri}` : "";
  return `MKE/${kode}/${nomor}/${kueri.periode}${seri}%`;
}
