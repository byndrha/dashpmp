import sql from "mssql";
import { resolveKoneksi } from "@/lib/queries/perusahaan-koneksi";

export type CompanyKoneksiLabel = "utama" | "logistik";

// Per-(kode,label) connection pool, shared by every PT that wires its own
// ERP databases through perusahaan_koneksi (pmputra, pmpersada, and any
// future PT) -- generalized out of the original db-pmputra.ts, which
// hardcoded kode="pmputra". Same resolve-via-Postgres pattern as db.ts.
declare global {
  var _companyPools: Map<string, Promise<sql.ConnectionPool>> | undefined;
}

export function getCompanyPool(kode: string, label: CompanyKoneksiLabel): Promise<sql.ConnectionPool> {
  if (!global._companyPools) global._companyPools = new Map();
  const cacheKey = `${kode}:${label}`;
  const cached = global._companyPools.get(cacheKey);
  if (cached) return cached;

  const promise = resolveKoneksi(kode, label)
    .then((cfg) => {
      if (!cfg) {
        throw new Error(`No perusahaan_koneksi row for kode="${kode}" label="${label}"`);
      }
      const config: sql.config = {
        server: cfg.host,
        port: cfg.port,
        database: cfg.dbName,
        user: cfg.dbUser,
        password: cfg.dbPassword,
        options: { encrypt: true, trustServerCertificate: true },
        connectionTimeout: 15000,
        requestTimeout: 40000,
        pool: { max: 5, min: 1, idleTimeoutMillis: 600000 },
      };
      return new sql.ConnectionPool(config).connect();
    })
    .catch((err) => {
      global._companyPools?.delete(cacheKey);
      throw err;
    });

  global._companyPools.set(cacheKey, promise);
  return promise;
}
