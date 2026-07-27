import { getPool, sql } from "@/lib/db";
import type { DocType, PaperSize, DocTemplate } from "@/lib/doc-template-types";

// Constants/types moved to lib/doc-template-types.ts (DB-free) so
// doc-template-panel.tsx, a client component, can import them without
// bundling this file's mssql-dependent query functions into the browser.
export type { DocType, PaperSize, DocTemplate } from "@/lib/doc-template-types";
export { PAPER_SIZES } from "@/lib/doc-template-types";

// One configurable print template per document type — starts with
// "DeliveryOrder" (the "cetak DO fisik" feature), reusable later for other
// printed documents (e.g. a TakeAway SalesInvoice) without a schema change,
// just a new DocType row. Single-row-per-DocType, upserted as a whole.

const DEFAULT_TEMPLATE: Omit<DocTemplate, "docType"> = {
  paperSize: "A5",
  customWidthMM: null,
  customHeightMM: null,
  headerTitle: "PT Mitra Kelola Esindo",
  headerAddress: null,
  logoPath: null,
  showDriverInfo: true,
  showArmadaInfo: true,
  showBonusColumn: true,
  showSignatureBlock: true,
  footerNotes: null,
};

export async function getDocTemplate(docType: DocType): Promise<DocTemplate> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("docType", sql.VarChar(30), docType)
    .query(`SELECT * FROM DashboardDocTemplate WHERE DocType = @docType`);
  const row = result.recordset[0] as
    | {
        DocType: DocType;
        PaperSize: PaperSize;
        CustomWidthMM: number | null;
        CustomHeightMM: number | null;
        HeaderTitle: string | null;
        HeaderAddress: string | null;
        LogoPath: string | null;
        ShowDriverInfo: boolean;
        ShowArmadaInfo: boolean;
        ShowBonusColumn: boolean;
        ShowSignatureBlock: boolean;
        FooterNotes: string | null;
      }
    | undefined;
  if (!row) return { docType, ...DEFAULT_TEMPLATE };
  return {
    docType,
    paperSize: row.PaperSize,
    customWidthMM: row.CustomWidthMM,
    customHeightMM: row.CustomHeightMM,
    headerTitle: row.HeaderTitle?.trim() || DEFAULT_TEMPLATE.headerTitle,
    headerAddress: row.HeaderAddress,
    logoPath: row.LogoPath,
    showDriverInfo: row.ShowDriverInfo,
    showArmadaInfo: row.ShowArmadaInfo,
    showBonusColumn: row.ShowBonusColumn,
    showSignatureBlock: row.ShowSignatureBlock,
    footerNotes: row.FooterNotes,
  };
}

export async function saveDocTemplate(input: DocTemplate): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("docType", sql.VarChar(30), input.docType)
    .input("paperSize", sql.VarChar(10), input.paperSize)
    .input("customWidthMM", sql.Decimal(6, 1), input.customWidthMM)
    .input("customHeightMM", sql.Decimal(6, 1), input.customHeightMM)
    .input("headerTitle", sql.VarChar(150), input.headerTitle)
    .input("headerAddress", sql.VarChar(255), input.headerAddress)
    .input("logoPath", sql.VarChar(255), input.logoPath)
    .input("showDriverInfo", sql.Bit, input.showDriverInfo)
    .input("showArmadaInfo", sql.Bit, input.showArmadaInfo)
    .input("showBonusColumn", sql.Bit, input.showBonusColumn)
    .input("showSignatureBlock", sql.Bit, input.showSignatureBlock)
    .input("footerNotes", sql.VarChar(500), input.footerNotes).query(`
      MERGE DashboardDocTemplate AS target
      USING (SELECT @docType AS DocType) AS src
      ON target.DocType = src.DocType
      WHEN MATCHED THEN UPDATE SET
        PaperSize = @paperSize, CustomWidthMM = @customWidthMM, CustomHeightMM = @customHeightMM,
        HeaderTitle = @headerTitle, HeaderAddress = @headerAddress, LogoPath = @logoPath,
        ShowDriverInfo = @showDriverInfo, ShowArmadaInfo = @showArmadaInfo, ShowBonusColumn = @showBonusColumn,
        ShowSignatureBlock = @showSignatureBlock, FooterNotes = @footerNotes, ModifiedDate = GETDATE()
      WHEN NOT MATCHED THEN INSERT
        (DocType, PaperSize, CustomWidthMM, CustomHeightMM, HeaderTitle, HeaderAddress, LogoPath,
         ShowDriverInfo, ShowArmadaInfo, ShowBonusColumn, ShowSignatureBlock, FooterNotes, ModifiedDate)
        VALUES (@docType, @paperSize, @customWidthMM, @customHeightMM, @headerTitle, @headerAddress, @logoPath,
                @showDriverInfo, @showArmadaInfo, @showBonusColumn, @showSignatureBlock, @footerNotes, GETDATE());
    `);
}
