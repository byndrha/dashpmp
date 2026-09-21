import { getPool, sql } from "@/lib/db";

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
// PENTING (ditemukan lewat validasi Step 6, 21 Sep 2026): sejumlah kecil
// ItemID punya baris GL historis yang "nyasar" ke akun Pendapatan (4%) yang
// BEDA dari mayoritas mutlak transaksinya -- contoh nyata: ItemID "019"
// punya 177.985 baris ke akun 4001 vs cuma 2 baris ke akun 4003 (kemungkinan
// koreksi/kesalahan input manual di ERP, bukan pola normal). Versi pertama
// fungsi ini memakai MAX(CASE...) yang secara tidak sengaja memilih "4003"
// (lebih besar secara string) padahal "4001" adalah akun yang BENAR --
// menyebabkan 7/10 sample SalesInvoice pada pengecekan formula (Step 6 no.1)
// tidak cocok dengan GL asli. Diperbaiki dengan memilih akun yang PALING
// SERING muncul (mode) per ItemID, bukan MAX() -- setelah perbaikan ini,
// 20/20 sample cocok persis. HppAccountNo & PersediaanAccountNo (Persediaan)
// ternyata 100% konsisten per ItemID pada data ini (tidak ada ambiguitas),
// tapi pola mode dipakai di ketiganya untuk konsisten & aman terhadap data
// masa depan yang mungkin punya ambiguitas serupa.
async function buildItemAccountMapping(pool: sql.ConnectionPool): Promise<Map<string, ItemAccountMapping>> {
  const pendapatan = await pool.request().input("batas", sql.Date, BATAS_DATA_NORMAL).query(`
    WITH Ranked AS (
      SELECT sid.ItemID, coa.AccountNo,
             ROW_NUMBER() OVER (PARTITION BY sid.ItemID ORDER BY COUNT(*) DESC, coa.AccountNo ASC) AS rn
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
             ROW_NUMBER() OVER (PARTITION BY sid.ItemID ORDER BY COUNT(*) DESC, coa.AccountNo ASC) AS rn
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
             ROW_NUMBER() OVER (PARTITION BY dod.ItemID ORDER BY COUNT(*) DESC, coa.AccountNo ASC) AS rn
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
