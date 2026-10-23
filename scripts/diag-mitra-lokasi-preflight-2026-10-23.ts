// Diagnosa awal (SELECT-only) untuk proyek "Mitra: identitas vs lokasi
// pengiriman" -- tidak mengubah data apa pun.
//   1. Es Balok (5 DB): Agen dengan >1 baris PMP_AgenDetail aktif.
//   2. Es Kristal: JoinDate NULL, isi DashboardMitraCompetitor, DO dengan
//      AddressDelivery tidak kosong.
//   3. Baseline laporan: getMitraGrowthByWilayah() + pemilik marketing
//      efektif per mitra (getMitraList()).
// Output: docs/data-fixes/2026-10-23-mitra-lokasi-preflight.json
//         docs/data-fixes/2026-10-23-mitra-lokasi-baseline.json
// Usage: npx tsx scripts/diag-mitra-lokasi-preflight-2026-10-23.ts
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "../src/lib/db";
import { getCompanyPool } from "../src/lib/db-company";
import { getMitraList } from "../src/lib/queries/mitra";
import { getMitraGrowthByWilayah } from "../src/lib/queries/mitra-growth";

const TARGETS: { kode: string; label: "utama" | "logistik"; db: string }[] = [
  { kode: "pmputra", label: "utama", db: "FINAC_ES_PO" },
  { kode: "pmputra", label: "logistik", db: "FINAC_LOGISTIC_PO" },
  { kode: "pmpersada", label: "utama", db: "FINAC_ES_TB" },
  { kode: "pmpersada", label: "logistik", db: "FINAC_PMP_LOGISTIC" },
  { kode: "pmpakis", label: "utama", db: "FINAC_ES_PAKIS" },
];

const OUT_DIR = join(process.cwd(), "docs", "data-fixes");

async function esBalok() {
  const out: unknown[] = [];
  for (const { kode, label, db } of TARGETS) {
    const pool = await getCompanyPool(kode, label);
    const dbName = (await pool.request().query(`SELECT DB_NAME() AS DbName`)).recordset[0].DbName;
    const summary = (
      await pool.request().query(`
        SELECT
          (SELECT COUNT(*) FROM PMP_Agen WHERE ISNULL(IsDeleted,0) = 0) AS AgenAktif,
          (SELECT COUNT(*) FROM PMP_AgenDetail WHERE ISNULL(IsDeleted,0) = 0) AS AgenDetailAktif,
          (SELECT COUNT(*) FROM (
             SELECT AgenID FROM PMP_AgenDetail WHERE ISNULL(IsDeleted,0) = 0
             GROUP BY AgenID HAVING COUNT(*) > 1) x) AS AgenDenganDetailLebihDari1,
          (SELECT COUNT(*) FROM (
             SELECT ad.AgenID FROM PMP_AgenDetail ad
             JOIN PMP_Agen a ON a.AgenID = ad.AgenID AND ISNULL(a.IsDeleted,0) = 0
             WHERE ISNULL(ad.IsDeleted,0) = 0
             GROUP BY ad.AgenID HAVING COUNT(*) > 1) y) AS AgenAktifDenganDetailLebihDari1
      `)
    ).recordset[0];
    const samples = (
      await pool.request().query(`
        SELECT TOP 20 ad.AgenID, COUNT(*) AS JumlahDetailAktif,
               MAX(CASE WHEN ISNULL(a.IsDeleted,0) = 0 THEN 1 ELSE 0 END) AS AgenAktif
        FROM PMP_AgenDetail ad
        LEFT JOIN PMP_Agen a ON a.AgenID = ad.AgenID
        WHERE ISNULL(ad.IsDeleted,0) = 0
        GROUP BY ad.AgenID HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC, ad.AgenID
      `)
    ).recordset;
    out.push({ kode, label, expectedDb: db, dbName, ...summary, contohAgenID: samples });
    console.log(`${kode}/${label} (${dbName}):`, JSON.stringify(summary), "contoh:", samples.slice(0, 5).map((s) => s.AgenID).join(","));
  }
  return out;
}

async function esKristal() {
  const pool = await getPool();
  const r = (
    await pool.request().query(`
      SELECT
        DB_NAME() AS DbName,
        (SELECT COUNT(*) FROM BusinessPartner WHERE ISNULL(IsDeleted,0) = 0) AS MitraAktif,
        (SELECT COUNT(*) FROM BusinessPartner WHERE ISNULL(IsDeleted,0) = 0 AND JoinDate IS NULL) AS MitraAktifJoinDateNull,
        (SELECT COUNT(*) FROM BusinessPartner WHERE JoinDate IS NULL) AS SemuaMitraJoinDateNull,
        (SELECT COUNT(*) FROM DashboardMitraCompetitor) AS CompetitorTotalBaris,
        (SELECT COUNT(*) FROM DashboardMitraCompetitor
           WHERE LTRIM(RTRIM(ISNULL(Kompetitor,''))) <> '') AS CompetitorBerisi,
        (SELECT COUNT(*) FROM DashboardMitraCompetitor mc
           JOIN BusinessPartner bp ON bp.BusinessPartnerID = mc.BusinessPartnerID AND ISNULL(bp.IsDeleted,0) = 0
           WHERE LTRIM(RTRIM(ISNULL(mc.Kompetitor,''))) <> '') AS CompetitorBerisiMitraAktif,
        (SELECT COUNT(*) FROM DashboardMitraCompetitor mc
           JOIN BusinessPartner bp ON bp.BusinessPartnerID = mc.BusinessPartnerID
             AND ISNULL(bp.IsDeleted,0) = 0 AND ISNULL(bp.IsSuspended,0) = 0
           WHERE LTRIM(RTRIM(ISNULL(mc.Kompetitor,''))) <> '') AS CompetitorBerisiMitraAktifTidakSuspend,
        (SELECT MAX(UpdatedAt) FROM DashboardMitraCompetitor) AS CompetitorMaxUpdatedAt,
        (SELECT COUNT(*) FROM DeliveryOrder) AS DOTotal,
        (SELECT COUNT(*) FROM DeliveryOrder
           WHERE LTRIM(RTRIM(ISNULL(AddressDelivery,''))) <> '') AS DOAddressDeliveryBerisi,
        (SELECT COUNT(*) FROM DeliveryOrder
           WHERE LTRIM(RTRIM(ISNULL(AddressDelivery,''))) <> '' AND ISNULL(IsDeleted,0) = 0) AS DOAddressDeliveryBerisiTidakDihapus,
        (SELECT MIN(TransDate) FROM DeliveryOrder
           WHERE LTRIM(RTRIM(ISNULL(AddressDelivery,''))) <> '') AS DOAddressDeliveryMinTransDate,
        (SELECT MAX(TransDate) FROM DeliveryOrder
           WHERE LTRIM(RTRIM(ISNULL(AddressDelivery,''))) <> '') AS DOAddressDeliveryMaxTransDate
    `)
  ).recordset[0];
  const joinDateNullSample = (
    await pool.request().query(`
      SELECT TOP 20 BusinessPartnerID, Name FROM BusinessPartner
      WHERE ISNULL(IsDeleted,0) = 0 AND JoinDate IS NULL ORDER BY BusinessPartnerID
    `)
  ).recordset;
  console.log("Es Kristal:", JSON.stringify(r));
  return { ...r, contohMitraJoinDateNull: joinDateNullSample };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const preflight = { generatedAt, esBalok: await esBalok(), esKristal: await esKristal() };
  writeFileSync(join(OUT_DIR, "2026-10-23-mitra-lokasi-preflight.json"), JSON.stringify(preflight, null, 2));
  console.log("Tertulis: docs/data-fixes/2026-10-23-mitra-lokasi-preflight.json");

  const [growth, mitra] = await Promise.all([getMitraGrowthByWilayah(), getMitraList()]);
  const baseline = {
    generatedAt,
    mitraGrowthByWilayah: growth,
    pemilikMarketing: mitra.map((m) => ({
      BusinessPartnerID: m.BusinessPartnerID,
      Wilayah: m.Wilayah,
      Kecamatan: m.Kecamatan,
      MarketingNama: m.MarketingNama,
    })),
  };
  writeFileSync(join(OUT_DIR, "2026-10-23-mitra-lokasi-baseline.json"), JSON.stringify(baseline, null, 2));
  console.log(`Tertulis: docs/data-fixes/2026-10-23-mitra-lokasi-baseline.json (growth ${growth.length} wilayah, mitra ${mitra.length})`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
