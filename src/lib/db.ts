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
  connectionTimeout: 10000,
  requestTimeout: 20000,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
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
