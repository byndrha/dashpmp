import { createCipheriv, createDecipheriv, createHash, createHmac } from "crypto";
import { getPool, sql } from "@/lib/db";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Derived from AUTH_SECRET (already required for NextAuth) with a distinct
// "info" prefix, so a leaked invoice token can't be used to derive anything
// about the session-signing secret itself.
function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured — cannot encode/decode invoice tokens");
  return createHash("sha256").update(`invoice-public-link:${secret}`).digest();
}

// Deterministic, not random — the same invoice always encodes to the same
// token string, so a "lihat invoice" button always returns the same
// shareable URL on every render, with nothing persisted anywhere to look it
// up again. Safe under AES-GCM's nonce-reuse rules: this (key, iv) pair is
// only ever used to encrypt this one specific plaintext (the id itself), by
// construction, never a second different plaintext.
function deriveIv(key: Buffer, salesInvoiceId: string): Buffer {
  return createHmac("sha256", key).update(salesInvoiceId).digest().subarray(0, IV_LENGTH);
}

// No `DashboardInvoicePublicLink` table, no per-invoice row to create —
// every Sales Invoice is reachable this way automatically, and the page
// always reflects live invoice/payment data instead of a snapshot.
export function encodeInvoiceToken(salesInvoiceId: string): string {
  const key = getKey();
  const iv = deriveIv(key, salesInvoiceId);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(salesInvoiceId, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
}

// Returns null for any malformed/tampered/forged token (bad base64, wrong
// length, failed GCM auth tag) — deliberately without distinguishing why, so
// a caller can't fingerprint which tokens are "almost valid".
function decodeInvoiceToken(token: string): string | null {
  try {
    const key = getKey();
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

export interface PublicInvoice {
  SalesInvoiceID: string;
  VoucherNo: string;
  TransDate: string | Date;
  DueDate: string | Date | null;
  Netto: number;
  CustomerName: string;
  // True once si.Paid covers si.Netto — this already reflects the ERP's own
  // payment accounting regardless of how many separate SalesPayment rows
  // (or a single payment spanning several invoices via SalesPaymentDetail)
  // contributed to it, same logic as sales-cards.ts's PaymentStatus. Once
  // true, the page shows a "sudah lunas" message instead of billing details.
  IsPaid: boolean;
}

// Only ever selects the SalesInvoice/BusinessPartner columns already
// confirmed live elsewhere in this codebase (aging.ts, sales.ts,
// sales-cards.ts) — no column here is a guess. Always a live query, never a
// stored snapshot, so a token's rendered amount/paid-status is always
// current as of the moment it's opened.
export async function getInvoiceByToken(token: string): Promise<PublicInvoice | null> {
  const salesInvoiceId = decodeInvoiceToken(token);
  if (!salesInvoiceId) return null;

  const pool = await getPool();
  const result = await pool
    .request()
    .input("salesInvoiceId", sql.VarChar(16), salesInvoiceId).query(`
      SELECT si.SalesInvoiceID, si.VoucherNo, si.TransDate, si.DueDate, si.Netto, si.Paid, bp.Name AS CustomerName
      FROM SalesInvoice si
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
      WHERE si.SalesInvoiceID = @salesInvoiceId AND si.IsDeleted = 0
    `);
  const row = result.recordset[0] as
    | {
        SalesInvoiceID: string;
        VoucherNo: string;
        TransDate: string | Date;
        DueDate: string | Date | null;
        Netto: number;
        Paid: number;
        CustomerName: string;
      }
    | undefined;
  if (!row) return null;

  return {
    SalesInvoiceID: row.SalesInvoiceID,
    VoucherNo: row.VoucherNo,
    TransDate: row.TransDate,
    DueDate: row.DueDate,
    Netto: row.Netto,
    CustomerName: row.CustomerName,
    IsPaid: row.Netto > 0 && row.Paid >= row.Netto,
  };
}
