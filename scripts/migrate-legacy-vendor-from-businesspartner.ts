// scripts/migrate-legacy-vendor-from-businesspartner.ts
// One-off: pulls every existing SUPP-coded BusinessPartner row from a
// company's MSSQL into the new Postgres vendor directory, so staff start
// with real data instead of an empty list. Safe to re-run — skips any
// BusinessPartnerID that already has a vendor_perusahaan_link row for that
// perusahaan_id.
//
// Usage: npx tsx scripts/migrate-legacy-vendor-from-businesspartner.ts <perusahaan_kode>
// Example: npx tsx scripts/migrate-legacy-vendor-from-businesspartner.ts mkesindo
import "dotenv/config";
import { getCompanyPool } from "../src/lib/db-company";
import { getPgPool } from "../src/lib/pg";

async function main() {
  const kode = process.argv[2];
  if (!kode) {
    console.error("Usage: npx tsx scripts/migrate-legacy-vendor-from-businesspartner.ts <perusahaan_kode>");
    process.exit(1);
  }

  const pgPool = getPgPool();
  const perusahaanRes = await pgPool.query(`SELECT id FROM perusahaan WHERE kode = $1`, [kode]);
  if (perusahaanRes.rows.length === 0) {
    console.error(`Tidak ditemukan baris perusahaan dengan kode="${kode}".`);
    process.exit(1);
  }
  const perusahaanId = perusahaanRes.rows[0].id as number;

  const mssqlPool = await getCompanyPool(kode, "utama");
  const suppliers = await mssqlPool.request().query(`
    SELECT BusinessPartnerID, Code, Name, Address, NPWP, NPWPAddress, ContactPerson, MobileNo
    FROM BusinessPartner WHERE Code LIKE 'SUPP%'
  `);
  const rows = suppliers.recordset as {
    BusinessPartnerID: string; Code: string; Name: string; Address: string | null;
    NPWP: string | null; NPWPAddress: string | null; ContactPerson: string | null; MobileNo: string | null;
  }[];
  console.log(`Ditemukan ${rows.length} baris SUPP% di BusinessPartner (${kode}).`);

  let migrated = 0, skipped = 0;
  for (const row of rows) {
    const already = await pgPool.query(
      `SELECT 1 FROM vendor_perusahaan_link WHERE perusahaan_id = $1 AND business_partner_id = $2`,
      [perusahaanId, row.BusinessPartnerID]
    );
    if ((already.rowCount ?? 0) > 0) {
      skipped++;
      continue;
    }

    const vendorRes = await pgPool.query(
      `INSERT INTO vendor (nama, npwp, npwp_alamat) VALUES ($1, $2, $3) RETURNING id`,
      [row.Name, row.NPWP || null, row.NPWPAddress || null]
    );
    const vendorId = vendorRes.rows[0].id as number;

    if (row.Address) {
      await pgPool.query(
        `INSERT INTO vendor_lokasi (vendor_id, nama_lokasi, alamat) VALUES ($1, 'Lokasi Utama', $2)`,
        [vendorId, row.Address]
      );
    }
    if (row.ContactPerson) {
      await pgPool.query(
        `INSERT INTO vendor_pic (vendor_id, nama, telepon, urutan) VALUES ($1, $2, $3, 0)`,
        [vendorId, row.ContactPerson, row.MobileNo || null]
      );
    }
    await pgPool.query(
      `INSERT INTO vendor_perusahaan_link (vendor_id, perusahaan_id, business_partner_id) VALUES ($1, $2, $3)`,
      [vendorId, perusahaanId, row.BusinessPartnerID]
    );
    migrated++;
    console.log(`  Migrated ${row.Code} (${row.Name}) -> vendor.id=${vendorId}`);
  }

  console.log(`Selesai. Migrated: ${migrated}, dilewati (sudah ada): ${skipped}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("MIGRATION FAILED:", err);
  process.exit(1);
});
