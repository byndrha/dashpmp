import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool } from "../src/lib/db";

// PEMANTAU READ-ONLY: melacak kapan jurnal DeliveryOrder (Sep-Okt 2026) hilang dari GeneralLedger.
// Tiap dijalankan: ambil daftar voucher jurnal DO, bandingkan dgn snapshot terakhir, catat voucher yang
// HILANG (beserta jendela waktu: snapshot sebelumnya -> sekarang) dan yang BARU ke log. Tidak menulis ke DB.
// Jalankan berkala (mis. tiap 30 menit):  npx tsx scripts/pantau-jurnal-do-2026-10-23.ts
// Berkas: docs/data-fixes/monitor/{snapshot.json, log.jsonl}

const DIR = path.join(__dirname, "..", "docs", "data-fixes", "monitor");
const SNAP = path.join(DIR, "snapshot.json");
const LOG = path.join(DIR, "log.jsonl");

type Entri = { id: string; asal: "dashboard" | "ERP"; debit: number };
type Snapshot = { diambilPada: string; saldo30Sep: number; jurnalDO: Record<string, Entri> };

async function main() {
  const pool = await getPool();
  const rows = (await pool.request().query(`
    SELECT g.VoucherNo, MIN(g.ID) AS ID, MAX(CASE WHEN LEFT(ISNULL(g.Memo,''),9)='[DASHPMP-' THEN 1 ELSE 0 END) AS dash,
           SUM(CASE WHEN c.AccountNo='1399' THEN g.Debit ELSE 0 END) AS debit
    FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
    WHERE g.[Type]='DELIVERYORDER' AND g.TransDate>='2026-09-01' AND g.TransDate<'2026-11-01'
    GROUP BY g.VoucherNo`)).recordset as { VoucherNo: string; ID: string; dash: number; debit: number }[];
  const saldo = (await pool.request().query(`
    SELECT SUM(g.Debit-g.Credit) AS s FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
    WHERE c.AccountNo='1399' AND g.TransDate<'2026-10-01'`)).recordset[0].s as number;

  const sekarang: Snapshot = {
    diambilPada: new Date().toISOString(), saldo30Sep: saldo,
    jurnalDO: Object.fromEntries(rows.map((r) => [r.VoucherNo, { id: r.ID, asal: r.dash ? "dashboard" : "ERP", debit: r.debit } as Entri])),
  };
  fs.mkdirSync(DIR, { recursive: true });

  if (!fs.existsSync(SNAP)) {
    fs.writeFileSync(SNAP, JSON.stringify(sekarang));
    console.log(`Snapshot awal dibuat: ${rows.length} voucher jurnal DO | saldo 1399 s/d 30 Sep = ${saldo}`);
    await pool.close(); return;
  }
  const lama = JSON.parse(fs.readFileSync(SNAP, "utf8")) as Snapshot;
  const hilang = Object.keys(lama.jurnalDO).filter((v) => !(v in sekarang.jurnalDO));
  const baru = Object.keys(sekarang.jurnalDO).filter((v) => !(v in lama.jurnalDO));
  const berubah = Object.keys(sekarang.jurnalDO).filter((v) => v in lama.jurnalDO && Math.abs(lama.jurnalDO[v].debit - sekarang.jurnalDO[v].debit) > 0.01);

  const catatan = {
    jendela: [lama.diambilPada, sekarang.diambilPada],
    saldo30Sep: { sebelum: lama.saldo30Sep, sesudah: saldo },
    hilang: hilang.map((v) => ({ voucher: v, ...lama.jurnalDO[v] })),
    jumlahBaru: baru.length, berubahNominal: berubah,
  };
  fs.appendFileSync(LOG, JSON.stringify(catatan) + "\n");
  console.log(`Jendela ${lama.diambilPada} -> ${sekarang.diambilPada}`);
  console.log(`Saldo 1399 s/d 30 Sep: ${lama.saldo30Sep} -> ${saldo} | voucher hilang: ${hilang.length} | baru: ${baru.length} | nominal berubah: ${berubah.length}`);
  for (const v of hilang) console.log("  HILANG:", v, JSON.stringify(lama.jurnalDO[v]));
  fs.writeFileSync(SNAP, JSON.stringify(sekarang));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
