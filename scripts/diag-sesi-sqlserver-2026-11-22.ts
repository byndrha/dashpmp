// Uji BACA-SAJA (2026-11-22): jumlah sesi & request yang terblokir di SQL Server
// PMPutra (utama) — untuk mendiagnosis pool timeout server dev.
import "dotenv/config";
import { getCompanyPool } from "../src/lib/db-company";

async function main() {
  const pool = await getCompanyPool(process.argv[2] ?? "pmputra", "utama");
  const sesi = await pool.request().query(`
    SELECT s.host_name, s.program_name, s.login_name, COUNT(*) AS n, SUM(CASE WHEN r.session_id IS NOT NULL THEN 1 ELSE 0 END) AS aktif
    FROM sys.dm_exec_sessions s LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id
    WHERE s.is_user_process = 1 GROUP BY s.host_name, s.program_name, s.login_name ORDER BY n DESC`);
  console.table(sesi.recordset.slice(0, 15));
  const blok = await pool.request().query(`
    SELECT r.session_id, r.blocking_session_id, r.wait_type, r.wait_time, r.status, DB_NAME(r.database_id) AS db, LEFT(t.text, 120) AS teks
    FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
    WHERE r.session_id <> @@SPID ORDER BY r.wait_time DESC`);
  console.table(blok.recordset.slice(0, 15));
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
