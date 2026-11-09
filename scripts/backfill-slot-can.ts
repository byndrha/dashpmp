// Backfill / perbaikan slot can untuk isian aktif
// (docs/superpowers/specs/2026-11-09-produksi-es-balok-slot-can-design.md §1).
//
// Jalankan ulang tepat setelah deploy branch slot-can (kode lama di main
// menulis isian tanpa slot, dan mengubah sisa/pecah tanpa menyentuh slot).
//
// Setiap (perusahaan_kode, kolom_id) yang punya isian aktif diperiksa. Kolom
// dianggap TIDAK KONSISTEN bila ada isian aktif dengan cardinality(slot) <>
// sisa (termasuk slot kosong), babonan dengan cardinality(slot_pecah) <> pecah
// atau slot_pecah ⊄ slot, produksi dengan slot_pecah tidak kosong, slot di
// luar 1..jumlahIceCan, slot beririsan antar-isian, atau slot yang menempati
// can rusak aktif (produksi_slot_rusak). Kolom tidak konsisten direncanakan
// ULANG SELURUHNYA (slot belum punya identitas fisik) dengan aturan
// deterministik, memakai slot bebas = 1..jumlahIceCan dikurangi slot rusak aktif:
//   - isian produksi, urut mulai_at naik (lalu id), mengambil slot bebas
//     terendah berurutan sebanyak `sisa`;
//   - isian babonan mengambil slot bebas tertinggi sebanyak `sisa`, dan
//     slot_pecah = `pecah` slot teratas dari slot itu.
// Kolom yang sudah konsisten tidak disentuh.
//
// Kapasitas = DenahKolom.jumlahIceCan dari produksi_denah. Bila total sisa
// isian aktif melebihi jumlah slot bebas, kolom tidak ada di denah, pecah >
// sisa pada babonan, atau pecah > 0 pada produksi, kolom itu dilaporkan lalu
// dilewati.
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
  slot_pecah: number[];
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

// Alasan kolom tidak konsisten, atau null bila konsisten.
function cekKonsisten(isian: BarisIsian[], kapasitas: number, rusak: Set<number>): string | null {
  const terpakai = new Set<number>();
  for (const i of isian) {
    if (i.slot.length !== i.sisa) return `isian ${i.id}: cardinality(slot) ${i.slot.length} <> sisa ${i.sisa}`;
    if (i.jenis === "babonan") {
      if (i.slot_pecah.length !== i.pecah) {
        return `babonan ${i.id}: cardinality(slot_pecah) ${i.slot_pecah.length} <> pecah ${i.pecah}`;
      }
      if (!i.slot_pecah.every((s) => i.slot.includes(s))) return `babonan ${i.id}: slot_pecah bukan subset slot`;
    } else if (i.slot_pecah.length > 0) {
      return `produksi ${i.id}: slot_pecah tidak kosong`;
    }
    for (const s of i.slot) {
      if (!Number.isInteger(s) || s < 1 || s > kapasitas) return `isian ${i.id}: slot ${s} di luar 1..${kapasitas}`;
      if (terpakai.has(s)) return `slot ${s} dipakai lebih dari satu isian aktif`;
      if (rusak.has(s)) return `slot ${s} ditempati isian ${i.id} padahal rusak aktif`;
      terpakai.add(s);
    }
  }
  return null;
}

// Rencana ulang seluruh kolom, atau string alasan bila kolom harus dilewati.
function rencanakan(isian: BarisIsian[], kapasitas: number, rusak: Set<number>): Rencana[] | string {
  const bebas = Array.from({ length: kapasitas }, (_, n) => n + 1).filter((s) => !rusak.has(s));
  const totalSisa = isian.reduce((a, i) => a + i.sisa, 0);
  if (totalSisa > bebas.length) {
    return `total sisa ${totalSisa} melebihi slot bebas ${bebas.length} (kapasitas ${kapasitas}, rusak ${rusak.size})`;
  }

  const produksi = isian
    .filter((i) => i.jenis === "produksi")
    .sort((a, b) => a.mulai_at.getTime() - b.mulai_at.getTime() || Number(a.id) - Number(b.id));
  const babonan = isian.filter((i) => i.jenis === "babonan");

  const rencana: Rencana[] = [];
  for (const i of produksi) {
    if (i.pecah > 0) return `isian produksi ${i.id} punya pecah ${i.pecah} (slot_pecah hanya untuk babonan)`;
    rencana.push({ id: i.id, jenis: i.jenis, slot: bebas.splice(0, i.sisa), slotPecah: [] });
  }
  for (const i of babonan) {
    if (i.pecah > i.sisa) return `babonan ${i.id}: pecah ${i.pecah} > sisa ${i.sisa}`;
    const slot = i.sisa > 0 ? bebas.splice(bebas.length - i.sisa, i.sisa) : [];
    const slotPecah = i.pecah > 0 ? slot.slice(slot.length - i.pecah) : [];
    rencana.push({ id: i.id, jenis: i.jenis, slot, slotPecah });
  }
  return rencana;
}

function samaArr(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x, n) => x === b[n]);
}

async function main() {
  const pg = getPgPool();
  const db = (await pg.query<{ db: string }>(`SELECT current_database() AS db`)).rows[0].db;
  console.log(`== Postgres direktori -> current_database() = ${db}`);
  console.log(`Mode: ${TULIS ? "TULIS" : "DRY-RUN (tambahkan --tulis untuk menulis)"}\n`);

  // Semua kolom dengan isian aktif; konsistensi diputuskan di bawah kunci.
  const { rows: target } = await pg.query<{ perusahaan_kode: string; kolom_id: string }>(`
    SELECT DISTINCT perusahaan_kode, kolom_id FROM produksi_kolom_isi
     WHERE selesai_at IS NULL
     ORDER BY perusahaan_kode, kolom_id
  `);
  console.log(`Kolom dengan isian aktif: ${target.length}`);

  let ditulis = 0;
  let dilewati = 0;
  let konsisten = 0;
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
        `SELECT id::text AS id, jenis, sisa, pecah, mulai_at, slot, slot_pecah
           FROM produksi_kolom_isi
          WHERE perusahaan_kode = $1 AND kolom_id = $2 AND selesai_at IS NULL
          ORDER BY mulai_at, id
          FOR UPDATE`,
        [kode, kolomId],
      );
      const { rows: barisRusak } = await c.query<{ slot: number }>(
        `SELECT slot FROM produksi_slot_rusak
          WHERE perusahaan_kode = $1 AND kolom_id = $2 AND selesai_at IS NULL`,
        [kode, kolomId],
      );
      const rusak = new Set(barisRusak.map((r) => r.slot));

      const kolom = denah.rows[0] ? cariKolom(denah.rows[0].data, kolomId) : null;
      const label = `${kode} / kolom ${kolomId}${kolom ? ` (nomor ${kolom.nomor}, kapasitas ${kolom.jumlahIceCan})` : ""}`;
      if (!kolom) {
        console.log(`  LEWATI ${label}: kolom tidak ditemukan di denah ${kode}`);
        dilewati++;
        await c.query("ROLLBACK");
        continue;
      }
      const alasan = cekKonsisten(isian, kolom.jumlahIceCan, rusak);
      if (alasan === null) {
        console.log(`  OK ${label}: konsisten, tidak disentuh.`);
        konsisten++;
        await c.query("ROLLBACK");
        continue;
      }
      const hasil = rencanakan(isian, kolom.jumlahIceCan, rusak);
      if (typeof hasil === "string") {
        console.log(`  LEWATI ${label}: ${hasil}`);
        dilewati++;
        await c.query("ROLLBACK");
        continue;
      }

      console.log(`  RENCANA ULANG ${label}: ${alasan}`);
      for (const r of hasil) {
        const lama = isian.find((i) => i.id === r.id)!;
        if (samaArr(lama.slot, r.slot) && samaArr(lama.slot_pecah, r.slotPecah)) {
          console.log(`    isian ${r.id} (${r.jenis}) tetap slot=[${r.slot.join(",")}]`);
          continue;
        }
        console.log(
          `    isian ${r.id} (${r.jenis}) slot=[${r.slot.join(",")}] slot_pecah=[${r.slotPecah.join(",")}]` +
            ` (lama slot=[${lama.slot.join(",")}] slot_pecah=[${lama.slot_pecah.join(",")}])`,
        );
        const upd = await c.query(
          `UPDATE produksi_kolom_isi SET slot = $2::int[], slot_pecah = $3::int[]
            WHERE id = $1 AND selesai_at IS NULL`,
          [r.id, r.slot, r.slotPecah],
        );
        if (upd.rowCount !== 1) throw new Error(`UPDATE isian ${r.id} mengenai ${upd.rowCount} baris, bukan 1.`);
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
    `\nSelesai. ${TULIS ? `Kolom ditulis: ${ditulis}` : "Dry-run, tidak ada yang ditulis"}; ` +
      `konsisten: ${konsisten}; dilewati: ${dilewati}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
