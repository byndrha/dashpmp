// DB-free constants/types for the Pelunasan (payment recording) feature —
// kept separate from queries/pelunasan.ts so client components can import
// these types without pulling `mssql` into the browser bundle (same pattern
// as armada-activity-types.ts / doc-template-types.ts).

import type { Konteks } from "@/lib/queries/metode-pembayaran";

export interface PaymentAllocationInput {
  salesInvoiceId: string;
  amount: number;
}

export interface RecordPaymentInput {
  businessPartnerId: string;
  perusahaanId: number;
  metodePembayaranKode: string;
  // Which surface is submitting this payment — must match one of the
  // resolved metode_pembayaran row's `konteks` entries. Prevents e.g. a
  // driver-app session from calling a kasir-only method (Kas Besar) even
  // though the read path (listActiveMetodePembayaran) already filters it
  // out of the UI; recordPayment() must not just trust the client.
  konteks: Konteks;
  allocations: PaymentAllocationInput[];
  notes?: string;
}

export interface RecordPaymentResult {
  salesPaymentId: string;
  voucherNo: string;
  totalAmount: number;
  totalDeposit: number;
}
