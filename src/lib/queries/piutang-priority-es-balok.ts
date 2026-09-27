// src/lib/queries/piutang-priority-es-balok.ts
import { sql } from "@/lib/db";
import { getCompanyPool } from "@/lib/db-company";
import { resolveAgenKoneksi, type SumberAgen } from "@/lib/queries/mitra-es-balok";
import { branchFilterFor } from "@/lib/queries/piutang-pembayaran";
import { getAgenRoster } from "@/lib/queries/penjualan-piutang";
import { getEsBalokCollectionTargets } from "@/lib/queries/piutang-target-es-balok";
import { esBalokStatus, type EsBalokInvoiceRow, type EsBalokPiutangStatus } from "@/lib/queries/piutang-invoice-outstanding";
import type { Segmentasi } from "@/lib/segmentasi-mitra";

const SOURCES: SumberAgen[] = ["utama", "logistik"];

// Shared per-Agen aggregate (piutangBerjalan/maxDaysOverdue) derived purely
// from the already-fetched invoiceRows -- both functions below need this,
// so it's built once here rather than duplicated. Only Agen actually
// present in invoiceRows (i.e. with a currently-outstanding FIFO row) get an
// entry; callers fall back to 0/null for any other Agen.
interface AgenAggregate {
  agenNama: string;
  segmentasi: Segmentasi | null;
  piutangBerjalan: number;
  maxDaysOverdue: number;
}

function aggregateByAgen(invoiceRows: EsBalokInvoiceRow[]): Map<string, AgenAggregate> {
  const map = new Map<string, AgenAggregate>();
  for (const row of invoiceRows) {
    const existing = map.get(row.agenId);
    if (existing) {
      existing.piutangBerjalan += row.outstanding;
      existing.maxDaysOverdue = Math.max(existing.maxDaysOverdue, row.daysOverdue);
    } else {
      map.set(row.agenId, {
        agenNama: row.agenNama,
        segmentasi: row.segmentasi,
        piutangBerjalan: row.outstanding,
        maxDaysOverdue: row.daysOverdue,
      });
    }
  }
  return map;
}

interface MaxTanggalRow {
  AgenID: string;
  MaxTanggal: Date;
}

// One MAX(Tanggal) GROUP BY AgenID query for a single (sumber, table) pair,
// bounded to the given agenIds -- same IN-clause-of-parameters pattern as
// getRawFifoInputs in piutang-invoice-outstanding.ts.
async function getMaxTanggalByAgen(
  kode: string,
  sumber: SumberAgen,
  table: "PMP_Pemesanan" | "PMP_Pembayaran",
  agenIds: string[]
): Promise<Map<string, Date>> {
  const result = new Map<string, Date>();
  if (agenIds.length === 0) return result;

  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const branchId = branchFilterFor(kode, sumber);

  const request = pool.request();
  const idParams = agenIds.map((id, i) => {
    request.input(`agen${i}`, sql.VarChar(16), id);
    return `@agen${i}`;
  });
  if (branchId) request.input("branchId", sql.VarChar(16), branchId);

  const queryResult = await request.query(`
    SELECT AgenID, MAX(Tanggal) AS MaxTanggal
    FROM ${table}
    WHERE IsDeleted = 0 AND AgenID IN (${idParams.join(", ")})
      ${branchId ? "AND BranchID = @branchId" : ""}
    GROUP BY AgenID
  `);

  for (const r of queryResult.recordset as MaxTanggalRow[]) {
    result.set(r.AgenID, new Date(r.MaxTanggal));
  }
  return result;
}

// Later-of-two-sources merge: each source's Map may or may not have an
// entry for a given Agen (an Agen active only in "logistik" has no "utama"
// row and vice versa), so this takes the max across whichever source(s)
// actually have a value.
function laterOf(agenId: string, maps: Map<string, Date>[]): Date | null {
  let latest: Date | null = null;
  for (const m of maps) {
    const d = m.get(agenId);
    if (d && (!latest || d.getTime() > latest.getTime())) latest = d;
  }
  return latest;
}

function toIsoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export interface EsBalokPriorityRow {
  agenId: string;
  agenNama: string;
  segmentasi: Segmentasi | null;
  piutangBerjalan: number;
  maxDaysOverdue: number | null;
  status: EsBalokPiutangStatus;
  terakhirPesan: string | null;
  terakhirBayar: string | null;
  targetDate: string | null;
  targetAmount: number | null;
  targetNote: string | null;
  isTarget: boolean;
}

export async function getEsBalokCollectionPriority(
  kode: string,
  invoiceRows: EsBalokInvoiceRow[]
): Promise<EsBalokPriorityRow[]> {
  const aggByAgen = aggregateByAgen(invoiceRows);
  const agenIds = [...aggByAgen.keys()];

  const [pesananMapsBySource, pembayaranMapsBySource, targets] = await Promise.all([
    Promise.all(SOURCES.map((s) => getMaxTanggalByAgen(kode, s, "PMP_Pemesanan", agenIds))),
    Promise.all(SOURCES.map((s) => getMaxTanggalByAgen(kode, s, "PMP_Pembayaran", agenIds))),
    getEsBalokCollectionTargets(kode),
  ]);

  const rows: EsBalokPriorityRow[] = agenIds.map((agenId) => {
    const agg = aggByAgen.get(agenId)!;
    const target = targets.get(agenId) ?? null;
    return {
      agenId,
      agenNama: agg.agenNama,
      segmentasi: agg.segmentasi,
      piutangBerjalan: agg.piutangBerjalan,
      maxDaysOverdue: agg.maxDaysOverdue,
      status: esBalokStatus(agg.maxDaysOverdue),
      terakhirPesan: toIsoDate(laterOf(agenId, pesananMapsBySource)),
      terakhirBayar: toIsoDate(laterOf(agenId, pembayaranMapsBySource)),
      targetDate: target?.targetDate ?? null,
      targetAmount: target?.targetAmount ?? null,
      targetNote: target?.note ?? null,
      isTarget: targets.has(agenId),
    };
  });

  rows.sort((a, b) => b.piutangBerjalan - a.piutangBerjalan);
  return rows;
}

interface PembayaranByDateRow {
  AgenID: string;
  NoDokumen: string;
  Tanggal: Date;
  Pembayaran: number;
  Tarikan: number;
}

async function getPembayaranByDateForSource(
  kode: string,
  sumber: SumberAgen,
  date: Date
): Promise<PembayaranByDateRow[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const branchId = branchFilterFor(kode, sumber);

  const request = pool.request().input("date", sql.DateTime, date);
  if (branchId) request.input("branchId", sql.VarChar(16), branchId);

  const result = await request.query(`
    SELECT AgenID, NoDokumen, Tanggal, ISNULL(Pembayaran,0) AS Pembayaran, ISNULL(Tarikan,0) AS Tarikan
    FROM PMP_Pembayaran
    WHERE IsDeleted = 0 AND Tanggal >= @date AND Tanggal < DATEADD(DAY, 1, @date)
      ${branchId ? "AND BranchID = @branchId" : ""}
  `);
  return result.recordset as PembayaranByDateRow[];
}

export interface EsBalokPembayaranRow {
  agenId: string;
  agenNama: string;
  sumber: SumberAgen;
  noDokumen: string;
  tanggal: string;
  pembayaran: number;
  tarikan: number;
  sisaPiutang: number;
  status: EsBalokPiutangStatus;
}

export async function getEsBalokPembayaranByDate(
  kode: string,
  date: Date,
  invoiceRows: EsBalokInvoiceRow[]
): Promise<EsBalokPembayaranRow[]> {
  const aggByAgen = aggregateByAgen(invoiceRows);

  const [rowsBySource, roster] = await Promise.all([
    Promise.all(SOURCES.map((s) => getPembayaranByDateForSource(kode, s, date))),
    getAgenRoster(kode),
  ]);

  const namaByAgen = new Map<string, string>();
  for (const r of roster) namaByAgen.set(r.AgenID, r.Nama);

  const rows: EsBalokPembayaranRow[] = [];
  SOURCES.forEach((sumber, i) => {
    for (const r of rowsBySource[i]) {
      const agg = aggByAgen.get(r.AgenID);
      rows.push({
        agenId: r.AgenID,
        agenNama: namaByAgen.get(r.AgenID) ?? r.AgenID,
        sumber,
        noDokumen: r.NoDokumen,
        tanggal: new Date(r.Tanggal).toISOString().slice(0, 10),
        pembayaran: r.Pembayaran,
        tarikan: r.Tarikan,
        sisaPiutang: agg?.piutangBerjalan ?? 0,
        status: esBalokStatus(agg?.maxDaysOverdue ?? null),
      });
    }
  });

  rows.sort((a, b) => b.tanggal.localeCompare(a.tanggal));
  return rows;
}
