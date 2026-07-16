import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { getPool, sql } from "../src/lib/db";

const PASSWORD_LENGTH = 10;
const PASSWORD_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function generatePassword(): string {
  const bytes = crypto.randomBytes(PASSWORD_LENGTH);
  let out = "";
  for (let i = 0; i < PASSWORD_LENGTH; i++) {
    out += PASSWORD_CHARSET[bytes[i] % PASSWORD_CHARSET.length];
  }
  return out;
}

async function main() {
  const pool = await getPool();

  const pending = await pool.request().query(`
    SELECT u.UserID, u.UserName, u.Name
    FROM [User] u
    LEFT JOIN DashboardAuth da ON da.UserID = u.UserID
    WHERE da.UserID IS NULL
  `);

  const users = pending.recordset as { UserID: number; UserName: string; Name: string }[];

  if (users.length === 0) {
    console.log("Semua user sudah punya baris DashboardAuth. Tidak ada yang di-seed.");
    return;
  }

  const results: { username: string; name: string; password: string }[] = [];

  for (const user of users) {
    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 12);

    await pool
      .request()
      .input("userId", sql.Int, user.UserID)
      .input("passwordHash", sql.NVarChar, passwordHash)
      .query(`
        INSERT INTO DashboardAuth (UserID, PasswordHash, IsActive, FailedLoginCount)
        VALUES (@userId, @passwordHash, 1, 0)
      `);

    results.push({ username: user.UserName, name: user.Name, password });
    console.log(`Seeded: ${user.UserName}`);
  }

  const outDir = path.join(__dirname, "..", "scratchpad");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `dashboard-auth-seed-${Date.now()}.csv`);

  const csv = ["username,name,password", ...results.map((r) => `${r.username},${r.name},${r.password}`)].join("\n");
  fs.writeFileSync(outFile, csv, "utf-8");

  console.log(`\n${results.length} password berhasil dibuat.`);
  console.log(`Daftar plaintext tersimpan di: ${outFile}`);
  console.log("File ini di-gitignore. Bagikan password ke tiap user secara manual, lalu hapus file ini.");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
