// Templat redaksi pesan penagihan (logika murni, aman dipakai di server maupun klien).
// Baris yang memuat variabel kosong (mis. {rekening} tanpa rekening, {tautan} tanpa
// tautan) dibuang seluruhnya supaya pesan tidak menyisakan kalimat menggantung.

export const VARIABEL_TEMPLAT = [
  { nama: "mitra", keterangan: "Nama mitra" },
  { nama: "pt", keterangan: "Nama PT" },
  { nama: "tanggal", keterangan: "Tanggal posisi piutang, mis. 13 Okt 2026" },
  { nama: "total", keterangan: "Total piutang, mis. Rp 1.250.000" },
  { nama: "jumlah_faktur", keterangan: "Jumlah faktur outstanding" },
  { nama: "rekening", keterangan: "Daftar rekening pembayaran (kosong bila PT belum punya rekening)" },
  { nama: "tautan", keterangan: "Tautan kartu piutang tanpa login" },
] as const;

export type NamaVariabel = (typeof VARIABEL_TEMPLAT)[number]["nama"];
export type NilaiTemplat = Record<NamaVariabel, string>;

export const MAKS_PANJANG_TEMPLAT = 2000;

export const TEMPLAT_AWAL = [
  "Yth. {mitra},",
  "",
  "Berikut kartu piutang {pt} per {tanggal}.",
  "Total piutang: {total} ({jumlah_faktur} faktur).",
  "",
  "{rekening}",
  "",
  "Lihat kartu piutang (tanpa login): {tautan}",
  "",
  "Mohon dicek dan dikonfirmasi pembayarannya. Terima kasih.",
].join("\n");

const POLA_VARIABEL = /\{([^{}\n]*)\}/g;
const NAMA_DIKENAL = new Set<string>(VARIABEL_TEMPLAT.map((v) => v.nama));

export function renderTemplat(templat: string, nilai: NilaiTemplat): string {
  const hasil: string[] = [];
  for (const baris of templat.split("\n")) {
    let kosong = false;
    const terisi = baris.replace(POLA_VARIABEL, (utuh, nama: string) => {
      if (!NAMA_DIKENAL.has(nama)) return utuh;
      const v = nilai[nama as NamaVariabel];
      if (v === "") kosong = true;
      return v;
    });
    if (!kosong) hasil.push(terisi);
  }
  return hasil.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function validasiTemplat(templat: string): string | null {
  if (templat.trim() === "") return "Templat pesan tidak boleh kosong.";
  if (templat.length > MAKS_PANJANG_TEMPLAT) return `Templat pesan maksimal ${MAKS_PANJANG_TEMPLAT} karakter.`;
  for (const m of templat.matchAll(POLA_VARIABEL)) {
    if (!NAMA_DIKENAL.has(m[1])) return `Variabel {${m[1]}} tidak dikenal. Yang tersedia: ${VARIABEL_TEMPLAT.map((v) => `{${v.nama}}`).join(", ")}.`;
  }
  return null;
}

// Contoh data untuk pratinjau di UI.
export const CONTOH_TEMPLAT: NilaiTemplat = {
  mitra: "Toko Maju Jaya",
  pt: "PT Contoh",
  tanggal: "13 Okt 2026",
  total: "Rp 1.250.000",
  jumlah_faktur: "3",
  rekening: "Pembayaran dapat ditransfer ke:\nBCA 1234567890 a.n. PT Contoh",
  tautan: "https://dash.example.com/kartu/aB3dE5gH7j",
};
