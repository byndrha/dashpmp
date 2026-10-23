import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getCompanyPool } from "../src/lib/db-company";
import { getPgPool } from "../src/lib/pg";
import { pecahTeksKompetitor } from "../src/lib/mitra-lokasi";
import {
  bangunPetaAliasKompetitor,
  kunciAliasKompetitor as kunci,
  type EntriAliasKompetitor as EntriDisetujui,
} from "../src/lib/kompetitor-alias";

// Migrasi kompetitor Es Kristal (spec 2026-10-23-mitra-identitas-lokasi-pengiriman §10):
// teks bebas DashboardMitraCompetitor.Kompetitor → master `kompetitor` (holding "pmp",
// bisnis "es_kristal") + relasi `mitra_kompetitor` (perusahaan_kode "mkesindo", sumber "utama").
// JANGAN dijalankan sebelum pengguna meninjau & menyetujui file disetujui di bawah.
//
// ── Bentuk file docs/data-fixes/2026-10-23-kompetitor-mitra-disetujui.json ──────────────
// Larik entri; satu entri = satu kompetitor di master:
//   [
//     { "nama": "Atlas", "alias": ["Es atlas", "ATLAS"], "mitra": [ … ] },
//     { "nama": "Belum ada kompetitor", "abaikan": true, "alias": ["Tidak ada kompetitor"] },
//     …
//   ]
//   - nama    : ejaan resmi yang disimpan ke master `kompetitor`.
//   - alias   : (opsional) ejaan lain yang disatukan ke nama ini.
//   - abaikan : (opsional) true = potongan teks yang cocok sengaja TIDAK dimigrasi
//               (mis. "Belum ada kompetitor"); entri ini tidak membuat baris master.
//   - mitra   : hanya informasi dari dry-run; DIABAIKAN oleh skrip ini.
// Cara menyatukan ejaan: pindahkan nama entri yang ingin dilebur ke `alias` entri tujuan,
// lalu hapus entri lamanya. Pencocokan tanpa beda huruf besar-kecil & spasi berlebih.
// Satu ejaan tidak boleh muncul di dua entri (skrip berhenti bila ada).
// ─────────────────────────────────────────────────────────────────────────────────────
//
// Aturan:
//   - Teks dibaca ULANG dari DB live (mitra IsDeleted = 0, teks tidak kosong), dipecah dengan
//     pecahTeksKompetitor(). Bila ada potongan yang tidak cocok dengan nama/alias mana pun →
//     BERHENTI sebelum menulis apa pun.
//   - Master: INSERT … ON CONFLICT DO NOTHING (unik holding+lower(trim(nama))+bisnis); nama
//     yang sudah ada dipakai ulang dan TIDAK dicatat sebagai "dibuat" (revert tidak menyentuhnya).
//   - Relasi: GABUNGAN (union) — hanya menambah pasangan yang belum ada (ON CONFLICT DO NOTHING).
//     Kompetitor yang sudah dipilih pengguna lewat form baru (Task 6) tidak dihapus.
//   - Setiap id yang benar-benar dibuat ditambahkan ke …-posted.json (digabung dengan isi lama,
//     jadi menjalankan ulang aman dan revert tetap mencakup semuanya).
//   - DashboardMitraCompetitor tidak disentuh.
//   - Semua tulisan Postgres dalam satu transaksi.
//
// Default DRY RUN; --execute untuk menulis. Revert: revert-kompetitor-mitra-2026-10-23.ts
// Usage: npx tsx scripts/fix-kompetitor-mitra-2026-10-23.ts [--execute]

const EXECUTE = process.argv.includes("--execute");
const HOLDING = "pmp";
const BISNIS = "es_kristal";
const KODE = "mkesindo";
const SUMBER = "utama";
const CREATED_BY = "migrasi-2026-10-23";
const DIR = path.join(__dirname, "..", "docs", "data-fixes");
const DISETUJUI = path.join(DIR, "2026-10-23-kompetitor-mitra-disetujui.json");
const POSTED = path.join(DIR, "2026-10-23-kompetitor-mitra-posted.json");

interface RelasiPosted { perusahaanKode: string; sumber: string; partnerId: string; kompetitorId: number }
interface Posted {
  holdingKode: string; bisnis: string; createdBy: string;
  kompetitorDibuat: { id: number; nama: string }[];
  mitraKompetitor: RelasiPosted[];
  run: { waktu: string; kompetitorDibuat: number; relasiDibuat: number }[];
}

function bacaDisetujui(): { peta: Map<string, EntriDisetujui>; galat: string[] } {
  const isi = JSON.parse(fs.readFileSync(DISETUJUI, "utf8")) as unknown;
  if (!Array.isArray(isi)) throw new Error("File disetujui harus berupa larik entri { nama, alias?, abaikan? }.");
  // Validasi & pemetaan ejaan bersama src/lib/kompetitor-alias.ts.
  return bangunPetaAliasKompetitor(isi as EntriDisetujui[]);
}

async function main() {
  const { peta, galat } = bacaDisetujui();
  if (galat.length > 0) { console.error("ABORT: file disetujui tidak valid:\n  " + galat.join("\n  ")); process.exit(1); }

  const pool = await getCompanyPool(KODE, SUMBER);
  const ident = (await pool.request().query(`SELECT DB_NAME() AS d`)).recordset[0] as { d: string };
  console.log("DB:", ident.d, EXECUTE ? "(EXECUTE)" : "(DRY RUN)");
  if (ident.d !== "MKEsindo") throw new Error(`DB bukan MKEsindo: ${ident.d}`);

  const rows = (await pool.request().query(`
    SELECT bp.BusinessPartnerID AS bpId, mc.Kompetitor AS teks
    FROM DashboardMitraCompetitor mc
    JOIN BusinessPartner bp ON bp.BusinessPartnerID = mc.BusinessPartnerID
    WHERE ISNULL(bp.IsDeleted, 0) = 0
      AND mc.Kompetitor IS NOT NULL AND LTRIM(RTRIM(mc.Kompetitor)) <> ''
    ORDER BY bp.BusinessPartnerID`)).recordset as { bpId: string; teks: string }[];
  await pool.close();

  // Petakan setiap potongan ke entri disetujui.
  const tidakCocok: string[] = [];
  const rencana: { bpId: string; nama: string[] }[] = [];
  const tanpaKompetitor: string[] = [];
  for (const r of rows) {
    const nama = new Set<string>();
    for (const potongan of pecahTeksKompetitor(r.teks)) {
      const e = peta.get(kunci(potongan));
      if (!e) { tidakCocok.push(`${r.bpId}: "${potongan}"`); continue; }
      if (!e.abaikan) nama.add(e.nama);
    }
    if (nama.size === 0) tanpaKompetitor.push(r.bpId);
    else rencana.push({ bpId: r.bpId, nama: [...nama] });
  }
  if (tidakCocok.length > 0) {
    console.error(`ABORT: ${tidakCocok.length} potongan tidak cocok dengan nama/alias mana pun di file disetujui:\n  ` + tidakCocok.join("\n  "));
    await getPgPool().end(); process.exit(1);
  }
  const namaDipakai = [...new Set(rencana.flatMap((m) => m.nama))].sort((a, b) => a.localeCompare(b, "id"));
  const totalRelasi = rencana.reduce((s, m) => s + m.nama.length, 0);
  console.log(`Mitra berteks: ${rows.length} | dapat ≥1 kompetitor: ${rencana.length} | semua potongan diabaikan: ${tanpaKompetitor.length}`);
  if (tanpaKompetitor.length > 0) console.log("  Tanpa kompetitor (diabaikan):", tanpaKompetitor.join(", "));
  console.log(`Nama master yang dipakai: ${namaDipakai.length} | pasangan mitra-kompetitor: ${totalRelasi}`);
  for (const n of namaDipakai) console.log(`  ${n}`);

  if (!EXECUTE) { console.log("DRY RUN selesai. Untuk menulis: --execute"); await getPgPool().end(); return; }

  const client = await getPgPool().connect();
  const dibuat: { id: number; nama: string }[] = [];
  const relasiDibuat: RelasiPosted[] = [];
  try {
    await client.query("BEGIN");
    const idPerNama = new Map<string, number>();
    for (const nama of namaDipakai) {
      const ins = await client.query<{ id: number; nama: string }>(
        `INSERT INTO kompetitor (holding_kode, nama, bisnis, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (holding_kode, (lower(trim(nama))), bisnis) DO NOTHING
         RETURNING id, nama`,
        [HOLDING, nama, BISNIS, CREATED_BY]
      );
      if (ins.rows[0]) { dibuat.push(ins.rows[0]); idPerNama.set(nama, ins.rows[0].id); continue; }
      const ada = await client.query<{ id: number }>(
        `SELECT id FROM kompetitor WHERE holding_kode = $1 AND bisnis = $2 AND lower(trim(nama)) = lower(trim($3))`,
        [HOLDING, BISNIS, nama]
      );
      if (!ada.rows[0]) throw new Error(`konflik unik tetapi kompetitor "${nama}" tidak ditemukan`);
      idPerNama.set(nama, ada.rows[0].id);
    }
    for (const m of rencana) {
      for (const nama of m.nama) {
        const kompetitorId = idPerNama.get(nama)!;
        const ins = await client.query(
          `INSERT INTO mitra_kompetitor (perusahaan_kode, sumber, partner_id, kompetitor_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING
           RETURNING kompetitor_id`,
          [KODE, SUMBER, m.bpId, kompetitorId]
        );
        if (ins.rowCount) relasiDibuat.push({ perusahaanKode: KODE, sumber: SUMBER, partnerId: m.bpId, kompetitorId });
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("GAGAL (rollback):", e);
    client.release(); await getPgPool().end(); process.exit(1);
  }
  client.release();

  // Gabungkan dengan posted lama supaya revert mencakup semua run.
  const lama: Posted | null = fs.existsSync(POSTED) ? (JSON.parse(fs.readFileSync(POSTED, "utf8")) as Posted) : null;
  const posted: Posted = {
    holdingKode: HOLDING, bisnis: BISNIS, createdBy: CREATED_BY,
    kompetitorDibuat: [...(lama?.kompetitorDibuat ?? []), ...dibuat],
    mitraKompetitor: [...(lama?.mitraKompetitor ?? []), ...relasiDibuat],
    run: [...(lama?.run ?? []), { waktu: new Date().toISOString(), kompetitorDibuat: dibuat.length, relasiDibuat: relasiDibuat.length }],
  };
  fs.writeFileSync(POSTED, JSON.stringify(posted, null, 2) + "\n");
  console.log(`Selesai. Kompetitor dibuat: ${dibuat.length} | relasi dibuat: ${relasiDibuat.length}`);
  console.log("Posted ditulis:", POSTED);

  const cek = await getPgPool().query<{ n: string }>(
    `SELECT COUNT(DISTINCT partner_id) AS n FROM mitra_kompetitor WHERE perusahaan_kode = $1 AND sumber = $2`,
    [KODE, SUMBER]
  );
  console.log(`Verifikasi: mitra ber-≥1 kompetitor sekarang ${cek.rows[0].n} (harapan ≥ ${rencana.length})`);
  await getPgPool().end();
}

main().catch((e) => { console.error(e); process.exit(1); });
