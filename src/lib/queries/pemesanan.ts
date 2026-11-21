import { getPool, sql } from "@/lib/db";
import { createSalesOrderManual, softDeleteSalesOrder, type KantongVariant } from "@/lib/queries/sales-order";
import { encodeInvoiceToken } from "@/lib/queries/invoice-public";
import { KODE_DOKUMEN, parseKueriPemesanan, polaLikeDokumen } from "@/lib/pencarian-pemesanan";
import {
  createJadwalDraft,
  deleteJadwalDraft,
  updateJadwalDriverTime,
  JADWAL_KANTONG_EXPR,
  JADWAL_KANTONG_10KG_EXPR,
  JADWAL_KANTONG_5KG_EXPR,
  getCurrentAssignment,
  removeSalesOrderFromJadwal,
  findDraftJadwalByArmadaAndTime,
  addSalesOrdersToJadwal,
  getLokasiStopSalesOrder,
  terapkanLokasiStopSalesOrder,
} from "@/lib/queries/pengiriman-jadwal";
import { AppError } from "@/lib/action-result";
import { softDeleteTakeAwayMuatanForSalesOrder, isTakeAwayMuatanStarted } from "@/lib/queries/takeaway-muatan";

export interface CreatePemesananInput {
  businessPartnerId: string;
  variant: KantongVariant;
  qtyKantong: number;
  // Free/bonus kantong on top of qtyKantong — not billed, see
  // createSalesOrderManual for how it's stored.
  bonusQty: number;
  // The real intended delivery moment — used ONLY for SalesOrder.DueDate
  // (createSalesOrderManual). Deliberately NOT used for scheduling: see
  // jamJadwal below.
  deliveryDateTime: Date;
  // Same moment as deliveryDateTime, but reconciled against the 14:00 WIB
  // rollover via resolveBusinessDateTime (business-date.ts) — used for the
  // Jadwal's own scheduling (findDraftJadwalByArmadaAndTime/
  // createJadwalDraft/updateJadwalDriverTime) so the Papan Pengiriman board
  // buckets this order under the period covering when it was actually
  // placed, not a period derived a second rollover-application further out.
  jamJadwal: Date;
  armadaId: number;
  salesmanId: string | null;
}

export interface CreatePemesananResult {
  salesOrderId: string;
  jadwalId: number;
}

// Orchestrates the Pemesanan module's single-submit flow: create the real
// SalesOrder, then immediately schedule it on the Papan Pengiriman board.
// If a Draft already exists for the exact same Armada + departure time
// (e.g. a second mitra's order aimed at the same trip), the new SO joins
// that Draft as another stop via addSalesOrdersToJadwal instead of
// spawning a sibling Jadwal — otherwise both would render on top of each
// other on the board and only one route validation would exist per trip
// where the user expects one. createJadwalDraft/addSalesOrdersToJadwal
// already enforce Armada capacity either way. Deliberately stops at Draft,
// not a real DeliveryOrder — the existing route-validation gate in
// startBerangkat (pengiriman-jadwal.ts) stays the only path from Draft to
// Terbit, so this doesn't add a second, unvalidated way to create a real
// DeliveryOrder. If scheduling fails after the SO was already created, the
// SO is soft-deleted so it doesn't linger as an unscheduled orphan the
// user never asked for.
export async function createPemesanan(input: CreatePemesananInput): Promise<CreatePemesananResult> {
  const salesOrderId = await createSalesOrderManual({
    businessPartnerId: input.businessPartnerId,
    variant: input.variant,
    qtyKantong: input.qtyKantong,
    bonusQty: input.bonusQty,
    deliveryDateTime: input.deliveryDateTime,
  });

  let createdJadwalId: number | null = null;
  try {
    const existingJadwalId = await findDraftJadwalByArmadaAndTime(input.armadaId, input.jamJadwal);
    if (existingJadwalId != null) {
      // Buat Pemesanan: kapasitas penuh hanya diperingatkan di UI, tidak
      // ditolak (permintaan pengguna 2026-11-21) — lihat OpsiKapasitas.
      await addSalesOrdersToJadwal(existingJadwalId, [salesOrderId], { abaikanKapasitas: true });
      return { salesOrderId, jadwalId: existingJadwalId };
    }

    createdJadwalId = await createJadwalDraft(
      {
        armadaId: input.armadaId,
        jamJadwal: input.jamJadwal,
        salesOrderIds: [salesOrderId],
      },
      { abaikanKapasitas: true }
    );

    if (input.salesmanId) {
      await updateJadwalDriverTime(createdJadwalId, {
        jamJadwal: input.jamJadwal,
        salesmanId: input.salesmanId,
      });
    }

    return { salesOrderId, jadwalId: createdJadwalId };
  } catch (err) {
    if (createdJadwalId != null) {
      await deleteJadwalDraft(createdJadwalId);
    }
    await softDeleteSalesOrder(salesOrderId);
    throw err;
  }
}

export type SalesOrderStatus = "Belum Dijadwalkan" | "Draft" | "Terbit";

export interface SalesOrderListRow {
  SalesOrderID: string;
  VoucherNo: string;
  TransDate: string | Date;
  DueDate: string | Date | null;
  CustomerName: string;
  Wilayah: string;
  Qty: number;
  // Raw (un-halved) per-kemasan bag counts — see formatKemasanQty in
  // lib/format.ts.
  Qty10KG: number;
  Qty5KG: number;
  Amount: number;
  Status: SalesOrderStatus;
  // Whether a real DeliveryOrder row exists for this SO — independent of
  // Status, which can read 'Terbit' purely from a linked Jadwal's own
  // Status (see the OUTER APPLY below) even in the narrow window that
  // Jadwal flip and this SO's own DO row are both written in the same
  // selesaiMuat transaction. In practice they coincide; this field is the
  // direct signal for the "SO -> DO" filter rather than reusing Status.
  HasDO: boolean;
  // null until an SI has actually been issued for this SalesOrderID (via
  // either its SalesOrderID or its linked DeliveryOrderID). Belum
  // Dijadwalkan is never non-null (live-confirmed: 0/64 in a 2026-08
  // spot-check) since nothing has been created for it yet. Terbit is
  // non-null except a rare few (~5/1406) — legacy/edge-case DOs invoiced
  // outside this dashboard's own flow. Draft is often non-null too
  // (~2511/2559 live) even though Draft's own trip hasn't been invoiced:
  // Status here reflects this SO's MOST RECENT Jadwal link (see the
  // OUTER APPLY above, ORDER BY JadwalDetailID DESC), which can be a
  // newer Draft re-schedule of an SO that was already invoiced through an
  // earlier, now-Terbit Jadwal — so Status and InvoiceToken are resolved
  // independently and are not implied by each other.
  InvoiceToken: string | null;
  // Matched via SalesOrderID specifically — kept separate from
  // HasDoInvoice so a mismatch between the two (an SI exists for one but
  // not the other) is visible to the "SO -> SI" / "DO -> SI" filters, the
  // same pattern of divergence the duplicate-SI investigation this
  // session was built to catch.
  HasSoInvoice: boolean;
  // Matched via DeliveryOrderID specifically — always false when HasDO is
  // false (there's no DeliveryOrderID to match against).
  HasDoInvoice: boolean;
  // Internal SalesReturnID (not a public token — "Lihat SR" is an
  // authenticated dialog, not a shared link like invoice) for the most
  // recent SalesReturn matched by this SO's DeliveryOrderID. Always null
  // when HasDO is false: SalesReturn.SalesOrderID is live-confirmed to be
  // NULL on every recently-created row (both dashboard- and desktop-ERP-
  // originated) — a return can only be recorded against an already-issued
  // DeliveryOrderID (confirmDeliveryDelivery/stop-delivery confirmation
  // runs strictly after DO creation), so DeliveryOrderID is the only
  // reliable match key, not SalesOrderID.
  SalesReturnId: string | null;
  // Total kantong yang diretur atas DO SO ini (SUM SalesReturnDetail.Retur
  // dari semua SR milik DO tsb — Retur, bukan Qty, lihat getSalesReturnDetail).
  // null bila tidak ada SR.
  ReturQty: number | null;
  // The Jadwal's own JamAktualBerangkat (actual departure) — null unless
  // this SO went through the dashboard's own Jadwal/Papan Pengiriman flow.
  // Deliberately NOT falling back to the DeliveryOrder's own TransDate for
  // a Jadwal-less DO (e.g. one entered directly in the desktop ERP): shown
  // as "-" in that case instead, per explicit product decision.
  ShippedAt: string | Date | null;
  // Same Jadwal-only convention as ShippedAt — null if this SO was never
  // scheduled through the dashboard.
  DriverName: string | null;
  ArmadaName: string | null;
  // Data DO itu sendiri — cadangan tampilan pengiriman untuk SO yang TIDAK
  // lewat Papan Pengiriman dashboard (DO dibuat langsung, mis. TakeAway
  // "Diambil sendiri"; contoh SO 003646 → DO 003407, cek live 2026-11-21).
  // DoTransDate = naive WIB (tampilkan dengan formatDateWib/formatTimeWib),
  // BUKAN jam berangkat; ShippedAt tetap khusus jadwal dashboard.
  DoVoucherNo: string | null;
  DoTransDate: string | Date | null;
  DoVehicleNo: string | null;
  DoSalesmanName: string | null;
  // Nomor SI/SR milik pesanan ini (untuk kotak pencarian & sorotan dokumen
  // yang cocok) — SI sama dengan yang dipakai InvoiceToken, SR sama dengan
  // SalesReturnId (yang terbaru bila lebih dari satu).
  SiVoucherNo: string | null;
  SrVoucherNo: string | null;
}

export interface SalesOrderListFilter {
  from: string;
  to: string;
  wilayah?: string;
  hasDO?: "yes" | "no";
  hasSoInvoice?: "yes" | "no";
  hasDoInvoice?: "yes" | "no";
  // Batasi ke SO tertentu (hasil pencarian nomor dokumen) — from/to tetap
  // wajib dan harus mencakup TransDate SO-SO tsb.
  salesOrderIds?: string[];
}

// Peta SI/SR untuk SO DALAM RENTANG filter saja (diukur live 2026-11-21,
// scripts/diag-pemesanan-lambat-2026-11-21.ts, rentang 1–22 Nov): pola lama
// mengagregasi SELURUH SalesInvoice (228 ribu + 245 ribu baris dikirim ke
// Node, 4–7 dtk per peta, lebih lambat lagi saat jaringan ke DB lambat).
// Dibatasi lewat SUB-QUERY rentang tanggal — bukan daftar IN berisi ribuan
// id dari JS, yang dulu terbukti memicu rencana nested-loop >40 dtk — hasilnya
// identik per kunci dengan peta penuh dan turun ke 0,5–1 dtk.
//
// Tetap query terpisah dari query utama: menggabungkan SalesInvoice/
// SalesReturn ke query utama terbukti membuat rencana SQL Server ambruk
// (245 dtk+) karena interaksi dengan OUTER APPLY di sana.
const SO_RENTANG = `SELECT SalesOrderID FROM SalesOrder WHERE IsDeleted = 0 AND TransDate >= @from AND TransDate < @to`;
const DO_RENTANG = `SELECT DeliveryOrderID FROM DeliveryOrder WHERE IsDeleted = 0 AND SalesOrderID IN (${SO_RENTANG})`;
// SalesInvoice.DeliveryOrderID disimpan berbungkus kutip tunggal.
const SI_DO_KEY = "REPLACE(DeliveryOrderID, CHAR(39), '')";

interface DokumenTerkait {
  id: string;
  voucherNo: string | null;
}

async function petaDariQuery(request: sql.Request, query: string): Promise<Map<string, DokumenTerkait>> {
  const result = await request.query(query);
  const map = new Map<string, DokumenTerkait>();
  for (const row of result.recordset as { K: string; M: string; V: string | null }[]) map.set(row.K, { id: row.M, voucherNo: row.V });
  return map;
}

// Total kantong diretur per DeliveryOrderID, dibatasi DO dalam rentang.
async function getReturQtyByDo(pool: sql.ConnectionPool, from: string, to: string): Promise<Map<string, number>> {
  const result = await pool
    .request()
    .input("from", sql.Date, from)
    .input("to", sql.Date, to)
    .query(`
      SELECT sr.DeliveryOrderID AS K, SUM(ISNULL(srd.Retur, 0)) AS Q
      FROM SalesReturn sr
      JOIN SalesReturnDetail srd ON srd.SalesReturnID = sr.SalesReturnID
      WHERE sr.IsDeleted = 0 AND sr.DeliveryOrderID IN (${DO_RENTANG})
      GROUP BY sr.DeliveryOrderID
    `);
  const map = new Map<string, number>();
  for (const row of result.recordset as { K: string; Q: number }[]) map.set(row.K, Number(row.Q));
  return map;
}

function getDocumentIdMaps(
  pool: sql.ConnectionPool,
  from: string,
  to: string
): Promise<[Map<string, DokumenTerkait>, Map<string, DokumenTerkait>, Map<string, DokumenTerkait>]> {
  const req = () => pool.request().input("from", sql.Date, from).input("to", sql.Date, to);
  return Promise.all([
    // SI per SalesOrderID
    petaDariQuery(
      req(),
      `SELECT x.K, x.M, si.VoucherNo AS V FROM (
         SELECT SalesOrderID AS K, MAX(SalesInvoiceID) AS M FROM SalesInvoice
         WHERE IsDeleted = 0 AND SalesOrderID IN (${SO_RENTANG}) GROUP BY SalesOrderID
       ) x JOIN SalesInvoice si ON si.SalesInvoiceID = x.M`
    ),
    // SI per DeliveryOrderID
    petaDariQuery(
      req(),
      `SELECT x.K, x.M, si.VoucherNo AS V FROM (
         SELECT ${SI_DO_KEY} AS K, MAX(SalesInvoiceID) AS M FROM SalesInvoice
         WHERE IsDeleted = 0 AND ${SI_DO_KEY} IN (${DO_RENTANG}) GROUP BY ${SI_DO_KEY}
       ) x JOIN SalesInvoice si ON si.SalesInvoiceID = x.M`
    ),
    // SR per DeliveryOrderID — SalesReturn.SalesOrderID selalu NULL (dicek
    // live), jadi DeliveryOrderID satu-satunya kunci yang andal.
    petaDariQuery(
      req(),
      `SELECT x.K, x.M, sr.VoucherNo AS V FROM (
         SELECT DeliveryOrderID AS K, MAX(SalesReturnID) AS M FROM SalesReturn
         WHERE IsDeleted = 0 AND DeliveryOrderID IN (${DO_RENTANG}) GROUP BY DeliveryOrderID
       ) x JOIN SalesReturn sr ON sr.SalesReturnID = x.M`
    ),
  ]);
}

// Lists Sales Orders from every source (Pemesanan module, Pengajuan-approval
// auto-creation, manual desktop-ERP entry) with a resolved scheduling
// status — a linked, non-deleted DashboardPengirimanJadwal's own Status
// (Draft/Terbit) wins when one exists; otherwise a directly-linked
// DeliveryOrder (created outside the Jadwal flow) still counts as Terbit;
// anything else is not yet scheduled at all. TransDate-bounded (exclusive
// upper bound, same convention as the rest of the app) rather than an
// unbounded IsClosed=0 filter — SalesOrder carries years of open backlog
// (see the documented SO-availability-window finding) an unbounded query
// would flood this list with.
export async function getSalesOrderList(filter: SalesOrderListFilter): Promise<SalesOrderListRow[]> {
  const pool = await getPool();
  const request = pool.request().input("from", sql.Date, filter.from).input("to", sql.Date, filter.to);
  if (filter.wilayah) request.input("wilayah", sql.VarChar(128), filter.wilayah);
  const idSo = filter.salesOrderIds ?? [];
  idSo.forEach((id, i) => request.input(`so${i}`, sql.VarChar(32), id));

  // Peta SI/SR tidak bergantung pada hasil query utama (keduanya dibatasi
  // rentang yang sama), jadi dimulai bersamaan — hemat satu putaran DB.
  const petaPromise = Promise.all([
    getDocumentIdMaps(pool, filter.from, filter.to),
    getReturQtyByDo(pool, filter.from, filter.to),
  ]);
  // Jika query utama gagal lebih dulu, galat peta tidak boleh jadi unhandled
  // rejection; galatnya tetap muncul saat petaPromise di-await di bawah.
  petaPromise.catch(() => {});
  const result = await request.query(`
    SELECT
        so.SalesOrderID,
        so.VoucherNo,
        so.TransDate,
        so.DueDate,
        bp.Name AS CustomerName,
        ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
        ISNULL(sod.TotalQty, 0) AS Qty,
        ISNULL(sod.TotalQty10KG, 0) AS Qty10KG,
        ISNULL(sod.TotalQty5KG, 0) AS Qty5KG,
        ISNULL(sod.TotalAmount, 0) AS Amount,
        CASE
          WHEN j.Status IS NOT NULL THEN j.Status
          WHEN do_.DeliveryOrderID IS NOT NULL THEN 'Terbit'
          ELSE 'Belum Dijadwalkan'
        END AS Status,
        do_.DeliveryOrderID,
        j.JamAktualBerangkat AS ShippedAt,
        sm.Name AS DriverName,
        arm.Nama AS ArmadaName,
        do_.VoucherNo AS DoVoucherNo,
        do_.TransDate AS DoTransDate,
        NULLIF(LTRIM(RTRIM(do_.VehicleNo)), '') AS DoVehicleNo,
        dsm.Name AS DoSalesmanName
    FROM SalesOrder so
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    LEFT JOIN (
      SELECT SalesOrderID, ${JADWAL_KANTONG_EXPR} AS TotalQty,
             ${JADWAL_KANTONG_10KG_EXPR} AS TotalQty10KG, ${JADWAL_KANTONG_5KG_EXPR} AS TotalQty5KG,
             SUM(Amount) AS TotalAmount
      FROM SalesOrderDetail sod
      -- Dibatasi ke SO dalam rentang: tanpa ini SQL Server mengagregasi
      -- detail 234 ribu SO sepanjang masa (±9,6 dtk) demi beberapa ratus SO.
      WHERE sod.SalesOrderID IN (${SO_RENTANG})
      GROUP BY SalesOrderID
    ) sod ON sod.SalesOrderID = so.SalesOrderID
    OUTER APPLY (
      SELECT TOP 1 jh.Status, jh.JamAktualBerangkat, jh.SalesmanID, jh.ArmadaID
      FROM DashboardPengirimanJadwalDetail jd
      JOIN DashboardPengirimanJadwal jh ON jh.JadwalID = jd.JadwalID AND jh.IsDeleted = 0
      WHERE jd.SalesOrderID = so.SalesOrderID AND jd.IsDeleted = 0
      ORDER BY jd.JadwalDetailID DESC
    ) j
    LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
    LEFT JOIN DashboardArmada arm ON arm.ArmadaID = j.ArmadaID
    OUTER APPLY (
      SELECT TOP 1 do2.DeliveryOrderID, do2.VoucherNo, do2.TransDate, do2.VehicleNo, do2.SalesmanID
      FROM DeliveryOrder do2
      WHERE do2.SalesOrderID = so.SalesOrderID AND do2.IsDeleted = 0
      ORDER BY do2.TransDate DESC
    ) do_
    LEFT JOIN Salesman dsm ON dsm.SalesmanID = do_.SalesmanID
    WHERE so.IsDeleted = 0
      AND so.TransDate >= @from AND so.TransDate < @to
      ${filter.wilayah ? "AND bp.NPWPName = @wilayah" : ""}
      ${filter.salesOrderIds ? `AND so.SalesOrderID IN (${idSo.length ? idSo.map((_, i) => `@so${i}`).join(", ") : "NULL"})` : ""}
    ORDER BY so.TransDate DESC
  `);

  const rows = result.recordset as (Omit<
    SalesOrderListRow,
    "HasDO" | "InvoiceToken" | "HasSoInvoice" | "HasDoInvoice" | "SalesReturnId" | "ReturQty" | "SiVoucherNo" | "SrVoucherNo"
  > & { DeliveryOrderID: string | null })[];

  // SalesInvoice/SalesReturn have 200K+/9K+ rows and no index on
  // SalesOrderID/DeliveryOrderID (only PK and TransDate). Joining either
  // into the query above — even via pre-aggregated GROUP BY derived tables
  // — was confirmed live to collapse SQL Server's plan for the whole query
  // to 245s+/timeout the moment a column from those joins is actually
  // selected, most likely from a bad plan interaction with the OUTER
  // APPLYs already above. Looking them up in completely separate, cached
  // query/round-trips instead (getDocumentIdMaps above) keeps those joins
  // out of this query's plan entirely — see SalesOrderListRow.InvoiceToken
  // for which Status values can have one.
  const [[soInvoiceMap, doInvoiceMap, doReturnMap], returQtyMap] = await petaPromise;

  const mapped = rows.map((r) => {
    const { DeliveryOrderID, ...rest } = r;
    const hasDO = DeliveryOrderID != null;
    const soInvoiceId = soInvoiceMap.get(r.SalesOrderID);
    const doInvoiceId = hasDO ? doInvoiceMap.get(DeliveryOrderID) : undefined;
    const invoice = soInvoiceId ?? doInvoiceId;
    const retur = hasDO ? doReturnMap.get(DeliveryOrderID) : undefined;
    const salesReturnId = retur?.id ?? null;
    return {
      ...rest,
      HasDO: hasDO,
      InvoiceToken: invoice ? encodeInvoiceToken(invoice.id) : null,
      HasSoInvoice: soInvoiceId != null,
      HasDoInvoice: doInvoiceId != null,
      SalesReturnId: salesReturnId,
      ReturQty: salesReturnId && hasDO ? (returQtyMap.get(DeliveryOrderID) ?? null) : null,
      SiVoucherNo: invoice?.voucherNo ?? null,
      SrVoucherNo: retur?.voucherNo ?? null,
    };
  });

  return mapped.filter((r) => {
    if (filter.hasDO === "yes" && !r.HasDO) return false;
    if (filter.hasDO === "no" && r.HasDO) return false;
    if (filter.hasSoInvoice === "yes" && !r.HasSoInvoice) return false;
    if (filter.hasSoInvoice === "no" && r.HasSoInvoice) return false;
    if (filter.hasDoInvoice === "yes" && !r.HasDoInvoice) return false;
    if (filter.hasDoInvoice === "no" && r.HasDoInvoice) return false;
    return true;
  });
}

// Pencarian nomor dokumen BERPERIODE (lihat lib/pencarian-pemesanan.ts):
// mengabaikan filter tanggal/wilayah halaman — dokumen yang dicari bisa di
// luar rentang tampil. Nomor SO/DO/SI/SR dipetakan ke SalesOrderID-nya
// (SI lewat SalesOrderID atau DO-nya; SR lewat DO, karena
// SalesReturn.SalesOrderID selalu NULL), lalu baris lengkapnya diambil
// dengan getSalesOrderList yang sama, dibatasi ke SO tsb. LIKE berawalan
// tetap (MKE/SI/003449/2026-11%) — dicek live: instan tanpa batas tanggal.
const BATAS_HASIL_CARI = 50;

export async function cariPemesananByNomorDokumen(teks: string): Promise<SalesOrderListRow[]> {
  const kueri = parseKueriPemesanan(teks);
  if (kueri.jenis !== "dokumen" || !kueri.periode) return [];
  const kodeList = kueri.kode ? [kueri.kode] : KODE_DOKUMEN;

  const pool = await getPool();
  const request = pool.request();
  const bagian: string[] = [];
  for (const kode of kodeList) {
    request.input(`p${kode}`, sql.VarChar(64), polaLikeDokumen(kode, kueri));
    if (kode === "SO")
      bagian.push(`SELECT SalesOrderID AS S FROM SalesOrder WHERE IsDeleted = 0 AND VoucherNo LIKE @pSO`);
    if (kode === "DO")
      bagian.push(`SELECT SalesOrderID AS S FROM DeliveryOrder WHERE IsDeleted = 0 AND VoucherNo LIKE @pDO`);
    if (kode === "SI")
      bagian.push(`SELECT ISNULL(si.SalesOrderID, d.SalesOrderID) AS S FROM SalesInvoice si
        LEFT JOIN DeliveryOrder d ON d.DeliveryOrderID = REPLACE(si.DeliveryOrderID, CHAR(39), '')
        WHERE si.IsDeleted = 0 AND si.VoucherNo LIKE @pSI`);
    if (kode === "SR")
      bagian.push(`SELECT d.SalesOrderID AS S FROM SalesReturn sr
        JOIN DeliveryOrder d ON d.DeliveryOrderID = sr.DeliveryOrderID
        WHERE sr.IsDeleted = 0 AND sr.VoucherNo LIKE @pSR`);
  }
  const hasil = await request.query(`
    SELECT TOP ${BATAS_HASIL_CARI} so.SalesOrderID, so.TransDate
    FROM SalesOrder so
    WHERE so.IsDeleted = 0 AND so.SalesOrderID IN (${bagian.join(" UNION ")})
  `);
  const soList = hasil.recordset as { SalesOrderID: string; TransDate: Date }[];
  if (soList.length === 0) return [];

  // Rentang dari TransDate SO-SO yang ketemu (naive WIB, jadi komponen UTC
  // = tanggal kalender), batas atas eksklusif +1 hari.
  const waktu = soList.map((r) => new Date(r.TransDate).getTime());
  const from = new Date(Math.min(...waktu)).toISOString().slice(0, 10);
  const akhir = new Date(Math.max(...waktu));
  akhir.setUTCDate(akhir.getUTCDate() + 1);
  const to = akhir.toISOString().slice(0, 10);
  return getSalesOrderList({ from, to, salesOrderIds: soList.map((r) => r.SalesOrderID) });
}

export interface ReschedulePemesananInput {
  salesOrderId: string;
  armadaId: number;
  deliveryDateTime: Date;
  salesmanId: string | null;
}

// Moves ONE Sales Order to a different armada/waktu/driver without
// touching whatever other SOs are still bundled in its current Draft (if
// it's currently assigned to one at all — a never-scheduled SO, status
// "Belum Dijadwalkan", has no current assignment and this just schedules
// it fresh). Same join-existing-Draft rule as createPemesanan: if another
// Draft already sits at the target Armada + departure time, this SO joins
// it as another stop instead of spawning a sibling Jadwal that would
// overlap it on the board. Reuses createJadwalDraft/addSalesOrdersToJadwal/
// updateJadwalDriverTime exactly as createPemesanan does, so the same
// capacity check and JamJadwal-not-before-TransDate validation
// (pengiriman-jadwal.ts) apply here too. Deliberately resolves/creates the
// NEW assignment before removing the SO from its OLD one: if that step
// throws (capacity exceeded, JamJadwal validation, etc.), the old
// assignment is still untouched and there's nothing to roll back —
// removeSalesOrderFromJadwal only runs once the new assignment has fully
// succeeded.
export async function reschedulePemesanan(input: ReschedulePemesananInput): Promise<{ jadwalId: number }> {
  const current = await getCurrentAssignment(input.salesOrderId);
  const existingJadwalId = await findDraftJadwalByArmadaAndTime(input.armadaId, input.deliveryDateTime);

  // Target is the Jadwal the SO is already sitting in (armada/time
  // unchanged) — nothing to move, just let a driver change (if any) apply.
  if (existingJadwalId != null && current && existingJadwalId === current.jadwalId) {
    if (input.salesmanId) {
      await updateJadwalDriverTime(existingJadwalId, {
        jamJadwal: input.deliveryDateTime,
        salesmanId: input.salesmanId,
      });
    }
    return { jadwalId: existingJadwalId };
  }

  // Ubah Pemesanan disamakan dengan Buat Pemesanan: kapasitas penuh hanya
  // diperingatkan di UI, tidak ditolak (lihat OpsiKapasitas).
  let jadwalId: number;
  if (existingJadwalId != null) {
    await addSalesOrdersToJadwal(existingJadwalId, [input.salesOrderId], { abaikanKapasitas: true });
    jadwalId = existingJadwalId;
  } else {
    jadwalId = await createJadwalDraft(
      {
        armadaId: input.armadaId,
        jamJadwal: input.deliveryDateTime,
        salesOrderIds: [input.salesOrderId],
      },
      { abaikanKapasitas: true }
    );

    if (input.salesmanId) {
      try {
        await updateJadwalDriverTime(jadwalId, {
          jamJadwal: input.deliveryDateTime,
          salesmanId: input.salesmanId,
        });
      } catch (err) {
        await deleteJadwalDraft(jadwalId);
        throw err;
      }
    }
  }

  if (current) {
    // Lokasi pengiriman stop ikut terbawa ke Jadwal baru (spec §9.1) —
    // baris JadwalDetail baru selalu lahir dengan LokasiPengirimanID NULL.
    const lokasiLama = await getLokasiStopSalesOrder(current.jadwalId, input.salesOrderId);
    if (lokasiLama != null) await terapkanLokasiStopSalesOrder(jadwalId, input.salesOrderId, lokasiLama);
    await removeSalesOrderFromJadwal(current.jadwalId, input.salesOrderId);
  }

  return { jadwalId };
}

// Directly edits SalesOrder.TransDate — the desktop-ERP "order date" field
// this dashboard otherwise only ever sets once, at creation
// (createSalesOrderManual/createSalesOrderFromPengajuan), and never touches
// again. Exists specifically for Terbit orders: TransDate is routinely
// bumped by same-day desktop-ERP edits to a value later than the real order
// time (see assertJamJadwalNotBeforeOrders's own comment in
// pengiriman-jadwal.ts), and once an SO has shipped, reschedulePemesanan
// (Ubah Pemesanan) is no longer reachable to work around it — that dialog
// only ever touched scheduling (Jadwal.JamJadwal), never TransDate itself,
// so this is a genuinely new write path, not a relaxed version of an
// existing one.
export async function updateSalesOrderTransDate(salesOrderId: string, transDate: Date): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.VarChar(16), salesOrderId)
    .input("transDate", sql.DateTime, transDate)
    .query(`UPDATE SalesOrder SET TransDate = @transDate, ModifiedDate = GETDATE() WHERE SalesOrderID = @id AND IsDeleted = 0`);
  if (result.rowsAffected[0] === 0) throw new AppError("Sales Order tidak ditemukan.");
}

// Soft-deletes an SO from the Pemesanan list — only for orders that haven't
// actually shipped. getCurrentAssignment only resolves a Draft-status
// Jadwal (its own query filters on that), so a directly-linked, non-Draft
// DeliveryOrder (Status='Terbit', or one created outside the Jadwal flow
// entirely) wouldn't be caught by it — checked separately here so this
// can't silently soft-delete an SO a real DO already exists against.
export async function deletePemesanan(salesOrderId: string): Promise<void> {
  const pool = await getPool();
  const doCheck = await pool
    .request()
    .input("soId", sql.VarChar(16), salesOrderId)
    .query(`SELECT COUNT(*) AS Cnt FROM DeliveryOrder WHERE SalesOrderID = @soId AND IsDeleted = 0`);
  if ((doCheck.recordset[0] as { Cnt: number }).Cnt > 0) {
    throw new AppError("Pesanan ini sudah terkirim (DO sudah terbit) — tidak bisa dihapus.");
  }

  // TakeAway-only in-between state: no DeliveryOrder exists yet (that only
  // gets created at Selesai Muat), but Kepala Produksi has already tapped
  // Mulai Muat in produksi-app and is physically loading it — cancelling
  // now would soft-delete this SO's DashboardTakeAwayMuatan row out from
  // under that in-progress work, and Selesai Muat would then fail on its
  // own IsDeleted=0 guard with a confusing, unexplained error.
  if (await isTakeAwayMuatanStarted(salesOrderId)) {
    throw new AppError("Order TakeAway ini sedang diproses di aplikasi produksi — tidak bisa dibatalkan sekarang.");
  }

  const current = await getCurrentAssignment(salesOrderId);
  if (current) {
    await removeSalesOrderFromJadwal(current.jadwalId, salesOrderId);
  }
  // No-op for a non-TakeAway SO (no matching row) — see
  // softDeleteTakeAwayMuatanForSalesOrder's own comment.
  await softDeleteTakeAwayMuatanForSalesOrder(salesOrderId);
  await softDeleteSalesOrder(salesOrderId);
}

export interface SalesReturnDetailLine {
  Name: string;
  Qty: number;
  Unit: string;
  Price: number;
  Amount: number;
}

export interface SalesReturnDetail {
  SalesReturnID: string;
  VoucherNo: string;
  TransDate: string | Date;
  CustomerName: string;
  Amount: number;
  Lines: SalesReturnDetailLine[];
}

// Backs the "Lihat SR" dialog on /mkesindo/pemesanan — an internal,
// authenticated view (unlike SI's /mkesindo/invoice/[token] public page),
// so this takes the raw internal SalesReturnID directly rather than a
// signed/public token.
export async function getSalesReturnDetail(salesReturnId: string): Promise<SalesReturnDetail | null> {
  const pool = await getPool();
  const headerResult = await pool
    .request()
    .input("id", sql.VarChar(16), salesReturnId).query(`
      SELECT sr.SalesReturnID, sr.VoucherNo, sr.TransDate, ISNULL(bp.Name, 'Tidak Diketahui') AS CustomerName
      FROM SalesReturn sr
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = sr.BusinessPartnerID
      WHERE sr.SalesReturnID = @id AND sr.IsDeleted = 0
    `);
  const header = headerResult.recordset[0] as Omit<SalesReturnDetail, "Amount" | "Lines"> | undefined;
  if (!header) return null;

  // Retur (not Qty/Amount) is the authoritative valid-return quantity —
  // desktop-ERP-side return corrections have been found live to update
  // Retur without resyncing Qty/Amount, leaving those two stale at the
  // original (pre-correction) claim. Dashboard-originated rows always
  // write Qty = Retur (see confirmStopDelivery in pengiriman-jadwal.ts),
  // so preferring Retur here is safe for both origins.
  const linesResult = await pool
    .request()
    .input("id", sql.VarChar(16), salesReturnId)
    .query(`SELECT Name, Retur AS Qty, Unit, Price, Retur * Price AS Amount FROM SalesReturnDetail WHERE SalesReturnID = @id`);
  const lines = linesResult.recordset as SalesReturnDetailLine[];

  return { ...header, Amount: lines.reduce((sum, l) => sum + l.Amount, 0), Lines: lines };
}
