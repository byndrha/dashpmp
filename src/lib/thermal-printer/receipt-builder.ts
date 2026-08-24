"use client";

import EscPosEncoder from "esc-pos-encoder";
import { formatDate, formatTime, formatRupiah } from "@/lib/format";
import type { ThermalReceiptData } from "@/lib/queries/thermal-receipt";

// esc-pos-encoder's chained-builder shape (initialize/align/bold/line/qrcode/
// cut) was confirmed against the actually-installed v3 package at runtime —
// see src/types/esc-pos-encoder.d.ts for what that inspection found (the
// package ships no TypeScript declarations of its own). No manual
// byte-level ESC/POS command construction happens here.
export function buildReceiptBytes(data: ThermalReceiptData): Uint8Array {
  const encoder = new EscPosEncoder();
  encoder
    .initialize()
    .align("center")
    .bold(true)
    .line("SI AWAL")
    .bold(false)
    .line(data.voucherNo)
    .line(`${formatDate(data.transDate)} ${formatTime(data.transDate)}`)
    .align("left")
    .newline()
    .line(`Mitra: ${data.mitraName}`);

  if (data.mitraAddress) encoder.line(data.mitraAddress);

  encoder
    .line(`Armada: ${data.armadaNama}${data.vehicleNo ? ` (${data.vehicleNo})` : ""}`)
    .line(`Driver: ${data.driverName ?? "-"}`)
    .newline()
    .rule();

  for (const line of data.lines) {
    encoder.line(`${line.name} x${line.qty}`).align("right").line(formatRupiah(line.amount)).align("left");
  }

  encoder
    .rule()
    .bold(true)
    .align("right")
    .line(`TOTAL: ${formatRupiah(data.total)}`)
    .bold(false)
    .align("left")
    .newline();

  if (data.bankTransfer) {
    encoder
      .line("Transfer ke:")
      .line(`${data.bankTransfer.bankNama} ${data.bankTransfer.nomorRekening}`)
      .line(`a.n. ${data.bankTransfer.atasNama}`)
      .newline();
  }

  encoder
    .align("center")
    .line("Scan untuk lihat tagihan & bayar QRIS:")
    .qrcode(data.invoiceUrl, { size: 6 })
    .newline()
    .line("SI Awal - nominal dapat berubah")
    .line("sesuai kondisi pengiriman di lapangan")
    .newline()
    .cut();

  return encoder.encode();
}
