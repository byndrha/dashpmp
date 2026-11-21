// Diagnostik read-only: memeriksa sumber data untuk modul Penjualan Es Balok
// (PMP_Pemesanan utama+logistik vs GL pendapatan), per PT.
// Usage: npx tsx scripts/diag-penjualan-es-balok-2026-11-21.ts
import "dotenv/config";
import { getCompanyPool, type CompanyKoneksiLabel } from "../src/lib/db-company";

const BRANCH: Record<string, string> = { pmpersada: "012", pmpakis: "011" };

async function q(kode: string, label: CompanyKoneksiLabel, text: string) {
  const pool = await getCompanyPool(kode, label);
  const r = await pool.request().query(text);
  return r.recordset;
}

async function main() {
  for (const kode of ["pmputra", "pmpersada", "pmpakis"]) {
    console.log(`\n===== ${kode} =====`);
    for (const label of ["utama", "logistik"] as const) {
      const bf = label === "logistik" && BRANCH[kode] ? `AND BranchID = '${BRANCH[kode]}'` : "";
      try {
        const db = await q(kode, label, `SELECT DB_NAME() AS db`);
        console.log(`-- ${label}: ${db[0].db}`);
        if (label === "utama") {
          const cols = await q(kode, label, `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PMP_Pemesanan' ORDER BY ORDINAL_POSITION`);
          console.log("cols:", cols.map((c) => `${c.COLUMN_NAME}:${c.DATA_TYPE}`).join(", "));
          const tgt = await q(kode, label, `SELECT OBJECT_ID('DashboardMonthlyTarget') AS t, OBJECT_ID('DashboardBalokTarget') AS t2`);
          console.log("target tables:", tgt[0]);
          const st = await q(kode, label, `SELECT Status, COUNT(*) n, SUM(BalokKecilRealisasi+BalokBesarRealisasi) q FROM PMP_Pemesanan WHERE IsDeleted=0 AND Tanggal >= '2026-10-01' GROUP BY Status`);
          console.log("status Okt+:", st);
          const tm = await q(kode, label, `SELECT TOP 5 NoDokumen, Tanggal, Status, AgenID FROM PMP_Pemesanan WHERE IsDeleted=0 ORDER BY Tanggal DESC`);
          console.log("latest:", tm);
          const hr = await q(kode, label, `SELECT DATEPART(HOUR,Tanggal) h, COUNT(*) n FROM PMP_Pemesanan WHERE IsDeleted=0 AND Tanggal>='2026-10-01' GROUP BY DATEPART(HOUR,Tanggal) ORDER BY h`);
          console.log("hour dist:", hr.map((r) => `${r.h}:${r.n}`).join(" "));
        }
        const m = await q(kode, label, `
          SELECT CONVERT(varchar(7),Tanggal,120) Bulan,
            SUM((BalokKecilRealisasi-ISNULL(BalokKecilRetur,0))*BalokKecilHarga + (BalokBesarRealisasi-ISNULL(BalokBesarRetur,0))*BalokBesarHarga) NetAll,
            SUM(CASE WHEN Status='3' AND ISNULL(IsVoid,0)=0 THEN (BalokKecilRealisasi-ISNULL(BalokKecilRetur,0))*BalokKecilHarga + (BalokBesarRealisasi-ISNULL(BalokBesarRetur,0))*BalokBesarHarga ELSE 0 END) NetS3,
            SUM(CASE WHEN Status='3' AND ISNULL(IsVoid,0)=0 THEN BalokKecilRealisasi ELSE 0 END) Kecil,
            SUM(CASE WHEN Status='3' AND ISNULL(IsVoid,0)=0 THEN BalokBesarRealisasi ELSE 0 END) Besar,
            AVG(CASE WHEN BalokKecilRealisasi>0 THEN BalokKecilHarga END) HK, AVG(CASE WHEN BalokBesarRealisasi>0 THEN BalokBesarHarga END) HB
          FROM PMP_Pemesanan WHERE IsDeleted=0 AND Tanggal>='2026-08-01' ${bf}
          GROUP BY CONVERT(varchar(7),Tanggal,120) ORDER BY Bulan`);
        console.log("pemesanan:", m);
      } catch (e) {
        console.log(`-- ${label}: ERROR ${(e as Error).message}`);
      }
    }
  }
  process.exit(0);
}
main();
