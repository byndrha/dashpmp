// Normalisasi nomor telepon untuk mencocokkan kontak WhatsApp ByChat dengan
// data mitra dashpmp. ERP menyimpan nomor apa adanya (BusinessPartner.MobileNo,
// PMP_Agen.Telepon): ada yang "0812-3456-7890", "+62 812...", dua nomor dalam
// satu kolom, atau teks campur nama. Bentuk kanonik: "62" + nomor tanpa 0,
// hanya digit (mis. "6281234567890"), sama dengan format `phone` API ByChat.
// Hanya nomor Indonesia (62) yang dikenali; selain itu null (tidak ditebak).

const KANONIK = /^62[1-9]\d{7,11}$/;

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0062")) digits = digits.slice(2);
  else if (digits.startsWith("62")) digits = digits;
  else if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  else return null;
  return KANONIK.test(digits) ? digits : null;
}

// Satu kolom bisa memuat lebih dari satu nomor (dipisah / , ; | atau baris
// baru). Mengembalikan semua nomor kanonik yang valid, tanpa duplikat.
export function extractPhones(raw: string | null | undefined): string[] {
  if (!raw || !String(raw).trim()) return [];
  const hasil: string[] = [];
  for (const bagian of String(raw).split(/[/,;|\n\r]+/)) {
    const n = normalizePhone(bagian);
    if (n && !hasil.includes(n)) hasil.push(n);
  }
  return hasil;
}

export function phoneMatches(kolom: string | null | undefined, target: string | null | undefined): boolean {
  const t = normalizePhone(target);
  if (!t) return false;
  return extractPhones(kolom).includes(t);
}

// 9 digit terakhir nomor kanonik -- dipakai sebagai prefilter LIKE di SQL
// (kolom ERP tidak seragam, jadi pencocokan akhir tetap di JS lewat
// phoneMatches). null bila terlalu pendek.
export function last9(kanonik: string): string | null {
  const d = String(kanonik).replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : null;
}
