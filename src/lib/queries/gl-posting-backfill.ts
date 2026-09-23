import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import { getNaiveWibTransDate } from "@/lib/business-date";

export type DocType = "SALESINVOICE" | "DELIVERYORDER";

export interface GLLine {
  accountNo: string;
  debit: number;
  credit: number;
}

export interface ComputedDoc {
  voucherNo: string;
  docType: DocType;
  documentId: string;
  transDate: Date;
  branchId: string;
  departmentId: string;
  businessPartnerId: string | null;
  currencyId: string;
  rate: number;
  lines: GLLine[];
  // Hanya terisi utk docType SALESINVOICE (VoucherNo DeliveryOrder induknya,
  // sudah diresolusi oleh computeBacklogForDate). null utk DELIVERYORDER.
  // Dipakai postBacklogForDate (fix round 1, Finding 1) utk memastikan SI
  // tidak diposting kalau DO induknya DIRENCANAKAN diposting di run yang
  // sama tapi ternyata GAGAL -- computeBacklogForDate sendiri hanya tahu
  // rencana pra-posting (dipostingDiRunIni), bukan hasil aktual tiap DO.
  parentDoVoucherNo: string | null;
}

export interface BacklogSkip {
  voucherNo: string;
  docType: DocType;
  documentId: string;
  alasan: string;
}

export interface BacklogPreview {
  tanggal: string;
  postable: ComputedDoc[];
  skipped: BacklogSkip[];
  totalPerAkun: { accountNo: string; debit: number; credit: number }[];
}

interface ItemAccountMapping {
  pendapatanAccountNo: string;
  hppAccountNo: string;
  persediaanAccountNo: string;
}

// Tanggal collapse mekanisme sync dashpmp->ERP (lihat spec & memori
// gl-posting-backlog-do-si-sept12) -- data GL sebelum tanggal ini dianggap
// benar dan dipakai sebagai sumber kebenaran untuk membangun pemetaan akun.
const BATAS_DATA_NORMAL = "2026-09-12";

// Dibangun LIVE tiap dipanggil (bukan tabel statis) -- lihat spec Bagian 1.
// Dibatasi ke voucher SATU-JENIS-ITEM saja (semua baris detail dokumen itu
// ItemID yang sama) supaya atribusi item->akun tidak ambigu, karena GL
// mengagregasi baris multi-item yang berbagi akun menjadi satu baris.
//
// PENTING (ditemukan lewat validasi Step 6, 21 Sep 2026, angka dikoreksi di
// fix round 1 setelah code review -- lihat task-2-report.md untuk jejak
// lengkap): sejumlah kecil ItemID punya baris GL historis yang "nyasar" ke
// akun Pendapatan (4%) yang BEDA dari mayoritas mutlak transaksinya --
// contoh nyata: ItemID "019" punya 177.985 baris ke akun 4001 vs cuma 2
// baris ke akun 4003 (kemungkinan koreksi/kesalahan input manual di ERP,
// bukan pola normal). Versi pertama fungsi ini memakai MAX(CASE...) yang
// secara tidak sengaja memilih "4003" (lebih besar secara string) padahal
// "4001" adalah akun yang BENAR -- pada run pertama validasi formula (20
// dokumen acak), ini menyebabkan 11/20 cocok (9/10 SalesInvoice TIDAK
// cocok, 0/10 DeliveryOrder gagal -- DeliveryOrder tidak kena bug ini
// karena akun Persediaan ternyata 100% konsisten per ItemID, tidak ambigu).
// Diperbaiki dua tahap: (1) pilih akun PALING SERING muncul (mode) per
// ItemID bukan MAX(); (2) frekuensi dihitung dari COUNT(DISTINCT VoucherNo)
// bukan COUNT(*) baris hasil JOIN, supaya voucher dengan >1 baris detail
// untuk item yang sama tidak dihitung berlebih. Setelah kedua perbaikan:
// 20/20 sample cocok pada run validasi ulang (lihat task-2-report.md).
async function buildItemAccountMapping(pool: sql.ConnectionPool): Promise<Map<string, ItemAccountMapping>> {
  const pendapatan = await pool.request().input("batas", sql.Date, BATAS_DATA_NORMAL).query(`
    WITH Ranked AS (
      SELECT sid.ItemID, coa.AccountNo,
             ROW_NUMBER() OVER (PARTITION BY sid.ItemID ORDER BY COUNT(DISTINCT si.VoucherNo) DESC, coa.AccountNo ASC) AS rn
      FROM SalesInvoice si
      JOIN SalesInvoiceDetail sid ON sid.SalesInvoiceID = si.SalesInvoiceID
      JOIN GeneralLedger gl ON gl.VoucherNo = si.VoucherNo AND gl.[Type] = 'SALESINVOICE'
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE si.TransDate < @batas AND si.IsDeleted = 0
        AND coa.AccountNo LIKE '4%'
        AND NOT EXISTS (
          SELECT 1 FROM SalesInvoiceDetail sid2
          WHERE sid2.SalesInvoiceID = si.SalesInvoiceID AND sid2.ItemID <> sid.ItemID
        )
      GROUP BY sid.ItemID, coa.AccountNo
    )
    SELECT ItemID, AccountNo AS PendapatanAccountNo FROM Ranked WHERE rn = 1
  `);

  const hpp = await pool.request().input("batas", sql.Date, BATAS_DATA_NORMAL).query(`
    WITH Ranked AS (
      SELECT sid.ItemID, coa.AccountNo,
             ROW_NUMBER() OVER (PARTITION BY sid.ItemID ORDER BY COUNT(DISTINCT si.VoucherNo) DESC, coa.AccountNo ASC) AS rn
      FROM SalesInvoice si
      JOIN SalesInvoiceDetail sid ON sid.SalesInvoiceID = si.SalesInvoiceID
      JOIN GeneralLedger gl ON gl.VoucherNo = si.VoucherNo AND gl.[Type] = 'SALESINVOICE'
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE si.TransDate < @batas AND si.IsDeleted = 0
        AND coa.AccountNo LIKE '5%'
        AND NOT EXISTS (
          SELECT 1 FROM SalesInvoiceDetail sid2
          WHERE sid2.SalesInvoiceID = si.SalesInvoiceID AND sid2.ItemID <> sid.ItemID
        )
      GROUP BY sid.ItemID, coa.AccountNo
    )
    SELECT ItemID, AccountNo AS HppAccountNo FROM Ranked WHERE rn = 1
  `);

  const persediaan = await pool.request().input("batas", sql.Date, BATAS_DATA_NORMAL).query(`
    WITH Ranked AS (
      SELECT dod.ItemID, coa.AccountNo,
             ROW_NUMBER() OVER (PARTITION BY dod.ItemID ORDER BY COUNT(DISTINCT do1.VoucherNo) DESC, coa.AccountNo ASC) AS rn
      FROM DeliveryOrder do1
      JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do1.DeliveryOrderID
      JOIN GeneralLedger gl ON gl.VoucherNo = do1.VoucherNo AND gl.[Type] = 'DELIVERYORDER'
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE do1.TransDate < @batas AND do1.IsDeleted = 0 AND coa.AccountNo LIKE '14%'
        AND NOT EXISTS (
          SELECT 1 FROM DeliveryOrderDetail dod2
          WHERE dod2.DeliveryOrderID = do1.DeliveryOrderID AND dod2.ItemID <> dod.ItemID
        )
      GROUP BY dod.ItemID, coa.AccountNo
    )
    SELECT ItemID, AccountNo AS PersediaanAccountNo FROM Ranked WHERE rn = 1
  `);

  const pendapatanMap = new Map<string, string>(
    (pendapatan.recordset as { ItemID: string; PendapatanAccountNo: string }[]).map((r) => [r.ItemID, r.PendapatanAccountNo])
  );
  const hppMap = new Map<string, string>(
    (hpp.recordset as { ItemID: string; HppAccountNo: string }[]).map((r) => [r.ItemID, r.HppAccountNo])
  );
  const persediaanMap = new Map<string, string>(
    (persediaan.recordset as { ItemID: string; PersediaanAccountNo: string }[]).map((r) => [
      r.ItemID,
      r.PersediaanAccountNo,
    ])
  );

  const semuaItemId = new Set<string>([...pendapatanMap.keys(), ...hppMap.keys(), ...persediaanMap.keys()]);
  const mapping = new Map<string, ItemAccountMapping>();
  for (const itemId of semuaItemId) {
    const pendapatanAccountNo = pendapatanMap.get(itemId);
    const hppAccountNo = hppMap.get(itemId);
    const persediaanAccountNo = persediaanMap.get(itemId);
    if (!pendapatanAccountNo || !hppAccountNo || !persediaanAccountNo) continue;
    mapping.set(itemId, { pendapatanAccountNo, hppAccountNo, persediaanAccountNo });
  }
  return mapping;
}

// null berarti baris ItemAverage TIDAK ADA (bukan bernilai 0) -- pemanggil
// wajib skip dokumen, tidak boleh fallback ke 0. Lihat Review Focus.
//
// CATATAN (ditemukan lewat validasi Step 6 fix round 1, 21 Sep 2026):
// `ItemAverage` adalah SATU baris live per (ItemID, Year, Month) yang terus
// ditimpa ERP sepanjang bulan berjalan (tidak ada riwayat/snapshot per
// tanggal) -- diverifikasi live: ItemAverage untuk ItemID "0110"/Sep 2026
// terakhir di-update 11 Sep 2026, sehingga membandingkan dokumen 4 Sep 2026
// (tanggal jauh sebelum update terakhir) terhadap Average SEKARANG bisa
// menunjukkan selisih kecil dari yang tercatat di GL asli waktu itu -- ini
// artefak validasi historis (bukan bug formula): untuk backlog SUNGGUHAN,
// baris DO dan SI yang sama-sama dihitung fresh oleh computeBacklogForDate
// pada run yang sama akan SELALU memakai nilai Average yang identik untuk
// ItemID/Year/Month yang sama, jadi drift ini tidak bisa terjadi di alur
// produksi -- hanya muncul saat memvalidasi ulang dokumen historis yang
// Average bulannya sudah bergerak sejak tanggal posting aslinya.
async function getItemAverage(
  pool: sql.ConnectionPool,
  itemId: string,
  year: number,
  month: number
): Promise<number | null> {
  const result = await pool
    .request()
    .input("itemId", sql.VarChar(16), itemId)
    .input("year", sql.Int, year)
    .input("month", sql.Int, month)
    .query(`SELECT TOP 1 Average FROM ItemAverage WHERE ItemID = @itemId AND Year = @year AND Month = @month AND IsDeleted = 0`);
  const row = result.recordset[0] as { Average: number } | undefined;
  return row ? row.Average : null;
}

interface DokumenBacklog {
  voucherNo: string;
  documentId: string;
  transDate: Date;
  branchId: string;
  departmentId: string;
  businessPartnerId: string | null;
  currencyId: string;
  rate: number;
  deliveryOrderId: string | null; // hanya relevan untuk SalesInvoice
}

// PENTING (ditemukan lewat validasi Step 6, 21 Sep 2026): tabel GeneralLedger
// (>1,9 juta baris live) TIDAK punya index pada VoucherNo (satu-satunya index
// non-klaster-nya, IX_GeneralLedger_COA_TransDate, mencakup Debit/Credit/
// BranchID/ChartOfAccountID/TransDate -- bukan VoucherNo). Query korelasi
// per-baris terhadap GeneralLedger via VoucherNo (LEFT JOIN ... WHERE
// gl.VoucherNo IS NULL per SI/DO kandidat, atau lookup satu-per-satu seperti
// doPunyaGL versi awal) menyebabkan nested-loop scan penuh tabel itu
// berulang kali -- diverifikasi LIVE: query gaya ini timeout di atas 40 detik
// untuk SATU tanggal (10 Sep 2026, tanggal normal, tidak ada backlog),
// padahal semestinya hasilnya kosong dalam hitungan milidetik. Diperbaiki
// dengan memisah jadi 2 langkah: (1) ambil kandidat dulu dari tabel kecil
// (SalesInvoice/DeliveryOrder + asal-dashpmp), (2) SATU query batch ke
// GeneralLedger pakai VoucherNo IN (...) untuk kandidat itu saja -- terbukti
// live jauh lebih cepat (hash/scan sekali jalan, bukan per-baris). Tidak
// menambah index baru ke database produksi (di luar cakupan task read-only
// ini) -- lihat catatan performa di laporan Task 2.
async function voucherNosDenganGL(
  pool: sql.ConnectionPool,
  voucherNos: string[],
  docType: DocType
): Promise<Set<string>> {
  if (voucherNos.length === 0) return new Set();
  const request = pool.request().input("tipe", sql.VarChar(32), docType);
  const placeholders = voucherNos.map((v, i) => {
    const nama = `v${i}`;
    request.input(nama, sql.VarChar(64), v);
    return `@${nama}`;
  });
  const result = await request.query(
    `SELECT DISTINCT VoucherNo FROM GeneralLedger WHERE [Type] = @tipe AND VoucherNo IN (${placeholders.join(", ")})`
  );
  return new Set((result.recordset as { VoucherNo: string }[]).map((r) => r.VoucherNo));
}

// Catatan verifikasi live (21 Sep 2026): SalesInvoice.DeliveryOrderID
// tersimpan DENGAN tanda kutip literal di dalam string (mis. "'01243294'",
// panjang 10 utk ID 8 digit) -- bukan quoting SQL, memang isi datanya begitu
// di ERP. .replace(/'/g, "") di bawah WAJIB ada, bukan defensive coding sisa.
async function cariBacklogSalesInvoice(pool: sql.ConnectionPool, tanggal: string): Promise<DokumenBacklog[]> {
  const kandidat = await pool.request().input("tanggal", sql.Date, tanggal).query(`
    SELECT si.VoucherNo, si.SalesInvoiceID AS DocumentID, si.TransDate, si.BranchID, si.DepartmentID,
           si.BusinessPartnerID, si.CurrencyID, si.Rate, si.DeliveryOrderID
    FROM SalesInvoice si
    LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.SalesInvoiceID = si.SalesInvoiceID AND jd.IsDeleted = 0
    LEFT JOIN DashboardTakeAwayMuatan ta ON ta.SalesInvoiceID = si.SalesInvoiceID
    WHERE CAST(si.TransDate AS DATE) = @tanggal AND si.IsDeleted = 0
      AND (jd.SalesInvoiceID IS NOT NULL OR ta.SalesInvoiceID IS NOT NULL)
  `);
  const rows = kandidat.recordset as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const sudahAdaGL = await voucherNosDenganGL(
    pool,
    rows.map((r) => r.VoucherNo as string),
    "SALESINVOICE"
  );

  return rows
    .filter((r) => !sudahAdaGL.has(r.VoucherNo as string))
    .map((r) => ({
      voucherNo: r.VoucherNo as string,
      documentId: r.DocumentID as string,
      transDate: r.TransDate as Date,
      branchId: r.BranchID as string,
      departmentId: r.DepartmentID as string,
      businessPartnerId: r.BusinessPartnerID as string | null,
      currencyId: r.CurrencyID as string,
      rate: r.Rate as number,
      deliveryOrderId: r.DeliveryOrderID ? String(r.DeliveryOrderID).replace(/'/g, "") : null,
    }));
}

async function cariBacklogDeliveryOrder(pool: sql.ConnectionPool, tanggal: string): Promise<DokumenBacklog[]> {
  const kandidat = await pool.request().input("tanggal", sql.Date, tanggal).query(`
    SELECT do1.VoucherNo, do1.DeliveryOrderID AS DocumentID, do1.TransDate, do1.BranchID, do1.DepartmentID,
           do1.BusinessPartnerID, do1.CurrencyID, do1.Rate
    FROM DeliveryOrder do1
    LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.DeliveryOrderID = do1.DeliveryOrderID AND jd.IsDeleted = 0
    LEFT JOIN DashboardTakeAwayMuatan ta ON ta.DeliveryOrderID = do1.DeliveryOrderID
    WHERE CAST(do1.TransDate AS DATE) = @tanggal AND do1.IsDeleted = 0
      AND (jd.DeliveryOrderID IS NOT NULL OR ta.DeliveryOrderID IS NOT NULL)
  `);
  const rows = kandidat.recordset as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const sudahAdaGL = await voucherNosDenganGL(
    pool,
    rows.map((r) => r.VoucherNo as string),
    "DELIVERYORDER"
  );

  return rows
    .filter((r) => !sudahAdaGL.has(r.VoucherNo as string))
    .map((r) => ({
      voucherNo: r.VoucherNo as string,
      documentId: r.DocumentID as string,
      transDate: r.TransDate as Date,
      branchId: r.BranchID as string,
      departmentId: r.DepartmentID as string,
      businessPartnerId: r.BusinessPartnerID as string | null,
      currencyId: r.CurrencyID as string,
      rate: r.Rate as number,
      deliveryOrderId: null,
    }));
}

// Ambil VoucherNo utk sekumpulan DeliveryOrderID sekaligus (DeliveryOrderID
// adalah primary key -- lookup per-ID sebenarnya sudah cepat, tapi di-batch
// juga di sini supaya tidak ada N round-trip terpisah ke DB per SI backlog.
async function voucherNoUntukDeliveryOrderIds(
  pool: sql.ConnectionPool,
  deliveryOrderIds: string[]
): Promise<Map<string, string>> {
  if (deliveryOrderIds.length === 0) return new Map();
  const request = pool.request();
  const placeholders = deliveryOrderIds.map((id, i) => {
    const nama = `id${i}`;
    request.input(nama, sql.VarChar(16), id);
    return `@${nama}`;
  });
  const result = await request.query(
    `SELECT DeliveryOrderID, VoucherNo FROM DeliveryOrder WHERE DeliveryOrderID IN (${placeholders.join(", ")})`
  );
  const map = new Map<string, string>();
  for (const row of result.recordset as { DeliveryOrderID: string; VoucherNo: string }[]) {
    map.set(row.DeliveryOrderID, row.VoucherNo);
  }
  return map;
}

async function hitungGLDeliveryOrder(
  pool: sql.ConnectionPool,
  doc: DokumenBacklog,
  mapping: Map<string, ItemAccountMapping>
): Promise<{ lines: GLLine[] } | { alasan: string }> {
  const detail = await pool
    .request()
    .input("id", sql.VarChar(16), doc.documentId)
    .query(`SELECT ItemID, Qty FROM DeliveryOrderDetail WHERE DeliveryOrderID = @id`);

  let totalBiaya = 0;
  const kreditPerAkun = new Map<string, number>();
  const tahun = doc.transDate.getUTCFullYear();
  const bulan = doc.transDate.getUTCMonth() + 1;

  for (const row of detail.recordset as { ItemID: string; Qty: number }[]) {
    const akun = mapping.get(row.ItemID);
    if (!akun) return { alasan: `Item ${row.ItemID} tidak punya histori pemetaan akun sebelum 12 Sep 2026` };

    const average = await getItemAverage(pool, row.ItemID, tahun, bulan);
    if (average === null) {
      return { alasan: `Item ${row.ItemID} tidak punya data ItemAverage untuk ${bulan}/${tahun}` };
    }

    const biaya = row.Qty * average;
    totalBiaya += biaya;
    kreditPerAkun.set(akun.persediaanAccountNo, (kreditPerAkun.get(akun.persediaanAccountNo) ?? 0) + biaya);
  }

  const lines: GLLine[] = [{ accountNo: "1399", debit: totalBiaya, credit: 0 }];
  for (const [accountNo, jumlah] of kreditPerAkun) {
    lines.push({ accountNo, debit: 0, credit: jumlah });
  }
  return { lines };
}

async function hitungGLSalesInvoice(
  pool: sql.ConnectionPool,
  doc: DokumenBacklog,
  mapping: Map<string, ItemAccountMapping>
): Promise<{ lines: GLLine[] } | { alasan: string }> {
  if (!doc.deliveryOrderId) return { alasan: "SalesInvoice tidak punya DeliveryOrderID induk" };
  // Catatan: pengecekan "DO induk sudah ter-GL atau belum" dilakukan di
  // computeBacklogForDate (Step 5), BUKAN di sini -- fungsi ini murni
  // menghitung baris GL dari detail item, dipanggil hanya setelah
  // computeBacklogForDate memastikan DO induknya sudah/akan ter-posting.

  // PENTING (ditemukan lewat validasi Step 6 fix round 1, 21 Sep 2026):
  // SalesReturn EKSPLISIT DI LUAR CAKUPAN formula ini (lihat spec Bagian 1,
  // "Batasan cakupan"). Diverifikasi live: SalesInvoice yang DO induknya
  // punya SalesReturn terkait ternyata GL voucher SI-nya sendiri diberi
  // BARIS TAMBAHAN oleh ERP (pasangan wash 1399/Persediaan yang membalik
  // sebagian biaya barang yang diretur) di luar 4 baris standar -- formula
  // 4-baris ini TIDAK merepetisi baris tambahan itu (contoh nyata:
  // MKE/SI/001256/2026-09/003/001, DO induknya 01241268 punya SalesReturn
  // MKE/SR/000026/2026-09/003/001 -- GL asli 7 baris, formula ini
  // menghasilkan net yang benar tapi bukan baris-per-baris yang sama).
  // Frekuensi live: 15/1677 (~0,9%) voucher SI di jendela 1-11 Sep 2026
  // punya >4 baris GL -- konsisten dengan skala kecil kasus SalesReturn.
  // Daripada menulis GL yang salah/tidak lengkap untuk kasus ini, dokumen
  // di-skip eksplisit (bukan ditebak), sama seperti pola skip lain di
  // fungsi ini.
  const returTerkait = await pool
    .request()
    .input("doId", sql.VarChar(16), doc.deliveryOrderId)
    .query(`SELECT TOP 1 1 AS ada FROM SalesReturn WHERE DeliveryOrderID = @doId AND IsDeleted = 0`);
  if (returTerkait.recordset.length > 0) {
    return { alasan: "DeliveryOrder induk punya SalesReturn terkait -- di luar cakupan formula ini (lihat spec Bagian 1)" };
  }

  const detail = await pool
    .request()
    .input("id", sql.VarChar(16), doc.documentId)
    .query(`SELECT ItemID, Qty, Amount FROM SalesInvoiceDetail WHERE SalesInvoiceID = @id`);

  let totalBiaya = 0;
  let totalPendapatan = 0;
  const kreditPendapatanPerAkun = new Map<string, number>();
  const debitHppPerAkun = new Map<string, number>();
  const tahun = doc.transDate.getUTCFullYear();
  const bulan = doc.transDate.getUTCMonth() + 1;

  for (const row of detail.recordset as { ItemID: string; Qty: number; Amount: number }[]) {
    const akun = mapping.get(row.ItemID);
    if (!akun) return { alasan: `Item ${row.ItemID} tidak punya histori pemetaan akun sebelum 12 Sep 2026` };

    const average = await getItemAverage(pool, row.ItemID, tahun, bulan);
    if (average === null) {
      return { alasan: `Item ${row.ItemID} tidak punya data ItemAverage untuk ${bulan}/${tahun}` };
    }

    const biaya = row.Qty * average;
    totalBiaya += biaya;
    totalPendapatan += row.Amount;
    kreditPendapatanPerAkun.set(
      akun.pendapatanAccountNo,
      (kreditPendapatanPerAkun.get(akun.pendapatanAccountNo) ?? 0) + row.Amount
    );
    debitHppPerAkun.set(akun.hppAccountNo, (debitHppPerAkun.get(akun.hppAccountNo) ?? 0) + biaya);
  }

  const lines: GLLine[] = [
    { accountNo: "1301", debit: totalPendapatan, credit: 0 },
    { accountNo: "1399", debit: 0, credit: totalBiaya },
  ];
  for (const [accountNo, jumlah] of kreditPendapatanPerAkun) lines.push({ accountNo, debit: 0, credit: jumlah });
  for (const [accountNo, jumlah] of debitHppPerAkun) lines.push({ accountNo, debit: jumlah, credit: 0 });
  return { lines };
}

export async function computeBacklogForDate(tanggal: string): Promise<BacklogPreview> {
  const pool = await getPool();
  const mapping = await buildItemAccountMapping(pool);

  const postable: ComputedDoc[] = [];
  const skipped: BacklogSkip[] = [];

  const doBacklog = await cariBacklogDeliveryOrder(pool, tanggal);
  for (const doc of doBacklog) {
    const hasil = await hitungGLDeliveryOrder(pool, doc, mapping);
    if ("alasan" in hasil) {
      skipped.push({ voucherNo: doc.voucherNo, docType: "DELIVERYORDER", documentId: doc.documentId, alasan: hasil.alasan });
      continue;
    }
    postable.push({
      voucherNo: doc.voucherNo,
      docType: "DELIVERYORDER",
      documentId: doc.documentId,
      transDate: doc.transDate,
      branchId: doc.branchId,
      departmentId: doc.departmentId,
      businessPartnerId: doc.businessPartnerId,
      currencyId: doc.currencyId,
      rate: doc.rate,
      lines: hasil.lines,
      parentDoVoucherNo: null,
    });
  }

  const siBacklog = await cariBacklogSalesInvoice(pool, tanggal);

  // Resolusi status DO induk di-batch (bukan query per-baris SI) -- lihat
  // catatan performa di voucherNosDenganGL.
  const doIdsUnik = Array.from(
    new Set(siBacklog.map((d) => d.deliveryOrderId).filter((id): id is string => id !== null))
  );
  const doVoucherMap = await voucherNoUntukDeliveryOrderIds(pool, doIdsUnik);
  const doVoucherNosUnik = Array.from(new Set(Array.from(doVoucherMap.values())));
  const doIndukSudahPunyaGL = await voucherNosDenganGL(pool, doVoucherNosUnik, "DELIVERYORDER");

  for (const doc of siBacklog) {
    if (!doc.deliveryOrderId) {
      skipped.push({ voucherNo: doc.voucherNo, docType: "SALESINVOICE", documentId: doc.documentId, alasan: "Tidak punya DeliveryOrderID induk" });
      continue;
    }
    const doVoucherNo = doVoucherMap.get(doc.deliveryOrderId);
    const dipostingDiRunIni = postable.some((p) => p.docType === "DELIVERYORDER" && p.voucherNo === doVoucherNo);
    const sudahPunyaGL = doVoucherNo ? doIndukSudahPunyaGL.has(doVoucherNo) : false;
    if (!dipostingDiRunIni && !sudahPunyaGL) {
      skipped.push({
        voucherNo: doc.voucherNo,
        docType: "SALESINVOICE",
        documentId: doc.documentId,
        alasan: "DeliveryOrder induk belum ter-posting -- proses tanggal DO induknya dulu",
      });
      continue;
    }
    // Invariant: dipostingDiRunIni/sudahPunyaGL di atas hanya bisa true kalau
    // doVoucherNo terisi (lihat definisi keduanya) -- guard ini murni utk
    // menyempitkan tipe TS ke `string`, bukan jalur yang seharusnya tercapai.
    if (!doVoucherNo) {
      skipped.push({ voucherNo: doc.voucherNo, docType: "SALESINVOICE", documentId: doc.documentId, alasan: "DeliveryOrder induk tidak ditemukan" });
      continue;
    }

    const hasil = await hitungGLSalesInvoice(pool, doc, mapping);
    if ("alasan" in hasil) {
      skipped.push({ voucherNo: doc.voucherNo, docType: "SALESINVOICE", documentId: doc.documentId, alasan: hasil.alasan });
      continue;
    }
    postable.push({
      voucherNo: doc.voucherNo,
      docType: "SALESINVOICE",
      documentId: doc.documentId,
      transDate: doc.transDate,
      branchId: doc.branchId,
      departmentId: doc.departmentId,
      businessPartnerId: doc.businessPartnerId,
      currencyId: doc.currencyId,
      rate: doc.rate,
      lines: hasil.lines,
      parentDoVoucherNo: doVoucherNo,
    });
  }

  const totalMap = new Map<string, { debit: number; credit: number }>();
  for (const doc of postable) {
    for (const line of doc.lines) {
      const existing = totalMap.get(line.accountNo) ?? { debit: 0, credit: 0 };
      totalMap.set(line.accountNo, { debit: existing.debit + line.debit, credit: existing.credit + line.credit });
    }
  }

  return {
    tanggal,
    postable,
    skipped,
    totalPerAkun: Array.from(totalMap, ([accountNo, v]) => ({ accountNo, ...v })),
  };
}

// ============================================================================
// POSTING SUNGGUHAN (write, transaksional, idempoten, dengan trackback)
// ============================================================================

// GeneralLedger.ID BUKAN primary key sungguhan (tidak ada constraint di
// database live, dikonfirmasi lewat INFORMATION_SCHEMA.TABLE_CONSTRAINTS --
// hasilnya kosong) dan nilainya DIBAGI oleh semua baris satu voucher yang
// sama (dikonfirmasi live: baris GeneralLedger untuk satu VoucherNo yang
// sama semuanya punya ID yang identik, bukan unik per baris) -- karena itu
// nextGeneralLedgerId() dipanggil SEKALI per dokumen (bukan per baris) dan
// dipakai ulang untuk semua baris doc.lines-nya, meniru pola live ini persis.
// Format live: string angka, zero-padded ke 8 digit setelah menembus
// 10.000.000 (mis. "01243198"), varchar(16) -- padStart(8) di bawah aman
// jauh di bawah batas kolom.
//
// FIX ROUND 1, Finding 2 (code review): tanpa guard, dua TRANSAKSI BERBEDA
// (dua dokumen berbeda) yang keduanya memanggil ini nyaris bersamaan bisa
// sama-sama membaca MaxID yang SAMA di bawah READ COMMITTED -- karena
// GeneralLedger.ID tidak py constraint UNIQUE/PK, kedua transaksi akan
// SUKSES insert ID yang identik utk voucher yang BERBEDA, diam-diam merusak
// invarian "satu ID unik per voucher" yang dipakai laporan/join lain.
//
// FIX ROUND 2 (code review thd fix round 1): round 1 menambahkan
// `WITH (UPDLOCK, HOLDLOCK)` di sini -- BENAR secara logika (serialisasi
// lintas-transaksi), TAPI ini SELECT MAX(...) tanpa index atas 1,9 juta
// baris live yang JUGA ditulis ERP desktop scr real-time -- UPDLOCK atas
// scan penuh tabel sebesar itu nyaris pasti eskalasi ke page/table lock
// (ambang default SQL Server ~5000 lock/statement), dan HOLDLOCK menahannya
// sampai transaksi (bukan cuma statement) commit -- artinya SELURUH durasi
// postSatuDokumen (idempotency-check + generate ID + semua insert GL/audit)
// berisiko memblokir posting SalesPayment/dsb milik ERP desktop yang SAMA
// SEKALI TIDAK PERNAH DIUJI. Diganti dgn `sp_getapplock` (lihat
// APLLOCK_RESOURCE di postSatuDokumen) -- mutex bernama di subsistem lock
// TERPISAH (`resource_type='APPLICATION'`), TIDAK PERNAH menyentuh baris
// GeneralLedger sama sekali, jadi TIDAK BISA memblokir atau diblokir lock
// baris/halaman/tabel milik ERP. Karena postSatuDokumen sekarang SELALU
// memegang applock ini utk seluruh transaksinya (lihat sana), dan desain
// posting-nya sequential (bukan konkuren dibatasi), applock SENDIRIAN sudah
// cukup menyerialkan SEMUA panggilan dashpmp-vs-dashpmp ke fungsi ini --
// table hint di SINI tidak diperlukan lagi, dikembalikan jadi plain SELECT.
// Exported so any other write path that posts its OWN GeneralLedger rows
// directly (e.g. pelunasan.ts's recordPayment(), which -- unlike SI/DO --
// is entirely dashpmp's own transaction, so it posts synchronously rather
// than needing a separate backlog/health-check system) can generate a safe
// ID under the SAME applock below, instead of duplicating this query and
// risking the exact cross-caller ID race Fix Round 1/2 above already
// eliminated for postSatuDokumen.
export async function nextGeneralLedgerId(poolOrTx: sql.ConnectionPool | sql.Transaction): Promise<string> {
  const result = await poolOrTx.request().query(`SELECT MAX(TRY_CAST(ID AS INT)) AS MaxID FROM GeneralLedger`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

// Nama resource applock -- SATU nama tetap dipakai SEMUA pemanggil yang
// generate GeneralLedger ID lewat nextGeneralLedgerId di atas (postSatuDokumen
// DAN recordPayment) supaya semuanya benar2 saling eksklusi di titik kritis
// yang sama (generate ID GeneralLedger). Bukan per-VoucherNo krn justru race
// lintas-DOKUMEN/lintas-FITUR (Finding 2 round 1) yang perlu diserialkan,
// bukan cuma race per-dokumen yang sama.
export const APPLOCK_RESOURCE = "dashpmp_gl_backfill_posting";

// Akuisisi applock di atas, dalam transaksi pemanggil -- dipakai postSatuDokumen
// di bawah dan recordPayment (pelunasan.ts). @LockOwner 'Transaction' berarti
// lock ini otomatis lepas saat transaksi pemanggil commit ATAU rollback, tidak
// perlu sp_releaseapplock manual. @LockTimeout 30 detik: pemanggil yang
// nunggu applock yang macet gagal bersih (exception), bukan hang selamanya.
export async function acquireGLPostingApplock(transaction: sql.Transaction): Promise<void> {
  await new sql.Request(transaction)
    .input("resource", sql.VarChar(255), APPLOCK_RESOURCE)
    .input("lockMode", sql.VarChar(32), "Exclusive")
    .input("lockOwner", sql.VarChar(32), "Transaction")
    .input("lockTimeout", sql.Int, 30000)
    .query(`
      DECLARE @result INT;
      EXEC @result = sp_getapplock @Resource = @resource, @LockMode = @lockMode, @LockOwner = @lockOwner, @LockTimeout = @lockTimeout;
      IF @result < 0 THROW 50000, 'Gagal memperoleh application lock untuk posting GeneralLedger', 1;
    `);
}

const chartOfAccountIdCache = new Map<string, string>();
async function getChartOfAccountId(poolOrTx: sql.ConnectionPool | sql.Transaction, accountNo: string): Promise<string> {
  const cached = chartOfAccountIdCache.get(accountNo);
  if (cached) return cached;
  const result = await poolOrTx
    .request()
    .input("accountNo", sql.VarChar(20), accountNo)
    .query(`SELECT TOP 1 ChartOfAccountID FROM ChartOfAccount WHERE AccountNo = @accountNo`);
  const row = result.recordset[0] as { ChartOfAccountID: string } | undefined;
  if (!row) throw new AppError(`ChartOfAccountID untuk akun ${accountNo} tidak ditemukan`);
  chartOfAccountIdCache.set(accountNo, row.ChartOfAccountID);
  return row.ChartOfAccountID;
}

export interface BacklogPostResultItem {
  voucherNo: string;
  docType: DocType;
  status: "POSTED" | "GAGAL";
  alasan?: string;
}

// Satu dokumen = satu transaksi MSSQL sendiri (bukan satu transaksi untuk
// seluruh backlog tanggal itu) -- kegagalan satu dokumen tidak boleh
// merollback dokumen lain yang sudah berhasil. Pengecekan ulang idempoten
// dilakukan DI DALAM transaksi ini, tepat sebelum insert pertama, supaya
// dua pemanggilan bersamaan untuk dokumen yang sama tidak bisa lolos
// keduanya (lihat Step 4c untuk verifikasi live race-nya).
//
// FIX ROUND 2 (code review): keselamatan konkurensi (baik "dokumen sama
// diposting 2x" maupun "2 dokumen beda rebutan ID GeneralLedger yang sama")
// SEKARANG dijamin oleh sp_getapplock (@LockOwner='Transaction', lihat di
// bawah) -- BUKAN lagi table hint WITH (UPDLOCK, HOLDLOCK) di query
// GeneralLedger manapun (dihapus dari idempotency-check di bawah maupun
// nextGeneralLedgerId). Alasan: applock adalah mutex bernama di subsistem
// lock TERPISAH SAMA SEKALI dari row/page/table lock -- tidak pernah
// menyentuh satu baris GeneralLedger pun, jadi tidak bisa memblokir/
// diblokir oleh ERP desktop yang menulis ke tabel yang sama scr real-time.
// UPDLOCK/HOLDLOCK atas SELECT tanpa index di tabel 1,9 juta baris live
// yang dipakai bersama itu berisiko nyata eskalasi ke page/table lock yang
// tertahan sepanjang durasi transaksi -- risiko ini belum pernah diuji thd
// ERP sungguhan, jadi dihindari sepenuhnya, bukan cuma diminimalkan.
async function postSatuDokumen(
  pool: sql.ConnectionPool,
  doc: ComputedDoc,
  dipostingOlehAkunId: number,
  tanggalProses: string
): Promise<BacklogPostResultItem> {
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    // Applock DULUAN, sebelum query GeneralLedger apa pun -- lihat
    // acquireGLPostingApplock's own comment di atas.
    await acquireGLPostingApplock(transaction);

    const cekUlang = await new sql.Request(transaction)
      .input("v", sql.VarChar(64), doc.voucherNo)
      .input("t", sql.VarChar(20), doc.docType)
      .query(`SELECT TOP 1 1 AS ada FROM GeneralLedger WHERE VoucherNo = @v AND [Type] = @t`);
    if (cekUlang.recordset.length > 0) {
      await transaction.rollback();
      return { voucherNo: doc.voucherNo, docType: doc.docType, status: "GAGAL", alasan: "Sudah ter-posting (terdeteksi ulang saat commit)" };
    }

    const glId = await nextGeneralLedgerId(transaction);
    const memo = `[DASHPMP-BACKFILL] ${tanggalProses}`;
    const insertHeader = await new sql.Request(transaction)
      .input("voucherNo", sql.VarChar(64), doc.voucherNo)
      .input("docType", sql.VarChar(20), doc.docType)
      .input("documentId", sql.VarChar(16), doc.documentId)
      .input("transDate", sql.DateTime, doc.transDate)
      .input("akunId", sql.Int, dipostingOlehAkunId)
      .query(`
        INSERT INTO DashboardGLPostingBackfill (VoucherNo, DocType, DocumentID, TransDate, DipostingOlehAkunID)
        OUTPUT INSERTED.BackfillID
        VALUES (@voucherNo, @docType, @documentId, @transDate, @akunId)
      `);
    const backfillId = (insertHeader.recordset[0] as { BackfillID: number }).BackfillID;

    for (const line of doc.lines) {
      const chartOfAccountId = await getChartOfAccountId(transaction, line.accountNo);
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), glId)
        .input("branchId", sql.VarChar(16), doc.branchId)
        .input("departmentId", sql.VarChar(16), doc.departmentId)
        .input("voucherNo", sql.VarChar(64), doc.voucherNo)
        .input("transDate", sql.DateTime, doc.transDate)
        .input("docType", sql.VarChar(20), doc.docType)
        .input("chartOfAccountId", sql.VarChar(16), chartOfAccountId)
        .input("debit", sql.Decimal(18, 6), line.debit)
        .input("credit", sql.Decimal(18, 6), line.credit)
        .input("memo", sql.VarChar(255), memo)
        .input("businessPartnerId", sql.VarChar(16), doc.businessPartnerId)
        .input("currencyId", sql.VarChar(16), doc.currencyId)
        .input("rate", sql.Decimal(18, 6), doc.rate)
        .query(`
          INSERT INTO GeneralLedger
            (ID, BranchID, DepartmentID, VoucherNo, TransDate, [Type], ChartOfAccountID, Debit, Credit, Memo, BusinessPartnerID, CurrencyID, Rate)
          VALUES
            (@id, @branchId, @departmentId, @voucherNo, @transDate, @docType, @chartOfAccountId, @debit, @credit, @memo, @businessPartnerId, @currencyId, @rate)
        `);

      await new sql.Request(transaction)
        .input("backfillId", sql.Int, backfillId)
        .input("glId", sql.VarChar(16), glId)
        .input("accountNo", sql.VarChar(20), line.accountNo)
        .input("debit", sql.Decimal(18, 6), line.debit)
        .input("credit", sql.Decimal(18, 6), line.credit)
        .query(`
          INSERT INTO DashboardGLPostingBackfillDetail (BackfillID, GeneralLedgerID, AccountNo, Debit, Credit)
          VALUES (@backfillId, @glId, @accountNo, @debit, @credit)
        `);
    }

    await transaction.commit();
    return { voucherNo: doc.voucherNo, docType: doc.docType, status: "POSTED" };
  } catch (err) {
    await transaction.rollback();
    // Pesan mentah dari driver MSSQL (nama tabel/kolom, detail constraint,
    // dsb) tidak boleh sampai ke UI -- log server-side, tampilkan pesan
    // Indonesia generik ke Manager (pola sama seperti AppError di
    // action-result.ts, yang justru dirancang mencegah kebocoran ini).
    console.error(`Gagal posting ${doc.docType} ${doc.voucherNo}:`, err);
    const alasan = "Terjadi kesalahan teknis saat menulis ke database -- lihat log server untuk detail.";
    return { voucherNo: doc.voucherNo, docType: doc.docType, status: "GAGAL", alasan };
  }
}

export interface BacklogPostResult {
  tanggal: string;
  hasilPerDokumen: BacklogPostResultItem[];
  skipped: BacklogSkip[];
  jumlahPosted: number;
  jumlahGagal: number;
}

export async function postBacklogForDate(tanggal: string, dipostingOlehAkunId: number): Promise<BacklogPostResult> {
  const pool = await getPool();
  // Dihitung ulang FRESH di sini (bukan menerima preview dari client) --
  // lihat spec: "tiap dokumen 1 transaksi sendiri" + mencegah state basi
  // antara preview dan submit. Dipanggil TEPAT SEKALI untuk seluruh run ini
  // -- setiap dokumen di bawah diposting dari snapshot `rencana` yang sama,
  // TIDAK PERNAH dihitung ulang per dokumen (lihat catatan ItemAverage di
  // getItemAverage: dua panggilan computeBacklogForDate terpisah untuk
  // tanggal yang sama tidak dijamin sepakat kalau ItemAverage berubah di
  // antara keduanya, tapi satu panggilan selalu konsisten secara internal).
  const rencana = await computeBacklogForDate(tanggal);
  // FIX (Minor, whole-branch review): tanggalProses hanya dipakai sebagai
  // tag kosmetik di Memo GL (tidak pernah dipakai untuk doc.transDate atau
  // angka GL apa pun) -- tapi tetap harus ikut konvensi naive-WIB yang
  // sudah dipakai semua penulisan tanggal lain di repo ini (lihat
  // getNaiveWibTransDate), bukan new Date().toISOString() yang membaca
  // kalender UTC server. Server yang berjalan UTC murni bisa salah satu
  // hari dibanding WIB antara 00:00-07:00 WIB -- persis kelas bug yang
  // sama seperti transdate-wib-utc-boundary-bug.
  const tanggalProses = getNaiveWibTransDate().toISOString().slice(0, 10);

  const doDocs = rencana.postable.filter((d) => d.docType === "DELIVERYORDER");
  const siDocs = rencana.postable.filter((d) => d.docType === "SALESINVOICE");

  // FIX ROUND 1, Finding 1 (code review): computeBacklogForDate's
  // `dipostingDiRunIni` cuma menandai bahwa DO induk sebuah SI DIRENCANAKAN
  // ikut diposting di run ini (dicek SEBELUM posting apa pun mulai) -- itu
  // TIDAK sama dengan "DO induk benar-benar berhasil ter-posting". Kalau
  // postSatuDokumen utk DO induk itu GAGAL (mis. error DB di tengah jalan),
  // tanpa pengecekan tambahan SI anaknya akan tetap diposting di bawah,
  // menghasilkan kredit 1399 tanpa debit DO pasangannya yang pernah
  // benar-benar tertulis -- 1399 tidak lagi balance utk pasangan itu.
  // Fix: lacak VoucherNo DO yang BENAR-BENAR "POSTED" di run ini
  // (doSuksesVoucherNos). Utk tiap SI: kalau DO induknya ada di daftar
  // "direncanakan run ini" (doDirencanakanVoucherNos) TAPI TIDAK ada di
  // daftar "sukses run ini", SI itu di-skip (GAGAL, tidak pernah masuk
  // postSatuDokumen) -- DO induk yang SUDAH py GL SEBELUM run ini (tidak
  // direncanakan run ini sama sekali, sesuai jaminan computeBacklogForDate)
  // tetap aman diposting terlepas dari hasil run ini.
  const doDirencanakanVoucherNos = new Set(doDocs.map((d) => d.voucherNo));
  const doSuksesVoucherNos = new Set<string>();

  const hasilPerDokumen: BacklogPostResultItem[] = [];

  for (const doc of doDocs) {
    const hasil = await postSatuDokumen(pool, doc, dipostingOlehAkunId, tanggalProses);
    hasilPerDokumen.push(hasil);
    if (hasil.status === "POSTED") doSuksesVoucherNos.add(doc.voucherNo);
  }

  for (const doc of siDocs) {
    const indukDirencanakan = doc.parentDoVoucherNo !== null && doDirencanakanVoucherNos.has(doc.parentDoVoucherNo);
    const indukSukses = doc.parentDoVoucherNo !== null && doSuksesVoucherNos.has(doc.parentDoVoucherNo);
    if (indukDirencanakan && !indukSukses) {
      hasilPerDokumen.push({
        voucherNo: doc.voucherNo,
        docType: doc.docType,
        status: "GAGAL",
        alasan: "DeliveryOrder induk gagal diposting pada proses ini",
      });
      continue;
    }
    hasilPerDokumen.push(await postSatuDokumen(pool, doc, dipostingOlehAkunId, tanggalProses));
  }

  return {
    tanggal,
    hasilPerDokumen,
    skipped: rencana.skipped,
    jumlahPosted: hasilPerDokumen.filter((h) => h.status === "POSTED").length,
    jumlahGagal: hasilPerDokumen.filter((h) => h.status === "GAGAL").length,
  };
}

export interface BackfillRiwayatRingkasan {
  jumlahDokumen: number;
  dipostingOlehAkunId: number;
  dipostingPada: string;
}

// Ringkasan per tanggal dari tabel audit trail Task 1 -- dipakai kartu
// Kesehatan Posting GL untuk menampilkan "siapa & kapan" pada baris yang
// sudah pernah diproses fitur ini, sesuai spec Bagian 3. Satu baris per
// tanggal: total dokumen yang diposting fitur ini (bisa kurang dari total
// backlog kalau baru sebagian tanggal itu diproses), plus akun & waktu dari
// baris TERBARU (bukan daftar lengkap -- cukup untuk konteks ringkas di
// tabel, bukan riwayat granular per dokumen).
export async function getBackfillRingkasanPerTanggal(
  tanggalMulai: string,
  tanggalAkhir: string
): Promise<Map<string, BackfillRiwayatRingkasan>> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("mulai", sql.Date, tanggalMulai)
    .input("akhir", sql.Date, tanggalAkhir).query(`
      WITH terurut AS (
        SELECT CAST(TransDate AS DATE) AS tanggal, DipostingOlehAkunID, DipostingPada,
               ROW_NUMBER() OVER (PARTITION BY CAST(TransDate AS DATE) ORDER BY DipostingPada DESC) AS rn
        FROM DashboardGLPostingBackfill
        WHERE TransDate >= @mulai AND TransDate < @akhir
      )
      SELECT
        t.tanggal,
        (SELECT COUNT(*) FROM DashboardGLPostingBackfill b WHERE CAST(b.TransDate AS DATE) = t.tanggal) AS jumlahDokumen,
        t.DipostingOlehAkunID,
        t.DipostingPada
      FROM terurut t
      WHERE t.rn = 1
    `);

  const map = new Map<string, BackfillRiwayatRingkasan>();
  for (const row of result.recordset as {
    tanggal: Date;
    jumlahDokumen: number;
    DipostingOlehAkunID: number;
    DipostingPada: Date;
  }[]) {
    map.set(row.tanggal.toISOString().slice(0, 10), {
      jumlahDokumen: row.jumlahDokumen,
      dipostingOlehAkunId: row.DipostingOlehAkunID,
      dipostingPada: row.DipostingPada.toISOString(),
    });
  }
  return map;
}
