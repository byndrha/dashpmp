import sql from "mssql";
import { resolveKoneksi } from "@/lib/queries/perusahaan-koneksi";

// MKEsindo's live MSSQL connection now resolves through the Postgres
// "directory" DB (perusahaan_koneksi, kode="mkesindo" label="utama")
// instead of static DB_* env vars — see docs/superpowers/specs/
// 2026-07-30-perusahaan-db-koneksi-design.md. Deliberately NO env-var
// fallback: if the directory lookup fails, this throws, and so does every
// page that calls getPool(). Accepted risk, not an oversight.
declare global {
  var _mssqlPool: Promise<sql.ConnectionPool> | undefined;
}

export function getPool(): Promise<sql.ConnectionPool> {
  if (!global._mssqlPool) {
    global._mssqlPool = resolveKoneksi("mkesindo", "utama")
      .then((cfg) => {
        if (!cfg) {
          throw new Error(
            'No perusahaan_koneksi row for kode="mkesindo" label="utama" — run scripts/seed-mkesindo-koneksi.ts (see docs/superpowers/plans/2026-07-30-perusahaan-db-koneksi.md Task 3)'
          );
        }
        const config: sql.config = {
          server: cfg.host,
          port: cfg.port,
          database: cfg.dbName,
          user: cfg.dbUser,
          password: cfg.dbPassword,
          options: {
            encrypt: process.env.DB_ENCRYPT !== "false",
            trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
          },
          // Same tuning as before this change — see the removed comment's
          // rationale, unchanged: ~5s cold TLS handshake on this host,
          // min:2 keeps warm connections alive for concurrent bursts.
          connectionTimeout: 15000,
          requestTimeout: 40000,
          pool: { max: 10, min: 2, idleTimeoutMillis: 600000 },
        };
        return new sql.ConnectionPool(config).connect();
      })
      .catch((err) => {
        // Don't cache a failed resolution/connection attempt — otherwise
        // every request for the rest of the process's lifetime reuses the
        // same rejected promise and never retries.
        global._mssqlPool = undefined;
        throw err;
      });
  }
  return global._mssqlPool;
}

export { sql };
