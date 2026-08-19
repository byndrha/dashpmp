import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Derived from AUTH_SECRET (already required for NextAuth) with a
// purpose-specific prefix, independent from src/lib/crypto-token.ts's own
// derived keys (invoice/payment public links) — a leaked value from one
// purpose can't be used to derive another.
//
// IMPORTANT — rotating AUTH_SECRET now breaks live dashboard connectivity,
// not just the admin credential UI: src/lib/db.ts's getPool() calls
// resolveKoneksi() on every fresh connection, which decrypts the live
// MKEsindo perusahaan_koneksi row using this same key. Rotate AUTH_SECRET
// without first re-encrypting that row under the new secret, and the next
// getPool() call throws and the whole live app goes down. Safe rotation
// order: (1) deploy the NEW AUTH_SECRET, (2) immediately re-enter every
// perusahaan_koneksi password via the /grup/perusahaan admin UI so it gets
// re-encrypted under the new secret (or re-seed the rows directly) — do
// this before any getPool() call is made against the new secret, i.e.
// before/at the same deploy, not as a follow-up.
function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured — cannot encrypt/decrypt stored secrets");
  return createHash("sha256").update(`perusahaan-db-credential:${secret}`).digest();
}

// Random IV per call, unlike crypto-token.ts's deterministic IV — a stored
// secret has no "same link every time" requirement, and determinism here
// would only leak which stored passwords happen to be identical.
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
}

export function decryptSecret(ciphertext: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertext, "base64url");
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

// Separate derived key from getKey()'s "perusahaan-db-credential:" prefix —
// a leaked Google Drive refresh token must not also unlock DB credentials,
// and vice versa (same principle as this file's existing getKey() comment).
function getGDriveKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured — cannot encrypt/decrypt stored secrets");
  return createHash("sha256").update(`gdrive-refresh-token:${secret}`).digest();
}

export function encryptGDriveToken(plaintext: string): string {
  const key = getGDriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
}

export function decryptGDriveToken(ciphertext: string): string {
  const key = getGDriveKey();
  const buf = Buffer.from(ciphertext, "base64url");
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
