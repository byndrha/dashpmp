// pdfmake ships no TypeScript declarations for its 0.3.x server API — this
// is a minimal ambient shim so it can be imported without a build error.
// The docDefinition/content shapes it accepts are intentionally untyped
// here; lib/pdf/delivery-order-pdf.ts is the one place that constructs them.
declare module "pdfmake" {
  interface PdfMakeDocument {
    getBuffer(): Promise<Buffer>;
  }
  interface PdfMakeStatic {
    setFonts(fonts: unknown): void;
    setUrlAccessPolicy(callback: (url: string) => boolean): void;
    setLocalAccessPolicy(callback: (path: string) => boolean): void;
    createPdf(docDefinition: unknown, options?: unknown): PdfMakeDocument;
  }
  const pdfMake: PdfMakeStatic;
  export default pdfMake;
}
