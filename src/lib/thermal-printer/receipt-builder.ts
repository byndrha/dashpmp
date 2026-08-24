"use client";

import EscPosEncoder from "esc-pos-encoder";
import { formatDate, formatTime, formatRupiah } from "@/lib/format";
import type { ThermalReceiptData } from "@/lib/queries/thermal-receipt";
import type { PrintFormatSettings } from "@/lib/queries/print-format-settings";

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

// The encoder's own .rule() helper prints a Unicode box-drawing character
// (─, CP437) — on hardware with no matching printer profile configured (see
// the constructor comment above), the active codepage table on the actual
// printer may not agree with the byte the library picks for that glyph, so
// nothing visible comes out. A plain ASCII hyphen is identical across every
// single-byte codepage an ESC/POS printer could possibly be set to, so it
// can never suffer this mismatch.
const HORIZONTAL_RULE = "-".repeat(THERMAL_PAPER_COLUMNS_58MM);

export function buildReceiptBytes(data: ThermalReceiptData, settings: PrintFormatSettings): Uint8Array {
  const encoder = new EscPosEncoder({ columns: THERMAL_PAPER_COLUMNS_58MM });
  encoder
    .initialize()
    .align("center")
    .bold(true)
    .line("Es Kristal - Pabrik Es PMP Group | Ponorogo")
    .bold(false)
    .line(data.voucherNo)
    .line(`${formatDate(data.transDate)} ${formatTime(data.transDate)}`)
    .align("left")
    .newline()
    .line(`Mitra: ${data.mitraName}`);

  if (data.mitraAddress && settings.showMitraAddress) encoder.line(data.mitraAddress);

  encoder.line(`Armada: ${data.armadaNama}${data.vehicleNo ? ` (${data.vehicleNo})` : ""}`);
  if (settings.showDriverName) encoder.line(`Driver: ${data.driverName ?? "-"}`);

  encoder.newline().line(HORIZONTAL_RULE);

  for (const line of data.lines) {
    encoder.line(`${line.name} x${line.qty}`).align("right").line(formatRupiah(line.amount)).align("left");
  }

  encoder
    .line(HORIZONTAL_RULE)
    .bold(true)
    .align("right")
    .line(`TOTAL: ${formatRupiah(data.total)}`)
    .bold(false)
    .align("left")
    .newline();

  if (data.bankTransfer && settings.showBankTransfer) {
    encoder
      .line("Transfer ke:")
      .line(`${data.bankTransfer.bankNama} ${data.bankTransfer.nomorRekening}`)
      .line(`a.n. ${data.bankTransfer.atasNama}`)
      .newline();
  }

  if (settings.showQrCode) {
    encoder
      .align("center")
      .line("Scan untuk lihat tagihan & bayar QRIS:")
      // model: 1 — many budget ESC/POS-clone printers (including this one)
      // only implement QR "model 1"; the library's own default (model 2,
      // used when no model is specified) prints as a firmware error message
      // instead of a code on hardware that doesn't support it. Untested
      // hypothesis against the real printer — confirm this actually renders
      // a scannable code before treating it as settled.
      .qrcode(data.invoiceUrl, { model: 1, size: 6 })
      .newline()
      .align("left");
  }

  if (settings.showDisclaimer) {
    encoder
      .align("center")
      .line("SI Awal - nominal dapat berubah")
      .line("sesuai kondisi pengiriman di lapangan")
      .newline();
  }

  encoder.cut();

  return encoder.encode();
}
