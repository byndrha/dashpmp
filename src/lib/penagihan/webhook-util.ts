import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizePhone } from "@/lib/bychat/phone";

// Logika murni webhook pesan masuk ByChat: verifikasi tanda tangan, deteksi kata
// opt-out, ekstraksi pengirim. Tanpa DB/HTTP supaya mudah diuji.

export const TOLERANSI_TIMESTAMP_DTK = 300;

// Tanda tangan = "sha256=" + HMAC_SHA256(secret, "<timestamp>.<body mentah>").
export function hitungTandaTangan(secret: string, timestamp: string, bodyMentah: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${bodyMentah}`).digest("hex");
}

export function verifikasiTandaTangan(p: { secret: string; timestamp: string | null; tandaTangan: string | null; bodyMentah: string; sekarang?: Date }): boolean {
  if (!p.secret || !p.timestamp || !p.tandaTangan) return false;
  const ts = Number(p.timestamp);
  if (!Number.isFinite(ts)) return false;
  const selisih = Math.abs((p.sekarang ?? new Date()).getTime() / 1000 - ts);
  if (selisih > TOLERANSI_TIMESTAMP_DTK) return false;
  const harus = Buffer.from(hitungTandaTangan(p.secret, p.timestamp, p.bodyMentah));
  const terima = Buffer.from(p.tandaTangan);
  return harus.length === terima.length && timingSafeEqual(harus, terima);
}

const FRASA = ["berhenti", "stop", "unsubscribe", "jangan kirim", "jangan tagih", "jangan hubungi", "tidak usah kirim", "tak usah kirim"];
const NEGASI = new Set(["jangan", "tidak", "tak", "belum", "bukan"]);
const MAKS_KATA = 6;

// Hanya pesan PENDEK yang memuat frasa tegas; frasa yang didahului negasi
// ("jangan stop") tidak dihitung. Kata ambigu ("sudah", "nanti") tidak pernah cukup.
export function adalahPermintaanOptOut(teks: string | null | undefined): boolean {
  if (!teks) return false;
  const kata = teks
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (kata.length === 0 || kata.length > MAKS_KATA) return false;
  const kalimat = ` ${kata.join(" ")} `;
  for (const f of FRASA) {
    const i = kalimat.indexOf(` ${f} `);
    if (i < 0) continue;
    const sebelum = kalimat.slice(0, i).trim().split(" ").pop() ?? "";
    if (f.split(" ")[0] !== "jangan" && NEGASI.has(sebelum)) continue;
    return true;
  }
  return false;
}

export interface PesanMasuk {
  accountId: number;
  conversationId: number | null;
  nomor: string | null; // kanonik; null bila kontak tak punya nomor asli
  teks: string;
}

// Hanya event message_created bertipe incoming (balasan mitra). Selain itu null.
export function bacaPesanMasuk(payload: unknown): PesanMasuk | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.event !== "message_created") return null;
  if (p.message_type !== "incoming" && p.message_type !== 0) return null;
  if (p.private === true) return null;
  const akun = (p.account as { id?: unknown } | undefined)?.id;
  const accountId = Number(akun);
  if (!Number.isInteger(accountId) || accountId <= 0) return null;
  const conv = (p.conversation ?? {}) as { id?: unknown; meta?: { sender?: { phone_number?: unknown } } };
  const telp = conv.meta?.sender?.phone_number ?? (p.sender as { phone_number?: unknown } | undefined)?.phone_number;
  const conversationId = Number(conv.id);
  return {
    accountId,
    conversationId: Number.isInteger(conversationId) ? conversationId : null,
    nomor: typeof telp === "string" ? normalizePhone(telp) : null,
    teks: typeof p.content === "string" ? p.content : "",
  };
}
