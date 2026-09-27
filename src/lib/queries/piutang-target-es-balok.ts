import { getPgPool } from "@/lib/pg";

// Target pelunasan (collection target) per Agen for the Piutang Es Balok
// module — Postgres "directory" DB table, same pattern as metode_pembayaran.
// One-time DDL (already run against the live directory DB; kept here as
// documentation for anyone who needs to recreate it on another environment):
//
// CREATE TABLE IF NOT EXISTS piutang_es_balok_target (
//   id BIGSERIAL PRIMARY KEY,
//   kode VARCHAR(32) NOT NULL,
//   agen_id VARCHAR(16) NOT NULL,
//   target_date DATE,
//   target_amount NUMERIC(18,2),
//   note VARCHAR(256),
//   created_by_user_id VARCHAR(64),
//   created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
//   updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
//   UNIQUE (kode, agen_id)
// );

export interface EsBalokCollectionTarget {
  agenId: string;
  targetDate: string | null;
  targetAmount: number | null;
  note: string | null;
}

interface EsBalokCollectionTargetDbRow {
  agen_id: string;
  target_date: string | null;
  target_amount: string | null;
  note: string | null;
}

function mapRow(r: EsBalokCollectionTargetDbRow): EsBalokCollectionTarget {
  return {
    agenId: r.agen_id,
    targetDate: r.target_date,
    targetAmount: r.target_amount !== null ? Number(r.target_amount) : null,
    note: r.note,
  };
}

// Keyed by agen_id so callers can do an O(1) lookup per Agen instead of an
// array .find() over every row.
export async function getEsBalokCollectionTargets(kode: string): Promise<Map<string, EsBalokCollectionTarget>> {
  const pool = getPgPool();
  const result = await pool.query<EsBalokCollectionTargetDbRow>(
    `SELECT agen_id, target_date, target_amount, note FROM piutang_es_balok_target WHERE kode = $1`,
    [kode]
  );
  const map = new Map<string, EsBalokCollectionTarget>();
  for (const row of result.rows) {
    map.set(row.agen_id, mapRow(row));
  }
  return map;
}

export interface SetEsBalokCollectionTargetInput {
  targetDate: string | null;
  targetAmount: number | null;
  note: string | null;
}

export async function setEsBalokCollectionTarget(
  kode: string,
  agenId: string,
  input: SetEsBalokCollectionTargetInput,
  userId: string
): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `INSERT INTO piutang_es_balok_target (kode, agen_id, target_date, target_amount, note, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (kode, agen_id) DO UPDATE
     SET target_date = EXCLUDED.target_date, target_amount = EXCLUDED.target_amount,
         note = EXCLUDED.note, updated_at = now()`,
    [kode, agenId, input.targetDate, input.targetAmount, input.note, userId]
  );
}

export async function removeEsBalokCollectionTarget(kode: string, agenId: string): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM piutang_es_balok_target WHERE kode = $1 AND agen_id = $2`, [kode, agenId]);
}
