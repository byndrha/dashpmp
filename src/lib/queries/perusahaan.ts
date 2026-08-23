import { getPool, sql } from "@/lib/db";
import { getPgPool } from "@/lib/pg";
import { encryptSecret } from "@/lib/crypto-secret";
import { AppError } from "@/lib/action-result";
import { PERUSAHAAN_STATUSES, type PerusahaanStatus, type PerusahaanJenisBisnis } from "@/lib/perusahaan-status";

export { PERUSAHAAN_STATUSES, type PerusahaanStatus };

export interface PerusahaanRow {
  PerusahaanID: number;
  Nama: string;
  // Stored as plain VARCHAR in MSSQL (no CHECK constraint), but every write
  // path (perusahaan/actions.ts's assertValid) rejects anything outside
  // PERUSAHAAN_JENIS_BISNIS — treat it as the locked enum, not free text.
  JenisBisnis: PerusahaanJenisBisnis | null;
  Wilayah: string | null;
  PabrikLatitude: number | null;
  PabrikLongitude: number | null;
  PabrikAlamat: string | null;
  Status: PerusahaanStatus;
  StandaloneUrl: string | null;
  Kode: string | null;
  DbServer: string | null;
  DbPort: number | null;
  DbName: string | null;
  DbUser: string | null;
  HasDbPassword: boolean;
  Catatan: string | null;
}

export interface PerusahaanInput {
  nama: string;
  jenisBisnis: PerusahaanJenisBisnis | null;
  wilayah: string | null;
  pabrikLatitude: number | null;
  pabrikLongitude: number | null;
  pabrikAlamat: string | null;
  status: PerusahaanStatus;
  standaloneUrl: string | null;
  // Links this MSSQL registry row to Postgres perusahaan.kode ('mkesindo' |
  // 'pmputra') — see docs/superpowers/specs/2026-07-30-perusahaan-db-koneksi-design.md.
  // null means "not linked yet" (e.g. a brand-new Draft PT).
  kode: string | null;
  dbServer: string | null;
  dbPort: number | null;
  dbName: string | null;
  dbUser: string | null;
  // On create: used as-is (blank means no password set). On update: blank
  // means "keep the existing stored credential" — only a non-blank value
  // triggers re-encryption and overwrite.
  dbPassword: string | null;
  catatan: string | null;
}

export interface PerusahaanSwitcherEntry {
  PerusahaanID: number;
  Nama: string;
  // Links to PT_ROUTES (src/lib/pt-routes.ts) so the switcher knows which
  // route tree an "AktifPenuh" entry actually navigates to.
  Kode: string | null;
  Status: PerusahaanStatus;
  StandaloneUrl: string | null;
}

export async function listPerusahaan(): Promise<PerusahaanRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT PerusahaanID, Nama, JenisBisnis, Wilayah, PabrikLatitude, PabrikLongitude, PabrikAlamat,
           Status, StandaloneUrl, Kode, DbServer, DbPort, DbName, DbUser,
           CASE WHEN DbPasswordEncrypted IS NULL THEN 0 ELSE 1 END AS HasDbPassword,
           Catatan
    FROM DashboardPerusahaan
    WHERE IsDeleted = 0
    ORDER BY Nama
  `);
  return (result.recordset as (Omit<PerusahaanRow, "HasDbPassword"> & { HasDbPassword: number })[]).map((r) => ({
    ...r,
    HasDbPassword: r.HasDbPassword === 1,
  }));
}

export async function listPerusahaanForSwitcher(): Promise<PerusahaanSwitcherEntry[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT PerusahaanID, Nama, Kode, Status, StandaloneUrl
    FROM DashboardPerusahaan
    WHERE IsDeleted = 0 AND Status <> 'Draft'
    ORDER BY Status DESC, Nama
  `);
  return result.recordset;
}

export async function createPerusahaan(input: PerusahaanInput): Promise<number> {
  const pool = await getPool();
  const encryptedPassword = input.dbPassword ? encryptSecret(input.dbPassword) : null;
  const result = await pool
    .request()
    .input("nama", sql.VarChar(128), input.nama)
    .input("jenisBisnis", sql.VarChar(128), input.jenisBisnis)
    .input("wilayah", sql.VarChar(128), input.wilayah)
    .input("pabrikLatitude", sql.Decimal(10, 7), input.pabrikLatitude)
    .input("pabrikLongitude", sql.Decimal(10, 7), input.pabrikLongitude)
    .input("pabrikAlamat", sql.VarChar(512), input.pabrikAlamat)
    .input("status", sql.VarChar(20), input.status)
    .input("standaloneUrl", sql.VarChar(512), input.standaloneUrl)
    .input("kode", sql.VarChar(32), input.kode)
    .input("dbServer", sql.VarChar(256), input.dbServer)
    .input("dbPort", sql.Int, input.dbPort)
    .input("dbName", sql.VarChar(128), input.dbName)
    .input("dbUser", sql.VarChar(128), input.dbUser)
    .input("dbPasswordEncrypted", sql.VarChar(512), encryptedPassword)
    .input("catatan", sql.VarChar(1024), input.catatan).query(`
      INSERT INTO DashboardPerusahaan
        (Nama, JenisBisnis, Wilayah, PabrikLatitude, PabrikLongitude, PabrikAlamat, Status, StandaloneUrl,
         Kode, DbServer, DbPort, DbName, DbUser, DbPasswordEncrypted, Catatan, IsDeleted, CreatedAt, UpdatedAt)
      OUTPUT inserted.PerusahaanID
      VALUES
        (@nama, @jenisBisnis, @wilayah, @pabrikLatitude, @pabrikLongitude, @pabrikAlamat, @status, @standaloneUrl,
         @kode, @dbServer, @dbPort, @dbName, @dbUser, @dbPasswordEncrypted, @catatan, 0, GETDATE(), GETDATE())
    `);
  return (result.recordset[0] as { PerusahaanID: number }).PerusahaanID;
}

export async function updatePerusahaan(id: number, input: PerusahaanInput): Promise<void> {
  const pool = await getPool();
  const request = pool
    .request()
    .input("id", sql.Int, id)
    .input("nama", sql.VarChar(128), input.nama)
    .input("jenisBisnis", sql.VarChar(128), input.jenisBisnis)
    .input("wilayah", sql.VarChar(128), input.wilayah)
    .input("pabrikLatitude", sql.Decimal(10, 7), input.pabrikLatitude)
    .input("pabrikLongitude", sql.Decimal(10, 7), input.pabrikLongitude)
    .input("pabrikAlamat", sql.VarChar(512), input.pabrikAlamat)
    .input("status", sql.VarChar(20), input.status)
    .input("standaloneUrl", sql.VarChar(512), input.standaloneUrl)
    .input("kode", sql.VarChar(32), input.kode)
    .input("dbServer", sql.VarChar(256), input.dbServer)
    .input("dbPort", sql.Int, input.dbPort)
    .input("dbName", sql.VarChar(128), input.dbName)
    .input("dbUser", sql.VarChar(128), input.dbUser)
    .input("catatan", sql.VarChar(1024), input.catatan);

  // Blank dbPassword means "keep existing" — the UPDATE statement itself
  // omits DbPasswordEncrypted in that case, so the stored value is
  // untouched. Two separate query strings (not a runtime-built one) keeps
  // this parameterized and readable.
  if (input.dbPassword) {
    await request.input("dbPasswordEncrypted", sql.VarChar(512), encryptSecret(input.dbPassword)).query(`
      UPDATE DashboardPerusahaan SET
        Nama = @nama, JenisBisnis = @jenisBisnis, Wilayah = @wilayah,
        PabrikLatitude = @pabrikLatitude, PabrikLongitude = @pabrikLongitude, PabrikAlamat = @pabrikAlamat,
        Status = @status, StandaloneUrl = @standaloneUrl, Kode = @kode,
        DbServer = @dbServer, DbPort = @dbPort, DbName = @dbName, DbUser = @dbUser,
        DbPasswordEncrypted = @dbPasswordEncrypted, Catatan = @catatan, UpdatedAt = GETDATE()
      WHERE PerusahaanID = @id
    `);
  } else {
    await request.query(`
      UPDATE DashboardPerusahaan SET
        Nama = @nama, JenisBisnis = @jenisBisnis, Wilayah = @wilayah,
        PabrikLatitude = @pabrikLatitude, PabrikLongitude = @pabrikLongitude, PabrikAlamat = @pabrikAlamat,
        Status = @status, StandaloneUrl = @standaloneUrl, Kode = @kode,
        DbServer = @dbServer, DbPort = @dbPort, DbName = @dbName, DbUser = @dbUser,
        Catatan = @catatan, UpdatedAt = GETDATE()
      WHERE PerusahaanID = @id
    `);
  }
}

// Resolves the Postgres "directory" DB's perusahaan.id for kode="mkesindo"
// — reused wherever a route tree is hardcoded to one company (the same
// convention as db.ts's getPool()/resolveKoneksi("mkesindo", "utama")) but
// still needs a real perusahaanId to hand to company-scoped Postgres
// queries (e.g. metode_pembayaran). Deliberately generic/standalone, not
// aging-specific — the public invoice page reuses this too.
export async function getMkesindoPerusahaanId(): Promise<number> {
  const pool = getPgPool();
  const result = await pool.query<{ id: number }>(`SELECT id FROM perusahaan WHERE kode = $1`, ["mkesindo"]);
  const row = result.rows[0];
  if (!row) {
    throw new AppError(
      'No perusahaan row for kode="mkesindo" — the Postgres directory DB is missing its seed row (see docs/superpowers/specs/2026-07-30-postgres-directory-multi-company.md).'
    );
  }
  return row.id;
}

export async function softDeletePerusahaan(id: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .query(`UPDATE DashboardPerusahaan SET IsDeleted = 1, UpdatedAt = GETDATE() WHERE PerusahaanID = @id`);
}
