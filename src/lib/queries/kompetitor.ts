// Master kompetitor per holding + relasi mitra↔kompetitor — Postgres direktori.
// Spec: docs/superpowers/specs/2026-10-23-mitra-identitas-lokasi-pengiriman-design.md §6.3.
//
// SENGAJA tidak ada fungsi hapus master kompetitor: FK mitra_kompetitor
// ON DELETE CASCADE akan diam-diam melepas kompetitor dari semua mitra.
import { getPgPool } from "@/lib/pg";
import { AppError } from "@/lib/action-result";
import type { IdentitasKunci } from "@/lib/queries/mitra-identitas";

export type BisnisKompetitor = "es_kristal" | "es_balok";

export interface Kompetitor {
  id: number;
  nama: string;
}

export async function listKompetitor(holdingKode: string, bisnis: BisnisKompetitor): Promise<Kompetitor[]> {
  const { rows } = await getPgPool().query<Kompetitor>(
    `SELECT id, nama FROM kompetitor WHERE holding_kode = $1 AND bisnis = $2 ORDER BY lower(nama), id`,
    [holdingKode, bisnis]
  );
  return rows;
}

/** Nama yang sudah ada (tanpa beda huruf besar-kecil/spasi tepi) → kembalikan yang ada. */
export async function tambahKompetitor(
  holdingKode: string,
  bisnis: BisnisKompetitor,
  nama: string,
  userId: string
): Promise<Kompetitor> {
  const bersih = nama.trim().replace(/\s+/g, " ");
  if (!bersih) throw new AppError("Nama kompetitor wajib diisi.");
  if (bersih.length > 128) throw new AppError("Nama kompetitor terlalu panjang (maks. 128 karakter).");
  const pg = getPgPool();
  const ins = await pg.query<Kompetitor>(
    `INSERT INTO kompetitor (holding_kode, nama, bisnis, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (holding_kode, (lower(trim(nama))), bisnis) DO NOTHING
     RETURNING id, nama`,
    [holdingKode, bersih, bisnis, userId]
  );
  if (ins.rows[0]) return ins.rows[0];
  const ada = await pg.query<Kompetitor>(
    `SELECT id, nama FROM kompetitor
     WHERE holding_kode = $1 AND bisnis = $2 AND lower(trim(nama)) = lower(trim($3))`,
    [holdingKode, bisnis, bersih]
  );
  if (!ada.rows[0]) throw new Error("tambahKompetitor: konflik unik tetapi baris tidak ditemukan");
  return ada.rows[0];
}

/** partner_id → daftar kompetitor (urut nama). */
export async function getKompetitorMitraMap(
  perusahaanKode: string,
  sumber: "utama" | "logistik"
): Promise<Map<string, Kompetitor[]>> {
  const { rows } = await getPgPool().query<{ partner_id: string; id: number; nama: string }>(
    `SELECT mk.partner_id, k.id, k.nama
     FROM mitra_kompetitor mk
     JOIN kompetitor k ON k.id = mk.kompetitor_id
     WHERE mk.perusahaan_kode = $1 AND mk.sumber = $2
     ORDER BY mk.partner_id, lower(k.nama), k.id`,
    [perusahaanKode, sumber]
  );
  const hasil = new Map<string, Kompetitor[]>();
  for (const r of rows) {
    const daftar = hasil.get(r.partner_id) ?? [];
    daftar.push({ id: r.id, nama: r.nama });
    hasil.set(r.partner_id, daftar);
  }
  return hasil;
}

/** ID kompetitor yang saat ini terpasang pada satu mitra. */
export async function getKompetitorIdsMitra(k: IdentitasKunci): Promise<number[]> {
  const { rows } = await getPgPool().query<{ kompetitor_id: number }>(
    `SELECT kompetitor_id FROM mitra_kompetitor WHERE perusahaan_kode = $1 AND sumber = $2 AND partner_id = $3`,
    [k.perusahaanKode, k.sumber, k.partnerId]
  );
  return rows.map((r) => Number(r.kompetitor_id));
}

/**
 * Ganti seluruh set kompetitor mitra. Pemanggil bertanggung jawab memastikan
 * ID berasal dari listKompetitor() holding & bisnis yang sama.
 */
export async function setKompetitorMitra(k: IdentitasKunci, kompetitorIds: number[]): Promise<void> {
  const ids = [...new Set(kompetitorIds)];
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new AppError("Daftar kompetitor tidak valid.");
  const client = await getPgPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM mitra_kompetitor WHERE perusahaan_kode = $1 AND sumber = $2 AND partner_id = $3`,
      [k.perusahaanKode, k.sumber, k.partnerId]
    );
    if (ids.length > 0) {
      await client.query(
        `INSERT INTO mitra_kompetitor (perusahaan_kode, sumber, partner_id, kompetitor_id)
         SELECT $1, $2, $3, unnest($4::int[])`,
        [k.perusahaanKode, k.sumber, k.partnerId, ids]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
