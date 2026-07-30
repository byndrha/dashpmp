import sql from "mssql";
import { resolveKoneksi } from "@/lib/queries/perusahaan-koneksi";

export type PmputraKoneksiLabel = "utama" | "logistik";

// PT Prima Maesa Putra's two databases (FINAC_ES_PO / FINAC_LOGISTIC_PO) —
// same resolve-via-Postgres pattern as db.ts, but keyed per label since
// there are two of them. Not called by any page yet — see
// docs/superpowers/specs/2026-07-30-perusahaan-db-koneksi-design.md's
// "PMPutra gets a connection-opener too" decision.
declare global {
  var _pmputraPools: Map<PmputraKoneksiLabel, Promise<sql.ConnectionPool>> | undefined;
}

export function getPmputraPool(label: PmputraKoneksiLabel): Promise<sql.ConnectionPool> {
  if (!global._pmputraPools) global._pmputraPools = new Map();
  const cached = global._pmputraPools.get(label);
  if (cached) return cached;

  const promise = resolveKoneksi("pmputra", label)
    .then((cfg) => {
      if (!cfg) {
        throw new Error(`No perusahaan_koneksi row for kode="pmputra" label="${label}"`);
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
      global._pmputraPools?.delete(label);
      throw err;
    });

  global._pmputraPools.set(label, promise);
  return promise;
}
