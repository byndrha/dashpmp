"use client";

import EscPosEncoder from "esc-pos-encoder";
import { formatDateWib, formatTimeWib, formatRupiah } from "@/lib/format";
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

// Target size (in printer dots) for the QRIS Statis image's LONGER side —
// the other side is scaled proportionally from the source image's real
// aspect ratio (see buildQrisImage below), so a non-square upload (a QR
// code with a bank logo strip, for instance) never comes out stretched.
const QRIS_IMAGE_TARGET_DOTS = 300;

// GS v 0 (the raster-image print command @point-of-sale/receipt-printer-
// encoder's .image() emits) requires both dimensions to be a multiple of 8
// dots — this rounds to the nearest multiple of 8 without ever collapsing
// a real dimension to 0.
function roundToMultipleOf8(dots: number): number {
  return Math.max(8, Math.round(dots / 8) * 8);
}

// Decodes the data: URI into an <img> element and computes the width/height
// (in dots, multiples of 8) to print it at, preserving the source image's
// own aspect ratio. Resolves null if the image fails to decode (a
// corrupted/unsupported data URI) — the caller treats that exactly like a
// missing image, silently omitting the QRIS block rather than failing the
// whole print job over a decorative asset.
async function loadQrisImageElement(
  dataUri: string
): Promise<{ element: HTMLImageElement; width: number; height: number } | null> {
  try {
    const element = new Image();
    element.src = dataUri;
    await element.decode();
    const naturalWidth = element.naturalWidth || 1;
    const naturalHeight = element.naturalHeight || 1;
    const scale = QRIS_IMAGE_TARGET_DOTS / Math.max(naturalWidth, naturalHeight);
    return {
      element,
      width: roundToMultipleOf8(naturalWidth * scale),
      height: roundToMultipleOf8(naturalHeight * scale),
    };
  } catch {
    return null;
  }
}

export async function buildReceiptBytes(data: ThermalReceiptData, settings: PrintFormatSettings): Promise<Uint8Array> {
  // Decoded before any bytes are queued — the encoder's chained builder
  // methods are synchronous, so any async work (image decoding) has to
  // finish first rather than being interleaved mid-chain.
  const qrisImage =
    settings.showQrCode && data.qrisStatisImageDataUri ? await loadQrisImageElement(data.qrisStatisImageDataUri) : null;

  const encoder = new EscPosEncoder({ columns: THERMAL_PAPER_COLUMNS_58MM });
  encoder
    .initialize()
    .align("center")
    .bold(true)
    .line("Pabrik Es PMP Group")
    .line("Es Kristal | Ponorogo")
    .bold(false)
    .line(data.voucherNo)
    .line(`${formatDateWib(data.transDate)} ${formatTimeWib(data.transDate)}`)
    .align("left")
    .newline()
    .line(`Mitra: ${data.mitraName}`);

  if (data.mitraAddress && settings.showMitraAddress) encoder.line(data.mitraAddress);

  encoder.line(`Armada: ${data.armadaNama}${data.vehicleNo ? ` (${data.vehicleNo})` : ""}`);
  if (settings.showDriverName) encoder.line(`Driver: ${data.driverName ?? "-"}`);
  encoder.line(`Operasional: ${data.operationalName}`);

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

  if (qrisImage) {
    encoder.align("center").image(qrisImage.element, qrisImage.width, qrisImage.height).align("left").newline();
  }

  if (data.bankTransfer && settings.showBankTransfer) {
    encoder
      .line(`${data.bankTransfer.bankNama} ${data.bankTransfer.nomorRekening}`)
      .line(`a.n. ${data.bankTransfer.atasNama}`)
      .newline();
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
