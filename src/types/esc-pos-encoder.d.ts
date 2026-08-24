// esc-pos-encoder@3.0 ships no TypeScript declarations at all (nor does
// @point-of-sale/receipt-printer-encoder, the library it now wraps — see
// that package's README: "EscPosEncoder is now ReceiptPrinterEncoder").
// This is a minimal ambient shim covering only the chained builder methods
// this repo actually calls. Verified against the installed v3.0.0 package
// at runtime (Node REPL against node_modules, not just reading source):
// every method below returns the same encoder instance for chaining,
// align() throws "Unknown alignment" for values outside left/center/right,
// qrcode()'s `size` option is validated to the 1-8 range (unknown option
// keys are silently ignored rather than rejected), and encode() returns a
// Uint8Array of raw ESC/POS bytes. receipt-builder.ts is the one place that
// constructs receipts with this API.
declare module "esc-pos-encoder" {
  type EscPosAlignment = "left" | "center" | "right";

  interface EscPosQrCodeOptions {
    size?: number; // module size, validated to the range 1-8
  }

  class EscPosEncoder {
    constructor(options?: unknown);
    initialize(): this;
    align(value: EscPosAlignment): this;
    bold(value?: boolean): this;
    line(text: string): this;
    newline(): this;
    rule(): this;
    qrcode(data: string, options?: EscPosQrCodeOptions): this;
    cut(): this;
    encode(): Uint8Array;
  }

  export default EscPosEncoder;
}
