// DB-free constants/types for the Pelunasan (payment recording) feature —
// kept separate from queries/pelunasan.ts so client components can import
// PAYMENT_CHANNELS as a value without pulling `mssql` into the browser
// bundle (same pattern as armada-activity-types.ts / doc-template-types.ts).

// The 3 ChartOfAccountID values actually used for SalesPayment.ChartOfAccountID
// in production (confirmed via direct SQL query against ChartOfAccount).
// A 4th "QRIS Dinamis (Mandiri Livin Merchant)" channel will be added once
// the user shares real Mandiri merchant API credentials/documentation —
// don't add it speculatively before that.
export const PAYMENT_CHANNELS = [
  { id: "014", label: "Kas Kecil" },
  { id: "013", label: "Kas Besar" },
  { id: "01000096", label: "Bank Mandiri - 6708" },
] as const;

export type PaymentChannelId = (typeof PAYMENT_CHANNELS)[number]["id"];

export interface PaymentAllocationInput {
  salesInvoiceId: string;
  amount: number;
}

export interface RecordPaymentInput {
  businessPartnerId: string;
  chartOfAccountId: PaymentChannelId;
  allocations: PaymentAllocationInput[];
  notes?: string;
}

export interface RecordPaymentResult {
  salesPaymentId: string;
  voucherNo: string;
  totalAmount: number;
  totalDeposit: number;
}
