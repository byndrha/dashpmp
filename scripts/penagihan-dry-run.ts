// Dry-run: hitung kandidat penagihan MKEsindo dengan pengaturan awal. TIDAK menulis
// apa pun dan TIDAK mengirim pesan. Usage: node_modules/.bin/tsx scripts/penagihan-dry-run.ts
import "dotenv/config";
import { muatKandidatMkesindo, muatJumlahMitraPerNomor } from "../src/lib/penagihan/mesin";
import { PENGATURAN_AWAL, pilihKandidat, susunJadwal } from "../src/lib/penagihan/logika";

async function main() {
  const [mentah, perNomor] = await Promise.all([muatKandidatMkesindo(), muatJumlahMitraPerNomor()]);
  const sekarang = new Date();
  const { terpilih, dilewati } = pilihKandidat(mentah, PENGATURAN_AWAL, { jumlahMitraPerNomor: perNomor, optout: new Set(), terakhirDitagih: new Map(), sekarang });
  const alasan = new Map<string, number>();
  for (const d of dilewati) alasan.set(d.alasan, (alasan.get(d.alasan) ?? 0) + 1);
  const jadwal = susunJadwal(terpilih.length, new Date("2026-10-14T02:00:00Z"), PENGATURAN_AWAL);
  console.log({ mitraBerpiutang: mentah.length, terpilih: terpilih.length, muatDalamJendela: jadwal.length, dilewati: Object.fromEntries(alasan) });
  console.log(terpilih.slice(0, 5).map((k) => `${k.nama} ${k.nomor} Rp${Math.round(k.total)} ${k.jumlahFaktur}f ${k.hariLewatMaks}hr`));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
