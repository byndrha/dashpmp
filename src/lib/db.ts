import sql from "mssql";

const config: sql.config = {
  server: process.env.DB_SERVER!,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433,
  database: process.env.DB_NAME!,
  user: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  options: {
    encrypt: process.env.DB_ENCRYPT !== "false",
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
  },
  // Measured live against this DB host: opening a fresh connection (TLS
  // handshake + auth) alone takes ~5s, before any query even runs — with the
  // old min:0/idleTimeoutMillis:30000 pool, any page whose Promise.all fires
  // several concurrent queries after 30s of quiet pays that ~5s handshake
  // cost N times in parallel, competing for the same DB host. min: 2 keeps
  // warm connections alive so bursts reuse an already-open socket instead
  // (subsequent queries on a warm connection measured ~0.4-0.5s). Timeouts
  // bumped to give legitimately slow queries (some of this app's aggregate
  // queries measured 9-17s under concurrent load, see aging.ts) real
  // headroom instead of hard-failing right at the edge.
  connectionTimeout: 15000,
  requestTimeout: 40000,
  pool: {
    max: 10,
    min: 2,
    idleTimeoutMillis: 600000,
  },
};

declare global {
  var _mssqlPool: Promise<sql.ConnectionPool> | undefined;
}

export function getPool(): Promise<sql.ConnectionPool> {
  if (!global._mssqlPool) {
    global._mssqlPool = new sql.ConnectionPool(config).connect().catch((err) => {
      // Don't cache a failed connection attempt — otherwise every request for
      // the rest of the process's lifetime reuses the same rejected promise
      // and never retries, even after the underlying issue (bad creds,
      // network blip) is fixed.
      global._mssqlPool = undefined;
      throw err;
    });
  }
  return global._mssqlPool;
}

export { sql };
