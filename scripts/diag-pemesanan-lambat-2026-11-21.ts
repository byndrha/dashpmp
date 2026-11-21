// Diagnostik read-only: ukur tiap bagian getSalesOrderList (/mkesindo/pemesanan),
// lalu bandingkan dengan versi yang dibatasi ke SO dalam rentang tanggal.
// Usage: npx tsx scripts/diag-pemesanan-lambat-2026-11-21.ts [from] [to]
import "dotenv/config";
import { getPool, sql } from "../src/lib/db";

async function ukur(label: string, fn: () => Promise<{ recordset: unknown[] }>) {
  const t = Date.now();
  try {
    const r = await fn();
    console.log(`${label}: ${((Date.now() - t) / 1000).toFixed(1)}s (${r.recordset.length} baris)`);
    return r.recordset;
  } catch (e) {
    console.log(`${label}: GAGAL ${((Date.now() - t) / 1000).toFixed(1)}s — ${(e as Error).message}`);
    return [];
  }
}

const SO_RENTANG = `SELECT SalesOrderID FROM SalesOrder WHERE IsDeleted=0 AND TransDate>=@from AND TransDate<@to`;
const DO_RENTANG = `SELECT DeliveryOrderID FROM DeliveryOrder WHERE IsDeleted=0 AND SalesOrderID IN (${SO_RENTANG})`;

async function main() {
  const pool = await getPool();
  const from = process.argv[2] ?? "2026-11-01";
  const to = process.argv[3] ?? "2026-11-22";
  console.log(`rentang ${from} .. ${to}`);
  const req = () => pool.request().input("from", sql.Date, from).input("to", sql.Date, to);

  await ukur("SELECT 1", () => pool.request().query("SELECT 1"));

  // Pola sekarang: peta penuh
  const siSoPenuh = await ukur("[lama] Peta SI per SO (semua)", () =>
    pool.request().query(`SELECT SalesOrderID K, MAX(SalesInvoiceID) M FROM SalesInvoice WHERE IsDeleted=0 AND SalesOrderID IS NOT NULL GROUP BY SalesOrderID`)
  );
  const siDoPenuh = await ukur("[lama] Peta SI per DO (semua)", () =>
    pool.request().query(`SELECT REPLACE(DeliveryOrderID,'''','') K, MAX(SalesInvoiceID) M FROM SalesInvoice WHERE IsDeleted=0 AND DeliveryOrderID IS NOT NULL GROUP BY REPLACE(DeliveryOrderID,'''','')`)
  );

  // Usulan: dibatasi ke SO/DO dalam rentang (sub-query, bukan daftar IN dari JS)
  const siSoBaru = await ukur("[baru] Peta SI per SO (rentang)", () =>
    req().query(`SELECT SalesOrderID K, MAX(SalesInvoiceID) M FROM SalesInvoice
      WHERE IsDeleted=0 AND SalesOrderID IN (${SO_RENTANG}) GROUP BY SalesOrderID`)
  );
  const siDoBaru = await ukur("[baru] Peta SI per DO (rentang)", () =>
    req().query(`SELECT REPLACE(si.DeliveryOrderID,'''','') K, MAX(si.SalesInvoiceID) M FROM SalesInvoice si
      WHERE si.IsDeleted=0 AND REPLACE(si.DeliveryOrderID,'''','') IN (${DO_RENTANG})
      GROUP BY REPLACE(si.DeliveryOrderID,'''','')`)
  );
  await ukur("[baru] Peta SR per DO (rentang)", () =>
    req().query(`SELECT DeliveryOrderID K, MAX(SalesReturnID) M FROM SalesReturn
      WHERE IsDeleted=0 AND DeliveryOrderID IN (${DO_RENTANG}) GROUP BY DeliveryOrderID`)
  );

  // Kesetaraan: setiap kunci versi baru harus sama nilainya dengan peta penuh.
  const cocok = (baru: unknown[], penuh: unknown[]) => {
    const m = new Map((penuh as { K: string; M: string }[]).map((r) => [r.K, r.M]));
    return (baru as { K: string; M: string }[]).every((r) => m.get(r.K) === r.M);
  };
  console.log("SI per SO sama:", cocok(siSoBaru, siSoPenuh), "| SI per DO sama:", cocok(siDoBaru, siDoPenuh));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
