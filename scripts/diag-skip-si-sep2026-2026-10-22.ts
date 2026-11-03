import "dotenv/config";
import { getPool } from "../src/lib/db";
import { computeBacklogForDate } from "../src/lib/queries/gl-posting-backfill";

// DIAGNOSTIK READ-ONLY (tidak menulis apa pun): alasan engine melewati 22 SI
// September 2026 yang tidak punya jurnal pendapatan (Rp 5.912.000).
const DO_IDS = new Set([
  "01241765","01241917","01242075","01242262","01242425","01242601","01242748","01242920","01243107","01243280","01243454",
  "01243617","01243789","01243960","01244140","01244328","01244539","01244554","01244555","01244556","01244730","01244871",
]);

async function main() {
  const pool = await getPool();
  const hitung = new Map<string, number>();
  for (let h = 11; h <= 30; h++) {
    const tgl = `2026-09-${String(h).padStart(2, "0")}`;
    const r = await computeBacklogForDate(tgl);
    const ditemui = r.skipped.filter((s) => DO_IDS.has(String(s.documentId).replace(/'/g, "")));
    for (const s of ditemui) {
      const k = `${s.docType} | ${s.alasan}`;
      hitung.set(k, (hitung.get(k) ?? 0) + 1);
      console.log(tgl, s.docType, s.voucherNo, "|", s.alasan);
    }
  }
  console.log("--- rekap alasan ---");
  for (const [k, n] of hitung) console.log(n, k);
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
