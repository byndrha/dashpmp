import pdfMake from "pdfmake";
import path from "path";
import fs from "fs";
import { formatDate } from "@/lib/format";
import type { DocTemplate } from "@/lib/queries/doc-template";
import type { DeliveryOrderPrintData } from "@/lib/queries/delivery-order-print";

// pdfmake needs real font files on disk for its server-side renderer — it
// bundles Roboto under its own package dir, so no separate font asset is
// needed here — reading them also goes through pdfmake's local access
// policy, so that policy must allow exactly this one directory rather than
// denying everything outright. setUrlAccessPolicy stays fully denied: this
// document never fetches a remote URL (the logo is embedded as a data URI
// below), so there's no legitimate case to allow there.
let fontsConfigured = false;
function ensureFonts() {
  if (fontsConfigured) return;
  const fontDir = path.join(process.cwd(), "node_modules", "pdfmake", "fonts", "Roboto");
  pdfMake.setFonts({
    Roboto: {
      normal: path.join(fontDir, "Roboto-Regular.ttf"),
      bold: path.join(fontDir, "Roboto-Medium.ttf"),
      italics: path.join(fontDir, "Roboto-Italic.ttf"),
      bolditalics: path.join(fontDir, "Roboto-MediumItalic.ttf"),
    },
  });
  pdfMake.setUrlAccessPolicy(() => false);
  pdfMake.setLocalAccessPolicy((filePath: string) => path.resolve(filePath).startsWith(fontDir));
  fontsConfigured = true;
}

const MM_PER_POINT = 25.4 / 72;

function resolvePageSize(template: DocTemplate): unknown {
  if (template.paperSize === "Custom") {
    if (template.customWidthMM && template.customHeightMM) {
      return {
        width: template.customWidthMM / MM_PER_POINT,
        height: template.customHeightMM / MM_PER_POINT,
      };
    }
    return "A5";
  }
  return template.paperSize;
}

function readLogoDataUri(logoPath: string | null): string | undefined {
  if (!logoPath) return undefined;
  try {
    const filePath = path.join(process.cwd(), "public", logoPath.replace(/^\//, ""));
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase() || "png";
    const mime = ext === "jpg" ? "jpeg" : ext;
    return `data:image/${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return undefined;
  }
}

export async function generateDeliveryOrderPdf(data: DeliveryOrderPrintData, template: DocTemplate): Promise<Buffer> {
  ensureFonts();
  const logoImage = readLogoDataUri(template.logoPath);

  const columnCount = 4 + (template.showBonusColumn ? 1 : 0);
  const headerRow = [
    { text: "No", style: "th" },
    { text: "Nama Barang", style: "th" },
    { text: "Qty", style: "th", alignment: "right" },
    ...(template.showBonusColumn ? [{ text: "Bonus", style: "th", alignment: "right" }] : []),
    { text: "Satuan", style: "th" },
  ];
  const bodyRows = data.lines.map((line, i) => [
    { text: String(i + 1) },
    { text: line.Name },
    { text: String(line.Qty), alignment: "right" },
    ...(template.showBonusColumn ? [{ text: line.BonusQty > 0 ? String(line.BonusQty) : "-", alignment: "right" }] : []),
    { text: line.Unit },
  ]);

  const infoColumns = [];
  if (template.showArmadaInfo) infoColumns.push({ text: `Armada: ${data.header.VehicleNo || "-"}` });
  if (template.showDriverInfo) infoColumns.push({ text: `Driver: ${data.header.DriverName || "-"}` });

  const content: unknown[] = [
    {
      columns: [
        logoImage ? { image: logoImage, width: 36 } : { text: "", width: 0 },
        {
          stack: [
            { text: template.headerTitle, style: "companyName" },
            ...(template.headerAddress ? [{ text: template.headerAddress, style: "small" }] : []),
          ],
        },
      ],
    },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1 }], margin: [0, 6, 0, 0] },
    { text: "SURAT JALAN", style: "title", margin: [0, 8, 0, 8] },
    {
      columns: [
        { text: `No: ${data.header.VoucherNo}` },
        { text: `Tanggal: ${formatDate(data.header.TransDate)}`, alignment: "right" },
      ],
    },
    { text: "Kepada Yth,", margin: [0, 8, 0, 0] },
    { text: data.header.CustomerName, bold: true },
    ...(data.header.Alamat ? [{ text: data.header.Alamat }] : []),
    ...(infoColumns.length > 0 ? [{ columns: infoColumns, margin: [0, 8, 0, 0] }] : []),
    {
      table: {
        headerRows: 1,
        widths: Array.from({ length: columnCount }, (_, i) => (i === 1 ? "*" : "auto")),
        body: [headerRow, ...bodyRows],
      },
      margin: [0, 12, 0, 0],
    },
    ...(template.footerNotes ? [{ text: template.footerNotes, style: "small", margin: [0, 12, 0, 0] }] : []),
    ...(template.showSignatureBlock
      ? [
          {
            columns: [
              { stack: [{ text: "Pengirim", alignment: "center" }, { text: "\n\n\n" }, { text: "(_______________)", alignment: "center" }] },
              { stack: [{ text: "Penerima", alignment: "center" }, { text: "\n\n\n" }, { text: "(_______________)", alignment: "center" }] },
            ],
            margin: [0, 24, 0, 0],
          },
        ]
      : []),
  ];

  const docDefinition = {
    pageSize: resolvePageSize(template),
    pageMargins: [24, 24, 24, 24],
    content,
    defaultStyle: { font: "Roboto", fontSize: 9 },
    styles: {
      companyName: { fontSize: 12, bold: true },
      small: { fontSize: 8, color: "#555555" },
      title: { fontSize: 11, bold: true, alignment: "center" },
      th: { bold: true, fillColor: "#eeeeee" },
    },
  };

  const doc = pdfMake.createPdf(docDefinition);
  return doc.getBuffer();
}
