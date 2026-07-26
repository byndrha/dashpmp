import { getPool, sql } from "@/lib/db";
import { encodeIdToken, decodeIdToken, INVOICE_TOKEN_PURPOSE, PAYMENT_TOKEN_PURPOSE } from "@/lib/crypto-token";

export function encodePaymentToken(salesPaymentId: string): string {
  return encodeIdToken(PAYMENT_TOKEN_PURPOSE, salesPaymentId);
}

function decodePaymentToken(token: string): string | null {
  return decodeIdToken(PAYMENT_TOKEN_PURPOSE, token);
}

export interface PublicPaymentInvoiceLine {
  SalesInvoiceID: string;
  VoucherNo: string;
  // Amount of this specific payment applied to this specific invoice — a
  // single payment can cover several invoices at once via SalesPaymentDetail.
  Amount: number;
  Token: string;
}

export interface PublicPayment {
  SalesPaymentID: string;
  VoucherNo: string;
  TransDate: string | Date;
  Amount: number;
  CustomerName: string;
  Invoices: PublicPaymentInvoiceLine[];
}

// Same public/no-login shape as invoice-public.ts's getInvoiceByToken —
// only ever selects columns already confirmed live elsewhere in this
// codebase (piutang-payments.ts, sales-cards.ts, notifications.ts).
export async function getPaymentByToken(token: string): Promise<PublicPayment | null> {
  const salesPaymentId = decodePaymentToken(token);
  if (!salesPaymentId) return null;

  const pool = await getPool();
  const [headerResult, linesResult] = await Promise.all([
    pool
      .request()
      .input("salesPaymentId", sql.VarChar(16), salesPaymentId).query(`
        SELECT sp.SalesPaymentID, sp.VoucherNo, sp.TransDate, sp.Amount, bp.Name AS CustomerName
        FROM SalesPayment sp
        LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = sp.BusinessPartnerID
        WHERE sp.SalesPaymentID = @salesPaymentId AND sp.IsDeleted = 0
      `),
    pool
      .request()
      .input("salesPaymentId", sql.VarChar(16), salesPaymentId).query(`
        SELECT spd.SalesInvoiceID, si.VoucherNo, spd.Amount
        FROM SalesPaymentDetail spd
        JOIN SalesInvoice si ON si.SalesInvoiceID = spd.SalesInvoiceID AND si.IsDeleted = 0
        WHERE spd.SalesPaymentID = @salesPaymentId AND spd.IsDeleted = 0
        ORDER BY si.TransDate
      `),
  ]);

  const header = headerResult.recordset[0] as
    | { SalesPaymentID: string; VoucherNo: string; TransDate: string | Date; Amount: number; CustomerName: string }
    | undefined;
  if (!header) return null;

  const invoiceLines = linesResult.recordset as { SalesInvoiceID: string; VoucherNo: string; Amount: number }[];

  return {
    SalesPaymentID: header.SalesPaymentID,
    VoucherNo: header.VoucherNo,
    TransDate: header.TransDate,
    Amount: header.Amount,
    CustomerName: header.CustomerName,
    Invoices: invoiceLines.map((l) => ({
      SalesInvoiceID: l.SalesInvoiceID,
      VoucherNo: l.VoucherNo,
      Amount: l.Amount,
      Token: encodeIdToken(INVOICE_TOKEN_PURPOSE, l.SalesInvoiceID),
    })),
  };
}
