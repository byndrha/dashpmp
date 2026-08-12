import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import sql from "mssql";
import { AppError } from "@/lib/action-result";

const LABEL: CompanyKoneksiLabel = "utama";

async function getPool() {
  return getCompanyPool("pmpersada", LABEL);
}

export type TahapPembekuan = "BARU" | "MULAI" | "KRISTAL" | "SIAP" | "JADI" | "BABONAN" | "MAINTENANCE";

// Diporting persis dari formula draf referensi (getEffectiveRekStatus) —
// tahap & persentase TIDAK PERNAH disimpan sebagai kolom, selalu dihitung
// ulang dari WaktuIsi/EstimasiBeku setiap kali di-fetch.
function computeTahap(row: {
  IsMaintenance: boolean;
  BatchID: number | null;
  IsBabonan: boolean;
  WaktuIsi: Date | null;
  EstimasiBeku: Date | null;
}): { Tahap: TahapPembekuan; Pct: number; UsiaJam: number } {
  if (row.IsMaintenance) return { Tahap: "MAINTENANCE", Pct: 0, UsiaJam: 0 };
  if (row.BatchID == null || !row.WaktuIsi || !row.EstimasiBeku) return { Tahap: "BARU", Pct: 0, UsiaJam: 0 };

  const start = row.WaktuIsi.getTime();
  const usiaJam = (Date.now() - start) / 3600000;

  if (row.IsBabonan) return { Tahap: "BABONAN", Pct: 100, UsiaJam: usiaJam };

  const end = row.EstimasiBeku.getTime();
  if (end <= start) return { Tahap: "JADI", Pct: 100, UsiaJam: usiaJam };

  const pct = Math.min(100, Math.max(0, Math.round(((Date.now() - start) / (end - start)) * 100)));
  const tahap: TahapPembekuan = pct >= 100 ? "JADI" : pct >= 75 ? "SIAP" : pct >= 50 ? "KRISTAL" : pct > 0 ? "MULAI" : "BARU";
  return { Tahap: tahap, Pct: pct, UsiaJam: usiaJam };
}

export interface BakRow {
  BakID: number;
  Nama: string;
  TotalRek: number;
}

export async function getBakList(): Promise<BakRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT BakID, Nama, TotalRek FROM DashboardProduksiBak ORDER BY BakID`);
  return result.recordset;
}

export interface RekMapRow {
  RekID: number;
  BakID: number;
  BakNama: string;
  NomorRek: number;
  IsMaintenance: boolean;
  BatchID: number | null;
  JenisEs: "BK" | "BB" | null;
  JumlahCan: number | null;
  WaktuIsi: string | null;
  EstimasiBeku: string | null;
  IsBabonan: boolean;
  DicatatOlehAkunID: number | null;
  Tahap: TahapPembekuan;
  Pct: number;
  UsiaJam: number;
}

export async function getRekMap(): Promise<RekMapRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT r.RekID, r.BakID, bak.Nama AS BakNama, r.NomorRek, r.IsMaintenance, r.BatchIDAktif AS BatchID,
           b.JenisEs, b.JumlahCan, b.WaktuIsi, b.EstimasiBeku, b.IsBabonan, b.DicatatOlehAkunID
    FROM DashboardProduksiRek r
    JOIN DashboardProduksiBak bak ON bak.BakID = r.BakID
    LEFT JOIN DashboardProduksiBatch b ON b.BatchID = r.BatchIDAktif
    ORDER BY r.BakID, r.NomorRek
  `);
  const rows = result.recordset as {
    RekID: number;
    BakID: number;
    BakNama: string;
    NomorRek: number;
    IsMaintenance: boolean;
    BatchID: number | null;
    JenisEs: "BK" | "BB" | null;
    JumlahCan: number | null;
    WaktuIsi: Date | null;
    EstimasiBeku: Date | null;
    IsBabonan: boolean | null;
    DicatatOlehAkunID: number | null;
  }[];
  return rows.map((r) => {
    const eff = computeTahap({
      IsMaintenance: r.IsMaintenance,
      BatchID: r.BatchID,
      IsBabonan: r.IsBabonan ?? false,
      WaktuIsi: r.WaktuIsi,
      EstimasiBeku: r.EstimasiBeku,
    });
    return {
      RekID: r.RekID,
      BakID: r.BakID,
      BakNama: r.BakNama,
      NomorRek: r.NomorRek,
      IsMaintenance: r.IsMaintenance,
      BatchID: r.BatchID,
      JenisEs: r.JenisEs,
      JumlahCan: r.JumlahCan,
      WaktuIsi: r.WaktuIsi ? r.WaktuIsi.toISOString() : null,
      EstimasiBeku: r.EstimasiBeku ? r.EstimasiBeku.toISOString() : null,
      IsBabonan: r.IsBabonan ?? false,
      DicatatOlehAkunID: r.DicatatOlehAkunID,
      Tahap: eff.Tahap,
      Pct: eff.Pct,
      UsiaJam: eff.UsiaJam,
    };
  });
}

export interface KonfigurasiRow {
  DurasiBKJam: number;
  DurasiBBJam: number;
}

export async function getKonfigurasi(): Promise<KonfigurasiRow> {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT DurasiBKJam, DurasiBBJam FROM DashboardProduksiKonfigurasi WHERE ID = 1`);
  return result.recordset[0];
}

// Dipakai dari dalam transaksi (Task 3's isiAirBaru) — Request harus dibuat
// dari sql.Transaction, bukan pool langsung, supaya baca konsisten dalam
// transaksi yang sama.
export async function getKonfigurasiInternal(transaction: sql.Transaction): Promise<KonfigurasiRow> {
  const result = await new sql.Request(transaction).query(`SELECT DurasiBKJam, DurasiBBJam FROM DashboardProduksiKonfigurasi WHERE ID = 1`);
  return result.recordset[0];
}
