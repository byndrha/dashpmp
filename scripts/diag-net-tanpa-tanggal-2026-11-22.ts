// Uji BACA-SAJA (2026-11-22): bandingkan net per Agen tanpa filter tanggal
// (rumus getPiutangSummary) vs "sebelum 9999-12-31" (getPemesananNetByAgenBefore).
import "dotenv/config";
import { sql } from "../src/lib/db";
import { getCompanyPool } from "../src/lib/db-company";
import { resolveAgenKoneksi, type SumberAgen } from "../src/lib/queries/mitra-es-balok";
import { getPemesananNetByAgenBefore, getPembayaranNetByAgenBefore } from "../src/lib/queries/penjualan-piutang";

async function main() {
  const kode = process.argv[2] ?? "pmputra";
  const MAX = new Date(9999, 11, 31);
  for (const sumber of ["utama", "logistik"] as SumberAgen[]) {
    const { kode: k, label } = resolveAgenKoneksi(kode, sumber);
    const pool = await getCompanyPool(k, label);
    const tanpa = await pool.request().query(`SELECT SUM((BalokKecilRealisasi - ISNULL(BalokKecilRetur,0)) * BalokKecilHarga + (BalokBesarRealisasi - ISNULL(BalokBesarRetur,0)) * BalokBesarHarga - ISNULL(Pembayaran,0)) AS P FROM PMP_Pemesanan WHERE IsDeleted = 0`);
    const tanpaB = await pool.request().query(`SELECT SUM(ISNULL(Tarikan,0) - ISNULL(Pembayaran,0)) AS B FROM PMP_Pembayaran WHERE IsDeleted = 0`);
    const before = (await getPemesananNetByAgenBefore(kode, sumber, MAX)).reduce((s, r) => s + r.Net, 0);
    const beforeB = (await getPembayaranNetByAgenBefore(kode, sumber, MAX)).reduce((s, r) => s + r.Net, 0);
    const maks = await pool.request().input("m", sql.DateTime, MAX).query(`SELECT @m AS M, MAX(Tanggal) AS MaxTgl FROM PMP_Pembayaran`);
    console.log(sumber, { pesananTanpa: tanpa.recordset[0].P, pesananBefore: before, bayarTanpa: tanpaB.recordset[0].B, bayarBefore: beforeB }, maks.recordset[0]);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
