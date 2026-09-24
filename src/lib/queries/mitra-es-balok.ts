// src/lib/queries/mitra-es-balok.ts
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";

export type SumberAgen = "utama" | "logistik";

// Maps a LOGICAL (kode, sumber) pair to the PHYSICAL database connection.
// Not 1:1 with kode: pmpersada's and pmpakis's "logistik" both resolve to
// the SAME physical database (FINAC_PMP_LOGISTIC) -- confirmed live: that
// database's PMP_Agen has no BranchID column at all, and 56/159 active
// AgenID rows transact under BOTH BranchID='011' (pmpakis) and '012'
// (pmpersada) in PMP_Pemesanan, so no clean per-Agen split is possible.
// User decision: show it as-is, badged "Logistik (Bersama)" in the UI, with
// pmpersada and pmpakis BOTH reading/writing this one shared connection.
// pmputra's "logistik" is its own separate, non-shared database
// (FINAC_LOGISTIC_PO) -- only the pmpersada/pmpakis pair is special-cased.
export function resolveAgenKoneksi(kode: string, sumber: SumberAgen): { kode: string; label: CompanyKoneksiLabel } {
  if (sumber === "logistik" && (kode === "pmpersada" || kode === "pmpakis")) {
    return { kode: "pmpersada", label: "logistik" };
  }
  return { kode, label: sumber === "logistik" ? "logistik" : "utama" };
}

// pmputra merges utama+logistik into one MitraCard per AgenID (verified
// live: AgenID matches exactly between pmputra's two databases). pmpersada
// and pmpakis do NOT merge -- AgenID does not match between pmpersada's own
// utama and its (shared-with-pmpakis) logistik, confirmed live via a 10/10
// mismatch sample -- so each (sumber, AgenID) pair is its own card.
function sourcesForKode(kode: string): SumberAgen[] {
  if (kode === "pmputra") return ["utama"]; // "logistik" folded into the utama card by getMitraList below
  return ["utama", "logistik"];
}

export interface MitraCard {
  agenId: string;
  sumber: SumberAgen;
  nama: string;
  telepon: string | null;
  isActive: boolean;
  wilayah: string | null;
  alamat: string | null;
  hargaBalokKecil: number;
  hargaBalokBesar: number;
  maksimumHutang: number;
  latitude: number | null;
  longitude: number | null;
}

interface AgenRow {
  AgenID: string;
  Nama: string;
  Telepon: string | null;
  IsActive: boolean;
  BalokKecil: number;
  BalokBesar: number;
  MaksimumHutang: number;
  Wilayah: string | null;
  Alamat: string | null;
  Latitude: number | null;
  Longitude: number | null;
}

// Shared SELECT shape for one (kode,sumber) database -- LEFT JOINs
// PMP_AgenDetail (an Agen may have zero detail rows) -> PMP_Wilayah, and
// DashboardAgenLocation (an Agen may have zero saved pins). IsDeleted=0
// only -- deleted Agen never appear in the list, matching Es Kristal's
// getMitraList (deleteMitra there is also a soft IsDeleted=1).
async function getAgenRows(kode: string, sumber: SumberAgen): Promise<AgenRow[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const result = await pool.request().query(`
    SELECT a.AgenID, a.Nama, a.Telepon, a.IsActive, a.BalokKecil, a.BalokBesar, a.MaksimumHutang,
           w.Nama AS Wilayah, ad.Address1 AS Alamat, loc.Latitude, loc.Longitude
    FROM PMP_Agen a
    LEFT JOIN PMP_AgenDetail ad ON ad.AgenID = a.AgenID AND ISNULL(ad.IsDeleted,0) = 0
    LEFT JOIN PMP_Wilayah w ON w.WilayahID = ad.RegionID
    LEFT JOIN DashboardAgenLocation loc ON loc.AgenID = a.AgenID
    WHERE ISNULL(a.IsDeleted,0) = 0
    ORDER BY a.Nama
  `);
  return result.recordset as AgenRow[];
}

function toCard(row: AgenRow, sumber: SumberAgen): MitraCard {
  return {
    agenId: row.AgenID,
    sumber,
    nama: row.Nama,
    telepon: row.Telepon || null,
    isActive: row.IsActive,
    wilayah: row.Wilayah,
    alamat: row.Alamat,
    hargaBalokKecil: row.BalokKecil,
    hargaBalokBesar: row.BalokBesar,
    maksimumHutang: row.MaksimumHutang,
    latitude: row.Latitude,
    longitude: row.Longitude,
  };
}

export async function getMitraList(kode: string): Promise<MitraCard[]> {
  if (kode === "pmputra") {
    // Merged: one card per AgenID, values taken from "utama" (kantong/GL
    // already established elsewhere in this codebase to source from utama
    // only for pmputra -- see penjualan-piutang.ts's kantong fix). Only
    // "utama" is fetched here since the two databases' PMP_Agen rows for
    // the SAME AgenID carry identical descriptive fields (Nama/Telepon/
    // harga) -- there is nothing additive to merge from logistik for the
    // list view itself; per-Agen order/piutang totals (Task 4) DO combine
    // both databases, since kantong volume, not Agen metadata, is what
    // differs between them.
    const rows = await getAgenRows("pmputra", "utama");
    return rows.map((r) => toCard(r, "utama"));
  }
  const sources = sourcesForKode(kode);
  const perSource = await Promise.all(sources.map((s) => getAgenRows(kode, s)));
  return perSource.flatMap((rows, i) => rows.map((r) => toCard(r, sources[i])));
}

export interface WilayahOption {
  wilayahId: string;
  nama: string;
}

export async function getWilayahOptions(kode: string, sumber: SumberAgen): Promise<WilayahOption[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const result = await pool.request().query(`
    SELECT WilayahID, Nama FROM PMP_Wilayah WHERE ISNULL(IsDeleted,0) = 0 ORDER BY Nama
  `);
  return (result.recordset as { WilayahID: string; Nama: string }[]).map((r) => ({ wilayahId: r.WilayahID, nama: r.Nama }));
}
