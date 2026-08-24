import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import { getMkesindoPerusahaanId } from "@/lib/queries/perusahaan";
import { listActiveMetodePembayaran } from "@/lib/queries/metode-pembayaran";
import { getFileBuffer } from "@/lib/storage/google-drive";

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
  // Staff who triggered this print (the account whose session called
  // getThermalReceiptDataAction), not a DB-stored field — passed in from
  // the action layer, where the logged-in session is already available.
  operationalName: string;
  lines: ThermalReceiptLine[];
  total: number;
  // Null when no active TRANSFER method with bank details is configured —
  // the receipt builder simply omits that block in that case.
  bankTransfer: ThermalReceiptBankTransfer | null;
  // Data URI (already base64-encoded, with its real content-type) of the
  // uploaded QRIS Statis image, fetched server-side here rather than left
  // as a bare URL for the client to fetch — the image is hosted on Google
  // Drive, which does not reliably send the CORS headers a browser <canvas>
  // needs to read pixel data from a cross-origin <img>; embedding it as a
  // data: URI sidesteps that fetch (and its CORS behavior) entirely. Null
  // when no active QRIS Statis method is configured, or its image hasn't
  // been uploaded yet — the receipt builder omits that block in that case,
  // same as bankTransfer above.
  qrisStatisImageDataUri: string | null;
}

// Deliberately its own query, not a reuse of invoice-public.ts's
// getInvoiceByToken — a thermal receipt is a different document (adds
// Armada/plat/Driver, omits "Tagihan Lain yang Masih Berjalan" entirely,
// never fetches it) even though both read from the same underlying tables.
export async function getThermalReceiptData(
  salesInvoiceId: string,
  operationalName: string
): Promise<ThermalReceiptData> {
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
  const paymentMethods = await listActiveMetodePembayaran(perusahaanId, "publik");
  const transferRow = paymentMethods.find((m) => m.metode === "TRANSFER" && m.nomorRekening);
  const bankTransfer: ThermalReceiptBankTransfer | null = transferRow
    ? {
        bankNama: transferRow.bankNama ?? "",
        nomorRekening: transferRow.nomorRekening ?? "",
        atasNama: transferRow.atasNama ?? "",
      }
    : null;

  const qrisRow = paymentMethods.find((m) => m.jenis === "qris_static" && m.qrisStatisImagePath);
  const qrisStatisImageDataUri = qrisRow?.qrisStatisImagePath
    ? await fetchQrisImageAsDataUri(qrisRow.qrisStatisImagePath)
    : null;

  return {
    mitraName: header.MitraName,
    mitraAddress: header.MitraAddress,
    voucherNo: header.VoucherNo,
    transDate: header.TransDate.toISOString(),
    armadaNama,
    vehicleNo,
    driverName,
    operationalName,
    lines,
    total: header.Netto,
    bankTransfer,
    qrisStatisImageDataUri,
  };
}

// qrisStatisImagePath is shaped "/api/files/{perusahaanKode}/{fileId}/{filename}"
// (see the route it points at: src/app/api/files/[perusahaan]/[fileId]/[filename]/route.ts)
// — rather than have this server-side code re-enter the app over HTTP to
// fetch its own API route (fragile: depends on NEXTAUTH_URL being correct
// and the server being able to reach itself), pull the same two path
// segments that route reads and call the underlying getFileBuffer directly,
// the exact function that route itself calls.
// Returns null rather than throwing on any failure (path shape mismatch,
// Drive API error, unreadable body), since a broken/unreachable image
// should just mean the QRIS block is silently omitted from the receipt,
// not that printing an otherwise-valid SI Awal fails outright.
async function fetchQrisImageAsDataUri(qrisStatisImagePath: string): Promise<string | null> {
  const segments = qrisStatisImagePath.split("/");
  const perusahaanKode = segments[3];
  const fileId = segments[4];
  if (!perusahaanKode || !fileId) return null;
  try {
    const { buffer, mimeType } = await getFileBuffer(perusahaanKode, fileId);
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}
