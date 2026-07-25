import { randomBytes } from "crypto";
import { getPool, sql } from "@/lib/db";

// A random, unguessable bearer token — not literal encryption (nothing here
// is ever decrypted). Anyone holding the token can view the invoice; the
// security property this needs is "can't be guessed or enumerated", which a
// 32-byte random value already gives without any cipher/key-management
// machinery.
export function generateInvoiceToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface PublicInvoice {
  SalesInvoiceID: string;
  VoucherNo: string;
  TransDate: string | Date;
  DueDate: string | Date | null;
  Netto: number;
  CustomerName: string;
}

// Only ever selects the SalesInvoice/BusinessPartner columns already
// confirmed live elsewhere in this codebase (aging.ts, sales.ts) — no
// column here is a guess. Returns null for an unknown/expired token,
// deliberately without distinguishing "malformed" from "valid but
// nonexistent" so a caller can't fingerprint which tokens are real.
export async function getInvoiceByToken(token: string): Promise<PublicInvoice | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("token", sql.VarChar(64), token).query(`
      SELECT si.SalesInvoiceID, si.VoucherNo, si.TransDate, si.DueDate, si.Netto, bp.Name AS CustomerName
      FROM DashboardInvoicePublicLink pl
      JOIN SalesInvoice si ON si.SalesInvoiceID = pl.SalesInvoiceID AND si.IsDeleted = 0
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
      WHERE pl.Token = @token
    `);
  return (result.recordset[0] as PublicInvoice | undefined) ?? null;
}
