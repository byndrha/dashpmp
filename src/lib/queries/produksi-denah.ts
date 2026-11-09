// Denah produksi Es Balok — Postgres direktori (tabel produksi_denah &
// produksi_kolom_isi, lihat scripts/create-produksi-denah-tables.ts).
// Spec: docs/superpowers/specs/2026-10-25-produksi-es-balok-builder-denah-design.md
//
// Fungsi di sini TIDAK membaca sesi: pemanggil (server action / page) wajib
// sudah memeriksa scope perusahaan dan bolehEditDenah(). Fungsi publik
// bertipe KodeProduksi; fungsi *UntukKode menerima string bebas hanya agar
// skrip uji sekali-pakai bisa memakai kode uji (mis. 'zz-uji') tanpa
// menyentuh baris pabrik sungguhan.
import { getPgPool, pantauClient } from "@/lib/pg";
import { AppError } from "@/lib/action-result";
import {
  kolomTerkunciBerubah,
  migrasiDenah,
  PESAN_DENAH_RUSAK,
  validasiDenah,
  type DenahDokumen,
  type GalatDenah,
  type KodeGalatSimpanDenah,
  type KodeProduksi,
} from "@/lib/produksi-denah";

export type { KodeProduksi } from "@/lib/produksi-denah";

// Penolakan simpan yang TERSTRUKTUR: pesan ringkas untuk pengguna + kode
// jenis penolakan + daftar galat per elemen/kolom (builder menyorot kolom
// yang melanggar). Turunan AppError, jadi runAction tetap meneruskan pesannya.
export class GalatSimpanDenah extends AppError {
  readonly kodeGalat: KodeGalatSimpanDenah;
  readonly galat: GalatDenah[];
  constructor(message: string, kodeGalat: KodeGalatSimpanDenah, galat: GalatDenah[] = []) {
    super(message);
    this.kodeGalat = kodeGalat;
    this.galat = galat;
  }
}

export interface DenahTersimpan {
  rusak: false;
  versi: number;
  data: DenahDokumen;
  updatedAt: string;
  updatedBy: string | null;
}

/**
 * Baris denah ada tetapi isinya tidak bisa dibaca (migrasiDenah melempar).
 * Halaman menampilkan PESAN_DENAH_RUSAK tanpa detail internal; builder
 * menolak membuka editor agar data lama tidak tertimpa diam-diam.
 */
export interface DenahRusak {
  rusak: true;
  versi: number;
  updatedAt: string;
  updatedBy: string | null;
}

export const PESAN_DENAH_BASI =
  "Denah sudah diubah orang lain sejak Anda membuka builder. Muat ulang untuk melihat versi terbaru.";

const BATAS_PESAN_PELANGGARAN = 20;

// Kolom `data` bisa berisi dokumen v1 (unit grid) atau v2 (meter): selalu
// lewat migrasiDenah() sebelum dipakai. Penulisan selalu v2.
type BarisDenah = { versi: number; data: unknown; updated_at: Date; updated_by: string | null };

function keDenahTersimpan(r: BarisDenah, kode: string): DenahTersimpan | DenahRusak {
  const meta = { versi: r.versi, updatedAt: r.updated_at.toISOString(), updatedBy: r.updated_by };
  try {
    return { rusak: false, data: migrasiDenah(r.data), ...meta };
  } catch (err) {
    // Detail hanya ke log server; pengguna melihat PESAN_DENAH_RUSAK.
    console.error(`produksi_denah ${kode} versi ${r.versi} tidak bisa dibaca:`, err);
    return { rusak: true, ...meta };
  }
}

export async function getDenahUntukKode(kode: string): Promise<DenahTersimpan | DenahRusak | null> {
  const { rows } = await getPgPool().query<BarisDenah>(
    `SELECT versi, data, updated_at, updated_by FROM produksi_denah WHERE perusahaan_kode = $1`,
    [kode]
  );
  return rows[0] ? keDenahTersimpan(rows[0], kode) : null;
}

export async function getDenah(kode: KodeProduksi): Promise<DenahTersimpan | DenahRusak | null> {
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

// Kolom yang TERKUNCI di builder: ada isian aktif apa pun (termasuk Babonan)
// ATAU maintenance yang masih terbuka. Maintenance terbuka mengunci sama
// seperti isian: rek yang sedang dikerjakan tidak boleh diubah/dihapus di
// bawah operator (catatan maintenance akan yatim). Can rusak aktif juga
// mengunci (slot can bernomor 1..jumlahIceCan; mengubah kapasitas bisa
// membuat slot rusak yatim).
const SQL_KOLOM_TERKUNCI = `
  SELECT kolom_id FROM produksi_kolom_isi WHERE perusahaan_kode = $1 AND selesai_at IS NULL
  UNION
  SELECT kolom_id FROM produksi_maintenance WHERE perusahaan_kode = $1 AND selesai_at IS NULL
  UNION
  SELECT kolom_id FROM produksi_slot_rusak WHERE perusahaan_kode = $1 AND selesai_at IS NULL`;

export async function getKolomTerkunciUntukKode(kode: string): Promise<Set<string>> {
  const { rows } = await getPgPool().query<{ kolom_id: string }>(SQL_KOLOM_TERKUNCI, [kode]);
  return new Set(rows.map((r) => r.kolom_id));
}

function pesanPelanggaran(judul: string, galat: GalatDenah[]): string {
  const baris = galat.slice(0, BATAS_PESAN_PELANGGARAN).map((g) => `- ${g.pesan}`);
  if (galat.length > BATAS_PESAN_PELANGGARAN) baris.push(`- … dan ${galat.length - BATAS_PESAN_PELANGGARAN} pelanggaran lain.`);
  return `${judul}\n${baris.join("\n")}`;
}

// Satu transaksi: kunci baris denah (FOR UPDATE), cek versi, validasi aturan
// + aturan kolom berisi es (isian aktif, maintenance terbuka, can rusak) terhadap
// denah lama, lalu tulis versi+1. Baris produksi_kolom_isi &
// produksi_maintenance dibaca DI DALAM transaksi yang sama. Bila apa pun gagal
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
  if (galatValidasi.length > 0) {
    throw new GalatSimpanDenah(pesanPelanggaran("Denah belum valid:", galatValidasi), "VALIDASI", galatValidasi);
  }

  const client = await getPgPool().connect();
  const lepas = pantauClient(client, "produksi-denah");
  let rollbackGagal: Error | undefined;
  try {
    await client.query("BEGIN");
    const lama = await client.query<{ versi: number; data: unknown }>(
      `SELECT versi, data FROM produksi_denah WHERE perusahaan_kode = $1 FOR UPDATE`,
      [kode]
    );
    const barisLama = lama.rows[0] ?? null;
    if ((barisLama?.versi ?? null) !== versiDasar) throw new GalatSimpanDenah(PESAN_DENAH_BASI, "VERSI_BASI");

    // Isian aktif ∪ maintenance terbuka ∪ can rusak aktif, dibaca di transaksi yang sama.
    const isi = await client.query<{ kolom_id: string }>(SQL_KOLOM_TERKUNCI, [kode]);
    // Tetap KETAT: baris lama yang rusak menolak simpan (tidak pernah ditimpa diam-diam).
    let dataLama: DenahDokumen | null = null;
    if (barisLama) {
      try {
        dataLama = migrasiDenah(barisLama.data);
      } catch (err) {
        console.error(`produksi_denah ${kode} versi ${barisLama.versi} tidak bisa dibaca saat simpan:`, err);
        throw new AppError(`${PESAN_DENAH_RUSAK} Denah tidak disimpan agar data lama tidak tertimpa.`);
      }
    }
    const pelanggaran = kolomTerkunciBerubah(dataLama, data, new Set(isi.rows.map((r) => r.kolom_id)));
    if (pelanggaran.length > 0) {
      throw new GalatSimpanDenah(
        pesanPelanggaran("Denah tidak bisa disimpan karena mengubah kolom yang masih berisi es, sedang maintenance, atau punya can rusak:", pelanggaran),
        "KOLOM_TERKUNCI",
        pelanggaran
      );
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
      if (r.rows.length === 0) throw new GalatSimpanDenah(PESAN_DENAH_BASI, "VERSI_BASI");
      versi = r.rows[0].versi;
    }
    await client.query("COMMIT");
    return { versi };
  } catch (err) {
    await client.query("ROLLBACK").catch((e: unknown) => {
      rollbackGagal = e instanceof Error ? e : new Error(String(e));
    });
    throw err;
  } finally {
    lepas(rollbackGagal);
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
