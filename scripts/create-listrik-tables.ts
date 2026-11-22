// Migrasi skema (aditif, idempoten, aman dijalankan ulang) untuk modul
// Kelistrikan tahap 1 (docs/riset/2026-11-22-riset-kelistrikan.md).
//
// Postgres direktori saja, satu set tabel untuk SEMUA perusahaan (Es Kristal
// & Es Balok) dibedakan perusahaan_kode:
//   - listrik_pengaturan: tarif & meter per perusahaan; semua kolom angka
//     boleh NULL (belum diketahui) — tampilan tidak menebak.
//   - listrik_bacaan_meter: pembacaan stand meter utama PLN. Kolom sumber
//     (manual/otomatis) supaya alat pencatat otomatis nanti menulis ke tabel
//     yang sama. Tidak pernah dihapus — dibatalkan lewat dibatalkan_at.
//
// Hanya CREATE ... IF NOT EXISTS. Tidak pernah DROP atau DELETE.
//
// Usage: npx tsx scripts/create-listrik-tables.ts
import "dotenv/config";
import { getPgPool } from "../src/lib/pg";

async function main() {
  const pg = getPgPool();
  const db = (await pg.query<{ db: string }>(`SELECT current_database() AS db`))
    .rows[0].db;
  console.log(`== Postgres direktori -> current_database() = ${db}`);

  await pg.query(`
    CREATE TABLE IF NOT EXISTS listrik_pengaturan (
      perusahaan_kode text PRIMARY KEY,
      golongan text NULL,
      daya_kva numeric NULL,
      faktor_kali numeric NULL,
      harga_lwbp numeric NULL,
      faktor_k numeric NULL,
      jam_wbp_mulai smallint NOT NULL DEFAULT 17,
      jam_wbp_selesai smallint NOT NULL DEFAULT 22,
      register_terpisah boolean NOT NULL DEFAULT false,
      diubah_oleh_akun_id text NULL,
      diubah_oleh_nama text NULL,
      diubah_at timestamptz NULL,
      CONSTRAINT listrik_pengaturan_jam_chk CHECK (
        jam_wbp_mulai BETWEEN 0 AND 23 AND jam_wbp_selesai BETWEEN 0 AND 23 AND jam_wbp_mulai < jam_wbp_selesai
      ),
      CONSTRAINT listrik_pengaturan_angka_chk CHECK (
        (daya_kva IS NULL OR daya_kva > 0) AND (faktor_kali IS NULL OR faktor_kali > 0)
        AND (harga_lwbp IS NULL OR harga_lwbp > 0) AND (faktor_k IS NULL OR faktor_k BETWEEN 1 AND 3)
      )
    )
  `);
  console.log("listrik_pengaturan siap.");

  await pg.query(`
    CREATE TABLE IF NOT EXISTS listrik_bacaan_meter (
      id bigserial PRIMARY KEY,
      perusahaan_kode text NOT NULL,
      waktu timestamptz NOT NULL,
      slot text NOT NULL,
      kwh_total numeric NULL,
      kwh_lwbp numeric NULL,
      kwh_wbp numeric NULL,
      kvarh numeric NULL,
      foto_path text NULL,
      foto_lat double precision NULL,
      foto_lng double precision NULL,
      sumber text NOT NULL DEFAULT 'manual',
      catatan text NULL,
      dicatat_oleh_akun_id text NULL,
      dicatat_oleh_nama text NOT NULL,
      dibuat_at timestamptz NOT NULL DEFAULT now(),
      dibatalkan_at timestamptz NULL,
      dibatalkan_oleh_nama text NULL,
      alasan_batal text NULL,
      CONSTRAINT listrik_bacaan_slot_chk CHECK (slot IN ('mulai_wbp','akhir_wbp','lain')),
      CONSTRAINT listrik_bacaan_sumber_chk CHECK (sumber IN ('manual','otomatis')),
      CONSTRAINT listrik_bacaan_stand_chk CHECK (
        kwh_total IS NOT NULL OR (kwh_lwbp IS NOT NULL AND kwh_wbp IS NOT NULL)
      ),
      CONSTRAINT listrik_bacaan_nonneg_chk CHECK (
        (kwh_total IS NULL OR kwh_total >= 0) AND (kwh_lwbp IS NULL OR kwh_lwbp >= 0)
        AND (kwh_wbp IS NULL OR kwh_wbp >= 0) AND (kvarh IS NULL OR kvarh >= 0)
      )
    )
  `);
  await pg.query(`
    CREATE INDEX IF NOT EXISTS listrik_bacaan_meter_waktu_idx
      ON listrik_bacaan_meter (perusahaan_kode, waktu DESC) WHERE dibatalkan_at IS NULL
  `);
  console.log("listrik_bacaan_meter siap.");

  console.log("\nSelesai.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
