// One-off migration: uploads existing public/uploads files to Google Drive
// and rewrites the DB paths that point at them. Usage:
// npx tsx scripts/migrate-uploads-to-gdrive.ts
// Requires MKEsindo's Google Drive already connected (Task 4) before running.
import "dotenv/config";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { getPool, sql } from "../src/lib/db";
import { uploadFile } from "../src/lib/storage/google-drive";

const UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads");

async function migrateFlatCategory(
  category: string,
  updateRow: (oldPath: string, newPath: string) => Promise<void>
) {
  const dir = path.join(UPLOADS_ROOT, category);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    console.log(`(skip) no local directory for "${category}"`);
    return;
  }
  for (const filename of entries) {
    const buffer = await readFile(path.join(dir, filename));
    const uploaded = await uploadFile("mkesindo", [category], filename, buffer, "application/octet-stream");
    const oldPath = `/uploads/${category}/${filename}`;
    await updateRow(oldPath, uploaded.publicPath);
    console.log(`migrated ${oldPath} -> ${uploaded.publicPath}`);
  }
}

async function migrateNestedCategory(
  category: string,
  updateRow: (oldPath: string, newPath: string) => Promise<void>
) {
  const dir = path.join(UPLOADS_ROOT, category);
  let subdirs: string[];
  try {
    subdirs = await readdir(dir);
  } catch {
    console.log(`(skip) no local directory for "${category}"`);
    return;
  }
  for (const subdir of subdirs) {
    const files = await readdir(path.join(dir, subdir));
    for (const filename of files) {
      const buffer = await readFile(path.join(dir, subdir, filename));
      const uploaded = await uploadFile("mkesindo", [category, subdir], filename, buffer, "application/octet-stream");
      const oldPath = `/uploads/${category}/${subdir}/${filename}`;
      await updateRow(oldPath, uploaded.publicPath);
      console.log(`migrated ${oldPath} -> ${uploaded.publicPath}`);
    }
  }
}

async function main() {
  const pool = await getPool();

  await migrateFlatCategory("produksi-kualitas", async (oldPath, newPath) => {
    await pool.request().input("old", sql.VarChar, oldPath).input("new", sql.VarChar, newPath)
      .query(`UPDATE DashboardProduksiKualitas SET FotoPath = @new WHERE FotoPath = @old`);
  });

  await migrateFlatCategory("site", async (oldPath, newPath) => {
    await pool.request().input("old", sql.VarChar, oldPath).input("new", sql.VarChar, newPath)
      .query(`UPDATE DashboardSiteSettings SET FaviconPath = @new WHERE FaviconPath = @old`);
    await pool.request().input("old", sql.VarChar, oldPath).input("new", sql.VarChar, newPath)
      .query(`UPDATE DashboardSiteSettings SET OgImagePath = @new WHERE OgImagePath = @old`);
  });

  await migrateFlatCategory("armada", async (oldPath, newPath) => {
    await pool.request().input("old", sql.VarChar, oldPath).input("new", sql.VarChar, newPath)
      .query(`UPDATE DashboardArmada SET FotoPath = @new WHERE FotoPath = @old`);
    await pool.request().input("old", sql.VarChar, oldPath).input("new", sql.VarChar, newPath)
      .query(`UPDATE DashboardArmada SET QrMyPertaminaPath = @new WHERE QrMyPertaminaPath = @old`);
  });

  await migrateNestedCategory("satpam-check", async (oldPath, newPath) => {
    await pool.request().input("old", sql.VarChar, oldPath).input("new", sql.VarChar, newPath)
      .query(`UPDATE DashboardVehicleCheckPhoto SET FilePath = @new WHERE FilePath = @old`);
  });

  // driver-app: FotoBuktiUrls is a JSON array string (multi-photo per row) —
  // needs parse/map/re-serialize, not a straight column value match.
  const driverAppDir = path.join(UPLOADS_ROOT, "driver-app");
  let jadwalDetailDirs: string[] = [];
  try {
    jadwalDetailDirs = await readdir(driverAppDir);
  } catch {
    console.log('(skip) no local directory for "driver-app"');
  }
  for (const jadwalDetailId of jadwalDetailDirs) {
    const files = await readdir(path.join(driverAppDir, jadwalDetailId));
    const pathMap = new Map<string, string>();
    for (const filename of files) {
      const buffer = await readFile(path.join(driverAppDir, jadwalDetailId, filename));
      const uploaded = await uploadFile("mkesindo", ["driver-app", jadwalDetailId], filename, buffer, "application/octet-stream");
      pathMap.set(`/uploads/driver-app/${jadwalDetailId}/${filename}`, uploaded.publicPath);
    }

    const stopResult = await pool.request().input("jadwalDetailId", sql.VarChar, jadwalDetailId)
      .query(`SELECT FotoBuktiUrls, TandaTanganUrl FROM DashboardPengirimanStopDelivery WHERE JadwalDetailID = @jadwalDetailId`);
    for (const row of stopResult.recordset as { FotoBuktiUrls: string | null; TandaTanganUrl: string | null }[]) {
      const oldUrls: string[] = row.FotoBuktiUrls ? JSON.parse(row.FotoBuktiUrls) : [];
      const newUrls = oldUrls.map((u) => pathMap.get(u) ?? u);
      const newTandaTangan = row.TandaTanganUrl ? (pathMap.get(row.TandaTanganUrl) ?? row.TandaTanganUrl) : row.TandaTanganUrl;
      await pool.request()
        .input("jadwalDetailId", sql.VarChar, jadwalDetailId)
        .input("fotoBuktiUrls", sql.VarChar(sql.MAX), JSON.stringify(newUrls))
        .input("tandaTanganUrl", sql.VarChar, newTandaTangan)
        .query(`UPDATE DashboardPengirimanStopDelivery SET FotoBuktiUrls = @fotoBuktiUrls, TandaTanganUrl = @tandaTanganUrl WHERE JadwalDetailID = @jadwalDetailId`);
    }

    // NOTE: the plan brief named this column "JadwalDetailItemID" — the
    // table's actual identity column (confirmed against both the original
    // CREATE TABLE DDL in docs/superpowers/plans/2026-08-07-aplikasi-driver.md
    // and the live INSERT/SELECT usage in src/lib/queries/pengiriman-jadwal.ts,
    // e.g. "SELECT ISNULL(MAX(StopDeliveryItemID), 0) + 1 ...") is
    // StopDeliveryItemID. Using the brief's name verbatim here would reference
    // a column that doesn't exist.
    const itemResult = await pool.request().query(`
      SELECT sdi.StopDeliveryItemID, sdi.FotoReturUrl
      FROM DashboardPengirimanStopDeliveryItem sdi
      WHERE sdi.FotoReturUrl LIKE '/uploads/driver-app/${jadwalDetailId}/%'
    `);
    for (const row of itemResult.recordset as { StopDeliveryItemID: number; FotoReturUrl: string }[]) {
      const newUrl = pathMap.get(row.FotoReturUrl) ?? row.FotoReturUrl;
      await pool.request().input("id", sql.Int, row.StopDeliveryItemID).input("url", sql.VarChar, newUrl)
        .query(`UPDATE DashboardPengirimanStopDeliveryItem SET FotoReturUrl = @url WHERE StopDeliveryItemID = @id`);
    }
  }

  console.log("Migration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
