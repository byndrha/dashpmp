import { getPool, sql } from "@/lib/db";
import { getShiftWindow, type ShiftNumber } from "@/lib/report-shift";
import { getResaleBreakdownUntukStopItems } from "@/lib/queries/retur-resale";
import { getMetodePembayaranByKode } from "@/lib/queries/metode-pembayaran";
import { haversineKm, type LatLng } from "@/lib/route-estimate";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";

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
  businessPartnerId: string;
  items: KartuPengirimanItemRow[];
  statusBayar: StatusBayar;
  nominalBayar: number | null;
  retur: KartuPengirimanReturRow[];
  jamTiba: string | null; // ISO, true-UTC (DashboardPengirimanStopDelivery.JamTiba via GETDATE()) -- null if not yet arrived
}

// One "in-between" occurrence along a Jadwal's route -- recorded on its own
// table (Istirahat/BBM/Kendala), each keyed by JadwalID but NOT by a
// specific stop, so these are shown interleaved among the stop list by
// timestamp rather than attached to any one destination.
export type KartuPengirimanSisipanEntry =
  | { type: "ISTIRAHAT"; waktu: string; keterangan: string; waktuSelesai: string | null }
  | { type: "BBM"; waktu: string; liter: number | null; nominalAsli: number | null; nominalEkstra: number | null }
  | { type: "KENDALA"; waktu: string; jenisKendala: string };

export interface KartuPengirimanRow {
  jadwalId: number;
  driverName: string | null;
  armadaNama: string | null;
  vehicleNo: string | null; // real plate when linked to ExpeditionDetail, else armada's own nickname
  jamSelesaiMuat: string; // ISO
  jamAktualBerangkat: string | null; // ISO, null if not yet departed
  lokasiTerjauh: { wilayah: string; kecamatan: string | null } | null;
  stops: KartuPengirimanStopRow[]; // sorted by jamTiba ascending, not-yet-arrived stops last
  sisipan: KartuPengirimanSisipanEntry[]; // unsorted; caller interleaves by `waktu` against stops' jamTiba
}

// Farthest-from-pabrik destination per Jadwal, for the route title format
// "[JamAktualBerangkat] - Wilayah, Kecamatan". Mirrors the farthest-location
// half of estimateTravelMinutesForJadwal (pengiriman-jadwal.ts, private,
// not reusable directly since it also computes travel-time and needs a
// differently-shaped caller) -- deliberately NOT importing that function,
// this is a fresh, lighter query scoped to this shift's own small JadwalID
// list. "Wilayah"/"Kecamatan" are NOT dedicated columns -- they read
// BusinessPartner.NPWPName/NPWPAddress (repurposed fields), same as the
// function this mirrors.
async function getLokasiTerjauhPerJadwal(
  pool: sql.ConnectionPool,
  jadwalIds: number[]
): Promise<Map<number, { wilayah: string; kecamatan: string | null }>> {
  const result = new Map<number, { wilayah: string; kecamatan: string | null }>();
  if (jadwalIds.length === 0) return result;

  const pabrik = await getPabrikLocation();
  const pabrikLatLng: LatLng = { lat: pabrik.latitude, lng: pabrik.longitude };

  const request = pool.request();
  const placeholders = jadwalIds.map((id, i) => {
    request.input(`jid${i}`, sql.Int, id);
    return `@jid${i}`;
  });
  const stopsResult = await request.query(`
    SELECT jd.JadwalID, ml.Latitude, ml.Longitude,
           ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
           bp.NPWPAddress AS Kecamatan
    FROM DashboardPengirimanJadwalDetail jd
    JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
    JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    LEFT JOIN DashboardMitraLocation ml ON ml.BusinessPartnerID = so.BusinessPartnerID
    WHERE jd.JadwalID IN (${placeholders.join(",")}) AND jd.IsDeleted = 0
  `);
  type StopRow = { JadwalID: number; Latitude: number | null; Longitude: number | null; Wilayah: string; Kecamatan: string | null };
  const byJadwal = new Map<number, (StopRow & { Latitude: number; Longitude: number })[]>();
  for (const row of stopsResult.recordset as StopRow[]) {
    if (row.Latitude == null || row.Longitude == null) continue;
    const list = byJadwal.get(row.JadwalID) ?? [];
    list.push(row as StopRow & { Latitude: number; Longitude: number });
    byJadwal.set(row.JadwalID, list);
  }

  for (const [jadwalId, stops] of byJadwal) {
    let farthest: { wilayah: string; kecamatan: string | null } | null = null;
    let farthestKm = -1;
    for (const stop of stops) {
      const km = haversineKm(pabrikLatLng, { lat: stop.Latitude, lng: stop.Longitude });
      if (km > farthestKm) {
        farthestKm = km;
        farthest = { wilayah: stop.Wilayah, kecamatan: stop.Kecamatan };
      }
    }
    if (farthest) result.set(jadwalId, farthest);
  }
  return result;
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
      SELECT j.JadwalID, sm.Name AS DriverName, a.Nama AS ArmadaNama, j.JamSelesaiMuat, j.JamAktualBerangkat,
             ISNULL(ed.VehicleNo, a.Nama) AS VehicleNo
      FROM DashboardPengirimanJadwal j
      LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
      LEFT JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID AND a.IsDeleted = 0
      LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
      WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL AND j.JamSelesaiMuat BETWEEN @start AND @end
      ORDER BY j.JamSelesaiMuat
    `);
  const jadwalRows = jadwalResult.recordset as {
    JadwalID: number;
    DriverName: string | null;
    ArmadaNama: string | null;
    JamSelesaiMuat: Date;
    JamAktualBerangkat: Date | null;
    VehicleNo: string | null;
  }[];
  if (jadwalRows.length === 0) return [];
  const jadwalIds = jadwalRows.map((r) => r.JadwalID);

  // 2. Stops (JadwalDetail) for those Jadwal, with their SalesOrder's
  //    BusinessPartner name, SalesInvoiceID (for payment lookup), and the
  //    linked StopDelivery's TanpaPembayaran/StopDeliveryID (for retur lookup).
  const jadwalPlaceholders = jadwalIds.map((id, i) => `@jid${i}`).join(",");
  const stopRequest = pool.request();
  jadwalIds.forEach((id, i) => stopRequest.input(`jid${i}`, sql.Int, id));
  const [stopResult, lokasiTerjauhMap, sisipanMap] = await Promise.all([
    stopRequest.query(`
      SELECT jd.JadwalDetailID, jd.JadwalID, jd.SalesOrderID, jd.SalesInvoiceID,
             bp.Name AS CustomerName, bp.BusinessPartnerID, sd.StopDeliveryID, sd.TanpaPembayaran, sd.JamTiba
      FROM DashboardPengirimanJadwalDetail jd
      JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
      JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
      LEFT JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = jd.JadwalDetailID
      WHERE jd.JadwalID IN (${jadwalPlaceholders}) AND jd.IsDeleted = 0
    `),
    getLokasiTerjauhPerJadwal(pool, jadwalIds),
    getSisipanUntukJadwal(pool, jadwalIds),
  ]);
  const stopRows = stopResult.recordset as {
    JadwalDetailID: number;
    JadwalID: number;
    SalesOrderID: string;
    SalesInvoiceID: string | null;
    CustomerName: string;
    BusinessPartnerID: string;
    StopDeliveryID: number | null;
    TanpaPembayaran: boolean | null;
    JamTiba: Date | null;
  }[];
  if (stopRows.length === 0)
    return jadwalRows.map((j) => ({
      jadwalId: j.JadwalID,
      driverName: j.DriverName,
      armadaNama: j.ArmadaNama,
      vehicleNo: j.VehicleNo,
      jamSelesaiMuat: j.JamSelesaiMuat.toISOString(),
      jamAktualBerangkat: j.JamAktualBerangkat ? j.JamAktualBerangkat.toISOString() : null,
      lokasiTerjauh: lokasiTerjauhMap.get(j.JadwalID) ?? null,
      stops: [],
      sisipan: sisipanMap.get(j.JadwalID) ?? [],
    }));

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
      businessPartnerId: s.BusinessPartnerID,
      items: itemsBySoId.get(s.SalesOrderID) ?? [],
      statusBayar,
      nominalBayar,
      retur: s.StopDeliveryID != null ? (returByStopDeliveryId.get(s.StopDeliveryID) ?? []) : [],
      jamTiba: s.JamTiba ? s.JamTiba.toISOString() : null,
    });
    stopsByJadwalId.set(s.JadwalID, list);
  }
  // Sorted by real arrival time (not the planned/Urutan sequence) -- this is
  // a report of what actually happened, and it's also what lets the caller
  // interleave `sisipan` entries by timestamp against a correctly-ordered
  // stop list. Not-yet-arrived stops (jamTiba null) sort last, in their
  // original (arbitrary, no-ORDER-BY) fetch order relative to each other.
  for (const list of stopsByJadwalId.values()) {
    list.sort((a, b) => {
      if (a.jamTiba == null && b.jamTiba == null) return 0;
      if (a.jamTiba == null) return 1;
      if (b.jamTiba == null) return -1;
      return a.jamTiba.localeCompare(b.jamTiba);
    });
  }

  return jadwalRows.map((j) => ({
    jadwalId: j.JadwalID,
    driverName: j.DriverName,
    armadaNama: j.ArmadaNama,
    vehicleNo: j.VehicleNo,
    jamSelesaiMuat: j.JamSelesaiMuat.toISOString(),
    jamAktualBerangkat: j.JamAktualBerangkat ? j.JamAktualBerangkat.toISOString() : null,
    lokasiTerjauh: lokasiTerjauhMap.get(j.JadwalID) ?? null,
    stops: stopsByJadwalId.get(j.JadwalID) ?? [],
    sisipan: sisipanMap.get(j.JadwalID) ?? [],
  }));
}

// Istirahat/BBM/Kendala for this shift's Jadwal set, scoped by JadwalID
// membership (NOT by each table's own time-window semantics -- e.g. BBM's
// own getBbmUntukShift in driver-fuel.ts groups by WaktuIsi's real-time
// shift window for the Kas section's cash-register accounting, which can
// disagree with the parent Jadwal's JamSelesaiMuat-based shift; this
// function deliberately groups by JadwalID instead, since these entries are
// shown attached to a specific Jadwal's own Kartu Pengiriman card here, not
// aggregated as a shift-wide cash total).
async function getSisipanUntukJadwal(pool: sql.ConnectionPool, jadwalIds: number[]): Promise<Map<number, KartuPengirimanSisipanEntry[]>> {
  const result = new Map<number, KartuPengirimanSisipanEntry[]>();
  if (jadwalIds.length === 0) return result;

  function push(jadwalId: number, entry: KartuPengirimanSisipanEntry) {
    const list = result.get(jadwalId) ?? [];
    list.push(entry);
    result.set(jadwalId, list);
  }

  function inClause(request: sql.Request, prefix: string): string {
    return jadwalIds
      .map((id, i) => {
        request.input(`${prefix}${i}`, sql.Int, id);
        return `@${prefix}${i}`;
      })
      .join(",");
  }

  const istirahatRequest = pool.request();
  const istirahatPlaceholders = inClause(istirahatRequest, "ist");
  const istirahatResult = await istirahatRequest.query(`
    SELECT JadwalID, Keterangan, WaktuMulai, WaktuSelesai
    FROM DashboardPengirimanIstirahat
    WHERE JadwalID IN (${istirahatPlaceholders})
  `);
  for (const r of istirahatResult.recordset as { JadwalID: number; Keterangan: string; WaktuMulai: Date; WaktuSelesai: Date | null }[]) {
    push(r.JadwalID, {
      type: "ISTIRAHAT",
      waktu: r.WaktuMulai.toISOString(),
      keterangan: r.Keterangan,
      waktuSelesai: r.WaktuSelesai ? r.WaktuSelesai.toISOString() : null,
    });
  }

  const bbmRequest = pool.request();
  const bbmPlaceholders = inClause(bbmRequest, "bbm");
  const bbmResult = await bbmRequest.query(`
    SELECT JadwalID, Liter, NominalAsli, NominalEkstra, WaktuMasukSpbu
    FROM DashboardPengirimanBBM
    WHERE JadwalID IN (${bbmPlaceholders}) AND WaktuMasukSpbu IS NOT NULL
  `);
  for (const r of bbmResult.recordset as {
    JadwalID: number;
    Liter: number | null;
    NominalAsli: number | null;
    NominalEkstra: number | null;
    WaktuMasukSpbu: Date;
  }[]) {
    push(r.JadwalID, {
      type: "BBM",
      waktu: r.WaktuMasukSpbu.toISOString(),
      liter: r.Liter,
      nominalAsli: r.NominalAsli,
      nominalEkstra: r.NominalEkstra,
    });
  }

  const kendalaRequest = pool.request();
  const kendalaPlaceholders = inClause(kendalaRequest, "ken");
  const kendalaResult = await kendalaRequest.query(`
    SELECT JadwalID, JenisKendala, WaktuLapor
    FROM DashboardPengirimanKendala
    WHERE JadwalID IN (${kendalaPlaceholders})
  `);
  for (const r of kendalaResult.recordset as { JadwalID: number; JenisKendala: string; WaktuLapor: Date }[]) {
    push(r.JadwalID, { type: "KENDALA", waktu: r.WaktuLapor.toISOString(), jenisKendala: r.JenisKendala });
  }

  return result;
}

export interface RekapDriverRow {
  salesmanId: string;
  driverName: string | null;
  totalKirim: number;
  totalReturn: number;
  netto: number;
}

// Kirim/Return/Netto per driver across ALL THREE shifts of one Tanggal
// Usaha -- deliberately whole-day, unlike every other function in this
// plan which is scoped to one shift's own window. Kirim = SUM(Qty) ordered
// (SalesOrderDetail), Return = SUM(QtyRetur) (StopDeliveryItem), Netto =
// Kirim - Return, all in raw item qty (not kantong-ekivalen -- this report
// mixes 10kg/5kg items per Jadwal and this recap doesn't need the
// kantong-ekivalen conversion the rest of this app's production reports
// use, since it's a delivery/return headcount per driver, not a
// production-capacity figure).
export async function getRekapPerDriverUntukHari(tanggalUsaha: string): Promise<RekapDriverRow[]> {
  const pool = await getPool();
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const start = getShiftWindow(businessDate, 2, "work").start;
  const end = getShiftWindow(businessDate, 1, "work").end;

  const result = await pool
    .request()
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end).query(`
      WITH JadwalHariIni AS (
        SELECT j.JadwalID, j.SalesmanID, sm.Name AS DriverName
        FROM DashboardPengirimanJadwal j
        LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
        WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL AND j.JamSelesaiMuat BETWEEN @start AND @end
      ),
      KirimPerJadwal AS (
        SELECT jh.JadwalID, SUM(sod.Qty) AS TotalKirim
        FROM JadwalHariIni jh
        JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = jh.JadwalID AND jd.IsDeleted = 0
        JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
        GROUP BY jh.JadwalID
      ),
      ReturPerJadwal AS (
        SELECT jh.JadwalID, SUM(sdi.QtyRetur) AS TotalReturn
        FROM JadwalHariIni jh
        JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = jh.JadwalID AND jd.IsDeleted = 0
        JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = jd.JadwalDetailID
        JOIN DashboardPengirimanStopDeliveryItem sdi ON sdi.StopDeliveryID = sd.StopDeliveryID
        GROUP BY jh.JadwalID
      )
      SELECT jh.SalesmanID, jh.DriverName,
             SUM(ISNULL(k.TotalKirim, 0)) AS TotalKirim,
             SUM(ISNULL(r.TotalReturn, 0)) AS TotalReturn
      FROM JadwalHariIni jh
      LEFT JOIN KirimPerJadwal k ON k.JadwalID = jh.JadwalID
      LEFT JOIN ReturPerJadwal r ON r.JadwalID = jh.JadwalID
      WHERE jh.SalesmanID IS NOT NULL
      GROUP BY jh.SalesmanID, jh.DriverName
      ORDER BY jh.DriverName
    `);
  return (result.recordset as { SalesmanID: string; DriverName: string | null; TotalKirim: number; TotalReturn: number }[]).map((r) => ({
    salesmanId: r.SalesmanID,
    driverName: r.DriverName,
    totalKirim: r.TotalKirim,
    totalReturn: r.TotalReturn,
    netto: r.TotalKirim - r.TotalReturn,
  }));
}
