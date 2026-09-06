import { getPool, sql } from "@/lib/db";
import { getShiftWindow, type ShiftNumber } from "@/lib/report-shift";
import { getResaleBreakdownUntukStopItems } from "@/lib/queries/retur-resale";
import { getMetodePembayaranByKode } from "@/lib/queries/metode-pembayaran";

export interface KartuPengirimanItemRow {
  itemId: string;
  itemName: string;
  qty: number;
}
export interface KartuPengirimanReturRow {
  itemId: string;
  itemName: string;
  qtyRetur: number;
  kondisiRetur: "BAIK" | "RUSAK" | null;
  resale: { jalur: "DALAM_RUTE" | "LUAR_RUTE" | "RETAIL"; qty: number }[];
}
export type StatusBayar = "TUNAI" | "QRIS" | "TRANSFER" | "TIDAK_BAYAR" | "BELUM_BAYAR";
export interface KartuPengirimanStopRow {
  jadwalDetailId: number;
  customerName: string;
  items: KartuPengirimanItemRow[];
  statusBayar: StatusBayar;
  nominalBayar: number | null;
  retur: KartuPengirimanReturRow[];
}
export interface KartuPengirimanRow {
  jadwalId: number;
  driverName: string | null;
  armadaNama: string | null;
  jamSelesaiMuat: string; // ISO
  stops: KartuPengirimanStopRow[];
}

// Kartu Pengiriman untuk satu shift -- satu blok per Jadwal (dikelompokkan
// lewat JamSelesaiMuat, sama seperti Aktivitas Muatan Distribusi/Ringkasan
// Lintas Shift: Jadwal yang mulai di satu shift tapi selesai muat di shift
// berikutnya tercatat di shift saat SELESAI MUAT), berisi setiap stop
// (tujuan) dengan item yang dipesan, status bayar, dan riwayat retur+jual
// ulangnya.
export async function getKartuPengirimanUntukShift(
  tanggalUsaha: string,
  shift: ShiftNumber,
  perusahaanId: number
): Promise<KartuPengirimanRow[]> {
  const pool = await getPool();
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const window = getShiftWindow(businessDate, shift, "work");

  // 1. Jadwal in this shift's window.
  const jadwalResult = await pool
    .request()
    .input("start", sql.DateTime, window.start)
    .input("end", sql.DateTime, window.end).query(`
      SELECT j.JadwalID, sm.Name AS DriverName, a.Nama AS ArmadaNama, j.JamSelesaiMuat
      FROM DashboardPengirimanJadwal j
      LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
      LEFT JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID AND a.IsDeleted = 0
      WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL AND j.JamSelesaiMuat BETWEEN @start AND @end
      ORDER BY j.JamSelesaiMuat
    `);
  const jadwalRows = jadwalResult.recordset as { JadwalID: number; DriverName: string | null; ArmadaNama: string | null; JamSelesaiMuat: Date }[];
  if (jadwalRows.length === 0) return [];
  const jadwalIds = jadwalRows.map((r) => r.JadwalID);

  // 2. Stops (JadwalDetail) for those Jadwal, with their SalesOrder's
  //    BusinessPartner name, SalesInvoiceID (for payment lookup), and the
  //    linked StopDelivery's TanpaPembayaran/StopDeliveryID (for retur lookup).
  const jadwalPlaceholders = jadwalIds.map((id, i) => `@jid${i}`).join(",");
  const stopRequest = pool.request();
  jadwalIds.forEach((id, i) => stopRequest.input(`jid${i}`, sql.Int, id));
  const stopResult = await stopRequest.query(`
    SELECT jd.JadwalDetailID, jd.JadwalID, jd.SalesOrderID, jd.SalesInvoiceID,
           bp.Name AS CustomerName, sd.StopDeliveryID, sd.TanpaPembayaran
    FROM DashboardPengirimanJadwalDetail jd
    JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
    JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    LEFT JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = jd.JadwalDetailID
    WHERE jd.JadwalID IN (${jadwalPlaceholders}) AND jd.IsDeleted = 0
  `);
  const stopRows = stopResult.recordset as {
    JadwalDetailID: number;
    JadwalID: number;
    SalesOrderID: string;
    SalesInvoiceID: string | null;
    CustomerName: string;
    StopDeliveryID: number | null;
    TanpaPembayaran: boolean | null;
  }[];
  if (stopRows.length === 0) return jadwalRows.map((j) => ({ jadwalId: j.JadwalID, driverName: j.DriverName, armadaNama: j.ArmadaNama, jamSelesaiMuat: j.JamSelesaiMuat.toISOString(), stops: [] }));

  // 3. Items ordered per SalesOrderID.
  const soIds = [...new Set(stopRows.map((r) => r.SalesOrderID))];
  const soRequest = pool.request();
  const soPlaceholders = soIds.map((id, i) => {
    soRequest.input(`so${i}`, sql.VarChar(16), id);
    return `@so${i}`;
  });
  const itemResult = await soRequest.query(`
    SELECT SalesOrderID, ItemID, Name, Qty FROM SalesOrderDetail WHERE SalesOrderID IN (${soPlaceholders.join(",")})
  `);
  const itemsBySoId = new Map<string, KartuPengirimanItemRow[]>();
  for (const r of itemResult.recordset as { SalesOrderID: string; ItemID: string; Name: string; Qty: number }[]) {
    const list = itemsBySoId.get(r.SalesOrderID) ?? [];
    list.push({ itemId: r.ItemID, itemName: r.Name, qty: r.Qty });
    itemsBySoId.set(r.SalesOrderID, list);
  }

  // 4. Retur items (StopDeliveryItem) per StopDeliveryID.
  const stopDeliveryIds = [...new Set(stopRows.map((r) => r.StopDeliveryID).filter((id): id is number => id != null))];
  const returByStopDeliveryId = new Map<number, KartuPengirimanReturRow[]>();
  const stopDeliveryItemIdsAll: number[] = [];
  const returRawByStopDeliveryId = new Map<number, { StopDeliveryItemID: number; ItemID: string; Name: string | null; QtyRetur: number; KondisiRetur: "BAIK" | "RUSAK" | null }[]>();
  if (stopDeliveryIds.length > 0) {
    const sdRequest = pool.request();
    const sdPlaceholders = stopDeliveryIds.map((id, i) => {
      sdRequest.input(`sd${i}`, sql.Int, id);
      return `@sd${i}`;
    });
    const returResult = await sdRequest.query(`
      SELECT sdi.StopDeliveryID, sdi.StopDeliveryItemID, sdi.ItemID, sod.Name, sdi.QtyRetur, sdi.KondisiRetur
      FROM DashboardPengirimanStopDeliveryItem sdi
      LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderDetailID = sdi.SalesOrderDetailID
      WHERE sdi.StopDeliveryID IN (${sdPlaceholders.join(",")}) AND sdi.QtyRetur > 0
    `);
    for (const r of returResult.recordset as { StopDeliveryID: number; StopDeliveryItemID: number; ItemID: string; Name: string | null; QtyRetur: number; KondisiRetur: "BAIK" | "RUSAK" | null }[]) {
      const list = returRawByStopDeliveryId.get(r.StopDeliveryID) ?? [];
      list.push(r);
      returRawByStopDeliveryId.set(r.StopDeliveryID, list);
      stopDeliveryItemIdsAll.push(r.StopDeliveryItemID);
    }
  }
  const resaleMap = await getResaleBreakdownUntukStopItems(stopDeliveryItemIdsAll);
  for (const [stopDeliveryId, rows] of returRawByStopDeliveryId) {
    returByStopDeliveryId.set(
      stopDeliveryId,
      rows.map((r) => ({
        itemId: r.ItemID,
        itemName: r.Name ?? r.ItemID,
        qtyRetur: r.QtyRetur,
        kondisiRetur: r.KondisiRetur,
        resale: resaleMap.get(r.StopDeliveryItemID) ?? [],
      }))
    );
  }

  // 5. Payment per SalesInvoiceID -- same join path as getStopDeliveryProof
  //    (pengiriman-jadwal.ts), plus resolving MetodeKode -> metode label via
  //    Postgres (deduped so each distinct kode is looked up once, not once
  //    per stop).
  const invoiceIds = [...new Set(stopRows.map((r) => r.SalesInvoiceID).filter((id): id is string => id != null))];
  const paymentByInvoiceId = new Map<string, { voucherNo: string; amount: number; metodeKode: string | null }>();
  if (invoiceIds.length > 0) {
    const payRequest = pool.request();
    const payPlaceholders = invoiceIds.map((id, i) => {
      payRequest.input(`si${i}`, sql.VarChar(16), id);
      return `@si${i}`;
    });
    const payResult = await payRequest.query(`
      SELECT spd.SalesInvoiceID, sp.VoucherNo, spd.Amount, spm.MetodeKode,
             ROW_NUMBER() OVER (PARTITION BY spd.SalesInvoiceID ORDER BY sp.TransDate DESC) AS rn
      FROM SalesPaymentDetail spd
      JOIN SalesPayment sp ON sp.SalesPaymentID = spd.SalesPaymentID
      LEFT JOIN DashboardSalesPaymentMetode spm ON spm.SalesPaymentID = sp.SalesPaymentID
      WHERE spd.SalesInvoiceID IN (${payPlaceholders.join(",")}) AND spd.IsDeleted = 0
    `);
    for (const r of payResult.recordset as { SalesInvoiceID: string; VoucherNo: string; Amount: number; MetodeKode: string | null; rn: number | string }[]) {
      // ROW_NUMBER() is SQL BIGINT; the mssql driver hands this back as a
      // string (confirmed live: `{ rn: '1' }`, not `{ rn: 1 }`), so a strict
      // `r.rn !== 1` check against the numeric literal never matches and
      // silently drops every payment. Compare numerically instead.
      if (Number(r.rn) !== 1) continue; // most recent payment per invoice only, matching getStopDeliveryProof's TOP 1
      paymentByInvoiceId.set(r.SalesInvoiceID, { voucherNo: r.VoucherNo, amount: r.Amount, metodeKode: r.MetodeKode });
    }
  }
  const distinctKode = [...new Set([...paymentByInvoiceId.values()].map((p) => p.metodeKode).filter((k): k is string => k != null))];
  const metodeLabelByKode = new Map<string, "TUNAI" | "QRIS" | "TRANSFER">();
  for (const kode of distinctKode) {
    const row = await getMetodePembayaranByKode(perusahaanId, kode);
    if (row) metodeLabelByKode.set(kode, row.metode);
  }

  // 6. Assemble.
  const stopsByJadwalId = new Map<number, KartuPengirimanStopRow[]>();
  for (const s of stopRows) {
    const payment = s.SalesInvoiceID ? paymentByInvoiceId.get(s.SalesInvoiceID) : undefined;
    let statusBayar: StatusBayar;
    let nominalBayar: number | null = null;
    if (s.TanpaPembayaran) {
      statusBayar = "TIDAK_BAYAR";
    } else if (payment) {
      statusBayar = payment.metodeKode ? (metodeLabelByKode.get(payment.metodeKode) ?? "BELUM_BAYAR") : "BELUM_BAYAR";
      nominalBayar = payment.amount;
    } else {
      statusBayar = "BELUM_BAYAR";
    }
    const list = stopsByJadwalId.get(s.JadwalID) ?? [];
    list.push({
      jadwalDetailId: s.JadwalDetailID,
      customerName: s.CustomerName,
      items: itemsBySoId.get(s.SalesOrderID) ?? [],
      statusBayar,
      nominalBayar,
      retur: s.StopDeliveryID != null ? (returByStopDeliveryId.get(s.StopDeliveryID) ?? []) : [],
    });
    stopsByJadwalId.set(s.JadwalID, list);
  }

  return jadwalRows.map((j) => ({
    jadwalId: j.JadwalID,
    driverName: j.DriverName,
    armadaNama: j.ArmadaNama,
    jamSelesaiMuat: j.JamSelesaiMuat.toISOString(),
    stops: stopsByJadwalId.get(j.JadwalID) ?? [],
  }));
}
