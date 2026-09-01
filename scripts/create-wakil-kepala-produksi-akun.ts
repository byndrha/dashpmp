// One-off setup — creates the 3 Wakil Kepala Produksi accounts and
// assigns each to their Tim. Run once; safe to re-run (skips a Tim that
// already has a WakilKepalaAkunID set, and skips creating an akun whose
// username already exists).
// Usage: npx tsx scripts/create-wakil-kepala-produksi-akun.ts
import "dotenv/config";
import { createAkun } from "../src/lib/queries/akun";
import { getAllTim, updateTimWakilKepala } from "../src/lib/queries/tim-produksi";
import { getPgPool } from "../src/lib/pg";

const PERAN_PRODUKSI_ID = 1012;
const PERUSAHAAN_MKESINDO_ID = 1;
const PASSWORD = "12345678";

const WAKIL_LIST: { username: string; nama: string; timNama: string }[] = [
  { username: "Nizam", nama: "PRD-Nizam", timNama: "Tim A" },
  { username: "Aldo", nama: "PRD-Aldo", timNama: "Tim B" },
  { username: "Reza", nama: "PRD-Reza", timNama: "Tim C" },
];

async function findAkunIdByUsername(username: string): Promise<number | null> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT id FROM akun WHERE username = $1`, [username]);
  return (result.rows[0] as { id: number } | undefined)?.id ?? null;
}

async function main() {
  const timList = await getAllTim();

  for (const wakil of WAKIL_LIST) {
    const tim = timList.find((t) => t.nama === wakil.timNama);
    if (!tim) {
      console.log(`SKIP ${wakil.username}: Tim "${wakil.timNama}" tidak ditemukan.`);
      continue;
    }

    let akunId = await findAkunIdByUsername(wakil.username);
    if (akunId == null) {
      await createAkun({
        nama: wakil.nama,
        username: wakil.username,
        password: PASSWORD,
        email: null,
        nomorTelepon: null,
        perusahaanId: PERUSAHAAN_MKESINDO_ID,
        peranId: PERAN_PRODUKSI_ID,
        salesmanId: null,
      });
      akunId = await findAkunIdByUsername(wakil.username);
      console.log(`Created akun ${wakil.username} (id ${akunId}).`);
    } else {
      console.log(`Akun ${wakil.username} sudah ada (id ${akunId}) — tidak dibuat ulang.`);
    }
    if (akunId == null) throw new Error(`Gagal menemukan akun ${wakil.username} setelah dibuat.`);

    if (tim.wakilKepalaAkunId === akunId) {
      console.log(`Tim ${wakil.timNama} sudah punya Wakil ${wakil.username} — tidak diubah.`);
      continue;
    }
    await updateTimWakilKepala(tim.timId, akunId);
    console.log(`Set ${wakil.username} (id ${akunId}) sebagai Wakil Kepala Produksi ${wakil.timNama}.`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
