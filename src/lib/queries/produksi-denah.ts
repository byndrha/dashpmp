// Denah produksi Es Balok — Postgres direktori (tabel produksi_denah &
// produksi_kolom_isi, lihat scripts/create-produksi-denah-tables.ts).
// Spec: docs/superpowers/specs/2026-10-25-produksi-es-balok-builder-denah-design.md
//
// Fungsi di sini TIDAK membaca sesi: pemanggil (server action / page) wajib
// sudah memeriksa scope perusahaan dan bolehEditDenah(). Fungsi publik
// bertipe KodeProduksi; fungsi *UntukKode menerima string bebas hanya agar
// skrip uji sekali-pakai bisa memakai kode uji (mis. 'zz-uji') tanpa
// menyentuh baris pabrik sungguhan.
import { getPgPool } from "@/lib/pg";
import { AppError } from "@/lib/action-result";
import { kolomTerkunciBerubah, validasiDenah, type DenahDokumen, type GalatDenah } from "@/lib/produksi-denah";

export type KodeProduksi = "pmpersada" | "pmpakis";

export interface DenahTersimpan {
  versi: number;
  data: DenahDokumen;
  updatedAt: string;
  updatedBy: string | null;
}

export const PESAN_DENAH_BASI =
  "Denah sudah diubah orang lain sejak Anda membuka builder. Muat ulang untuk melihat versi terbaru.";

const BATAS_PESAN_PELANGGARAN = 20;

type BarisDenah = { versi: number; data: DenahDokumen; updated_at: Date; updated_by: string | null };

function keDenahTersimpan(r: BarisDenah): DenahTersimpan {
  return { versi: r.versi, data: r.data, updatedAt: r.updated_at.toISOString(), updatedBy: r.updated_by };
}

export async function getDenahUntukKode(kode: string): Promise<DenahTersimpan | null> {
  const { rows } = await getPgPool().query<BarisDenah>(
    `SELECT versi, data, updated_at, updated_by FROM produksi_denah WHERE perusahaan_kode = $1`,
    [kode]
  );
  return rows[0] ? keDenahTersimpan(rows[0]) : null;
}

export async function getDenah(kode: KodeProduksi): Promise<DenahTersimpan | null> {
  return getDenahUntukKode(kode);
}

export async function getKolomIsiIdsUntukKode(kode: string): Promise<Set<string>> {
  const { rows } = await getPgPool().query<{ kolom_id: string }>(
    `SELECT DISTINCT kolom_id FROM produksi_kolom_isi WHERE perusahaan_kode = $1 AND selesai_at IS NULL`,
    [kode]
  );
  return new Set(rows.map((r) => r.kolom_id));
}

export async function getKolomIsiIds(kode: KodeProduksi): Promise<Set<string>> {
  return getKolomIsiIdsUntukKode(kode);
}

function pesanPelanggaran(judul: string, galat: GalatDenah[]): string {
  const baris = galat.slice(0, BATAS_PESAN_PELANGGARAN).map((g) => `- ${g.pesan}`);
  if (galat.length > BATAS_PESAN_PELANGGARAN) baris.push(`- … dan ${galat.length - BATAS_PESAN_PELANGGARAN} pelanggaran lain.`);
  return `${judul}\n${baris.join("\n")}`;
}

// Satu transaksi: kunci baris denah (FOR UPDATE), cek versi, validasi aturan
// + aturan kolom berisi es terhadap denah lama, lalu tulis versi+1. Baris
// produksi_kolom_isi dibaca DI DALAM transaksi yang sama. Bila apa pun gagal
// -> ROLLBACK, denah lama tetap utuh.
//
// Catatan: untuk denah yang belum pernah disimpan (versiDasar null) tidak ada
// baris yang bisa dikunci; dua penyimpanan pertama bersamaan dijaga oleh
// PRIMARY KEY (INSERT ... ON CONFLICT DO NOTHING -> 0 baris = basi).
export async function simpanDenahUntukKode(
  kode: string,
  data: DenahDokumen,
  versiDasar: number | null,
  userId: string
): Promise<{ versi: number }> {
  const galatValidasi = validasiDenah(data);
  if (galatValidasi.length > 0) throw new AppError(pesanPelanggaran("Denah belum valid:", galatValidasi));

  const client = await getPgPool().connect();
  try {
    await client.query("BEGIN");
    const lama = await client.query<{ versi: number; data: DenahDokumen }>(
      `SELECT versi, data FROM produksi_denah WHERE perusahaan_kode = $1 FOR UPDATE`,
      [kode]
    );
    const barisLama = lama.rows[0] ?? null;
    if ((barisLama?.versi ?? null) !== versiDasar) throw new AppError(PESAN_DENAH_BASI);

    const isi = await client.query<{ kolom_id: string }>(
      `SELECT DISTINCT kolom_id FROM produksi_kolom_isi WHERE perusahaan_kode = $1 AND selesai_at IS NULL`,
      [kode]
    );
    const pelanggaran = kolomTerkunciBerubah(barisLama?.data ?? null, data, new Set(isi.rows.map((r) => r.kolom_id)));
    if (pelanggaran.length > 0) {
      throw new AppError(pesanPelanggaran("Denah tidak bisa disimpan karena mengubah kolom yang masih berisi es:", pelanggaran));
    }

    let versi: number;
    if (barisLama) {
      const r = await client.query<{ versi: number }>(
        `UPDATE produksi_denah SET versi = versi + 1, data = $2::jsonb, updated_by = $3, updated_at = now()
         WHERE perusahaan_kode = $1 RETURNING versi`,
        [kode, JSON.stringify(data), userId]
      );
      versi = r.rows[0].versi;
    } else {
      const r = await client.query<{ versi: number }>(
        `INSERT INTO produksi_denah (perusahaan_kode, versi, data, updated_by, updated_at)
         VALUES ($1, 1, $2::jsonb, $3, now())
         ON CONFLICT (perusahaan_kode) DO NOTHING RETURNING versi`,
        [kode, JSON.stringify(data), userId]
      );
      if (r.rows.length === 0) throw new AppError(PESAN_DENAH_BASI);
      versi = r.rows[0].versi;
    }
    await client.query("COMMIT");
    return { versi };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function simpanDenah(
  kode: KodeProduksi,
  data: DenahDokumen,
  versiDasar: number | null,
  userId: string
): Promise<{ versi: number }> {
  return simpanDenahUntukKode(kode, data, versiDasar, userId);
}
