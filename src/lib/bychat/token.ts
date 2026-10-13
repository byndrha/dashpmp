import { jwtVerify, errors as joseErrors } from "jose";

// Verifikasi token konteks bertanda tangan dari ByChat (Dashboard App).
// Kontrak: bagian 11 INTEGRASI-DASHPMP-BYCHAT.md -- JWT HS256, iss="bychat",
// aud = origin dashpmp, umur 60 detik, klaim account_id (=PT),
// conversation_id, inbox_id, agent{id,name,email,role}, contact{id,name,
// phone_number,identifier}. Otoritas embed SEPENUHNYA dari token ini (tidak
// ada cookie/login dashpmp), jadi semua pemeriksaan di sini GAGAL TERTUTUP:
// rahasia belum dikonfigurasi, algoritma lain, audience/issuer salah,
// kedaluwarsa, atau klaim penting hilang -> TokenError.

export type TokenErrorKode = "konfigurasi" | "tidak_valid" | "kedaluwarsa";

export class TokenError extends Error {
  constructor(
    public kode: TokenErrorKode,
    message: string
  ) {
    super(message);
  }
}

export interface BychatClaims {
  accountId: number;
  conversationId: number | null;
  inboxId: number | null;
  agent: { id: number | null; name: string; email: string; role: string };
  contact: { id: number | null; name: string; phoneNumber: string | null; identifier: string | null };
  jti: string | null;
  exp: number;
}

export interface VerifyOptions {
  secret?: string;
  audience?: string;
  now?: Date;
}

const MAKS_UMUR_DETIK = 300; // kontrak 60 dtk; 300 = toleransi, bukan izin token berumur panjang
const MIN_PANJANG_RAHASIA = 32;

export function defaultAudience(): string {
  return (process.env.BYCHAT_EMBED_AUDIENCE || "https://dash.pabrikespmp.com").trim();
}

const asInt = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};
const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export async function verifyContextToken(token: string, options: VerifyOptions = {}): Promise<BychatClaims> {
  const secret = options.secret ?? process.env.BYCHAT_CONTEXT_SECRET ?? "";
  if (secret.length < MIN_PANJANG_RAHASIA) {
    throw new TokenError("konfigurasi", "Integrasi ByChat belum dikonfigurasi di server (rahasia konteks).");
  }
  if (!token || typeof token !== "string" || token.length > 8192) {
    throw new TokenError("tidak_valid", "Token tidak valid.");
  }

  let payload: Record<string, unknown>;
  try {
    const res = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: "bychat",
      audience: options.audience ?? defaultAudience(),
      algorithms: ["HS256"],
      requiredClaims: ["exp", "iss", "aud"],
      clockTolerance: 5,
      ...(options.now ? { currentDate: options.now } : {}),
    });
    payload = res.payload as Record<string, unknown>;
  } catch (e) {
    if (e instanceof joseErrors.JWTExpired) throw new TokenError("kedaluwarsa", "Sesi konteks kedaluwarsa. Muat ulang panel.");
    throw new TokenError("tidak_valid", "Token tidak valid.");
  }

  const exp = payload.exp as number;
  const iat = typeof payload.iat === "number" ? payload.iat : null;
  if (iat !== null && exp - iat > MAKS_UMUR_DETIK) {
    throw new TokenError("tidak_valid", "Token tidak valid (umur terlalu panjang).");
  }

  const accountId = asInt(payload.account_id);
  if (accountId === null) throw new TokenError("tidak_valid", "Token tidak memuat akun ByChat.");

  const agent = asObj(payload.agent);
  const contact = asObj(payload.contact);
  return {
    accountId,
    conversationId: asInt(payload.conversation_id),
    inboxId: asInt(payload.inbox_id),
    agent: { id: asInt(agent.id), name: asStr(agent.name), email: asStr(agent.email), role: asStr(agent.role) },
    contact: {
      id: asInt(contact.id),
      name: asStr(contact.name),
      phoneNumber: typeof contact.phone_number === "string" && contact.phone_number ? contact.phone_number : null,
      identifier: typeof contact.identifier === "string" && contact.identifier ? contact.identifier : null,
    },
    jti: typeof payload.jti === "string" ? payload.jti : null,
    exp,
  };
}
