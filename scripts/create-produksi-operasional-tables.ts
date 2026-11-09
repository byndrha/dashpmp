// Migrasi skema (aditif, idempoten, aman dijalankan ulang) untuk Produksi Es
// Balok tahap operasional
// (docs/superpowers/specs/2026-11-09-produksi-es-balok-operasional-design.md §11 Data).
//
// Postgres direktori saja:
//   - produksi_kolom_isi: diperluas (ALTER ... ADD COLUMN IF NOT EXISTS).
//     Satu baris = satu isian (produksi | babonan).
//   - produksi_maintenance, produksi_panen, produksi_muatan,
//     produksi_babonan_keluar, produksi_kendaraan_aktif, produksi_log: baru.
//
// Hanya ADD COLUMN / CREATE ... IF NOT EXISTS / ADD CONSTRAINT bila belum ada.
// Tidak pernah DROP tabel/kolom atau DELETE data. Satu-satunya DROP CONSTRAINT:
// PK produksi_kendaraan_aktif (akun_id) diganti (akun_id, perusahaan_kode),
// hanya bila PK lama masih akun_id saja (lihat bagian tabel itu). Kolom NOT NULL baru diberi DEFAULT sementara
// (lalu DEFAULT dicabut) -- karena itu skrip berhenti bila produksi_kolom_isi
// sudah berisi baris sebelum kolom tersebut ada.
//
// ID akun bertipe text (session.user.id adalah string).
//
// Usage: npx tsx scripts/create-produksi-operasional-tables.ts
import "dotenv/config";
import type { Pool } from "pg";
import { getPgPool } from "../src/lib/pg";

async function addConstraintIfMissing(pg: Pool, table: string, name: string, definition: string) {
  const ada = await pg.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [name]);
  if (ada.rowCount && ada.rowCount > 0) {
    console.log(`  constraint ${name} sudah ada.`);
    return;
  }
  await pg.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}`);
  console.log(`  constraint ${name} ditambahkan.`);
}

async function main() {
  const pg = getPgPool();
  const db = (await pg.query<{ db: string }>(`SELECT current_database() AS db`)).rows[0].db;
  console.log(`== Postgres direktori -> current_database() = ${db}`);

  // ---------------------------------------------------------------------------
  // produksi_kolom_isi (sudah ada dari create-produksi-denah-tables.ts)
  // ---------------------------------------------------------------------------
  const tabelAda = await pg.query(`SELECT to_regclass('public.produksi_kolom_isi') AS t`);
  if (!tabelAda.rows[0].t) {
    throw new Error(
      "produksi_kolom_isi belum ada. Jalankan dulu: npx tsx scripts/create-produksi-denah-tables.ts",
    );
  }

  const kolomNotNull = ["jenis", "bak_id", "varian", "jumlah_awal", "sisa", "pecah", "diisi_oleh_akun_id"];
  const sudahAda = await pg.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'produksi_kolom_isi'`,
  );
  const namaAda = new Set(sudahAda.rows.map((r) => r.column_name));
  const kolomBaruNotNull = kolomNotNull.filter((c) => !namaAda.has(c) && c !== "pecah");
  const jumlahBaris = Number(
    (await pg.query<{ n: string }>(`SELECT count(*) AS n FROM produksi_kolom_isi`)).rows[0].n,
  );
  console.log(`produksi_kolom_isi: ${jumlahBaris} baris; kolom NOT NULL yang belum ada: ${kolomBaruNotNull.join(", ") || "(tidak ada)"}`);
  if (kolomBaruNotNull.length > 0 && jumlahBaris > 0) {
    throw new Error(
      `BERHENTI: produksi_kolom_isi sudah berisi ${jumlahBaris} baris, padahal kolom NOT NULL ` +
        `(${kolomBaruNotNull.join(", ")}) belum ada. DEFAULT sementara akan mengisi baris lama ` +
        `dengan nilai palsu -- tangani baris itu dulu secara manual.`,
    );
  }

  // Kolom NOT NULL tanpa default permanen: DEFAULT sementara, lalu dicabut.
  const kolomSementara: Array<[string, string, string]> = [
    ["jenis", "text", "'produksi'"],
    ["bak_id", "text", "''"],
    ["varian", "text", "'kecil'"],
    ["jumlah_awal", "integer", "0"],
    ["sisa", "integer", "0"],
    ["diisi_oleh_akun_id", "text", "''"],
  ];
  for (const [nama, tipe, def] of kolomSementara) {
    if (namaAda.has(nama)) {
      console.log(`  kolom ${nama} sudah ada.`);
      continue;
    }
    await pg.query(`ALTER TABLE produksi_kolom_isi ADD COLUMN IF NOT EXISTS ${nama} ${tipe} NOT NULL DEFAULT ${def}`);
    await pg.query(`ALTER TABLE produksi_kolom_isi ALTER COLUMN ${nama} DROP DEFAULT`);
    console.log(`  kolom ${nama} ditambahkan.`);
  }
  await pg.query(`ALTER TABLE produksi_kolom_isi ADD COLUMN IF NOT EXISTS durasi_beku_jam numeric NULL`);
  await pg.query(`ALTER TABLE produksi_kolom_isi ADD COLUMN IF NOT EXISTS pecah integer NOT NULL DEFAULT 0`);
  await pg.query(`ALTER TABLE produksi_kolom_isi ADD COLUMN IF NOT EXISTS ditutup_oleh_akun_id text NULL`);

  await addConstraintIfMissing(pg, "produksi_kolom_isi", "produksi_kolom_isi_jenis_chk",
    `CHECK (jenis IN ('produksi','babonan'))`);
  await addConstraintIfMissing(pg, "produksi_kolom_isi", "produksi_kolom_isi_varian_chk",
    `CHECK (varian IN ('kecil','besar'))`);
  await addConstraintIfMissing(pg, "produksi_kolom_isi", "produksi_kolom_isi_sisa_chk",
    `CHECK (sisa >= 0)`);
  await addConstraintIfMissing(pg, "produksi_kolom_isi", "produksi_kolom_isi_jumlah_awal_chk",
    `CHECK (jumlah_awal >= 0)`);
  await addConstraintIfMissing(pg, "produksi_kolom_isi", "produksi_kolom_isi_pecah_chk",
    `CHECK (pecah >= 0)`);

  await pg.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS produksi_kolom_isi_babonan_aktif_uq
      ON produksi_kolom_isi (perusahaan_kode, kolom_id)
      WHERE selesai_at IS NULL AND jenis = 'babonan'
  `);
  console.log("produksi_kolom_isi siap.");

  // ---------------------------------------------------------------------------
  // produksi_maintenance
  // ---------------------------------------------------------------------------
  await pg.query(`
    CREATE TABLE IF NOT EXISTS produksi_maintenance (
      id bigserial PRIMARY KEY,
      perusahaan_kode text NOT NULL,
      kolom_id text NOT NULL,
      mulai_at timestamptz NOT NULL DEFAULT now(),
      selesai_at timestamptz NULL,
      catatan text NULL,
      dibuka_oleh_akun_id text NOT NULL,
      ditutup_oleh_akun_id text NULL
    )
  `);
  await pg.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS produksi_maintenance_aktif_uq
      ON produksi_maintenance (perusahaan_kode, kolom_id) WHERE selesai_at IS NULL
  `);
  console.log("produksi_maintenance siap.");

  // ---------------------------------------------------------------------------
  // produksi_panen
  // ---------------------------------------------------------------------------
  await pg.query(`
    CREATE TABLE IF NOT EXISTS produksi_panen (
      id bigserial PRIMARY KEY,
      perusahaan_kode text NOT NULL,
      isian_id bigint NOT NULL REFERENCES produksi_kolom_isi(id),
      kolom_id text NOT NULL,
      bak_id text NOT NULL,
      varian text NOT NULL,
      panen_at timestamptz NOT NULL DEFAULT now(),
      tanggal_bisnis date NOT NULL,
      dimuat integer NOT NULL DEFAULT 0,
      ke_babonan integer NOT NULL DEFAULT 0,
      pecah integer NOT NULL DEFAULT 0,
      persen_saat_panen integer NULL,
      operator_akun_id text NOT NULL,
      shift smallint NOT NULL,
      dibatalkan_at timestamptz NULL,
      alasan_batal text NULL,
      CONSTRAINT produksi_panen_varian_chk CHECK (varian IN ('kecil','besar')),
      CONSTRAINT produksi_panen_jumlah_chk CHECK (dimuat >= 0 AND ke_babonan >= 0 AND pecah >= 0)
    )
  `);
  await pg.query(`
    CREATE INDEX IF NOT EXISTS produksi_panen_tanggal_idx
      ON produksi_panen (perusahaan_kode, tanggal_bisnis)
  `);
  await pg.query(`CREATE INDEX IF NOT EXISTS produksi_panen_isian_idx ON produksi_panen (isian_id)`);
  console.log("produksi_panen siap.");

  // ---------------------------------------------------------------------------
  // produksi_muatan
  // ---------------------------------------------------------------------------
  await pg.query(`
    CREATE TABLE IF NOT EXISTS produksi_muatan (
      id bigserial PRIMARY KEY,
      panen_id bigint NOT NULL REFERENCES produksi_panen(id),
      jenis text NOT NULL,
      kendaraan_erp_id text NULL,
      plat text NOT NULL,
      agen_id text NULL,
      agen_nama text NULL,
      jumlah integer NOT NULL,
      CONSTRAINT produksi_muatan_jenis_chk CHECK (jenis IN ('armada','pembeli')),
      CONSTRAINT produksi_muatan_jumlah_chk CHECK (jumlah > 0)
    )
  `);
  await pg.query(`CREATE INDEX IF NOT EXISTS produksi_muatan_panen_idx ON produksi_muatan (panen_id)`);
  console.log("produksi_muatan siap.");

  // ---------------------------------------------------------------------------
  // produksi_babonan_keluar
  // ---------------------------------------------------------------------------
  await pg.query(`
    CREATE TABLE IF NOT EXISTS produksi_babonan_keluar (
      id bigserial PRIMARY KEY,
      isian_id bigint NOT NULL REFERENCES produksi_kolom_isi(id),
      at timestamptz NOT NULL DEFAULT now(),
      jumlah integer NOT NULL,
      alasan text NULL,
      akun_id text NOT NULL,
      CONSTRAINT produksi_babonan_keluar_jumlah_chk CHECK (jumlah > 0)
    )
  `);
  await pg.query(`
    CREATE INDEX IF NOT EXISTS produksi_babonan_keluar_isian_idx ON produksi_babonan_keluar (isian_id)
  `);
  console.log("produksi_babonan_keluar siap.");

  // ---------------------------------------------------------------------------
  // produksi_kendaraan_aktif
  // ---------------------------------------------------------------------------
  await pg.query(`
    CREATE TABLE IF NOT EXISTS produksi_kendaraan_aktif (
      akun_id text PRIMARY KEY,
      perusahaan_kode text NOT NULL,
      jenis text NOT NULL,
      kendaraan_erp_id text NULL,
      plat text NOT NULL,
      agen_nama text NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT produksi_kendaraan_aktif_jenis_chk CHECK (jenis IN ('armada','pembeli'))
    )
  `);
  // PK (akun_id) → (akun_id, perusahaan_kode): satu akun lintas pabrik
  // (Direktur/Super Admin) punya kendaraan aktif per pabrik. Hanya dijalankan
  // bila PK sekarang masih akun_id saja; baris lama tetap kompatibel (akun_id
  // unik ⇒ pasangan (akun_id, perusahaan_kode) juga unik). Satu transaksi.
  const pk = await pg.query<{ conname: string; kolom: string[] }>(`
    SELECT c.conname, array_agg(a.attname::text ORDER BY k.ord) AS kolom
      FROM pg_constraint c
      JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.conrelid = 'public.produksi_kendaraan_aktif'::regclass AND c.contype = 'p'
     GROUP BY c.conname
  `);
  const pkSekarang = pk.rows[0];
  if (pkSekarang && pkSekarang.kolom.length === 1 && pkSekarang.kolom[0] === "akun_id") {
    const klien = await pg.connect();
    try {
      await klien.query("BEGIN");
      await klien.query(`ALTER TABLE produksi_kendaraan_aktif DROP CONSTRAINT ${pkSekarang.conname}`);
      await klien.query(
        `ALTER TABLE produksi_kendaraan_aktif ADD CONSTRAINT produksi_kendaraan_aktif_pkey PRIMARY KEY (akun_id, perusahaan_kode)`,
      );
      await klien.query("COMMIT");
      console.log(`  PK ${pkSekarang.conname} (akun_id) diganti produksi_kendaraan_aktif_pkey (akun_id, perusahaan_kode).`);
    } catch (err) {
      await klien.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      klien.release();
    }
  } else if (!pkSekarang) {
    await pg.query(
      `ALTER TABLE produksi_kendaraan_aktif ADD CONSTRAINT produksi_kendaraan_aktif_pkey PRIMARY KEY (akun_id, perusahaan_kode)`,
    );
    console.log("  PK produksi_kendaraan_aktif_pkey (akun_id, perusahaan_kode) ditambahkan.");
  } else {
    console.log(`  PK ${pkSekarang.conname} (${pkSekarang.kolom.join(", ")}) sudah sesuai.`);
  }
  console.log("produksi_kendaraan_aktif siap.");

  // ---------------------------------------------------------------------------
  // produksi_log (hanya INSERT)
  // ---------------------------------------------------------------------------
  await pg.query(`
    CREATE TABLE IF NOT EXISTS produksi_log (
      id bigserial PRIMARY KEY,
      perusahaan_kode text NOT NULL,
      at timestamptz NOT NULL DEFAULT now(),
      akun_id text NOT NULL,
      akun_nama text NOT NULL,
      peran text NOT NULL,
      shift smallint NULL,
      aksi text NOT NULL,
      kolom_id text NULL,
      bak_id text NULL,
      bak_nama text NULL,
      kolom_nomor integer NULL,
      rujukan_id bigint NULL,
      sebelum jsonb NULL,
      sesudah jsonb NULL,
      alasan text NULL,
      CONSTRAINT produksi_log_peran_chk CHECK (peran IN ('operator','admin'))
    )
  `);
  await pg.query(`ALTER TABLE produksi_log ADD COLUMN IF NOT EXISTS bak_id text NULL`);
  await pg.query(`
    CREATE INDEX IF NOT EXISTS produksi_log_at_idx ON produksi_log (perusahaan_kode, at DESC)
  `);
  // namaAkun (DISTINCT ON akun_id ... ORDER BY at DESC) dan riwayat operator.
  await pg.query(`
    CREATE INDEX IF NOT EXISTS produksi_log_akun_at_idx ON produksi_log (perusahaan_kode, akun_id, at DESC)
  `);
  console.log("produksi_log siap.");

  // ---------------------------------------------------------------------------
  // Index untuk polling keadaan (getDataPabrik → kosongSejak: max(selesai_at)
  // per kolom dari isian & maintenance yang sudah selesai).
  // ---------------------------------------------------------------------------
  await pg.query(`
    CREATE INDEX IF NOT EXISTS produksi_kolom_isi_kolom_selesai_idx
      ON produksi_kolom_isi (perusahaan_kode, kolom_id, selesai_at DESC)
  `);
  await pg.query(`
    CREATE INDEX IF NOT EXISTS produksi_maintenance_kolom_selesai_idx
      ON produksi_maintenance (perusahaan_kode, kolom_id, selesai_at DESC)
  `);
  console.log("index polling siap.");

  console.log("\nSelesai.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
