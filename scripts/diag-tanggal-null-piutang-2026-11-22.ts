// Uji BACA-SAJA (2026-11-22): baris PMP_Pemesanan/PMP_Pembayaran ber-Tanggal
// NULL — ikut Total Piutang (tanpa filter tanggal) tetapi tidak ikut
// perhitungan "sebelum tanggal X". Usage: npx tsx <file> [kode]
import "dotenv/config";
import { getCompanyPool } from "../src/lib/db-company";
import { resolveAgenKoneksi, type SumberAgen } from "../src/lib/queries/mitra-es-balok";

async function main() {
  const kode = process.argv[2] ?? "pmputra";
  for (const sumber of ["utama", "logistik"] as SumberAgen[]) {
    const { kode: k, label } = resolveAgenKoneksi(kode, sumber);
    const pool = await getCompanyPool(k, label);
    const a = await pool.request().query(`SELECT COUNT(*) AS N, SUM((BalokKecilRealisasi - ISNULL(BalokKecilRetur,0)) * BalokKecilHarga + (BalokBesarRealisasi - ISNULL(BalokBesarRetur,0)) * BalokBesarHarga - ISNULL(Pembayaran,0)) AS Net FROM PMP_Pemesanan WHERE IsDeleted = 0 AND Tanggal IS NULL`);
    const b = await pool.request().query(`SELECT COUNT(*) AS N, SUM(ISNULL(Tarikan,0) - ISNULL(Pembayaran,0)) AS Net, MIN(NoDokumen) AS Contoh FROM PMP_Pembayaran WHERE IsDeleted = 0 AND Tanggal IS NULL`);
    const c = await pool.request().query(`SELECT COUNT(*) AS N FROM PMP_Pemesanan WHERE IsDeleted = 0 AND Tanggal >= '9999-01-01'`);
    console.log(kode, sumber, "pemesanan NULL:", a.recordset[0], "| pembayaran NULL:", b.recordset[0], "| tgl ekstrem:", c.recordset[0]);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
