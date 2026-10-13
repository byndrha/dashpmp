import { createHash } from "node:crypto";

// Fungsi murni untuk pengiriman kartu (mudah diuji tanpa DB/HTTP).

// Stabil per (PT, mitra, tanggal posisi): klik ganda / percobaan ulang pada
// hari yang sama menghasilkan kunci yang sama sehingga ByChat (idempoten 24
// jam) tidak mengirim dua kali. JSON array menghindari ambiguitas pemisah.
export function idempotencyKey(ptKode: string, mitraId: string, tanggalPosisi: string): string {
  const h = createHash("sha256").update(JSON.stringify([ptKode, mitraId, tanggalPosisi])).digest("hex");
  return `dashpmp-kartu-${h.slice(0, 40)}`;
}

export const BATAS_JAM_ULANG = 24;

export interface KirimTerakhir {
  waktu: Date;
  agenNama: string;
}

// Bawaan: 1 kartu per 24 jam per (PT, mitra). Override: agen ber-peran
// administrator di ByChat (klaim role pada token bertanda tangan).
export function bolehKirimUlang(
  terakhir: KirimTerakhir | null,
  sekarang: Date,
  peranAgen: string | null | undefined
): { boleh: boolean; alasan?: string } {
  if (!terakhir) return { boleh: true };
  if ((peranAgen ?? "").toLowerCase() === "administrator") return { boleh: true };
  const jam = (sekarang.getTime() - terakhir.waktu.getTime()) / 3600000;
  if (jam >= BATAS_JAM_ULANG) return { boleh: true };
  const lalu = jam < 1 ? "kurang dari 1 jam" : `${Math.floor(jam)} jam`;
  return {
    boleh: false,
    alasan: `Kartu piutang mitra ini sudah dikirim ${lalu} lalu oleh ${terakhir.agenNama || "agen lain"}. Batas 1 kartu per ${BATAS_JAM_ULANG} jam.`,
  };
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const tglIndo = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
};

export interface RekeningTeks {
  bank: string;
  nomorRekening: string;
  atasNama: string;
}

// Teks pengantar yang menyertai gambar (Bahasa Indonesia, sopan, singkat).
// Rekening ikut ditulis sebagai TEKS (bukan hanya di gambar) supaya nomornya
// bisa disalin mitra.
export function buatPengantar(p: {
  mitra: string;
  pt: string;
  tanggal: string;
  total: number;
  jumlahFaktur: number;
  rekening?: RekeningTeks[];
  tautan?: string;
}): string {
  const baris = [
    `Yth. ${p.mitra},`,
    "",
    `Berikut kartu piutang ${p.pt} per ${tglIndo(p.tanggal)}.`,
    `Total piutang: Rp ${Math.round(p.total).toLocaleString("id-ID")} (${p.jumlahFaktur} faktur).`,
  ];
  const rek = p.rekening ?? [];
  if (rek.length > 0) {
    baris.push("", "Pembayaran dapat ditransfer ke:");
    for (const r of rek) baris.push(`${r.bank} ${r.nomorRekening}${r.atasNama ? ` a.n. ${r.atasNama}` : ""}`);
  }
  if (p.tautan) baris.push("", `Lihat kartu piutang (tanpa login): ${p.tautan}`);
  baris.push("", "Mohon dicek dan dikonfirmasi pembayarannya. Terima kasih.");
  return baris.join("\n");
}
