import { getPool, sql } from "@/lib/db";

export interface GLPostingHealthRow {
  tanggal: string;
  siDibuat: number;
  siPosted: number;
  doDibuat: number;
  doPosted: number;
}

// Bandingkan SalesInvoice/DeliveryOrder yang dibuat per hari terhadap baris
// GeneralLedger yang benar-benar ter-posting untuk hari yang sama (dicocokkan
// lewat VoucherNo, dan GL.TransDate yang mengikuti tanggal dokumen sumber,
// bukan tanggal proses -- lihat catatan investigasi gl-posting-backlog-do-si-sept12).
// Dipakai untuk mendeteksi dini kalau proses posting GL macet, alih-alih baru
// ketahuan berhari-hari kemudian lewat selisih COA Pendapatan.
export async function getGLPostingHealth(todayISO: string, hari = 14): Promise<GLPostingHealthRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("today", sql.Date, todayISO)
    .input("hari", sql.Int, hari).query(`
      WITH tgl AS (
        SELECT CAST(DATEADD(DAY, -n.n, @today) AS DATE) AS tanggal
        FROM (SELECT TOP (@hari) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS n FROM sys.objects) n
      )
      SELECT
        tgl.tanggal AS tanggal,
        (SELECT COUNT(*) FROM SalesInvoice si WHERE CAST(si.TransDate AS DATE) = tgl.tanggal AND si.IsDeleted = 0) AS siDibuat,
        (SELECT COUNT(DISTINCT gl.VoucherNo) FROM GeneralLedger gl WHERE gl.[Type] = 'SALESINVOICE' AND CAST(gl.TransDate AS DATE) = tgl.tanggal) AS siPosted,
        (SELECT COUNT(*) FROM DeliveryOrder do2 WHERE CAST(do2.TransDate AS DATE) = tgl.tanggal AND do2.IsDeleted = 0) AS doDibuat,
        (SELECT COUNT(DISTINCT gl.VoucherNo) FROM GeneralLedger gl WHERE gl.[Type] = 'DELIVERYORDER' AND CAST(gl.TransDate AS DATE) = tgl.tanggal) AS doPosted
      FROM tgl
      ORDER BY tgl.tanggal DESC
    `);

  return (
    result.recordset as { tanggal: Date; siDibuat: number; siPosted: number; doDibuat: number; doPosted: number }[]
  ).map((r) => ({
    tanggal: r.tanggal.toISOString().slice(0, 10),
    siDibuat: r.siDibuat,
    siPosted: r.siPosted,
    doDibuat: r.doDibuat,
    doPosted: r.doPosted,
  }));
}
