// Backfill slot can untuk isian aktif yang sudah ada sebelum model slot
// (docs/superpowers/specs/2026-11-09-produksi-es-balok-slot-can-design.md §1).
//
// Untuk setiap (perusahaan_kode, kolom_id) yang punya isian aktif dengan
// cardinality(slot) = 0 dan sisa > 0:
//   - isian produksi, urut mulai_at naik (lalu id), mengambil slot bebas
//     terendah berurutan sebanyak `sisa`;
//   - isian babonan mengambil slot bebas tertinggi sebanyak `sisa`, dan
//     slot_pecah = `pecah` slot teratas dari slot itu.
// Slot milik isian aktif yang sudah punya slot dianggap terpakai.
//
// Kapasitas = DenahKolom.jumlahIceCan dari produksi_denah. Bila total sisa
// isian aktif melebihi kapasitas, kolom tidak ada di denah, atau pecah > sisa
// pada babonan, kolom itu dilaporkan lalu dilewati.
//
// Satu transaksi per kolom dengan urutan kunci yang sama seperti modul query
// (produksi_denah FOR SHARE → kunci advisory per (kode, kolom) → isian aktif
// FOR UPDATE). Kunci advisory diimpor dari modul query agar hash identik.
// Hanya UPDATE kolom slot/slot_pecah; tidak ada baris yang dihapus.
//
// Usage:
//   npx tsx scripts/backfill-slot-can.ts          (dry-run, bawaan)
//   npx tsx scripts/backfill-slot-can.ts --tulis  (menulis)
import "dotenv/config";
import { getPgPool } from "../src/lib/pg";
import { migrasiDenah, type DenahKolom } from "../src/lib/produksi-denah";
import { kunciAdvisoryKolom } from "../src/lib/queries/produksi-operasional";

const TULIS = process.argv.includes("--tulis");

type BarisIsian = {
  id: string;
  jenis: "produksi" | "babonan";
  sisa: number;
  pecah: number;
  mulai_at: Date;
  slot: number[];
};

type Rencana = { id: string; jenis: string; slot: number[]; slotPecah: number[] };

function cariKolom(data: unknown, kolomId: string): DenahKolom | null {
  const denah = migrasiDenah(data);
  for (const e of denah.elemen) {
    if (e.tipe !== "bak") continue;
    const k = e.kolom.find((x) => x.id === kolomId);
    if (k) return k;
  }
  return null;
}

// Mengembalikan rencana, atau string alasan bila kolom harus dilewati.
function rencanakan(isian: BarisIsian[], kapasitas: number): Rencana[] | string {
  const totalSisa = isian.reduce((a, i) => a + i.sisa, 0);
  if (totalSisa > kapasitas) return `total sisa ${totalSisa} melebihi kapasitas ${kapasitas}`;

  const terpakai = new Set<number>();
  for (const i of isian) {
    if (i.slot.length === 0) continue;
    if (i.slot.length !== i.sisa) return `isian ${i.id} sudah punya slot tetapi cardinality ${i.slot.length} <> sisa ${i.sisa}`;
    for (const s of i.slot) {
      if (s < 1 || s > kapasitas) return `isian ${i.id} punya slot ${s} di luar 1..${kapasitas}`;
      if (terpakai.has(s)) return `slot ${s} dipakai lebih dari satu isian aktif`;
      terpakai.add(s);
    }
  }
  const bebas = Array.from({ length: kapasitas }, (_, n) => n + 1).filter((s) => !terpakai.has(s));

  const perlu = isian.filter((i) => i.slot.length === 0 && i.sisa > 0);
  const produksi = perlu
    .filter((i) => i.jenis === "produksi")
    .sort((a, b) => a.mulai_at.getTime() - b.mulai_at.getTime() || Number(a.id) - Number(b.id));
  const babonan = perlu.filter((i) => i.jenis === "babonan");

  const rencana: Rencana[] = [];
  for (const i of produksi) {
    if (i.pecah > 0) return `isian produksi ${i.id} punya pecah ${i.pecah} (slot_pecah hanya untuk babonan)`;
    rencana.push({ id: i.id, jenis: i.jenis, slot: bebas.splice(0, i.sisa), slotPecah: [] });
  }
  for (const i of babonan) {
    if (i.pecah > i.sisa) return `babonan ${i.id}: pecah ${i.pecah} > sisa ${i.sisa}`;
    const slot = bebas.splice(bebas.length - i.sisa, i.sisa);
    rencana.push({ id: i.id, jenis: i.jenis, slot, slotPecah: slot.slice(slot.length - i.pecah) });
  }
  return rencana;
}

async function main() {
  const pg = getPgPool();
  const db = (await pg.query<{ db: string }>(`SELECT current_database() AS db`)).rows[0].db;
  console.log(`== Postgres direktori -> current_database() = ${db}`);
  console.log(`Mode: ${TULIS ? "TULIS" : "DRY-RUN (tambahkan --tulis untuk menulis)"}\n`);

  const { rows: target } = await pg.query<{ perusahaan_kode: string; kolom_id: string }>(`
    SELECT DISTINCT perusahaan_kode, kolom_id FROM produksi_kolom_isi
     WHERE selesai_at IS NULL AND cardinality(slot) = 0 AND sisa > 0
     ORDER BY perusahaan_kode, kolom_id
  `);
  console.log(`Kolom yang perlu backfill: ${target.length}`);

  let ditulis = 0;
  let dilewati = 0;
  for (const { perusahaan_kode: kode, kolom_id: kolomId } of target) {
    const c = await pg.connect();
    try {
      await c.query("BEGIN");
      const denah = await c.query<{ data: unknown }>(
        `SELECT data FROM produksi_denah WHERE perusahaan_kode = $1 FOR SHARE`,
        [kode],
      );
      await kunciAdvisoryKolom(c, kode, kolomId);
      const { rows: isian } = await c.query<BarisIsian>(
        `SELECT id::text AS id, jenis, sisa, pecah, mulai_at, slot
           FROM produksi_kolom_isi
          WHERE perusahaan_kode = $1 AND kolom_id = $2 AND selesai_at IS NULL
          ORDER BY mulai_at, id
          FOR UPDATE`,
        [kode, kolomId],
      );

      const kolom = denah.rows[0] ? cariKolom(denah.rows[0].data, kolomId) : null;
      const hasil = kolom
        ? rencanakan(isian, kolom.jumlahIceCan)
        : `kolom tidak ditemukan di denah ${kode}`;
      const label = `${kode} / kolom ${kolomId}${kolom ? ` (nomor ${kolom.nomor}, kapasitas ${kolom.jumlahIceCan})` : ""}`;
      if (typeof hasil === "string") {
        console.log(`  LEWATI ${label}: ${hasil}`);
        dilewati++;
        await c.query("ROLLBACK");
        continue;
      }

      console.log(`  ${label}:`);
      for (const r of hasil) {
        console.log(`    isian ${r.id} (${r.jenis}) slot=[${r.slot.join(",")}] slot_pecah=[${r.slotPecah.join(",")}]`);
        await c.query(
          `UPDATE produksi_kolom_isi SET slot = $2::int[], slot_pecah = $3::int[]
            WHERE id = $1 AND selesai_at IS NULL AND cardinality(slot) = 0`,
          [r.id, r.slot, r.slotPecah],
        );
      }
      if (TULIS) {
        await c.query("COMMIT");
        ditulis++;
      } else {
        await c.query("ROLLBACK");
      }
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }

  console.log(
    `\nSelesai. ${TULIS ? `Kolom ditulis: ${ditulis}` : "Dry-run, tidak ada yang ditulis"}; dilewati: ${dilewati}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
