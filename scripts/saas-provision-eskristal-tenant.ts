// Provisioning satu perusahaan Es Kristal baru dari database kosong:
//   1. CREATE DATABASE di instance MSSQL yang sama dengan sumber (MKEsindo).
//   2. Terapkan db/eskristal/schema.sql (hasil scripts/saas-dump-eskristal-schema.ts).
//   3. Seed data referensi dari MKEsindo -- hanya data struktural (bagan akun,
//      TOP, master barang, mesin, format cetak), disanitasi dari nama orang &
//      nomor rekening. TIDAK menyalin mitra, salesman, atau transaksi apa pun.
//   4. Daftarkan di direktori Postgres: perusahaan (+holding_id) dan
//      perusahaan_koneksi label "utama".
//
// Kredensial MSSQL tenant baru disalin apa adanya (ciphertext) dari koneksi
// mkesindo -- skrip ini tidak pernah membaca/menulis password plaintext.
// Konsekuensinya tenant baru memakai login yang sama dengan MKEsindo; ganti
// ke login khusus per tenant lewat /grup/perusahaan bila sudah dibuat.
//
// Idempotent: database/skema/seed yang sudah ada dilewati.
//
// Usage:
//   npx tsx scripts/saas-provision-eskristal-tenant.ts --kode demokristal \
//     --nama "PT Demo Es Kristal" --db DemoEsKristal --holding demo
import "dotenv/config";
import { readFileSync } from "fs";
import sql from "mssql";
import { getPool } from "../src/lib/db";
import { getPgPool } from "../src/lib/pg";
import { resolveKoneksi } from "../src/lib/queries/perusahaan-koneksi";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : fallback;
  if (!v) throw new Error(`Argumen --${name} wajib diisi`);
  return v;
}

const KODE = arg("kode");
const NAMA = arg("nama");
const DB_NAME = arg("db");
const HOLDING = arg("holding");
const PABRIK_LAT = Number(arg("pabrik-lat", "-7.6298000"));
const PABRIK_LNG = Number(arg("pabrik-lng", "111.5239000"));
const PABRIK_ALAMAT = arg("pabrik-alamat", "Kawasan Industri Contoh No. 1");

if (!/^[a-z][a-z0-9]{2,31}$/.test(KODE)) throw new Error("--kode harus huruf kecil/angka, 3-32 karakter");
if (!/^[A-Za-z][A-Za-z0-9_]{2,63}$/.test(DB_NAME)) throw new Error("--db harus alfanumerik/underscore, 3-64 karakter");

// Sanitasi bagan akun MKEsindo: nama pemegang saham asli diganti generik,
// 4 digit akhir nomor rekening dibuang.
const COA_RENAME: Record<string, string> = {
  "3101": "Modal Pemegang Saham A",
  "3102": "Modal Pemegang Saham B",
};
type Row = Record<string, unknown>;
const sanitizeCoa = (row: Row): Row => ({
  ...row,
  Description: COA_RENAME[String(row.AccountNo)] ?? String(row.Description ?? "").replace(/\s*-\s*\d{4}\s*$/, ""),
});

async function columnsOf(pool: sql.ConnectionPool, table: string) {
  const r = await pool.request().input("t", table).query(`
    SELECT c.name, c.is_identity, c.is_computed, t.name type_name
    FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID(@t)`);
  return r.recordset as { name: string; is_identity: boolean; is_computed: boolean; type_name: string }[];
}

// Isi tabel target hanya bila masih kosong. Kolom rowversion/computed dilewati;
// kolom identity diisi eksplisit (IDENTITY_INSERT) supaya ID sama dengan sumber.
async function seedTable(target: sql.ConnectionPool, table: string, rows: Row[]) {
  const existing = await target.request().query(`SELECT COUNT(*) n FROM [${table}]`);
  if (existing.recordset[0].n > 0) {
    console.log(`  ${table}: sudah berisi ${existing.recordset[0].n} baris, dilewati`);
    return;
  }
  if (rows.length === 0) return;
  const cols = (await columnsOf(target, table)).filter((c) => !c.is_computed && c.type_name !== "timestamp");
  const hasIdentity = cols.some((c) => c.is_identity);
  const usable = cols.filter((c) => c.name in rows[0]);
  const names = usable.map((c) => c.name);
  // NULL tanpa tipe dikirim sebagai nvarchar -- ditolak kolom biner.
  const isBinary = usable.map((c) => ["varbinary", "binary", "image"].includes(c.type_name));
  const tx = new sql.Transaction(target);
  await tx.begin();
  try {
    // Query berparameter jalan lewat sp_executesql, dan SET di dalamnya hanya
    // berlaku selama batch itu -- jadi IDENTITY_INSERT harus satu statement
    // dengan INSERT-nya.
    const insert = `INSERT INTO [${table}] (${names.map((n) => `[${n}]`).join(", ")}) VALUES (${names.map((_, i) => `@p${i}`).join(", ")})`;
    const stmt = hasIdentity ? `SET IDENTITY_INSERT [${table}] ON; ${insert}; SET IDENTITY_INSERT [${table}] OFF;` : insert;
    for (const row of rows) {
      const req = new sql.Request(tx);
      names.forEach((n, i) => (isBinary[i] ? req.input(`p${i}`, sql.VarBinary(sql.MAX), row[n]) : req.input(`p${i}`, row[n])));
      await req.query(stmt);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
  console.log(`  ${table}: ${rows.length} baris`);
}

async function main() {
  const pg = getPgPool();
  const holding = (await pg.query(`SELECT id, nama FROM holding WHERE kode = $1`, [HOLDING])).rows[0];
  if (!holding) throw new Error(`Holding "${HOLDING}" tidak ada -- jalankan scripts/saas-migrate-holding.ts dulu`);
  const srcCfg = await resolveKoneksi("mkesindo", "utama");
  if (!srcCfg) throw new Error("Koneksi mkesindo/utama tidak ditemukan");
  if (srcCfg.dbName.toLowerCase() === DB_NAME.toLowerCase()) throw new Error("--db tidak boleh sama dengan database sumber");

  const baseCfg: sql.config = {
    server: srcCfg.host,
    port: srcCfg.port,
    user: srcCfg.dbUser,
    password: srcCfg.dbPassword,
    options: { encrypt: process.env.DB_ENCRYPT !== "false", trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true" },
    connectionTimeout: 15000,
    requestTimeout: 120000,
  };

  // 1. Database
  // Collation WAJIB sama dengan sumber: default server (SQL_Latin1_General_CP1_CI_AS)
  // berbeda dari MKEsindo (Latin1_General_CI_AS), dan skema.sql tidak menyebut
  // collation per kolom -- jadi semua kolom teks ikut collation database.
  const master = await new sql.ConnectionPool({ ...baseCfg, database: "master" }).connect();
  const coll = await master.request().input("src", srcCfg.dbName).input("db", DB_NAME).query(`
    SELECT CONVERT(varchar(128), DATABASEPROPERTYEX(@src, 'Collation')) src, DB_ID(@db) id,
           CONVERT(varchar(128), DATABASEPROPERTYEX(@db, 'Collation')) target`);
  const { src: srcCollation, id: targetId, target: targetCollation } = coll.recordset[0];
  if (!/^[A-Za-z0-9_]+$/.test(srcCollation)) throw new Error(`Collation sumber tidak valid: ${srcCollation}`);
  if (targetId === null) {
    await master.request().query(`CREATE DATABASE [${DB_NAME}] COLLATE ${srcCollation}`);
    console.log(`Database ${DB_NAME} dibuat (collation ${srcCollation}).`);
  } else if (targetCollation !== srcCollation) {
    throw new Error(`Database ${DB_NAME} sudah ada dengan collation ${targetCollation}, sumber ${srcCollation} -- tidak dilanjutkan`);
  } else {
    console.log(`Database ${DB_NAME} sudah ada.`);
  }
  await master.close();

  // 2. Skema
  const target = await new sql.ConnectionPool({ ...baseCfg, database: DB_NAME }).connect();
  const tableCount = (await target.request().query(`SELECT COUNT(*) n FROM sys.tables`)).recordset[0].n;
  if (tableCount === 0) {
    const batches = readFileSync("db/eskristal/schema.sql", "utf8").split(/^\s*GO\s*$/m).map((b) => b.trim()).filter(Boolean);
    for (const b of batches) await target.request().batch(b);
    console.log(`Skema diterapkan: ${batches.length} batch.`);
  } else {
    console.log(`Skema dilewati: database sudah punya ${tableCount} tabel.`);
  }

  // 3. Seed referensi
  console.log("Seed data referensi:");
  const source = await getPool();
  const read = async (q: string) => (await source.request().query(q)).recordset;
  await seedTable(target, "ChartOfAccount", (await read(`SELECT * FROM ChartOfAccount`)).map(sanitizeCoa));
  await seedTable(target, "TermOfPayment", await read(`SELECT * FROM TermOfPayment`));
  await seedTable(target, "Item", await read(`SELECT * FROM Item`));
  await seedTable(target, "Server", await read(`SELECT * FROM Server`));
  await seedTable(target, "DashboardProduksiMesin", await read(`SELECT * FROM DashboardProduksiMesin`));
  await seedTable(target, "DashboardPrintFormatSettings", await read(`SELECT * FROM DashboardPrintFormatSettings`));
  await seedTable(target, "DashboardSiteSettings", [
    { ID: 1, Title: holding.nama, Description: `Manajemen Pabrik Es ${NAMA}`, UpdatedAt: new Date() },
  ]);
  await seedTable(target, "DashboardPabrikLocation", [
    { ID: 1, Latitude: PABRIK_LAT, Longitude: PABRIK_LNG, Alamat: PABRIK_ALAMAT, ModifiedDate: new Date() },
  ]);
  await target.close();

  // 4. Direktori Postgres
  const client = await pg.connect();
  try {
    await client.query("BEGIN");
    const p = await client.query(
      `INSERT INTO perusahaan (kode, nama, jenis_bisnis, holding_id) VALUES ($1, $2, 'Es Kristal', $3)
       ON CONFLICT (kode) DO UPDATE SET nama = EXCLUDED.nama, holding_id = EXCLUDED.holding_id, updated_at = now()
       RETURNING id`,
      [KODE, NAMA, holding.id]
    );
    await client.query(
      `INSERT INTO perusahaan_koneksi (perusahaan_id, label, db_engine, host, port, db_name, db_user, db_password_encrypted)
       SELECT $1, 'utama', k.db_engine, k.host, k.port, $2, k.db_user, k.db_password_encrypted
       FROM perusahaan_koneksi k JOIN perusahaan s ON s.id = k.perusahaan_id
       WHERE s.kode = 'mkesindo' AND k.label = 'utama'
       ON CONFLICT (perusahaan_id, label) DO UPDATE SET db_name = EXCLUDED.db_name, updated_at = now()`,
      [p.rows[0].id, DB_NAME]
    );
    await client.query("COMMIT");
    console.log(`Direktori: perusahaan "${KODE}" (id ${p.rows[0].id}) di holding "${HOLDING}", koneksi utama -> ${DB_NAME}.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Verifikasi lewat jalur resolve yang sama dengan aplikasi.
  const resolved = await resolveKoneksi(KODE, "utama");
  const check = await new sql.ConnectionPool({ ...baseCfg, database: resolved!.dbName }).connect();
  const v = await check.request().query(`
    SELECT (SELECT COUNT(*) FROM sys.tables) tabel, (SELECT COUNT(*) FROM sys.views) views,
           (SELECT COUNT(*) FROM sys.triggers) triggers, (SELECT COUNT(*) FROM ChartOfAccount) coa, DB_NAME() db`);
  console.log("Verifikasi:", v.recordset[0]);
  await check.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("PROVISIONING GAGAL:", err);
  process.exit(1);
});
