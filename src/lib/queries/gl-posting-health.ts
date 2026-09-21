import { getPool, sql } from "@/lib/db";

export interface GLPostingHealthRow {
  tanggal: string;
  siDibuat: number;
  siPosted: number;
  siRupiahDibuat: number;
  siRupiahPosted: number;
  doDibuat: number;
  doPosted: number;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Bandingkan SalesInvoice/DeliveryOrder yang dibuat per hari terhadap baris
// GeneralLedger yang benar-benar ter-posting untuk hari yang sama (dicocokkan
// lewat VoucherNo, dan GL.TransDate yang mengikuti tanggal dokumen sumber,
// bukan tanggal proses -- lihat catatan investigasi gl-posting-backlog-do-si-sept12).
// siRupiahDibuat = SUM(SalesInvoice.Netto) hari itu (seharusnya). siRupiahPosted
// = SUM(Credit-Debit) akun Pendapatan (4xxx) yang ter-posting hari itu (realisasi)
// -- dua-duanya secara historis cocok persis saat posting berjalan normal.
// DeliveryOrder tidak dibandingkan versi Rupiah-nya karena tabelnya sendiri
// tidak punya kolom nominal (DO adalah dokumen pengiriman, bukan tagihan).
//
// Dihitung lewat 5 query GROUP BY terpisah (bukan subquery berkorelasi per
// hari) -- versi awal yang memakai subquery berkorelasi per baris terbukti
// lambat di halaman nyata (25-36 detik untuk 30 hari), karena tiap subquery
// men-scan ulang GeneralLedger/SalesInvoice untuk setiap baris tanggal.
export async function getGLPostingHealth(todayISO: string, hari = 30): Promise<GLPostingHealthRow[]> {
  const pool = await getPool();
  const endDate = new Date(`${todayISO}T00:00:00.000Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - hari);
  const startISO = toISODate(startDate);
  const endISO = toISODate(endDate);

  const request = () => pool.request().input("start", sql.Date, startISO).input("end", sql.Date, endISO);

  const [siDibuatRes, siPostedRes, siRupiahPostedRes, doDibuatRes, doPostedRes] = await Promise.all([
    request().query(`
      SELECT CAST(TransDate AS DATE) AS tgl, COUNT(*) AS cnt, ISNULL(SUM(Netto), 0) AS rp
      FROM SalesInvoice WHERE TransDate >= @start AND TransDate < @end AND IsDeleted = 0
      GROUP BY CAST(TransDate AS DATE)
    `),
    request().query(`
      SELECT CAST(TransDate AS DATE) AS tgl, COUNT(DISTINCT VoucherNo) AS cnt
      FROM GeneralLedger WHERE [Type] = 'SALESINVOICE' AND TransDate >= @start AND TransDate < @end
      GROUP BY CAST(TransDate AS DATE)
    `),
    request().query(`
      SELECT CAST(gl.TransDate AS DATE) AS tgl, ISNULL(SUM(gl.Credit) - SUM(gl.Debit), 0) AS rp
      FROM GeneralLedger gl JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE coa.AccountNo LIKE '4%' AND gl.TransDate >= @start AND gl.TransDate < @end
      GROUP BY CAST(gl.TransDate AS DATE)
    `),
    request().query(`
      SELECT CAST(TransDate AS DATE) AS tgl, COUNT(*) AS cnt
      FROM DeliveryOrder WHERE TransDate >= @start AND TransDate < @end AND IsDeleted = 0
      GROUP BY CAST(TransDate AS DATE)
    `),
    request().query(`
      SELECT CAST(TransDate AS DATE) AS tgl, COUNT(DISTINCT VoucherNo) AS cnt
      FROM GeneralLedger WHERE [Type] = 'DELIVERYORDER' AND TransDate >= @start AND TransDate < @end
      GROUP BY CAST(TransDate AS DATE)
    `),
  ]);

  type CountRow = { tgl: Date; cnt: number };
  type RpRow = { tgl: Date; rp: number };
  const toMap = <T extends { tgl: Date }>(rows: T[]) => new Map(rows.map((r) => [toISODate(r.tgl), r]));

  const siDibuatMap = toMap(siDibuatRes.recordset as (CountRow & RpRow)[]);
  const siPostedMap = toMap(siPostedRes.recordset as CountRow[]);
  const siRupiahPostedMap = toMap(siRupiahPostedRes.recordset as RpRow[]);
  const doDibuatMap = toMap(doDibuatRes.recordset as CountRow[]);
  const doPostedMap = toMap(doPostedRes.recordset as CountRow[]);

  const rows: GLPostingHealthRow[] = [];
  for (let i = 0; i < hari; i++) {
    const d = new Date(endDate);
    d.setUTCDate(d.getUTCDate() - 1 - i);
    const tanggal = toISODate(d);
    rows.push({
      tanggal,
      siDibuat: siDibuatMap.get(tanggal)?.cnt ?? 0,
      siPosted: siPostedMap.get(tanggal)?.cnt ?? 0,
      siRupiahDibuat: siDibuatMap.get(tanggal)?.rp ?? 0,
      siRupiahPosted: siRupiahPostedMap.get(tanggal)?.rp ?? 0,
      doDibuat: doDibuatMap.get(tanggal)?.cnt ?? 0,
      doPosted: doPostedMap.get(tanggal)?.cnt ?? 0,
    });
  }
  return rows;
}
