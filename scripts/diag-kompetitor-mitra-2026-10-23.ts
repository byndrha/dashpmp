import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getCompanyPool } from "../src/lib/db-company";
import { getPgPool } from "../src/lib/pg";
import { pecahTeksKompetitor } from "../src/lib/mitra-lokasi";

// DRY-RUN migrasi kompetitor Es Kristal (spec 2026-10-23-mitra-identitas-lokasi-pengiriman §10).
// HANYA MEMBACA. Tidak menulis ke MSSQL maupun Postgres.
//
// Sumber: DashboardMitraCompetitor.Kompetitor (teks bebas) untuk mitra MKEsindo yang belum
// dihapus (BusinessPartner.IsDeleted = 0) dan teksnya tidak kosong. Teks dipecah dengan
// pecahTeksKompetitor() (pemisah , ; baris baru dan kata "dan"; trim; dedupe tanpa beda huruf).
// Ejaan ganda TIDAK disatukan di sini — itu tugas peninjau (lihat fix-kompetitor-mitra-2026-10-23.ts).
//
// Keluaran:
//   docs/data-fixes/2026-10-23-kompetitor-mitra-dryrun.json
//     { namaUnik: { nama, mitra: [bpId,…] }[], perMitra: { bpId, teksAsli, hasil: string[] }[] }
//   Salinan namaUnik untuk disunting pengguna dibuat terpisah sebagai
//   docs/data-fixes/2026-10-23-kompetitor-mitra-disetujui.json (hanya bila belum ada, agar
//   suntingan pengguna tidak tertimpa).
//
// Usage: npx tsx scripts/diag-kompetitor-mitra-2026-10-23.ts

const KODE = "mkesindo";
const DIR = path.join(__dirname, "..", "docs", "data-fixes");
const DRYRUN = path.join(DIR, "2026-10-23-kompetitor-mitra-dryrun.json");
const DISETUJUI = path.join(DIR, "2026-10-23-kompetitor-mitra-disetujui.json");

async function main() {
  const pool = await getCompanyPool(KODE, "utama");
  const ident = (await pool.request().query(`SELECT DB_NAME() AS d`)).recordset[0] as { d: string };
  console.log("DB:", ident.d, "(DRY RUN, hanya baca)");
  if (ident.d !== "MKEsindo") throw new Error(`DB bukan MKEsindo: ${ident.d}`);

  const rows = (await pool.request().query(`
    SELECT bp.BusinessPartnerID AS bpId, mc.Kompetitor AS teks
    FROM DashboardMitraCompetitor mc
    JOIN BusinessPartner bp ON bp.BusinessPartnerID = mc.BusinessPartnerID
    WHERE ISNULL(bp.IsDeleted, 0) = 0
      AND mc.Kompetitor IS NOT NULL AND LTRIM(RTRIM(mc.Kompetitor)) <> ''
    ORDER BY bp.BusinessPartnerID`)).recordset as { bpId: string; teks: string }[];

  const perMitra = rows.map((r) => ({ bpId: r.bpId, teksAsli: r.teks, hasil: pecahTeksKompetitor(r.teks) }));

  // Kelompokkan nama tanpa beda huruf besar-kecil; ejaan yang tampil = kemunculan pertama.
  const unik = new Map<string, { nama: string; mitra: string[] }>();
  for (const m of perMitra) {
    for (const nama of m.hasil) {
      const kunci = nama.trim().replace(/\s+/g, " ").toLowerCase();
      const ada = unik.get(kunci) ?? { nama: nama.trim().replace(/\s+/g, " "), mitra: [] };
      if (!ada.mitra.includes(m.bpId)) ada.mitra.push(m.bpId);
      unik.set(kunci, ada);
    }
  }
  const namaUnik = [...unik.values()].sort(
    (a, b) => b.mitra.length - a.mitra.length || a.nama.localeCompare(b.nama, "id")
  );

  const kosongSetelahPecah = perMitra.filter((m) => m.hasil.length === 0);
  console.log(`Mitra dengan teks kompetitor tidak kosong: ${perMitra.length}`);
  console.log(`Mitra yang hasil pecahnya kosong: ${kosongSetelahPecah.length}`);
  console.log(`Nama unik (tanpa beda huruf): ${namaUnik.length}`);
  for (const n of namaUnik) console.log(`  ${String(n.mitra.length).padStart(3)}  ${n.nama}`);

  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(DRYRUN, JSON.stringify({ namaUnik, perMitra }, null, 2) + "\n");
  console.log("Dry-run ditulis:", DRYRUN);
  if (fs.existsSync(DISETUJUI)) {
    console.log("File disetujui sudah ada, TIDAK ditimpa:", DISETUJUI);
  } else {
    fs.writeFileSync(DISETUJUI, JSON.stringify(namaUnik, null, 2) + "\n");
    console.log("Salinan untuk ditinjau ditulis:", DISETUJUI);
  }

  await pool.close();
  await getPgPool().end();
}

main().catch((e) => { console.error(e); process.exit(1); });
