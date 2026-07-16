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
    global._mssqlPool = new sql.ConnectionPool(config).connect();
  }
  return global._mssqlPool;
}

export { sql };
