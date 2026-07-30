import { Pool } from "pg";

// "Directory" Postgres DB — a small central store for Akun (accounts) and
// Perusahaan (companies) that bridges the per-company MSSQL databases (see
// docs/superpowers/specs/2026-07-30-postgres-directory-multi-company.md).
// Every existing MKEsindo query keeps using src/lib/db.ts (MSSQL) untouched
// — this pool is only for akun_direktori/perusahaan/perusahaan_koneksi.
const config = {
  host: process.env.DIRECTORY_DB_HOST!,
  port: process.env.DIRECTORY_DB_PORT ? Number(process.env.DIRECTORY_DB_PORT) : 5432,
  database: process.env.DIRECTORY_DB_NAME!,
  user: process.env.DIRECTORY_DB_USER!,
  password: process.env.DIRECTORY_DB_PASSWORD!,
  // Confirmed live against the real Coolify instance — plain TCP, no TLS.
  ssl: process.env.DIRECTORY_DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 600000,
  connectionTimeoutMillis: 15000,
  // Bounds an individual query, not just connection acquisition — db.ts's
  // getPool() now calls resolveKoneksi() against this pool before it can
  // even attempt the MSSQL connection, so a hung Postgres query here would
  // otherwise hang every request in the app indefinitely. 10s is generous
  // for what this pool actually runs (single-row akun_direktori/perusahaan/
  // perusahaan_koneksi lookups), never anything expensive.
  statement_timeout: 10000,
};

declare global {
  var _pgPool: Pool | undefined;
}

// Same global-cache pattern as db.ts's getPool(), except pg's Pool manages
// its own internal reconnect-on-failure per client checkout — no need to
// clear the cached pool on a failed query the way the mssql singleton does.
export function getPgPool(): Pool {
  if (!global._pgPool) {
    global._pgPool = new Pool(config);
  }
  return global._pgPool;
}
