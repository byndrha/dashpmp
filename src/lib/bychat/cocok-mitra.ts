// Pencocokan nomor percakapan ByChat ke mitra — murni (tanpa DB) supaya bisa
// diuji. Kandidat datang dari prefilter SQL `last9` di mitra.ts; keputusan
// akhir SELALU lewat phoneMatches (nomor kanonik utuh), sehingga mitra yang
// hanya kebetulan sama 8 digit terakhirnya tidak ikut.
// Spec §9.6: kontak yang diperiksa = kontak lokasi utama (MobileNo/PhoneNo
// atau Telepon) + kontak alamat mitra + kontak lokasi pengiriman tambahan aktif.
import { phoneMatches } from "@/lib/bychat/phone";

export interface KandidatKontakMitra {
  id: string;
  kontak: (string | null)[];
}

/** ID kandidat yang salah satu kolom kontaknya memuat `nomor`, urut seperti masukan. */
export function cocokkanNomorKeMitra(nomor: string, kandidat: KandidatKontakMitra[]): string[] {
  const hasil: string[] = [];
  for (const k of kandidat) {
    if (hasil.includes(k.id)) continue;
    if (k.kontak.some((kolom) => phoneMatches(kolom, nomor))) hasil.push(k.id);
  }
  return hasil;
}
