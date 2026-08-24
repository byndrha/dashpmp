"use client";

import EscPosEncoder from "esc-pos-encoder";
import { formatDate, formatTime, formatRupiah } from "@/lib/format";
import type { ThermalReceiptData } from "@/lib/queries/thermal-receipt";

// esc-pos-encoder's chained-builder shape (initialize/align/bold/line/qrcode/
// cut) was confirmed against the actually-installed v3 package at runtime —
// see src/types/esc-pos-encoder.d.ts for what that inspection found (the
// package ships no TypeScript declarations of its own). No manual
// byte-level ESC/POS command construction happens here.
// 32 columns is the standard width for 58mm thermal paper on Font A
// (12x24 dots) — confirmed against this library's own built-in 58mm printer
// profiles (e.g. "pos-5890", "youku-58t", both media.width:58 with
// columns:32). Left as a plain `columns` override rather than pinning to
// one of those named profiles, since the exact codepage/cutter-feed
// quirks of the real Iware C5813 haven't been verified against hardware —
// see connection.ts's own disclosed-limitation comment for the same
// caveat on the Bluetooth GATT UUIDs. Without this, the library defaults
// to 42 columns (an 80mm-class width), which silently miscomputes every
// right-aligned amount and word-wrap boundary on real 58mm paper.
const THERMAL_PAPER_COLUMNS_58MM = 32;

export function buildReceiptBytes(data: ThermalReceiptData): Uint8Array {
  const encoder = new EscPosEncoder({ columns: THERMAL_PAPER_COLUMNS_58MM });
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
