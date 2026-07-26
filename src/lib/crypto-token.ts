import { createCipheriv, createDecipheriv, createHash, createHmac } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Shared here (rather than defined in invoice-public.ts/payment-public.ts
// individually) so both files can reference the same purpose string
// without importing from each other — invoice pages link to payment pages
// and vice versa, and cross-importing would create a circular dependency.
export const INVOICE_TOKEN_PURPOSE = "invoice-public-link";
export const PAYMENT_TOKEN_PURPOSE = "payment-public-link";

// Derived from AUTH_SECRET (already required for NextAuth) with a
// purpose-specific prefix, so a token minted for one purpose (e.g. an
// invoice link) fails GCM authentication if decoded under a different
// purpose (e.g. a payment link) — needed because SalesInvoiceID and
// SalesPaymentID share the same ID format/length, so without this
// separation a token for one document could accidentally resolve to an
// unrelated document of the other type.
function getKey(purpose: string): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured — cannot encode/decode public tokens");
  return createHash("sha256").update(`${purpose}:${secret}`).digest();
}

// Deterministic, not random — the same (purpose, id) pair always encodes to
// the same token string, so a "lihat dokumen" button always returns the
// same shareable URL on every render, with nothing persisted anywhere to
// look it up again. Safe under AES-GCM's nonce-reuse rules: this (key, iv)
// pair is only ever used to encrypt this one specific plaintext (the id
// itself), by construction, never a second different plaintext.
function deriveIv(key: Buffer, plaintext: string): Buffer {
  return createHmac("sha256", key).update(plaintext).digest().subarray(0, IV_LENGTH);
}

export function encodeIdToken(purpose: string, id: string): string {
  const key = getKey(purpose);
  const iv = deriveIv(key, id);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(id, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
}

// Returns null for any malformed/tampered/forged/wrong-purpose token —
// deliberately without distinguishing why, so a caller can't fingerprint
// which tokens are "almost valid".
export function decodeIdToken(purpose: string, token: string): string | null {
  try {
    const key = getKey(purpose);
    const buf = Buffer.from(token, "base64url");
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH || encrypted.length === 0) return null;
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}
