import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getCompanyPool } from "../src/lib/db-company";
import { getPgPool } from "../src/lib/pg";

// Membatalkan fix-kompetitor-mitra-2026-10-23.ts berdasarkan
// docs/data-fixes/2026-10-23-kompetitor-mitra-posted.json:
//   1. Hapus TEPAT baris mitra_kompetitor yang tercatat di posted (per PK).
//   2. Hapus baris master `kompetitor` yang tercatat dibuat oleh fix HANYA bila:
//      created_by masih penanda migrasi, tidak ada lagi baris mitra_kompetitor yang menunjuknya
//      (FK ON DELETE CASCADE akan diam-diam melepas relasi buatan pengguna), dan tidak dirujuk
//      DashboardMitraPengajuan.KompetitorIDs di MKEsindo. Selain itu dilewati & dilaporkan.
// DashboardMitraCompetitor tidak disentuh. Semua tulisan Postgres dalam satu transaksi.
// Default DRY RUN; --execute untuk menulis.
// Usage: npx tsx scripts/revert-kompetitor-mitra-2026-10-23.ts [--execute]

const EXECUTE = process.argv.includes("--execute");
const POSTED = path.join(__dirname, "..", "docs", "data-fixes", "2026-10-23-kompetitor-mitra-posted.json");

interface Posted {
  holdingKode: string; bisnis: string; createdBy: string;
  kompetitorDibuat: { id: number; nama: string }[];
  mitraKompetitor: { perusahaanKode: string; sumber: string; partnerId: string; kompetitorId: number }[];
}

async function idDiPengajuan(): Promise<Set<number>> {
  const pool = await getCompanyPool("mkesindo", "utama");
  const ident = (await pool.request().query(`SELECT DB_NAME() AS d`)).recordset[0] as { d: string };
  if (ident.d !== "MKEsindo") throw new Error(`DB bukan MKEsindo: ${ident.d}`);
  const r = (await pool.request().query(`
    SELECT KompetitorIDs AS v FROM DashboardMitraPengajuan
    WHERE KompetitorIDs IS NOT NULL AND LTRIM(RTRIM(KompetitorIDs)) <> ''`)).recordset as { v: string }[];
  await pool.close();
  const hasil = new Set<number>();
  for (const { v } of r) for (const m of v.match(/\d+/g) ?? []) hasil.add(Number(m));
  return hasil;
}

async function main() {
  const posted = JSON.parse(fs.readFileSync(POSTED, "utf8")) as Posted;
  const pg = getPgPool();
  console.log(EXECUTE ? "(EXECUTE)" : "(DRY RUN)");
  console.log(`Posted: relasi ${posted.mitraKompetitor.length} | kompetitor dibuat ${posted.kompetitorDibuat.length}`);

  const dirujukPengajuan = await idDiPengajuan();
  const client = await pg.connect();
  try {
    await client.query("BEGIN");
    let relasiDihapus = 0;
    for (const r of posted.mitraKompetitor) {
      const d = await client.query(
        `DELETE FROM mitra_kompetitor
         WHERE perusahaan_kode = $1 AND sumber = $2 AND partner_id = $3 AND kompetitor_id = $4`,
        [r.perusahaanKode, r.sumber, r.partnerId, r.kompetitorId]
      );
      relasiDihapus += d.rowCount ?? 0;
    }
    console.log(`Relasi dihapus: ${relasiDihapus} dari ${posted.mitraKompetitor.length} (sisanya sudah tidak ada)`);

    let masterDihapus = 0;
    for (const k of posted.kompetitorDibuat) {
      const info = await client.query<{ created_by: string | null; holding_kode: string; bisnis: string; ref: string }>(
        `SELECT k.created_by, k.holding_kode, k.bisnis,
                (SELECT COUNT(*) FROM mitra_kompetitor mk WHERE mk.kompetitor_id = k.id) AS ref
         FROM kompetitor k WHERE k.id = $1`,
        [k.id]
      );
      const row = info.rows[0];
      if (!row) { console.log(`  lewati #${k.id} "${k.nama}": sudah tidak ada`); continue; }
      const alasan =
        row.created_by !== posted.createdBy ? `created_by = ${row.created_by}` :
        row.holding_kode !== posted.holdingKode || row.bisnis !== posted.bisnis ? "holding/bisnis berbeda" :
        Number(row.ref) > 0 ? `masih dipakai ${row.ref} mitra` :
        dirujukPengajuan.has(k.id) ? "dirujuk DashboardMitraPengajuan.KompetitorIDs" : null;
      if (alasan) { console.log(`  lewati #${k.id} "${k.nama}": ${alasan}`); continue; }
      const d = await client.query(`DELETE FROM kompetitor WHERE id = $1`, [k.id]);
      masterDihapus += d.rowCount ?? 0;
    }
    console.log(`Master kompetitor dihapus: ${masterDihapus} dari ${posted.kompetitorDibuat.length}`);

    if (EXECUTE) { await client.query("COMMIT"); console.log("Revert selesai (COMMIT)."); }
    else { await client.query("ROLLBACK"); console.log("DRY RUN selesai (ROLLBACK). Untuk menulis: --execute"); }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("GAGAL (rollback):", e);
    client.release(); await pg.end(); process.exit(1);
  }
  client.release();
  await pg.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
