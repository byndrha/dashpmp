// Uji BACA-SAJA (2026-11-22): latensi koneksi & kueri ringan ke MSSQL MKEsindo
// dan PMPutra.
import "dotenv/config";
import { getPool } from "../src/lib/db";
import { getCompanyPool } from "../src/lib/db-company";

async function main() {
  for (const [nama, ambil] of [["mkesindo", () => getPool()], ["pmputra", () => getCompanyPool("pmputra", "utama")]] as const) {
    let t = Date.now();
    const pool = await ambil();
    console.log(nama, "connect:", Date.now() - t, "ms");
    for (let i = 0; i < 3; i++) {
      t = Date.now();
      await pool.request().query("SELECT 1 AS x");
      console.log(nama, "SELECT 1:", Date.now() - t, "ms");
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
