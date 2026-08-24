import { getPool, sql } from "@/lib/db";

export interface PrintFormatSettings {
  showMitraAddress: boolean;
  showDriverName: boolean;
  showBankTransfer: boolean;
  showQrCode: boolean;
  showDisclaimer: boolean;
}

// Only used if the seeded row is ever somehow missing (should never happen —
// the migration that created DashboardPrintFormatSettings always inserts
// exactly one row) — same defensive-fallback shape as site-settings.ts.
const PRINT_FORMAT_SETTINGS_FALLBACK: PrintFormatSettings = {
  showMitraAddress: true,
  showDriverName: true,
  showBankTransfer: true,
  showQrCode: true,
  showDisclaimer: true,
};

export async function getPrintFormatSettings(): Promise<PrintFormatSettings> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 1 ShowMitraAddress, ShowDriverName, ShowBankTransfer, ShowQrCode, ShowDisclaimer
    FROM DashboardPrintFormatSettings ORDER BY ID
  `);
  const row = result.recordset[0] as
    | {
        ShowMitraAddress: boolean;
        ShowDriverName: boolean;
        ShowBankTransfer: boolean;
        ShowQrCode: boolean;
        ShowDisclaimer: boolean;
      }
    | undefined;
  if (!row) return PRINT_FORMAT_SETTINGS_FALLBACK;
  return {
    showMitraAddress: row.ShowMitraAddress,
    showDriverName: row.ShowDriverName,
    showBankTransfer: row.ShowBankTransfer,
    showQrCode: row.ShowQrCode,
    showDisclaimer: row.ShowDisclaimer,
  };
}

export async function setPrintFormatSettings(input: PrintFormatSettings): Promise<void> {
  const pool = await getPool();
  const existing = await pool.request().query(`SELECT TOP 1 ID FROM DashboardPrintFormatSettings ORDER BY ID`);
  const id = (existing.recordset[0] as { ID: number } | undefined)?.ID;

  const request = pool
    .request()
    .input("showMitraAddress", sql.Bit, input.showMitraAddress)
    .input("showDriverName", sql.Bit, input.showDriverName)
    .input("showBankTransfer", sql.Bit, input.showBankTransfer)
    .input("showQrCode", sql.Bit, input.showQrCode)
    .input("showDisclaimer", sql.Bit, input.showDisclaimer);

  if (id != null) {
    await request.input("id", sql.Int, id).query(`
      UPDATE DashboardPrintFormatSettings
      SET ShowMitraAddress = @showMitraAddress, ShowDriverName = @showDriverName,
          ShowBankTransfer = @showBankTransfer, ShowQrCode = @showQrCode,
          ShowDisclaimer = @showDisclaimer, UpdatedAt = GETDATE()
      WHERE ID = @id
    `);
  } else {
    // Defensive only — the migration always seeds one row, so this branch
    // shouldn't run in practice.
    await request.query(`
      INSERT INTO DashboardPrintFormatSettings (ShowMitraAddress, ShowDriverName, ShowBankTransfer, ShowQrCode, ShowDisclaimer)
      VALUES (@showMitraAddress, @showDriverName, @showBankTransfer, @showQrCode, @showDisclaimer)
    `);
  }
}
