import { getPgPool } from "@/lib/pg";
import { encryptSecret, decryptSecret } from "@/lib/crypto-secret";
import { AppError } from "@/lib/action-result";
import { normalizeBaseUrl } from "@/lib/bychat/client";

// Pemetaan akun ByChat -> PT (satu akun = satu PT), dikelola di
// /grup/perusahaan. Token API ByChat tersimpan terenkripsi (kunci sama dengan
// kredensial koneksi database lain -- lihat catatan rotasi AUTH_SECRET di
// crypto-secret.ts) dan tidak pernah dikembalikan ke klien.

export const BYCHAT_URL_DEFAULT = "https://chat.byndrha.id";

export interface ByChatKoneksiRow {
  perusahaanId: number;
  perusahaanKode: string;
  bychatUrl: string;
  bychatAccountId: number;
  inboxId: number | null;
  aktif: boolean;
  updatedAt: string;
}

export interface ResolvedByChat {
  perusahaanId: number;
  perusahaanKode: string;
  perusahaanNama: string;
  bychatUrl: string;
  bychatAccountId: number;
  apiToken: string;
  inboxId: number | null;
}

// Dipakai embed/kirim: PT dicari dari account_id pada token bertanda tangan.
// null = belum dipetakan atau dinonaktifkan -> pemanggil WAJIB menolak.
export async function resolveByChatByAccountId(accountId: number): Promise<ResolvedByChat | null> {
  const result = await getPgPool().query(
    `SELECT bk.perusahaan_id, p.kode, p.nama, bk.bychat_url, bk.bychat_account_id, bk.api_token_encrypted, bk.inbox_id
     FROM perusahaan_bychat_koneksi bk
     JOIN perusahaan p ON p.id = bk.perusahaan_id
     WHERE bk.bychat_account_id = $1 AND bk.aktif = TRUE`,
    [accountId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    perusahaanId: row.perusahaan_id,
    perusahaanKode: row.kode,
    perusahaanNama: row.nama,
    bychatUrl: row.bychat_url,
    bychatAccountId: row.bychat_account_id,
    apiToken: decryptSecret(row.api_token_encrypted),
    inboxId: row.inbox_id,
  };
}

function toRow(r: Record<string, unknown>): ByChatKoneksiRow {
  return {
    perusahaanId: r.perusahaan_id as number,
    perusahaanKode: r.kode as string,
    bychatUrl: r.bychat_url as string,
    bychatAccountId: r.bychat_account_id as number,
    inboxId: (r.inbox_id as number | null) ?? null,
    aktif: r.aktif as boolean,
    updatedAt: new Date(r.updated_at as string).toISOString(),
  };
}

export async function listAllByChatKoneksi(): Promise<ByChatKoneksiRow[]> {
  const result = await getPgPool().query(
    `SELECT bk.perusahaan_id, p.kode, bk.bychat_url, bk.bychat_account_id, bk.inbox_id, bk.aktif, bk.updated_at
     FROM perusahaan_bychat_koneksi bk JOIN perusahaan p ON p.id = bk.perusahaan_id
     ORDER BY bk.perusahaan_id`
  );
  return result.rows.map(toRow);
}

export async function getByChatKoneksi(perusahaanId: number): Promise<ByChatKoneksiRow | null> {
  const result = await getPgPool().query(
    `SELECT bk.perusahaan_id, p.kode, bk.bychat_url, bk.bychat_account_id, bk.inbox_id, bk.aktif, bk.updated_at
     FROM perusahaan_bychat_koneksi bk JOIN perusahaan p ON p.id = bk.perusahaan_id
     WHERE bk.perusahaan_id = $1`,
    [perusahaanId]
  );
  return result.rows[0] ? toRow(result.rows[0]) : null;
}

// Token tersimpan (didekripsi) HANYA untuk dipakai server (mis. Uji koneksi
// dengan token yang sudah tersimpan) -- jangan pernah dikembalikan ke klien.
export async function getStoredApiToken(perusahaanId: number): Promise<string | null> {
  const result = await getPgPool().query(`SELECT api_token_encrypted FROM perusahaan_bychat_koneksi WHERE perusahaan_id = $1`, [perusahaanId]);
  const row = result.rows[0];
  return row ? decryptSecret(row.api_token_encrypted) : null;
}

export interface UpsertByChatInput {
  perusahaanId: number;
  bychatUrl: string;
  bychatAccountId: number;
  apiToken: string | null; // null/"" = pertahankan token tersimpan
  inboxId: number | null;
  aktif: boolean;
}

export async function upsertByChatKoneksi(input: UpsertByChatInput): Promise<void> {
  const url = normalizeBaseUrl(input.bychatUrl || BYCHAT_URL_DEFAULT);
  if (!Number.isInteger(input.bychatAccountId) || input.bychatAccountId <= 0) {
    throw new AppError("ID akun ByChat harus berupa angka positif.");
  }
  if (input.inboxId != null && (!Number.isInteger(input.inboxId) || input.inboxId <= 0)) {
    throw new AppError("ID inbox tidak valid.");
  }
  const token = (input.apiToken ?? "").trim();
  const ada = await getByChatKoneksi(input.perusahaanId);
  if (!ada && !token) throw new AppError("Token Akses API ByChat wajib diisi untuk koneksi baru.");

  try {
    if (!ada) {
      await getPgPool().query(
        `INSERT INTO perusahaan_bychat_koneksi (perusahaan_id, bychat_url, bychat_account_id, api_token_encrypted, inbox_id, aktif)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.perusahaanId, url, input.bychatAccountId, encryptSecret(token), input.inboxId, input.aktif]
      );
    } else if (token) {
      await getPgPool().query(
        `UPDATE perusahaan_bychat_koneksi
         SET bychat_url = $2, bychat_account_id = $3, api_token_encrypted = $4, inbox_id = $5, aktif = $6, updated_at = now()
         WHERE perusahaan_id = $1`,
        [input.perusahaanId, url, input.bychatAccountId, encryptSecret(token), input.inboxId, input.aktif]
      );
    } else {
      await getPgPool().query(
        `UPDATE perusahaan_bychat_koneksi
         SET bychat_url = $2, bychat_account_id = $3, inbox_id = $4, aktif = $5, updated_at = now()
         WHERE perusahaan_id = $1`,
        [input.perusahaanId, url, input.bychatAccountId, input.inboxId, input.aktif]
      );
    }
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new AppError("ID akun ByChat ini sudah dipakai PT lain. Satu akun ByChat hanya boleh untuk satu PT.");
    }
    throw err;
  }
}

export async function deleteByChatKoneksi(perusahaanId: number): Promise<void> {
  await getPgPool().query(`DELETE FROM perusahaan_bychat_koneksi WHERE perusahaan_id = $1`, [perusahaanId]);
}
