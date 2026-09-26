// src/lib/queries/piutang-pembayaran.ts
import { sql } from "@/lib/db";
import { getCompanyPool } from "@/lib/db-company";
import { resolveAgenKoneksi, nextSequentialId, withIdRetry, type SumberAgen } from "@/lib/queries/mitra-es-balok";
import { PMPERSADA_OWN_BRANCH_ID } from "@/lib/queries/penjualan-piutang";
import { computeProportionalAllocation, type AllocationItem } from "@/lib/piutang-allocation";

// PMPersada's counterpart inside the shared logistik database (see
// PMPERSADA_OWN_BRANCH_ID's own comment in penjualan-piutang.ts) --
// confirmed live 2026-09-26: BranchID='011' rows in that shared database
// carry NoDokumen suffix "/GE/PK" and are PMPakis's own, vs BranchID='012'
// carrying "/GE/TB" for PMPersada's own.
export const PMPAKIS_OWN_BRANCH_ID = "011";

function branchFilterFor(kode: string, sumber: SumberAgen): string | null {
  if (sumber !== "logistik") return null;
  if (kode === "pmpersada") return PMPERSADA_OWN_BRANCH_ID;
  if (kode === "pmpakis") return PMPAKIS_OWN_BRANCH_ID;
  return null;
}

// The NoDokumen suffix is NOT a location code (Ponorogo/Tuban/Pakis) as it
// first appears -- "HO" is the ERP's own "Head Office" branch role, used by
// every "utama" database and by pmputra's own non-shared "logistik"
// database. Only the shared PMPersada/PMPakis logistik database splits by
// owning company: PMPersada's rows get "TB", PMPakis's get "PK" (confirmed
// live 2026-09-26, distinguishing recent Sept-2026 documents from an older
// mixed-suffix period in the same table's history).
function documentSuffix(kode: string, sumber: SumberAgen): string {
  if (sumber === "utama") return "HO";
  if (kode === "pmpersada") return "TB";
  if (kode === "pmpakis") return "PK";
  return "HO";
}

// BranchID stored ON the new row -- distinct from branchFilterFor, which
// decides whether to FILTER reads by BranchID in the (possibly shared)
// database. Every non-shared database's own rows use "011" (observed
// uniformly across pmputra/pmpersada-utama); the shared logistik database's
// two owners each use their own code.
function branchIdForInsert(kode: string, sumber: SumberAgen): string {
  if (sumber === "logistik" && kode === "pmpersada") return PMPERSADA_OWN_BRANCH_ID;
  if (sumber === "logistik" && kode === "pmpakis") return PMPAKIS_OWN_BRANCH_ID;
  return "011";
}

// Observed constant across every sampled row (both shared-DB owners and
// every non-shared database) -- confirmed live 2026-09-26, no company-
// specific variation found.
const DEPARTMENT_ID = "011";

export interface KasBankOption {
  chartOfAccountId: string;
  accountNo: string;
  nama: string;
}

// "Kas Bank" dropdown options -- ChartOfAccountID values actually offered
// by the ERP desktop's own Pembayaran/Tarikan tab, confirmed live 2026-09-26
// by cross-referencing every ChartOfAccountID historically used in
// PMP_Pembayaran against ChartOfAccount: all of them fall under "1101 Kas"
// or "1102 Bank", at the leaf (IsChildest) level. Each physical database
// has its own distinct set of cash/bank accounts.
export async function getKasBankOptions(kode: string, sumber: SumberAgen): Promise<KasBankOption[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const result = await pool.request().query(`
    SELECT ChartOfAccountID, AccountNo, Description
    FROM ChartOfAccount
    WHERE (AccountNo LIKE '1101%' OR AccountNo LIKE '1102%') AND IsChildest = 1 AND IsDeleted = 0
    ORDER BY AccountNo
  `);
  return (result.recordset as { ChartOfAccountID: string; AccountNo: string; Description: string }[]).map((r) => ({
    chartOfAccountId: r.ChartOfAccountID,
    accountNo: r.AccountNo,
    nama: r.Description,
  }));
}

// Agen's current signed balance in ONE source, computed "as of now" (no
// date bound) -- same baseline+cumulative-movement formula validated
// against the real ERP figure in getPiutangSummary, just scoped to a single
// AgenID instead of aggregated across the whole roster. Reused for both the
// Bayar dialog's preview (getPiutangBayarContext) and the actual write
// (bayarPiutang recomputes fresh rather than trusting a client-supplied
// figure, since balances can move between opening the dialog and
// submitting).
async function getAgenNetNow(kode: string, sumber: SumberAgen, agenId: string): Promise<number> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const branchId = branchFilterFor(kode, sumber);
  const request = pool.request().input("agenId", sql.VarChar(16), agenId);
  if (branchId) request.input("branchId", sql.VarChar(16), branchId);
  const result = await request.query(`
    SELECT
      ISNULL((SELECT SUM(PiutangSaldoAwal - TabunganSaldoAwal) FROM PMP_Agen WHERE IsDeleted = 0 AND AgenID = @agenId), 0)
      + ISNULL((
          SELECT SUM(
            (BalokKecilRealisasi - ISNULL(BalokKecilRetur,0)) * BalokKecilHarga
            + (BalokBesarRealisasi - ISNULL(BalokBesarRetur,0)) * BalokBesarHarga
            - ISNULL(Pembayaran,0)
          )
          FROM PMP_Pemesanan
          WHERE IsDeleted = 0 AND AgenID = @agenId
            ${branchId ? "AND BranchID = @branchId" : ""}
        ), 0)
      + ISNULL((
          SELECT SUM(ISNULL(Tarikan,0) - ISNULL(Pembayaran,0))
          FROM PMP_Pembayaran
          WHERE IsDeleted = 0 AND AgenID = @agenId
            ${branchId ? "AND BranchID = @branchId" : ""}
        ), 0) AS Net
  `);
  return (result.recordset[0] as { Net: number }).Net;
}

export interface PiutangBayarContext {
  hutangUtama: number;
  hutangLogistik: number;
  kasBankUtama: KasBankOption[];
  kasBankLogistik: KasBankOption[];
}

// Fetched when the "Bayar" dialog opens -- the current per-source Hutang
// (for the live allocation preview) and each source's own Kas Bank options.
export async function getPiutangBayarContext(kode: string, agenId: string): Promise<PiutangBayarContext> {
  const sources: SumberAgen[] = ["utama", "logistik"];
  const [netBySource, kasBankBySource] = await Promise.all([
    Promise.all(sources.map((s) => getAgenNetNow(kode, s, agenId))),
    Promise.all(sources.map((s) => getKasBankOptions(kode, s))),
  ]);
  return {
    hutangUtama: Math.max(netBySource[0], 0),
    hutangLogistik: Math.max(netBySource[1], 0),
    kasBankUtama: kasBankBySource[0],
    kasBankLogistik: kasBankBySource[1],
  };
}

export interface PiutangTarikContext {
  tabunganUtama: number;
  tabunganLogistik: number;
  kasBankUtama: KasBankOption[];
  kasBankLogistik: KasBankOption[];
}

// Fetched when the "Tarik" dialog opens -- the current per-source Tabungan
// (surplus balance, i.e. a negative net) available to withdraw, and each
// source's own Kas Bank options (the account the withdrawal is paid out
// from).
export async function getPiutangTarikContext(kode: string, agenId: string): Promise<PiutangTarikContext> {
  const sources: SumberAgen[] = ["utama", "logistik"];
  const [netBySource, kasBankBySource] = await Promise.all([
    Promise.all(sources.map((s) => getAgenNetNow(kode, s, agenId))),
    Promise.all(sources.map((s) => getKasBankOptions(kode, s))),
  ]);
  return {
    tabunganUtama: Math.max(-netBySource[0], 0),
    tabunganLogistik: Math.max(-netBySource[1], 0),
    kasBankUtama: kasBankBySource[0],
    kasBankLogistik: kasBankBySource[1],
  };
}

async function nextNoDokumenAT(transaction: sql.Transaction, monthKey: string): Promise<string> {
  const result = await new sql.Request(transaction)
    .input("pattern", sql.VarChar(64), `PMP/AT/%/${monthKey}/GE/%`)
    .query(`SELECT MAX(TRY_CAST(SUBSTRING(NoDokumen, 8, 6) AS INT)) AS MaxSeq FROM PMP_Pembayaran WHERE NoDokumen LIKE @pattern`);
  const next = ((result.recordset[0] as { MaxSeq: number | null }).MaxSeq ?? 0) + 1;
  return String(next).padStart(6, "0");
}

// Inserts one PMP_Pembayaran row for a single source. `Piutang` and
// `Tabungan` columns are left at 0 -- confirmed live 2026-09-26 that real
// ERP usage never populates them (1 stray row out of 15,129 for `Piutang`,
// 0 out of 26,664 total for `Tabungan` across pmputra's two databases) --
// only `Pembayaran`/`Tarikan` carry real activity.
async function insertPembayaran(
  kode: string,
  sumber: SumberAgen,
  agenId: string,
  jumlah: number,
  chartOfAccountId: string,
  catatan: string | null
): Promise<string> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const branchId = branchIdForInsert(kode, sumber);
  const suffix = documentSuffix(kode, sumber);
  const monthKey = new Date().toISOString().slice(0, 7);

  return withIdRetry(async () => {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const pembayaranId = await nextSequentialId(transaction, "PMP_Pembayaran", "PembayaranID");
      const seq = await nextNoDokumenAT(transaction, monthKey);
      const noDokumen = `PMP/AT/${seq}/${monthKey}/GE/${suffix}`;
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), pembayaranId)
        .input("noDokumen", sql.VarChar(64), noDokumen)
        .input("agenId", sql.VarChar(16), agenId)
        .input("branchId", sql.VarChar(16), branchId)
        .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
        .input("coa", sql.VarChar(16), chartOfAccountId)
        .input("jumlah", sql.Decimal(18, 2), jumlah)
        .input("catatan", sql.VarChar(256), catatan).query(`
          INSERT INTO PMP_Pembayaran
            (PembayaranID, NoDokumen, Tanggal, BranchID, DepartmentID, AgenID, ChartOfAccountID, Piutang, Pembayaran, Tabungan, Tarikan, Catatan, IsDeleted, ModifiedDate)
          VALUES
            (@id, @noDokumen, GETDATE(), @branchId, @departmentId, @agenId, @coa, 0, @jumlah, 0, 0, @catatan, 0, GETDATE())
        `);
      await transaction.commit();
      return noDokumen;
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  });
}

// Same table/document-numbering as insertPembayaran, but populates
// `Tarikan` instead of `Pembayaran` -- both columns live on PMP_Pembayaran
// and share one NoDokumen sequence (PMP/AT/...), matching the ERP
// desktop's own Pembayaran/Tarikan tabs.
async function insertTarikan(
  kode: string,
  sumber: SumberAgen,
  agenId: string,
  jumlah: number,
  chartOfAccountId: string,
  catatan: string | null
): Promise<string> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const branchId = branchIdForInsert(kode, sumber);
  const suffix = documentSuffix(kode, sumber);
  const monthKey = new Date().toISOString().slice(0, 7);

  return withIdRetry(async () => {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const pembayaranId = await nextSequentialId(transaction, "PMP_Pembayaran", "PembayaranID");
      const seq = await nextNoDokumenAT(transaction, monthKey);
      const noDokumen = `PMP/AT/${seq}/${monthKey}/GE/${suffix}`;
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), pembayaranId)
        .input("noDokumen", sql.VarChar(64), noDokumen)
        .input("agenId", sql.VarChar(16), agenId)
        .input("branchId", sql.VarChar(16), branchId)
        .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
        .input("coa", sql.VarChar(16), chartOfAccountId)
        .input("jumlah", sql.Decimal(18, 2), jumlah)
        .input("catatan", sql.VarChar(256), catatan).query(`
          INSERT INTO PMP_Pembayaran
            (PembayaranID, NoDokumen, Tanggal, BranchID, DepartmentID, AgenID, ChartOfAccountID, Piutang, Pembayaran, Tabungan, Tarikan, Catatan, IsDeleted, ModifiedDate)
          VALUES
            (@id, @noDokumen, GETDATE(), @branchId, @departmentId, @agenId, @coa, 0, 0, 0, @jumlah, @catatan, 0, GETDATE())
        `);
      await transaction.commit();
      return noDokumen;
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  });
}

export interface BayarPiutangResult {
  sumber: SumberAgen;
  jumlah: number;
  noDokumen: string;
}

// Records a Mitra's payment, automatically split across "utama"/"logistik"
// by each source's own current Hutang (proportional split when both have
// Hutang; overpayment beyond the combined Hutang routes to "logistik" --
// see computeProportionalAllocation, and the design discussion with the
// user 2026-09-26 on why Tabungan in one PT can never offset Hutang in the
// other: different PT, different COA, different rekening bank).
// Recomputes each source's Hutang fresh (not trusting a client-supplied
// figure from when the dialog opened) to avoid acting on stale balances.
export async function bayarPiutang(
  kode: string,
  agenId: string,
  jumlah: number,
  kasBank: { utama?: string; logistik?: string },
  catatan: string | null
): Promise<BayarPiutangResult[]> {
  if (jumlah <= 0) throw new Error("Jumlah pembayaran harus lebih dari 0.");

  const [netUtama, netLogistik] = await Promise.all([
    getAgenNetNow(kode, "utama", agenId),
    getAgenNetNow(kode, "logistik", agenId),
  ]);
  const plan: AllocationItem[] = computeProportionalAllocation(Math.max(netUtama, 0), Math.max(netLogistik, 0), jumlah);

  const results: BayarPiutangResult[] = [];
  for (const item of plan) {
    const coa = item.sumber === "utama" ? kasBank.utama : kasBank.logistik;
    if (!coa) throw new Error(`Kas Bank untuk sumber "${item.sumber}" belum dipilih.`);
    const noDokumen = await insertPembayaran(kode, item.sumber, agenId, item.jumlah, coa, catatan);
    results.push({ sumber: item.sumber, jumlah: item.jumlah, noDokumen });
  }
  return results;
}

// Records a Mitra's withdrawal of its own Tabungan (surplus balance),
// automatically split across "utama"/"logistik" by each source's own
// current Tabungan -- mirrors bayarPiutang's proportional-split design, but
// a withdrawal can never exceed the combined Tabungan available (there is
// no "logistik absorbs the excess" case here, since there is nothing to
// route -- the Mitra simply cannot withdraw savings that don't exist).
export async function tarikPiutang(
  kode: string,
  agenId: string,
  jumlah: number,
  kasBank: { utama?: string; logistik?: string },
  catatan: string | null
): Promise<BayarPiutangResult[]> {
  if (jumlah <= 0) throw new Error("Jumlah penarikan harus lebih dari 0.");

  const [netUtama, netLogistik] = await Promise.all([
    getAgenNetNow(kode, "utama", agenId),
    getAgenNetNow(kode, "logistik", agenId),
  ]);
  const tabunganUtama = Math.max(-netUtama, 0);
  const tabunganLogistik = Math.max(-netLogistik, 0);
  if (jumlah > tabunganUtama + tabunganLogistik) {
    throw new Error("Jumlah penarikan melebihi total tabungan Mitra saat ini.");
  }
  const plan: AllocationItem[] = computeProportionalAllocation(tabunganUtama, tabunganLogistik, jumlah);

  const results: BayarPiutangResult[] = [];
  for (const item of plan) {
    const coa = item.sumber === "utama" ? kasBank.utama : kasBank.logistik;
    if (!coa) throw new Error(`Kas Bank untuk sumber "${item.sumber}" belum dipilih.`);
    const noDokumen = await insertTarikan(kode, item.sumber, agenId, item.jumlah, coa, catatan);
    results.push({ sumber: item.sumber, jumlah: item.jumlah, noDokumen });
  }
  return results;
}
