import { getPgPool } from "@/lib/pg";

export interface JabatanRow {
  id: number;
  kode: string;
  nama: string;
}

export interface AspekKinerjaRow {
  id: number;
  jabatanId: number;
  kode: string;
  nama: string;
  satuan: string;
}

export async function getJabatanByPeranId(peranId: number): Promise<JabatanRow | null> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT j.id, j.kode, j.nama
     FROM jabatan j
     JOIN jabatan_peran_map m ON m.jabatan_id = j.id
     WHERE m.peran_id = $1
     LIMIT 1`,
    [peranId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as { id: number; kode: string; nama: string };
  return { id: row.id, kode: row.kode, nama: row.nama };
}

export async function getAspekKinerjaList(jabatanId: number): Promise<AspekKinerjaRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT id, jabatan_id, kode, nama, satuan FROM aspek_kinerja WHERE jabatan_id = $1 ORDER BY id`,
    [jabatanId]
  );
  return (result.rows as { id: number; jabatan_id: number; kode: string; nama: string; satuan: string }[]).map((r) => ({
    id: r.id,
    jabatanId: r.jabatan_id,
    kode: r.kode,
    nama: r.nama,
    satuan: r.satuan,
  }));
}
