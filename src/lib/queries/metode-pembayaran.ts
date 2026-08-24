import { getPgPool } from "@/lib/pg";
import { encryptSecret, decryptSecret } from "@/lib/crypto-secret";
import { AppError } from "@/lib/action-result";

export type Konteks = "driver" | "kasir" | "publik";

export interface MetodePembayaranRow {
  id: number;
  perusahaanId: number;
  kode: string;
  metode: "TUNAI" | "QRIS" | "TRANSFER";
  jenis: "manual" | "qris_static" | "qris_dinamis";
  coaId: string;
  konteks: Konteks[];
  wajibCatatan: boolean;
  catatan: string | null;
  qrisStatisImagePath: string | null;
  // Only meaningful when metode === "TRANSFER" — null for TUNAI/QRIS rows.
  bankNama: string | null;
  nomorRekening: string | null;
  atasNama: string | null;
  urutan: number;
  isActive: boolean;
}

interface MetodePembayaranDbRow {
  id: number;
  perusahaan_id: number;
  kode: string;
  metode: string;
  jenis: string;
  coa_id: string;
  konteks: string[];
  wajib_catatan: boolean;
  catatan: string | null;
  qris_statis_image_path: string | null;
  bank_nama: string | null;
  nomor_rekening: string | null;
  atas_nama: string | null;
  urutan: number;
  is_active: boolean;
}

function mapRow(r: MetodePembayaranDbRow): MetodePembayaranRow {
  return {
    id: r.id,
    perusahaanId: r.perusahaan_id,
    kode: r.kode,
    metode: r.metode as MetodePembayaranRow["metode"],
    jenis: r.jenis as MetodePembayaranRow["jenis"],
    coaId: r.coa_id,
    konteks: r.konteks as Konteks[],
    wajibCatatan: r.wajib_catatan,
    catatan: r.catatan,
    qrisStatisImagePath: r.qris_statis_image_path,
    bankNama: r.bank_nama,
    nomorRekening: r.nomor_rekening,
    atasNama: r.atas_nama,
    urutan: r.urutan,
    isActive: r.is_active,
  };
}

const SELECT_COLUMNS = `id, perusahaan_id, kode, metode, jenis, coa_id, konteks, wajib_catatan, catatan, qris_statis_image_path, bank_nama, nomor_rekening, atas_nama, urutan, is_active`;

export async function listMetodePembayaran(perusahaanId: number): Promise<MetodePembayaranRow[]> {
  const pool = getPgPool();
  const result = await pool.query<MetodePembayaranDbRow>(
    `SELECT ${SELECT_COLUMNS} FROM metode_pembayaran WHERE perusahaan_id = $1 ORDER BY urutan, kode`,
    [perusahaanId]
  );
  return result.rows.map(mapRow);
}

// Active rows for one surface — QrPaymentPanel's only read path. `= ANY`
// against a text[] column is Postgres's "array contains this element" test.
export async function listActiveMetodePembayaran(perusahaanId: number, konteks: Konteks): Promise<MetodePembayaranRow[]> {
  const pool = getPgPool();
  const result = await pool.query<MetodePembayaranDbRow>(
    `SELECT ${SELECT_COLUMNS} FROM metode_pembayaran
     WHERE perusahaan_id = $1 AND is_active AND $2 = ANY(konteks)
     ORDER BY urutan, kode`,
    [perusahaanId, konteks]
  );
  return result.rows.map(mapRow);
}

export async function getMetodePembayaranByKode(perusahaanId: number, kode: string): Promise<MetodePembayaranRow | null> {
  const pool = getPgPool();
  const result = await pool.query<MetodePembayaranDbRow>(
    `SELECT ${SELECT_COLUMNS} FROM metode_pembayaran WHERE perusahaan_id = $1 AND kode = $2`,
    [perusahaanId, kode]
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

// Joins in perusahaan.kode — uploadFile() (Google Drive storage) is keyed by
// that human-readable code, not the numeric perusahaan_id this table itself
// uses, so the QRIS-image upload action (Task 8) needs both from one lookup.
export async function getMetodePembayaranById(id: number): Promise<(MetodePembayaranRow & { perusahaanKode: string }) | null> {
  const pool = getPgPool();
  const result = await pool.query<MetodePembayaranDbRow & { perusahaan_kode: string }>(
    `SELECT mp.id, mp.perusahaan_id, mp.kode, mp.metode, mp.jenis, mp.coa_id, mp.konteks, mp.wajib_catatan,
            mp.catatan, mp.qris_statis_image_path, mp.bank_nama, mp.nomor_rekening, mp.atas_nama,
            mp.urutan, mp.is_active, p.kode AS perusahaan_kode
     FROM metode_pembayaran mp
     JOIN perusahaan p ON p.id = mp.perusahaan_id
     WHERE mp.id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...mapRow(row), perusahaanKode: row.perusahaan_kode };
}

export async function hasSnapBiKredensial(perusahaanId: number): Promise<boolean> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT 1 FROM metode_pembayaran_snap_bi_kredensial WHERE perusahaan_id = $1`, [perusahaanId]);
  return result.rowCount! > 0;
}

export interface UpsertMetodePembayaranInput {
  id?: number;
  perusahaanId: number;
  kode: string;
  metode: MetodePembayaranRow["metode"];
  jenis: MetodePembayaranRow["jenis"];
  coaId: string;
  konteks: Konteks[];
  wajibCatatan: boolean;
  catatan: string | null;
  bankNama: string | null;
  nomorRekening: string | null;
  atasNama: string | null;
  urutan: number;
  isActive: boolean;
}

export async function upsertMetodePembayaran(input: UpsertMetodePembayaranInput): Promise<number> {
  if (input.jenis === "qris_dinamis" && input.isActive) {
    const hasCreds = await hasSnapBiKredensial(input.perusahaanId);
    if (!hasCreds) {
      throw new AppError("QRIS Dinamis tidak bisa diaktifkan sebelum kredensial Snap BI PT ini diisi lengkap.");
    }
  }

  const pool = getPgPool();
  if (input.id) {
    await pool.query(
      `UPDATE metode_pembayaran SET
         kode = $1, metode = $2, jenis = $3, coa_id = $4, konteks = $5,
         wajib_catatan = $6, catatan = $7, bank_nama = $8, nomor_rekening = $9, atas_nama = $10,
         urutan = $11, is_active = $12, updated_at = now()
       WHERE id = $13 AND perusahaan_id = $14`,
      [
        input.kode, input.metode, input.jenis, input.coaId, input.konteks,
        input.wajibCatatan, input.catatan, input.bankNama, input.nomorRekening, input.atasNama,
        input.urutan, input.isActive, input.id, input.perusahaanId,
      ]
    );
    return input.id;
  }

  const result = await pool.query<{ id: number }>(
    `INSERT INTO metode_pembayaran
       (perusahaan_id, kode, metode, jenis, coa_id, konteks, wajib_catatan, catatan, bank_nama, nomor_rekening, atas_nama, urutan, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      input.perusahaanId, input.kode, input.metode, input.jenis, input.coaId, input.konteks,
      input.wajibCatatan, input.catatan, input.bankNama, input.nomorRekening, input.atasNama,
      input.urutan, input.isActive,
    ]
  );
  return result.rows[0].id;
}

export async function setQrisStatisImagePath(id: number, path: string): Promise<void> {
  const pool = getPgPool();
  await pool.query(`UPDATE metode_pembayaran SET qris_statis_image_path = $1, updated_at = now() WHERE id = $2`, [path, id]);
}

export interface SnapBiKredensial {
  clientId: string;
  merchantId: string;
  partnerId: string;
}

export async function getSnapBiKredensial(perusahaanId: number): Promise<(SnapBiKredensial & { clientSecret: string }) | null> {
  const pool = getPgPool();
  const result = await pool.query<{ client_id: string; client_secret_encrypted: string; merchant_id: string; partner_id: string }>(
    `SELECT client_id, client_secret_encrypted, merchant_id, partner_id FROM metode_pembayaran_snap_bi_kredensial WHERE perusahaan_id = $1`,
    [perusahaanId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    clientId: row.client_id,
    clientSecret: decryptSecret(row.client_secret_encrypted),
    merchantId: row.merchant_id,
    partnerId: row.partner_id,
  };
}

export interface UpsertSnapBiKredensialInput {
  perusahaanId: number;
  clientId: string;
  clientSecret: string;
  merchantId: string;
  partnerId: string;
}

export async function upsertSnapBiKredensial(input: UpsertSnapBiKredensialInput): Promise<void> {
  const pool = getPgPool();
  const encrypted = encryptSecret(input.clientSecret);
  await pool.query(
    `INSERT INTO metode_pembayaran_snap_bi_kredensial (perusahaan_id, client_id, client_secret_encrypted, merchant_id, partner_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (perusahaan_id) DO UPDATE
     SET client_id = EXCLUDED.client_id, client_secret_encrypted = EXCLUDED.client_secret_encrypted,
         merchant_id = EXCLUDED.merchant_id, partner_id = EXCLUDED.partner_id, updated_at = now()`,
    [input.perusahaanId, input.clientId, encrypted, input.merchantId, input.partnerId]
  );
}
