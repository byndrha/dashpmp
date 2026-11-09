// Data awal Produksi Es Balok — Operasional (spec 2026-11-09 §10):
// peran 'Produksi' (is_produksi = true) untuk PMPakis, setara peran
// 'Produksi' PMPersada. Aditif & idempoten: hanya INSERT bila belum ada
// peran bernama sama di perusahaan itu (UNIQUE (perusahaan_id, nama)).
//
// Tidak menulis peran_izin: akses operator produksi datang dari flag
// is_produksi (permissions.ts bolehAksiProduksi), dan baris izin yang
// tidak ada = tidak boleh (canView ?? false) — sama dengan peran PMPersada
// yang semua baris izinnya false. Tidak membuat akun.
//
// Usage: npx tsx scripts/seed-peran-produksi-pmpakis.ts
import "dotenv/config";
import { getPgPool } from "../src/lib/pg";

const KODE_PERUSAHAAN = "pmpakis";
const NAMA_PERAN = "Produksi";

async function main() {
  const pg = getPgPool();
  try {
    const db = (await pg.query<{ db: string }>(`SELECT current_database() AS db`)).rows[0].db;
    console.log(`== Postgres direktori -> current_database() = ${db}`);

    const p = await pg.query<{ id: number }>(`SELECT id FROM perusahaan WHERE kode = $1`, [KODE_PERUSAHAAN]);
    if (p.rows.length === 0) throw new Error(`Perusahaan dengan kode '${KODE_PERUSAHAAN}' tidak ditemukan.`);
    const perusahaanId = p.rows[0].id;

    const r = await pg.query<{ id: number }>(
      `INSERT INTO peran (perusahaan_id, nama, is_produksi)
       VALUES ($1, $2, true)
       ON CONFLICT (perusahaan_id, nama) DO NOTHING
       RETURNING id`,
      [perusahaanId, NAMA_PERAN]
    );
    if (r.rows.length > 0) {
      console.log(`Peran '${NAMA_PERAN}' untuk ${KODE_PERUSAHAAN} dibuat (id ${r.rows[0].id}).`);
    } else {
      const ada = await pg.query<{ id: number; is_produksi: boolean }>(
        `SELECT id, is_produksi FROM peran WHERE perusahaan_id = $1 AND nama = $2`,
        [perusahaanId, NAMA_PERAN]
      );
      const baris = ada.rows[0];
      console.log(`Peran '${NAMA_PERAN}' untuk ${KODE_PERUSAHAAN} sudah ada (id ${baris.id}, is_produksi=${baris.is_produksi}).`);
      if (!baris.is_produksi) console.warn("PERINGATAN: peran yang sudah ada tidak bertanda is_produksi — tidak diubah otomatis.");
    }
  } finally {
    await pg.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
