import { getPool, sql } from "@/lib/db";
import { getReportShift, getShiftWindow, getShiftLabel, type ShiftNumber } from "@/lib/report-shift";

export interface PengeluaranRow {
  pengeluaranId: number;
  keterangan: string;
  nominal: number;
}

export interface KasKecilShiftRow {
  kasKecilShiftId: number | null; // null when synthesized for a shift with no row yet
  tanggalUsaha: string;
  shift: ShiftNumber;
  shiftMulai: Date;
  kasMasuk: number;
  diisiOlehAkunId: number | null;
  pengeluaran: PengeluaranRow[];
  totalPengeluaran: number;
  saldoAkhir: number;
}

export interface CurrentShiftKasKecilInfo {
  tanggalUsaha: string;
  shift: ShiftNumber;
  shiftLabel: string;
}

// Shared core of every saldo-berjalan query below -- pre-aggregates
// Pengeluaran per KasKecilShiftID FIRST (avoiding fan-out from the
// one-to-many child table), then runs the running-balance window function
// ordered by ShiftMulai (never raw Shift -- see Global Constraints in the
// plan this came from). CROSS JOIN against DashboardKasKecilSaldoAwal is
// safe (never fans out) because that table always has exactly one row
// (seeded by this feature's migration, enforced in application code by
// setSaldoAwalKasKecil always doing a plain UPDATE, never an INSERT).
const SALDO_BERJALAN_SUBQUERY = `
  SELECT
    s.KasKecilShiftID, s.TanggalUsaha, s.Shift, s.ShiftMulai, s.KasMasuk, s.DiisiOlehAkunID,
    ISNULL(p.TotalPengeluaran, 0) AS TotalPengeluaran,
    sa.SaldoAwal + SUM(s.KasMasuk - ISNULL(p.TotalPengeluaran, 0))
      OVER (ORDER BY s.ShiftMulai ROWS UNBOUNDED PRECEDING) AS SaldoAkhir
  FROM DashboardKasKecilShift s
  CROSS JOIN DashboardKasKecilSaldoAwal sa
  LEFT JOIN (
    SELECT KasKecilShiftID, SUM(Nominal) AS TotalPengeluaran
    FROM DashboardKasKecilPengeluaran
    GROUP BY KasKecilShiftID
  ) p ON p.KasKecilShiftID = s.KasKecilShiftID
`;

interface RawShiftRow {
  KasKecilShiftID: number;
  TanggalUsaha: Date;
  Shift: number;
  ShiftMulai: Date;
  KasMasuk: number;
  DiisiOlehAkunID: number | null;
  TotalPengeluaran: number;
  SaldoAkhir: number;
}

// Fetches every Pengeluaran row for a batch of KasKecilShiftIDs in ONE
// round trip, fully parameterized (never string-interpolated) even though
// the ids always originate from our own prior query, not user input.
async function attachPengeluaran(pool: sql.ConnectionPool, ids: number[]): Promise<Map<number, PengeluaranRow[]>> {
  const map = new Map<number, PengeluaranRow[]>();
  if (ids.length === 0) return map;
  const request = pool.request();
  const placeholders = ids.map((id, i) => {
    request.input(`id${i}`, sql.Int, id);
    return `@id${i}`;
  });
  const result = await request.query(`
    SELECT PengeluaranID, KasKecilShiftID, Keterangan, Nominal
    FROM DashboardKasKecilPengeluaran
    WHERE KasKecilShiftID IN (${placeholders.join(",")})
  `);
  for (const row of result.recordset as { PengeluaranID: number; KasKecilShiftID: number; Keterangan: string; Nominal: number }[]) {
    const list = map.get(row.KasKecilShiftID) ?? [];
    list.push({ pengeluaranId: row.PengeluaranID, keterangan: row.Keterangan, nominal: row.Nominal });
    map.set(row.KasKecilShiftID, list);
  }
  return map;
}

function mapRow(r: RawShiftRow, pengeluaranMap: Map<number, PengeluaranRow[]>): KasKecilShiftRow {
  return {
    kasKecilShiftId: r.KasKecilShiftID,
    tanggalUsaha: r.TanggalUsaha.toISOString().slice(0, 10),
    shift: r.Shift as ShiftNumber,
    shiftMulai: r.ShiftMulai,
    kasMasuk: r.KasMasuk,
    diisiOlehAkunId: r.DiisiOlehAkunID,
    pengeluaran: pengeluaranMap.get(r.KasKecilShiftID) ?? [],
    totalPengeluaran: r.TotalPengeluaran,
    saldoAkhir: r.SaldoAkhir,
  };
}

export async function getSaldoAwalKasKecil(): Promise<number> {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT TOP 1 SaldoAwal FROM DashboardKasKecilSaldoAwal`);
  return (result.recordset[0] as { SaldoAwal: number } | undefined)?.SaldoAwal ?? 0;
}

// Always UPDATEs the singleton row (seeded by Task 1's migration) --
// never INSERTs -- so the CROSS JOIN in SALDO_BERJALAN_SUBQUERY can never
// fan out.
export async function setSaldoAwalKasKecil(saldoAwal: number, akunId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("saldoAwal", sql.Decimal(18, 2), saldoAwal)
    .input("akunId", sql.Int, akunId)
    .query(`UPDATE DashboardKasKecilSaldoAwal SET SaldoAwal = @saldoAwal, DiisiOlehAkunID = @akunId, ModifiedDate = GETDATE()`);
}

// Full shift history (newest first) with running balances -- see this
// plan's Global Constraints on why balances are never stored.
export async function getKasKecilHistory(limit = 90): Promise<KasKecilShiftRow[]> {
  const pool = await getPool();
  const result = await pool.request().input("limit", sql.Int, limit).query(`
    SELECT TOP (@limit) * FROM (${SALDO_BERJALAN_SUBQUERY}) x ORDER BY x.ShiftMulai DESC
  `);
  const rawRows = result.recordset as RawShiftRow[];
  const pengeluaranMap = await attachPengeluaran(pool, rawRows.map((r) => r.KasKecilShiftID));
  return rawRows.map((r) => mapRow(r, pengeluaranMap));
}

async function getKasKecilShiftRow(pool: sql.ConnectionPool, tanggalUsaha: string, shift: ShiftNumber): Promise<KasKecilShiftRow | null> {
  const result = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift).query(`
      SELECT * FROM (${SALDO_BERJALAN_SUBQUERY}) x WHERE x.TanggalUsaha = @t AND x.Shift = @s
    `);
  const row = result.recordset[0] as RawShiftRow | undefined;
  if (!row) return null;
  const pengeluaranMap = await attachPengeluaran(pool, [row.KasKecilShiftID]);
  return mapRow(row, pengeluaranMap);
}

// Latest SaldoAkhir over the FULL unfiltered history (no TOP N
// truncation) -- used by getCurrentShiftKasKecil's fallback so it never
// mistakes "pushed out of a display-limited window" for "no history at
// all yet" (same reasoning as Tahap 1's getLatestBalancePerJenisBarang).
async function getLatestSaldoAkhirKasKecil(pool: sql.ConnectionPool): Promise<number | null> {
  const result = await pool.request().query(`
    SELECT TOP 1 SaldoAkhir FROM (${SALDO_BERJALAN_SUBQUERY}) x ORDER BY x.ShiftMulai DESC
  `);
  const row = result.recordset[0] as { SaldoAkhir: number } | undefined;
  return row?.SaldoAkhir ?? null;
}

// Current work-shift row -- synthesizes a zero-valued row
// (kasKecilShiftId: null) if this shift has no row yet, carrying forward
// the latest known running balance (or SaldoAwal if no history at all
// yet) so the UI always has a sensible starting point before anyone has
// typed anything.
export async function getCurrentShiftKasKecil(): Promise<{ current: CurrentShiftKasKecilInfo; row: KasKecilShiftRow }> {
  const { shift, businessDate } = getReportShift("work");
  const tanggalUsaha = businessDate.toISOString().slice(0, 10);
  const current = { tanggalUsaha, shift, shiftLabel: getShiftLabel(shift, "work") };
  const pool = await getPool();

  const existing = await getKasKecilShiftRow(pool, tanggalUsaha, shift);
  if (existing) return { current, row: existing };

  const [latestSaldoAkhir, saldoAwal] = await Promise.all([getLatestSaldoAkhirKasKecil(pool), getSaldoAwalKasKecil()]);
  return {
    current,
    row: {
      kasKecilShiftId: null,
      tanggalUsaha,
      shift,
      shiftMulai: getShiftWindow(businessDate, shift, "work").start,
      kasMasuk: 0,
      diisiOlehAkunId: null,
      pengeluaran: [],
      totalPengeluaran: 0,
      saldoAkhir: latestSaldoAkhir ?? saldoAwal,
    },
  };
}

export async function upsertKasMasuk(tanggalUsaha: string, shift: ShiftNumber, kasMasuk: number, akunId: number): Promise<void> {
  const pool = await getPool();
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const shiftMulai = getShiftWindow(businessDate, shift, "work").start;
  await pool
    .request()
    .input("tanggalUsaha", sql.Date, tanggalUsaha)
    .input("shift", sql.TinyInt, shift)
    .input("shiftMulai", sql.DateTime, shiftMulai)
    .input("kasMasuk", sql.Decimal(18, 2), kasMasuk)
    .input("akunId", sql.Int, akunId).query(`
      MERGE DashboardKasKecilShift AS target
      USING (SELECT @tanggalUsaha AS TanggalUsaha, @shift AS Shift) AS src
      ON target.TanggalUsaha = src.TanggalUsaha AND target.Shift = src.Shift
      WHEN MATCHED THEN UPDATE SET
        KasMasuk = @kasMasuk,
        DiisiOlehAkunID = @akunId,
        ModifiedDate = GETDATE()
      WHEN NOT MATCHED THEN INSERT
        (TanggalUsaha, Shift, ShiftMulai, KasMasuk, DiisiOlehAkunID)
        VALUES (@tanggalUsaha, @shift, @shiftMulai, @kasMasuk, @akunId);
    `);
}

// Gets-or-creates the shift row so a Pengeluaran can FK to it even if
// nobody has touched KasMasuk yet this shift -- same pattern as
// ensureAktivitasRow in aktivitas-produksi.ts.
async function ensureKasKecilShiftId(pool: sql.ConnectionPool, tanggalUsaha: string, shift: ShiftNumber, akunId: number): Promise<number> {
  const existing = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`SELECT KasKecilShiftID FROM DashboardKasKecilShift WHERE TanggalUsaha = @t AND Shift = @s`);
  if (existing.recordset.length > 0) return (existing.recordset[0] as { KasKecilShiftID: number }).KasKecilShiftID;

  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const shiftMulai = getShiftWindow(businessDate, shift, "work").start;
  const result = await pool
    .request()
    .input("tanggalUsaha", sql.Date, tanggalUsaha)
    .input("shift", sql.TinyInt, shift)
    .input("shiftMulai", sql.DateTime, shiftMulai)
    .input("akunId", sql.Int, akunId).query(`
      INSERT INTO DashboardKasKecilShift (TanggalUsaha, Shift, ShiftMulai, DiisiOlehAkunID)
      OUTPUT INSERTED.KasKecilShiftID
      VALUES (@tanggalUsaha, @shift, @shiftMulai, @akunId)
    `);
  return (result.recordset[0] as { KasKecilShiftID: number }).KasKecilShiftID;
}

export async function tambahPengeluaran(
  tanggalUsaha: string,
  shift: ShiftNumber,
  keterangan: string,
  nominal: number,
  akunId: number
): Promise<number> {
  const pool = await getPool();
  const kasKecilShiftId = await ensureKasKecilShiftId(pool, tanggalUsaha, shift, akunId);
  const result = await pool
    .request()
    .input("kasKecilShiftId", sql.Int, kasKecilShiftId)
    .input("keterangan", sql.VarChar(200), keterangan)
    .input("nominal", sql.Decimal(18, 2), nominal)
    .input("akunId", sql.Int, akunId).query(`
      INSERT INTO DashboardKasKecilPengeluaran (KasKecilShiftID, Keterangan, Nominal, DicatatOlehAkunID)
      OUTPUT INSERTED.PengeluaranID
      VALUES (@kasKecilShiftId, @keterangan, @nominal, @akunId)
    `);
  return (result.recordset[0] as { PengeluaranID: number }).PengeluaranID;
}

// Hard delete -- per Global Constraints, nothing else references
// PengeluaranID, unlike DashboardTimProduksiAnggota which must soft-delete.
export async function hapusPengeluaran(pengeluaranId: number): Promise<void> {
  const pool = await getPool();
  await pool.request().input("pengeluaranId", sql.Int, pengeluaranId).query(`
    DELETE FROM DashboardKasKecilPengeluaran WHERE PengeluaranID = @pengeluaranId
  `);
}
