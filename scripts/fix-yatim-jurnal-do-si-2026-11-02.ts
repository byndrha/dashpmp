import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Hapus jurnal YATIM bertipe DELIVERYORDER dan SALESINVOICE (TransDate >= 1 Okt 2026): jurnal dashboard seluruhnya
// ([DASHPMP-]) yang vouchernya TIDAK punya dokumen aktif (dokumennya sudah dihapus ERP). Disetujui user 2 Nov.
// Pagar: semua baris yang dihapus ber-memo dashboard; --jurnal=<N> --net1399=<Rp> harus sama dengan dry-run (net 1399 = Debit-Credit).
// Snapshot semua baris sebelum hapus, 1 transaksi. Default DRY RUN; --execute untuk menulis.
// Revert: scripts/revert-jurnal-snapshot-generik.ts <snapshot.json>

const EXECUTE = process.argv.includes("--execute");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const HARI = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const SNAP = path.join(__dirname, "..", "docs", "data-fixes", `${HARI}-yatim-do-si-before.json`);
const TABEL: Record<string, string> = { DELIVERYORDER: "DeliveryOrder", SALESINVOICE: "SalesInvoice" };

async function main() {
  const pool = await getPool();
  const ident = (await pool.request().query(`SELECT DB_NAME() AS d`)).recordset[0] as { d: string };
  console.log("DB:", ident.d, EXECUTE ? "(EXECUTE)" : "(DRY RUN)");
  if (ident.d !== "MKEsindo") throw new Error(`DB bukan MKEsindo: ${ident.d}`);

  const rows: Record<string, unknown>[] = [];
  const ringkas: { tipe: string; voucher: string; id: string; net1399: number }[] = [];
  for (const [tipe, tabel] of Object.entries(TABEL)) {
    const kandidat = (await pool.request().input("t", sql.VarChar(20), tipe).query(`
      SELECT g.VoucherNo, g.ID FROM GeneralLedger g WHERE g.[Type]=@t AND g.TransDate>='2026-10-01'
        AND NOT EXISTS (SELECT 1 FROM ${tabel} d WHERE d.VoucherNo=g.VoucherNo AND d.IsDeleted=0)
      GROUP BY g.VoucherNo, g.ID`)).recordset as { VoucherNo: string; ID: string }[];
    for (const k of kandidat) {
      const r = (await pool.request().input("t", sql.VarChar(20), tipe).input("v", sql.VarChar(64), k.VoucherNo).input("id", sql.VarChar(16), k.ID)
        .query(`SELECT g.*, c.AccountNo FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE g.[Type]=@t AND g.VoucherNo=@v AND g.ID=@id`)).recordset as (Record<string, unknown> & { AccountNo: string; Debit: number; Credit: number })[];
      if (r.some((x) => !String(x.Memo ?? "").startsWith("[DASHPMP-"))) { console.log("DILEWATI (ada baris non-dashboard):", tipe, k.VoucherNo, k.ID); continue; }
      ringkas.push({ tipe, voucher: k.VoucherNo, id: k.ID, net1399: r.filter((x) => x.AccountNo === "1399").reduce((s, x) => s + x.Debit - x.Credit, 0) });
      rows.push(...r.map(({ AccountNo, ...sisa }) => { void AccountNo; return sisa; }));
    }
  }
  const net = ringkas.reduce((s, x) => s + x.net1399, 0);
  for (const x of ringkas) console.log("  ", x.tipe === "DELIVERYORDER" ? "DO" : "SI", x.voucher, "ID", x.id, "net1399", x.net1399.toFixed(2));
  console.log(`Sasaran: ${ringkas.length} jurnal (${rows.length} baris) | net 1399 ${net.toFixed(2)}`);
  if (ringkas.length === 0) { console.log("Tidak ada yatim."); await pool.close(); process.exit(0); }
  if (!EXECUTE) { console.log(`DRY RUN selesai. Untuk menulis: --execute --jurnal=${ringkas.length} --net1399=${net.toFixed(2)}`); await pool.close(); process.exit(0); }
  if (Number(arg("jurnal")) !== ringkas.length || Math.abs(Number(arg("net1399")) - net) > 0.01) {
    console.error(`ABORT: angka harapan tidak cocok (--jurnal=${arg("jurnal")} --net1399=${arg("net1399")}).`); await pool.close(); process.exit(1);
  }
  fs.mkdirSync(path.dirname(SNAP), { recursive: true });
  fs.writeFileSync(SNAP, JSON.stringify(rows, null, 2));
  console.log("Snapshot (trackback) ditulis:", SNAP);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    let n = 0;
    for (const x of ringkas) {
      const del = await new sql.Request(tx).input("t", sql.VarChar(20), x.tipe).input("v", sql.VarChar(64), x.voucher).input("id", sql.VarChar(16), x.id)
        .query(`DELETE FROM GeneralLedger WHERE [Type]=@t AND VoucherNo=@v AND ID=@id AND LEFT(ISNULL(Memo,''),9)='[DASHPMP-'`);
      n += del.rowsAffected[0];
    }
    if (n !== rows.length) throw new Error(`terhapus ${n} != snapshot ${rows.length}`);
    await tx.commit(); console.log(`${n} baris jurnal yatim dihapus.`);
  } catch (e) { await tx.rollback(); console.error("GAGAL (rollback):", e); await pool.close(); process.exit(1); }
  const ukur = (await pool.request().query(`SELECT SUM(g.Debit-g.Credit) AS saldo1399 FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399'`)).recordset[0];
  console.log("Setelah hapus:", JSON.stringify(ukur));
  await pool.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
