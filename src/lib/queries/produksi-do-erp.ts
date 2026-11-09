import sql from "mssql";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import type { KodeProduksi } from "@/lib/produksi-denah";
import { tanggalBisnisNaive, type DoKendaraan } from "@/lib/produksi-operasional";

// Baca ERP Es Balok (READ-ONLY): armada, agen, dan DO per kendaraan untuk pencocokan panen.
//
// Sumber DO, dicek live (read-only) 2026-11-09, PMP_Penjadwalan → PMP_PenjadwalanDetail →
// PMP_Pemesanan, 2–9 Nov 2026, per plat per hari:
// - PMPersada: `utama` (FINAC_ES_TB) dan `logistik` (BranchID '012') berisi muatan per
//   kendaraan per hari yang identik (hanya NoDokumen …/HO vs …/TB beda). Pakai `utama` saja,
//   menjumlahkan keduanya = muatan terhitung dua kali.
// - PMPakis: koneksi "pmpakis/logistik" menunjuk database fisik yang sama dengan
//   "pmpersada/logistik" (hasil BranchID '011' identik baris demi baris). Dibandingkan dengan
//   `utama` PMPakis: 7–8 Nov identik, tetapi 2, 3, dan 9 Nov berbeda (mis. 9 Nov `logistik`
//   belum memuat S 9464 UH 270 dan S 8003 UE baru 1 dari 2 DO; 2–3 Nov total harian berbeda
//   ±216–243 karena kendaraan/realisasi diubah di salah satu sisi). `utama` PMPakis paling
//   mutakhir dan hanya berisi PMPakis (BranchID '011', plus 2 baris BranchID ''), jadi dipakai
//   `utama` tanpa filter branch — sama polanya dengan PMPersada.
// Status tidak difilter karena realisasi balok sudah terisi sejak Status '2' (PMPersada hanya
// punya Status '2' sejak Agu 2026; PMPakis punya '2' dan '3', dan baris pindah 2→3 belakangan
// — di `utama` PMPakis Status '3' terakhir 2 Nov). Menyaring per Status akan membuang hari-hari
// terbaru. Semua pemesanan aktif (IsDeleted=0, IsVoid=0) sejak Agu 2026 sudah punya jadwal.
export const SUMBER_DO: Record<KodeProduksi, { label: CompanyKoneksiLabel; branchId: string | null }> = {
  pmpersada: { label: "utama", branchId: null },
  pmpakis: { label: "utama", branchId: null },
};

export interface KendaraanArmada {
  kendaraanErpId: string;
  plat: string;
  sopir: string | null;
}

export interface BarisDo {
  noDo: string;
  tanggal: Date; // naive WIB (komponen UTC = jam dinding WIB)
  kendaraanErpId: string;
  plat: string;
  kecil: number;
  besar: number;
}

/** Murni: saring baris ke tanggal bisnis (rollover panen) lalu jumlahkan per kendaraan. */
export function kelompokkanDo(rows: BarisDo[], tanggalBisnis: string): DoKendaraan[] {
  const per = new Map<string, DoKendaraan>();
  for (const r of rows) {
    if (tanggalBisnisNaive(r.tanggal) !== tanggalBisnis) continue;
    let d = per.get(r.kendaraanErpId);
    if (!d) {
      d = { kendaraanErpId: r.kendaraanErpId, plat: r.plat, kecil: 0, besar: 0, noDo: [] };
      per.set(r.kendaraanErpId, d);
    }
    d.kecil += r.kecil;
    d.besar += r.besar;
    if (!d.noDo.includes(r.noDo)) d.noDo.push(r.noDo);
  }
  return [...per.values()].sort((a, b) => a.plat.localeCompare(b.plat));
}

function poolUntuk(kode: KodeProduksi) {
  return getCompanyPool(kode, SUMBER_DO[kode].label);
}

export async function getKendaraanArmada(kode: KodeProduksi): Promise<KendaraanArmada[]> {
  const pool = await poolUntuk(kode);
  const result = await pool.request().query(`
    SELECT k.DaftarKendaraanID, k.Nama AS Plat, s.Nama AS Sopir
    FROM PMP_DaftarKendaraan k
    LEFT JOIN PMP_Sopir s ON s.SopirID = k.SopirID AND ISNULL(s.IsDeleted, 0) = 0
    WHERE ISNULL(k.IsDeleted, 0) = 0
    ORDER BY k.Nama
  `);
  return (result.recordset as { DaftarKendaraanID: string; Plat: string; Sopir: string | null }[]).map((r) => ({
    kendaraanErpId: r.DaftarKendaraanID,
    plat: r.Plat,
    sopir: r.Sopir,
  }));
}

export async function cariAgen(kode: KodeProduksi, q: string): Promise<{ agenId: string; nama: string }[]> {
  const kata = q.trim();
  if (!kata) return [];
  const pola = `%${kata.replace(/[[%_]/g, "[$&]")}%`;
  const pool = await poolUntuk(kode);
  const result = await pool
    .request()
    .input("pola", sql.VarChar(200), pola)
    .query(`
      SELECT TOP 20 AgenID, Nama
      FROM PMP_Agen
      WHERE ISNULL(IsDeleted, 0) = 0 AND (Nama LIKE @pola OR Code LIKE @pola)
      ORDER BY Nama
    `);
  return (result.recordset as { AgenID: string; Nama: string }[]).map((r) => ({ agenId: r.AgenID, nama: r.Nama }));
}

function geserHari(tanggal: string, hari: number): Date {
  const [y, m, d] = tanggal.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + hari));
}

export async function getDoPerKendaraan(kode: KodeProduksi, tanggalBisnis: string): Promise<DoKendaraan[]> {
  const { branchId } = SUMBER_DO[kode];
  const pool = await poolUntuk(kode);
  // Rentang naive lebar [H-1 00:00, H+1 00:00); pemotongan tepat (rollover) di kelompokkanDo.
  const request = pool
    .request()
    .input("mulai", sql.DateTime, geserHari(tanggalBisnis, -1))
    .input("akhir", sql.DateTime, geserHari(tanggalBisnis, 1));
  if (branchId !== null) request.input("branchId", sql.VarChar(16), branchId);
  const result = await request.query(`
    SELECT j.NoDokumen, j.Tanggal, k.DaftarKendaraanID, k.Nama AS Plat,
           ISNULL(p.BalokKecilRealisasi, 0) AS Kecil, ISNULL(p.BalokBesarRealisasi, 0) AS Besar
    FROM PMP_Penjadwalan j
    JOIN PMP_PenjadwalanDetail d ON d.PenjadwalanID = j.PenjadwalanID AND ISNULL(d.IsDeleted, 0) = 0
    JOIN PMP_Pemesanan p ON p.PemesananID = d.PemesananID
      AND ISNULL(p.IsDeleted, 0) = 0 AND ISNULL(p.IsVoid, 0) = 0
    JOIN PMP_DaftarKendaraan k ON k.DaftarKendaraanID = j.DaftarKendaraanID
    WHERE ISNULL(j.IsDeleted, 0) = 0
      AND j.Tanggal >= @mulai AND j.Tanggal < @akhir
      ${branchId !== null ? "AND j.BranchID = @branchId" : ""}
  `);
  const rows: BarisDo[] = (
    result.recordset as {
      NoDokumen: string;
      Tanggal: Date;
      DaftarKendaraanID: string;
      Plat: string;
      Kecil: number;
      Besar: number;
    }[]
  ).map((r) => ({
    noDo: r.NoDokumen,
    tanggal: r.Tanggal,
    kendaraanErpId: r.DaftarKendaraanID,
    plat: r.Plat,
    kecil: Number(r.Kecil),
    besar: Number(r.Besar),
  }));
  return kelompokkanDo(rows, tanggalBisnis);
}
