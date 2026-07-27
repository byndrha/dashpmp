// Split out from queries/doc-template.ts (which pulls in @/lib/db -> mssql
// -> Node-only modules) — DB-free so doc-template-panel.tsx, a client
// component, can import the constants/types without bundling the query
// layer into the browser. Same pattern as armada-activity-types.ts.
export type DocType = "DeliveryOrder";
export const PAPER_SIZES = ["A4", "A5", "Letter", "Custom"] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

export interface DocTemplate {
  docType: DocType;
  paperSize: PaperSize;
  customWidthMM: number | null;
  customHeightMM: number | null;
  headerTitle: string;
  headerAddress: string | null;
  logoPath: string | null;
  showDriverInfo: boolean;
  showArmadaInfo: boolean;
  showBonusColumn: boolean;
  showSignatureBlock: boolean;
  footerNotes: string | null;
}
