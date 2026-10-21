// Membuat (atau mengaktifkan ulang) satu akun admin untuk perusahaan di
// holding demo, plus perannya. Kata sandi dibangkitkan acak dan HANYA ditulis
// ke file lokal yang di-ignore git -- tidak pernah dicetak ke konsol.
//
// Jalankan HANYA setelah deployment produksi memakai gerbang login per
// holding (src/lib/auth.ts). Kode lama meloloskan accountScope tak dikenal,
// sehingga akun demo bisa membuka /mkesindo produksi.
//
// Peran sengaja BUKAN superadmin: izin modul penuh diberikan lewat
// peran_izin, tanpa hak lintas PT.
//
// Usage:
//   npx tsx scripts/saas-create-demo-akun.ts --kode demokristal --username demo.admin
//   npx tsx scripts/saas-create-demo-akun.ts --username demo.admin --nonaktif
import "dotenv/config";
import { randomBytes } from "crypto";
import { writeFileSync } from "fs";
import bcrypt from "bcryptjs";
import { getPgPool } from "../src/lib/pg";
import { MODULE_KEYS } from "../src/lib/permissions";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const USERNAME = arg("username", "demo.admin")!;
const KODE = arg("kode", "demokristal")!;
const NONAKTIF = process.argv.includes("--nonaktif");
const CRED_FILE = ".env.demo-akun.local";

async function main() {
  const pg = getPgPool();
  if (NONAKTIF) {
    const r = await pg.query(`UPDATE akun SET is_active = false, updated_at = now() WHERE username = $1 RETURNING id`, [USERNAME]);
    if (!r.rowCount) {
      console.log(`Akun ${USERNAME} tidak ditemukan.`);
      process.exit(0);
    }
    // Menonaktifkan akun tidak mematikan JWT yang sudah terbit -- cabut sesinya
    // juga (dicek auth.ts di setiap request lewat checkAkunSesi).
    const s = await pg.query(`UPDATE akun_sesi SET revoked_at = now() WHERE akun_id = $1 AND revoked_at IS NULL`, [r.rows[0].id]);
    console.log(`Akun ${USERNAME} dinonaktifkan, ${s.rowCount} sesi aktif dicabut.`);
    process.exit(0);
  }

  const p = (await pg.query(
    `SELECT p.id, p.nama, h.id holding_id, h.is_demo FROM perusahaan p JOIN holding h ON h.id = p.holding_id WHERE p.kode = $1`, [KODE])).rows[0];
  if (!p) throw new Error(`Perusahaan "${KODE}" tidak ada / tanpa holding`);
  if (!p.is_demo) throw new Error(`DITOLAK: perusahaan "${KODE}" bukan milik holding demo`);

  const existing = (await pg.query(`SELECT id, perusahaan_id FROM akun WHERE username = $1`, [USERNAME])).rows[0];
  if (existing && existing.perusahaan_id !== p.id) throw new Error(`Username ${USERNAME} sudah dipakai akun perusahaan lain`);

  const password = randomBytes(24).toString("base64url");
  const hash = await bcrypt.hash(password, 10);
  const client = await pg.connect();
  try {
    await client.query("BEGIN");
    const peranNama = "Administrator Demo";
    let peranId = (await client.query(`SELECT id FROM peran WHERE perusahaan_id = $1 AND nama = $2`, [p.id, peranNama])).rows[0]?.id as number | undefined;
    if (!peranId) {
      peranId = (await client.query(
        `INSERT INTO peran (perusahaan_id, nama, is_super_admin) VALUES ($1, $2, false) RETURNING id`, [p.id, peranNama])).rows[0].id as number;
    }
    await client.query(`DELETE FROM peran_izin WHERE peran_id = $1`, [peranId]);
    for (const key of MODULE_KEYS) {
      await client.query(`INSERT INTO peran_izin (peran_id, module_key, can_view, can_edit) VALUES ($1, $2, true, true)`, [peranId, key]);
    }
    if (existing) {
      await client.query(
        `UPDATE akun SET password_hash = $2, peran_id = $3, holding_id = $4, is_active = true, failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
        [existing.id, hash, peranId, p.holding_id]);
    } else {
      await client.query(
        `INSERT INTO akun (username, password_hash, nama, perusahaan_id, peran_id, holding_id, is_active) VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [USERNAME, hash, "Admin Demo", p.id, peranId, p.holding_id]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  writeFileSync(CRED_FILE, `# Akun uji demo -- JANGAN di-commit (di-ignore lewat .env*)\nDEMO_USERNAME=${USERNAME}\nDEMO_PASSWORD=${password}\n`);
  console.log(`Akun ${USERNAME} aktif untuk ${p.nama}. Kredensial ditulis ke ${CRED_FILE}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("GAGAL:", err);
  process.exit(1);
});
