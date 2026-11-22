// Diagnostik BACA-SAJA (2026-11-22): skema tabel pemesanan/penjadwalan ERP Es Balok
// untuk merancang modul Pemesanan Es Balok. Tidak menulis apa pun.
// Usage: npx tsx scripts/diag-pemesanan-es-balok-skema-2026-11-22.ts [kode]
import "dotenv/config";
import { getCompanyPool } from "../src/lib/db-company";

async function main() {
  const kode = process.argv[2] ?? "pmputra";
  const pool = await getCompanyPool(kode, "utama");
  const kolom = await pool.request().query(`
    SELECT t.name AS Tabel, c.name AS Kolom, ty.name AS Tipe, c.max_length AS Panjang, c.is_nullable AS BolehNull,
           OBJECT_DEFINITION(c.default_object_id) AS Bawaan
    FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE t.name IN ('PMP_Pemesanan','PMP_Penjadwalan','PMP_PenjadwalanDetail','PMP_Agen','PMP_DaftarKendaraan')
    ORDER BY t.name, c.column_id`);
  let cur = "";
  for (const r of kolom.recordset) {
    if (r.Tabel !== cur) { cur = r.Tabel; console.log(`\n== ${cur}`); }
    console.log(`  ${r.Kolom} ${r.Tipe}(${r.Panjang})${r.BolehNull ? "" : " NOT NULL"}${r.Bawaan ? " DEFAULT " + r.Bawaan : ""}`);
  }
  const tabelPmp = await pool.request().query(`SELECT name FROM sys.tables WHERE name LIKE 'PMP[_]%' ORDER BY name`);
  console.log("\n== tabel PMP_*:", tabelPmp.recordset.map((r: { name: string }) => r.name).join(", "));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
