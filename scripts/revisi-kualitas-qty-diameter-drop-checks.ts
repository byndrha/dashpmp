// One-off schema migration for DashboardProduksiKualitas, three independent
// changes bundled together (all from the same "revisi tab Kualitas" request
// -- see docs/superpowers/specs/2026-08-28-produksi-app-kualitas-aktivitas-revisi-design.md):
//
// 1. BeratSampel (DECIMAL(10,2), gram, never actually used for anything) is
//    replaced by Qty10KG (INT) -- becomes the plafon stok source of truth
//    checked against DashboardProduksiBatch's existing KualitasID FK. Old
//    gram values are discarded (no unit relationship to kantong count), so
//    this is add-new-column + drop-old, not a pure rename.
// 2. DiameterDalamCm (DECIMAL(5,2)) is replaced by DiameterDalamMm
//    (DECIMAL(5,1)) -- existing non-NULL values ARE carried over
//    (multiplied x10, cm -> mm), since the measurement itself is still
//    meaningful, just in a different unit.
// 3. CekKontaminasi/CekKemasan (BIT) are DROPPED entirely, including their
//    historical data -- explicit user request (their form input was
//    already removed in an earlier change; this finishes the removal).
//    Backed up to scratchpad/ first (gitignored), mirroring
//    scripts/drop-legacy-auth-tables.ts's own safety pattern, before the
//    DROP COLUMN runs.
//
// Idempotent, safe to re-run -- each step checks INFORMATION_SCHEMA first.
// Usage: npx tsx scripts/revisi-kualitas-qty-diameter-drop-checks.ts
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getPool, sql } from "../src/lib/db";

const TABLE = "DashboardProduksiKualitas";

async function columnExists(pool: Awaited<ReturnType<typeof getPool>>, column: string): Promise<boolean> {
  const result = await pool
    .request()
    .input("t", sql.VarChar(128), TABLE)
    .input("c", sql.VarChar(128), column)
    .query(`SELECT 1 AS Found FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t AND COLUMN_NAME = @c`);
  return result.recordset.length > 0;
}

async function main() {
  const pool = await getPool();

  // 1. BeratSampel -> Qty10KG
  if (await columnExists(pool, "Qty10KG")) {
    console.log("Qty10KG already exists -- skipping step 1.");
  } else if (await columnExists(pool, "BeratSampel")) {
    await pool.request().query(`ALTER TABLE ${TABLE} ADD Qty10KG INT NULL`);
    await pool.request().query(`ALTER TABLE ${TABLE} DROP COLUMN BeratSampel`);
    console.log("Replaced BeratSampel with Qty10KG (old gram values discarded).");
  } else {
    throw new Error("Neither BeratSampel nor Qty10KG found -- unexpected schema state.");
  }

  // 2. DiameterDalamCm -> DiameterDalamMm (x10 conversion)
  if (await columnExists(pool, "DiameterDalamMm")) {
    console.log("DiameterDalamMm already exists -- skipping step 2.");
  } else if (await columnExists(pool, "DiameterDalamCm")) {
    await pool.request().query(`ALTER TABLE ${TABLE} ADD DiameterDalamMm DECIMAL(5,1) NULL`);
    await pool.request().query(`UPDATE ${TABLE} SET DiameterDalamMm = DiameterDalamCm * 10 WHERE DiameterDalamCm IS NOT NULL`);
    await pool.request().query(`ALTER TABLE ${TABLE} DROP COLUMN DiameterDalamCm`);
    console.log("Replaced DiameterDalamCm with DiameterDalamMm (values converted x10).");
  } else {
    throw new Error("Neither DiameterDalamCm nor DiameterDalamMm found -- unexpected schema state.");
  }

  // 3. Drop CekKontaminasi/CekKemasan (backup first)
  if (!(await columnExists(pool, "CekKontaminasi")) && !(await columnExists(pool, "CekKemasan"))) {
    console.log("CekKontaminasi/CekKemasan already gone -- skipping step 3.");
  } else {
    const backupResult = await pool.request().query(`SELECT KualitasID, CekKontaminasi, CekKemasan FROM ${TABLE}`);
    const scratchpad = path.join(process.cwd(), "scratchpad");
    fs.mkdirSync(scratchpad, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(scratchpad, `kualitas-kontaminasi-kemasan-backup-${stamp}.json`);
    fs.writeFileSync(
      backupPath,
      JSON.stringify({ capturedAt: new Date().toISOString(), rows: backupResult.recordset }, null, 2),
      "utf8"
    );
    const written = JSON.parse(fs.readFileSync(backupPath, "utf8")) as { rows: unknown[] };
    if (written.rows.length !== backupResult.recordset.length) {
      throw new Error("ABORT -- backup verification failed for CekKontaminasi/CekKemasan. Nothing dropped.");
    }
    console.log(`Backup written and verified: ${backupPath}`);
    if (await columnExists(pool, "CekKontaminasi")) await pool.request().query(`ALTER TABLE ${TABLE} DROP COLUMN CekKontaminasi`);
    if (await columnExists(pool, "CekKemasan")) await pool.request().query(`ALTER TABLE ${TABLE} DROP COLUMN CekKemasan`);
    console.log("Dropped CekKontaminasi/CekKemasan.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
