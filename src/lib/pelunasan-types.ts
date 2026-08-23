// DB-free constants/types for the Pelunasan (payment recording) feature —
// kept separate from queries/pelunasan.ts so client components can import
// these types without pulling `mssql` into the browser bundle (same pattern
// as armada-activity-types.ts / doc-template-types.ts).

export interface PaymentAllocationInput {
  salesInvoiceId: string;
  amount: number;
}

export interface RecordPaymentInput {
  businessPartnerId: string;
  perusahaanId: number;
  metodePembayaranKode: string;
  allocations: PaymentAllocationInput[];
  notes?: string;
}

export interface RecordPaymentResult {
  salesPaymentId: string;
  voucherNo: string;
  totalAmount: number;
  totalDeposit: number;
}
