// One-off seed for MKEsindo's initial metode_pembayaran rows.
// Safe to re-run — upsertMetodePembayaran creates by kode if it doesn't
// already exist for this perusahaan_id (no explicit `id`, so INSERT path).
// Usage: npx tsx scripts/seed-metode-pembayaran-mkesindo.ts
import "dotenv/config";
import { getPgPool } from "../src/lib/pg";
import { upsertMetodePembayaran, listMetodePembayaran, type Konteks } from "../src/lib/queries/metode-pembayaran";

async function main() {
  const pool = getPgPool();
  const perusahaan = await pool.query<{ id: number }>(`SELECT id FROM perusahaan WHERE kode = 'mkesindo'`);
  const perusahaanId = perusahaan.rows[0]?.id;
  if (!perusahaanId) throw new Error("perusahaan kode='mkesindo' tidak ditemukan.");

  const existing = await listMetodePembayaran(perusahaanId);
  const existingKodes = new Set(existing.map((r) => r.kode));

  const seeds: {
    kode: string;
    metode: "TUNAI" | "QRIS" | "TRANSFER";
    jenis: "manual" | "qris_static" | "qris_dinamis";
    coaId: string;
    konteks: Konteks[];
    wajibCatatan: boolean;
  }[] = [
    { kode: "tunai-kecil", metode: "TUNAI", jenis: "manual", coaId: "014", konteks: ["driver", "kasir"], wajibCatatan: false },
    { kode: "tunai-besar", metode: "TUNAI", jenis: "manual", coaId: "013", konteks: ["kasir"], wajibCatatan: false },
    { kode: "transfer", metode: "TRANSFER", jenis: "manual", coaId: "01000096", konteks: ["driver", "kasir"], wajibCatatan: true },
    { kode: "qris-statis", metode: "QRIS", jenis: "qris_static", coaId: "01000096", konteks: ["driver", "kasir", "publik"], wajibCatatan: true },
    { kode: "qris-dinamis", metode: "QRIS", jenis: "qris_dinamis", coaId: "01000096", konteks: ["driver", "kasir", "publik"], wajibCatatan: false },
  ];

  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    if (existingKodes.has(s.kode)) {
      console.log(`skip (already exists): ${s.kode}`);
      continue;
    }
    // qris-dinamis starts inactive — MKEsindo has no Snap BI credentials yet
    // (upsertMetodePembayaran would reject isActive:true here anyway).
    const isActive = s.jenis !== "qris_dinamis";
    await upsertMetodePembayaran({
      perusahaanId,
      ...s,
      catatan: null,
      urutan: i,
      isActive,
      bankNama: null,
      nomorRekening: null,
      atasNama: null,
    });
    console.log(`seeded: ${s.kode}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
