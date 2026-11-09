// Data awal Produksi Es Balok — Operasional (spec 2026-11-09 §10): denah
// PMPersada sesuai tata letak IceControl (dikonfirmasi pengguna 2026-11-09).
//
//   - 5 bak "Bak 1"…"Bak 5" dengan 37/37/44/66/66 kolom.
//   - BK ("kecil") 36 can per kolom; Bak 4 & Bak 5 kolom nomor >= 41 BB
//     ("besar") 18 can per kolom.
//   - durasiBekuJam = { kecil: 24, besar: 32 }.
//   - Bak ditata berjajar vertikal, jarak 3 m. Ukuran bawaan buatBak,
//     diperpanjang secukupnya agar kolom & ice can muat; kanvas diperbesar.
//
// Bawaan DRY-RUN: hanya mencetak ringkasan + hasil validasi. Dengan argumen
// `--tulis`: tolak bila ada isian kolom aktif, lalu simpan lewat
// simpanDenahUntukKode (menimpa denah PMPersada yang ada — butuh persetujuan
// pengguna).
//
// Usage: npx tsx scripts/seed-denah-pmpersada-icecontrol.ts [--tulis]
import "dotenv/config";
import { getPgPool } from "../src/lib/pg";
import { buatBak, buatKolom, denahKosong, ringkasDenah, validasiDenah, type BakElemen, type DenahDokumen } from "../src/lib/produksi-denah";
import { tataBakMeter } from "../src/lib/produksi-denah-geometri";
import { periksaTeknik } from "../src/lib/produksi-denah-teknik";
import { getDenahUntukKode, getKolomIsiIdsUntukKode, simpanDenahUntukKode } from "../src/lib/queries/produksi-denah";

const KODE = "pmpersada";
const JUMLAH_KOLOM = [37, 37, 44, 66, 66];
const BAK_BB = new Set([4, 5]);
const NOMOR_AWAL_BB = 41;
const CAN_BK = 36;
const CAN_BB = 18;
const DURASI_BEKU = { kecil: 24, besar: 32 };
const JARAK_BAK_M = 3;
const TEPI_M = 3;

// Bulatkan ke atas ke 0,5 m.
const naik = (m: number) => Math.ceil(m * 2) / 2;

function susunDenah(): DenahDokumen {
  const dok = denahKosong();
  let y = TEPI_M;
  let lebarMaks = 0;
  JUMLAH_KOLOM.forEach((n, i) => {
    const nomorBak = i + 1;
    const kolom = BAK_BB.has(nomorBak)
      ? [
          ...buatKolom(NOMOR_AWAL_BB - 1, { varian: "kecil", jumlahIceCan: CAN_BK }, 1),
          ...buatKolom(n - (NOMOR_AWAL_BB - 1), { varian: "besar", jumlahIceCan: CAN_BB }, NOMOR_AWAL_BB),
        ]
      : buatKolom(n, { varian: "kecil", jumlahIceCan: CAN_BK }, 1);
    let bak: BakElemen = buatBak(TEPI_M, y, {
      nama: `Bak ${nomorBak}`,
      varianBawaan: "kecil",
      iceCanPerKolomBawaan: CAN_BK,
      durasiBekuJam: { ...DURASI_BEKU },
      kolom,
    });
    // Perpanjang (tidak pernah memperkecil) agar deret kolom & ice can muat.
    const t = tataBakMeter(bak);
    const w = Math.max(bak.w, naik(t.butuhA + 2 * bak.tebalDindingM));
    const h = Math.max(bak.h, naik(t.butuhB + 2 * bak.tebalDindingM));
    bak = { ...bak, w, h };
    dok.elemen.push(bak);
    lebarMaks = Math.max(lebarMaks, w);
    y += h + JARAK_BAK_M;
  });
  const tinggiPerlu = y - JARAK_BAK_M + TEPI_M;
  dok.kanvas = {
    ...dok.kanvas,
    lebar: Math.max(dok.kanvas.lebar, Math.ceil(lebarMaks + 2 * TEPI_M)),
    tinggi: Math.max(dok.kanvas.tinggi, Math.ceil(tinggiPerlu)),
  };
  return dok;
}

const rp = (n: number) => n.toLocaleString("id-ID");

async function main() {
  const tulis = process.argv.includes("--tulis");
  const dok = susunDenah();

  console.log(`== Denah ${KODE} dari IceControl (${tulis ? "TULIS" : "dry-run"})`);
  console.log(`Kanvas ${dok.kanvas.lebar} x ${dok.kanvas.tinggi} m`);
  let kolBK = 0, kolBB = 0;
  for (const e of dok.elemen) {
    if (e.tipe !== "bak") continue;
    const bk = e.kolom.filter((k) => k.varian === "kecil");
    const bb = e.kolom.filter((k) => k.varian === "besar");
    kolBK += bk.length;
    kolBB += bb.length;
    const rentangBB = bb.length ? `, BB ${bb.length} (no ${bb[0].nomor}–${bb[bb.length - 1].nomor})` : "";
    console.log(
      `  ${e.nama}: ${e.kolom.length} kolom (BK ${bk.length}${rentangBB}) — posisi (${e.x}, ${e.y}) ukuran ${e.w} x ${e.h} m`
    );
  }
  const r = ringkasDenah(dok);
  console.log(`Ringkasan: ${r.jumlahBak} bak, ${r.jumlahKolom} kolom`);
  console.log(`  BK: ${kolBK} kolom (${rp(r.iceCanKecil)} can)`);
  console.log(`  BB: ${kolBB} kolom (${rp(r.iceCanBesar)} can)`);
  console.log(`  Total: ${rp(r.iceCanKecil + r.iceCanBesar)} can`);

  const galat = validasiDenah(dok);
  console.log(`Galat validasi: ${galat.length}`);
  for (const g of galat) console.log(`  - ${g.pesan}`);
  const peringatan = periksaTeknik(dok);
  console.log(`Peringatan teknik (tidak memblokir): ${peringatan.length}`);
  for (const p of peringatan) console.log(`  - ${p.pesan}`);
  if (galat.length > 0) throw new Error("Denah tidak valid — tidak disimpan.");

  if (!tulis) {
    console.log("\nDry-run selesai. Jalankan dengan --tulis untuk menyimpan (menimpa denah PMPersada).");
    return;
  }

  const isi = await getKolomIsiIdsUntukKode(KODE);
  if (isi.size > 0) throw new Error(`Ditolak: ${isi.size} kolom ${KODE} masih berisi es (isian aktif). Kosongkan dulu.`);
  const sekarang = await getDenahUntukKode(KODE);
  const versiSekarang = sekarang ? sekarang.versi : null;
  if (sekarang?.rusak) console.warn("Denah lama tercatat rusak; simpanDenahUntukKode akan menolak menimpanya.");
  const { versi } = await simpanDenahUntukKode(KODE, dok, versiSekarang, "seed-icecontrol");
  console.log(`\nDenah ${KODE} disimpan: versi ${versiSekarang ?? "(baru)"} -> ${versi}.`);
}

main()
  .then(async () => {
    await getPgPool().end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await getPgPool().end().catch(() => {});
    process.exit(1);
  });
