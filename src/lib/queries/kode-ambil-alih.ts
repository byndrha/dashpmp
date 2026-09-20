import { getPgPool } from "@/lib/pg";

export interface KodeAmbilAlihAktif {
  kode: string;
  kedaluwarsaPada: string;
}

// Kode 6-digit acak, berlaku 3 menit. Generate baru otomatis "mengalahkan"
// kode lama yang belum terpakai -- bukan lewat kolom status terpisah,
// tapi karena verifikasi (lihat verifikasiDanPakaiKodeAmbilAlih di bawah)
// hanya pernah membandingkan ke baris PALING BARU dibuat.
export async function generateKodeAmbilAlih(dibuatOlehAkunId: number): Promise<KodeAmbilAlihAktif> {
  const pool = getPgPool();
  const kode = String(Math.floor(100000 + Math.random() * 900000));
  const result = await pool.query(
    `INSERT INTO kode_ambil_alih (kode, dibuat_oleh_akun_id, kedaluwarsa_pada)
     VALUES ($1, $2, now() + interval '3 minutes')
     RETURNING kode, kedaluwarsa_pada`,
    [kode, dibuatOlehAkunId]
  );
  const row = result.rows[0] as { kode: string; kedaluwarsa_pada: Date };
  return { kode: row.kode, kedaluwarsaPada: row.kedaluwarsa_pada.toISOString() };
}

// Kode aktif SEKARANG (baris paling baru, belum dipakai, belum kedaluwarsa)
// -- untuk ditampilkan ulang tanpa perlu password lagi kalau dialog dibuka
// ulang sebelum kode itu dipakai/kedaluwarsa.
export async function getKodeAmbilAlihAktif(): Promise<KodeAmbilAlihAktif | null> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT kode, kedaluwarsa_pada, dipakai_pada FROM kode_ambil_alih ORDER BY dibuat_pada DESC LIMIT 1`
  );
  const row = result.rows[0] as { kode: string; kedaluwarsa_pada: Date; dipakai_pada: Date | null } | undefined;
  if (!row) return null;
  if (row.dipakai_pada != null) return null;
  if (row.kedaluwarsa_pada.getTime() < Date.now()) return null;
  return { kode: row.kode, kedaluwarsaPada: row.kedaluwarsa_pada.toISOString() };
}

export interface RiwayatKodeAmbilAlihRow {
  id: number;
  kode: string;
  dibuatOlehAkunId: number;
  dibuatPada: string;
  kedaluwarsaPada: string;
  dipakaiPada: string | null;
  dipakaiOlehAkunId: number | null;
  dipakaiUntukJadwalId: number | null;
  dipakaiUntukAksi: string | null;
}

export async function getRiwayatKodeAmbilAlih(limit = 20): Promise<RiwayatKodeAmbilAlihRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT id, kode, dibuat_oleh_akun_id, dibuat_pada, kedaluwarsa_pada, dipakai_pada, dipakai_oleh_akun_id,
            dipakai_untuk_jadwal_id, dipakai_untuk_aksi
     FROM kode_ambil_alih ORDER BY dibuat_pada DESC LIMIT $1`,
    [limit]
  );
  return result.rows.map(
    (row: {
      id: number;
      kode: string;
      dibuat_oleh_akun_id: number;
      dibuat_pada: Date;
      kedaluwarsa_pada: Date;
      dipakai_pada: Date | null;
      dipakai_oleh_akun_id: number | null;
      dipakai_untuk_jadwal_id: number | null;
      dipakai_untuk_aksi: string | null;
    }) => ({
      id: row.id,
      kode: row.kode,
      dibuatOlehAkunId: row.dibuat_oleh_akun_id,
      dibuatPada: row.dibuat_pada.toISOString(),
      kedaluwarsaPada: row.kedaluwarsa_pada.toISOString(),
      dipakaiPada: row.dipakai_pada ? row.dipakai_pada.toISOString() : null,
      dipakaiOlehAkunId: row.dipakai_oleh_akun_id,
      dipakaiUntukJadwalId: row.dipakai_untuk_jadwal_id,
      dipakaiUntukAksi: row.dipakai_untuk_aksi,
    })
  );
}
