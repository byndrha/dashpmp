import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import { getMkesindoPerusahaanId } from "@/lib/queries/perusahaan";
import { listActiveMetodePembayaran } from "@/lib/queries/metode-pembayaran";
import { encodeInvoiceToken } from "@/lib/queries/invoice-public";

export interface ThermalReceiptLine {
  name: string;
  qty: number;
  amount: number;
}

export interface ThermalReceiptBankTransfer {
  bankNama: string;
  nomorRekening: string;
  atasNama: string;
}

export interface ThermalReceiptData {
  mitraName: string;
  mitraAddress: string | null;
  voucherNo: string;
  transDate: string;
  armadaNama: string;
  vehicleNo: string | null;
  driverName: string | null;
  lines: ThermalReceiptLine[];
  total: number;
  // Absolute URL to the existing public invoice page — printed as a native
  // ESC/POS QR code rather than a rasterized image, so the printer never
  // needs to render a bitmap. See the design spec's own reasoning: a
  // printed-at-departure static QRIS amount would go stale the moment
  // retur/non-delivery adjusts the real Netto after departure, but this
  // link always resolves to the live page.
  invoiceUrl: string;
  // Null when no active TRANSFER method with bank details is configured —
  // the receipt builder (Task 9) simply omits that block in that case.
  bankTransfer: ThermalReceiptBankTransfer | null;
}

// Deliberately its own query, not a reuse of invoice-public.ts's
// getInvoiceByToken — a thermal receipt is a different document (adds
// Armada/plat/Driver, omits "Tagihan Lain yang Masih Berjalan" entirely,
// never fetches it) even though both read from the same underlying tables.
export async function getThermalReceiptData(salesInvoiceId: string): Promise<ThermalReceiptData> {
  const pool = await getPool();

  const headerResult = await pool
    .request()
    .input("id", sql.VarChar(16), salesInvoiceId).query(`
      SELECT si.SalesInvoiceID, si.VoucherNo, si.TransDate, si.Netto, si.DeliveryOrderID,
             bp.Name AS MitraName, bp.Address AS MitraAddress
      FROM SalesInvoice si
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
      WHERE si.SalesInvoiceID = @id AND si.IsDeleted = 0
    `);
  const header = headerResult.recordset[0] as
    | {
        SalesInvoiceID: string;
        VoucherNo: string;
        TransDate: Date;
        Netto: number;
        DeliveryOrderID: string | null;
        MitraName: string;
        MitraAddress: string | null;
      }
    | undefined;
  if (!header) throw new AppError("SalesInvoice tidak ditemukan.");

  // Same literal-quote-character quirk as invoice-public.ts's
  // getInvoiceByToken — SalesInvoice.DeliveryOrderID is stored wrapped in
  // single quotes (e.g. "'01185115'").
  const deliveryOrderId = header.DeliveryOrderID ? header.DeliveryOrderID.replace(/'/g, "").trim() || null : null;

  const linesResult = await pool
    .request()
    .input("id", sql.VarChar(16), salesInvoiceId)
    .query(`SELECT Name, Qty, Amount FROM SalesInvoiceDetail WHERE SalesInvoiceID = @id ORDER BY SalesInvoiceDetailID`);
  const lines = (linesResult.recordset as { Name: string; Qty: number; Amount: number }[]).map((l) => ({
    name: l.Name,
    qty: l.Qty,
    amount: l.Amount,
  }));

  let armadaNama = "";
  let vehicleNo: string | null = null;
  let driverName: string | null = null;
  if (deliveryOrderId) {
    const deliveryResult = await pool
      .request()
      .input("doId", sql.VarChar(16), deliveryOrderId).query(`
        SELECT a.Nama AS ArmadaNama, ed.VehicleNo, sm.Name AS DriverName
        FROM DeliveryOrder do_
        LEFT JOIN DashboardPengirimanJadwalDetail jadd ON jadd.DeliveryOrderID = do_.DeliveryOrderID AND jadd.IsDeleted = 0
        LEFT JOIN DashboardPengirimanJadwal jad ON jad.JadwalID = jadd.JadwalID
        LEFT JOIN DashboardArmada a ON a.ArmadaID = jad.ArmadaID
        LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
        LEFT JOIN Salesman sm ON sm.SalesmanID = jad.SalesmanID
        WHERE do_.DeliveryOrderID = @doId AND do_.IsDeleted = 0
      `);
    const deliveryRow = deliveryResult.recordset[0] as
      | { ArmadaNama: string | null; VehicleNo: string | null; DriverName: string | null }
      | undefined;
    armadaNama = deliveryRow?.ArmadaNama ?? "";
    vehicleNo = deliveryRow?.VehicleNo ?? null;
    driverName = deliveryRow?.DriverName ?? null;
  }

  const perusahaanId = await getMkesindoPerusahaanId();
  const transferMethods = await listActiveMetodePembayaran(perusahaanId, "publik");
  const transferRow = transferMethods.find((m) => m.metode === "TRANSFER" && m.nomorRekening);
  const bankTransfer: ThermalReceiptBankTransfer | null = transferRow
    ? {
        bankNama: transferRow.bankNama ?? "",
        nomorRekening: transferRow.nomorRekening ?? "",
        atasNama: transferRow.atasNama ?? "",
      }
    : null;

  return {
    mitraName: header.MitraName,
    mitraAddress: header.MitraAddress,
    voucherNo: header.VoucherNo,
    transDate: header.TransDate.toISOString(),
    armadaNama,
    vehicleNo,
    driverName,
    lines,
    total: header.Netto,
    invoiceUrl: `${process.env.NEXTAUTH_URL ?? ""}/mkesindo/invoice/${encodeInvoiceToken(salesInvoiceId)}`,
    bankTransfer,
  };
}
