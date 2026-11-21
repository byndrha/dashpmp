// src/lib/queries/penjualan-es-balok.ts
//
// Modul Penjualan Es Balok (PMPutra/PMPersada/PMPakis) — padanan modul
// Penjualan Es Kristal (sales-overview.ts / sales.ts / revenue-target.ts),
// tetapi bersumber dari PMP_Pemesanan, bukan SO/DO/SI.
//
// Aturan sumber data (diverifikasi live 2026-11-21, lihat
// scripts/diag-penjualan-es-balok-2026-11-21.ts):
//  - Nominal = (Realisasi - Retur) x Harga, DIJUMLAH dari "utama" + "logistik".
//    Kedua DB mencatat pesanan fisik yang sama dengan komponen harga berbeda
//    (harga es di utama, ongkos logistik di logistik) — sama dengan rumus
//    modul Piutang (getPemesananPeriodByAgen) dan akun GL Pendapatan yang
//    juga menjumlah keduanya.
//  - Qty balok, jumlah dokumen, dan jumlah agen HANYA dari "utama": qty-nya
//    mirror di kedua DB (double-count kalau dijumlah), dan AgenID PMPersada/
//    PMPakis tidak cocok antara utama dan logistik.
//  - TIDAK memakai filter Status: semua pesanan PMPersada berstatus '2'
//    (tidak pernah '3'), PMPakis campur. Realisasi = 0 untuk pesanan yang
//    belum terealisasi, jadi tidak ikut terhitung dengan sendirinya.
//  - Logistik PMPersada/PMPakis adalah satu DB bersama — selalu disaring
//    per BranchID (ownBranchFilter).
//  - Tanggal dianggap tanggal kalender WIB (naive). PMPutra menyimpan
//    tanggal saja; dua PT lain menyimpan jam. "Hari ini" = tanggal WIB,
//    tanpa rollover 14:00 (rollover itu aturan Es Kristal).
import { sql } from "@/lib/db";
import { getCompanyPool } from "@/lib/db-company";
import { getBusinessDateWithRollover } from "@/lib/business-date";
import { resolveAgenKoneksi, type SumberAgen } from "@/lib/queries/mitra-es-balok";
import { ownBranchFilter, getPendapatanByMonth } from "@/lib/queries/penjualan-piutang";
import type { RevenueTarget } from "@/lib/queries/revenue-target";
import type { DateRangeFilter } from "@/types/dashboard";

const SUMBER: SumberAgen[] = ["utama", "logistik"];

// ---------------------------------------------------------------------------
// Tanggal (semua Date di sini = UTC-midnight yang mewakili tanggal WIB)
// ---------------------------------------------------------------------------

export function getTodayWib(): Date {
  // Rollover 24 = tidak pernah rollover → tanggal kalender WIB biasa.
  return getBusinessDateWithRollover(24);
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

function monthStartOf(d: Date, monthsOffset = 0): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthsOffset, 1));
}

function daysInMonth(monthStart: Date): number {
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
}

// Tanggal yang sama `monthsBack` bulan lalu, dijepit ke akhir bulan.
function sameDayMonthsBack(date: Date, monthsBack: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() - monthsBack;
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), dim)));
}

function pctChange(current: number, previous: number): number | null {
  return previous ? ((current - previous) / previous) * 100 : null;
}

// ---------------------------------------------------------------------------
// Agregasi inti
// ---------------------------------------------------------------------------

interface Agg {
  nominalKecil: number;
  nominalBesar: number;
  qtyKecil: number;
  qtyBesar: number;
  dokumen: number;
  agen: number;
}

const EMPTY: Agg = { nominalKecil: 0, nominalBesar: 0, qtyKecil: 0, qtyBesar: 0, dokumen: 0, agen: 0 };

type Grouping = "all" | "day" | "month";

function groupExpr(g: Grouping): string {
  if (g === "day") return "CONVERT(varchar(10), Tanggal, 120)";
  if (g === "month") return "CONVERT(varchar(7), Tanggal, 120)";
  return "'all'";
}

// Klausa wilayah berjalan di DB masing-masing (PMP_AgenDetail/PMP_Wilayah
// milik DB itu sendiri), dicocokkan lewat NAMA wilayah — AgenID/WilayahID
// tidak bisa diandalkan lintas DB untuk PMPersada/PMPakis.
const WILAYAH_CLAUSE = `AND AgenID IN (
  SELECT ad.AgenID FROM PMP_AgenDetail ad
  JOIN PMP_Wilayah w ON w.WilayahID = ad.RegionID
  WHERE ISNULL(ad.IsDeleted,0) = 0 AND w.Nama = @wilayah)`;

async function aggregateSumber(
  kode: string,
  sumber: SumberAgen,
  start: Date,
  end: Date,
  grouping: Grouping,
  wilayah?: string
): Promise<Map<string, Agg>> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const branchId = ownBranchFilter(kode, sumber);
  const request = pool.request().input("start", sql.DateTime, start).input("end", sql.DateTime, end);
  if (branchId) request.input("branchId", sql.VarChar(16), branchId);
  if (wilayah) request.input("wilayah", sql.VarChar(128), wilayah);
  const g = groupExpr(grouping);

  const result = await request.query(`
    SELECT ${g} AS K,
      SUM((ISNULL(BalokKecilRealisasi,0) - ISNULL(BalokKecilRetur,0)) * ISNULL(BalokKecilHarga,0)) AS NominalKecil,
      SUM((ISNULL(BalokBesarRealisasi,0) - ISNULL(BalokBesarRetur,0)) * ISNULL(BalokBesarHarga,0)) AS NominalBesar,
      SUM(ISNULL(BalokKecilRealisasi,0) - ISNULL(BalokKecilRetur,0)) AS QtyKecil,
      SUM(ISNULL(BalokBesarRealisasi,0) - ISNULL(BalokBesarRetur,0)) AS QtyBesar,
      SUM(CASE WHEN ISNULL(BalokKecilRealisasi,0) + ISNULL(BalokBesarRealisasi,0) > 0 THEN 1 ELSE 0 END) AS Dokumen,
      COUNT(DISTINCT CASE WHEN ISNULL(BalokKecilRealisasi,0) + ISNULL(BalokBesarRealisasi,0) > 0 THEN AgenID END) AS Agen
    FROM PMP_Pemesanan
    WHERE ISNULL(IsDeleted,0) = 0 AND ISNULL(IsVoid,0) = 0
      AND Tanggal >= @start AND Tanggal < @end
      ${branchId ? "AND BranchID = @branchId" : ""}
      ${wilayah ? WILAYAH_CLAUSE : ""}
    ${grouping === "all" ? "" : `GROUP BY ${g}`}
  `);

  const map = new Map<string, Agg>();
  for (const r of result.recordset as {
    K: string;
    NominalKecil: number | null;
    NominalBesar: number | null;
    QtyKecil: number | null;
    QtyBesar: number | null;
    Dokumen: number | null;
    Agen: number | null;
  }[]) {
    map.set(r.K, {
      nominalKecil: Number(r.NominalKecil ?? 0),
      nominalBesar: Number(r.NominalBesar ?? 0),
      qtyKecil: Number(r.QtyKecil ?? 0),
      qtyBesar: Number(r.QtyBesar ?? 0),
      dokumen: Number(r.Dokumen ?? 0),
      agen: Number(r.Agen ?? 0),
    });
  }
  return map;
}

// Gabungan utama+logistik per kunci: nominal dijumlah, sisanya dari utama.
async function aggregate(
  kode: string,
  start: Date,
  end: Date,
  grouping: Grouping,
  wilayah?: string
): Promise<Map<string, Agg>> {
  const [utama, logistik] = await Promise.all(
    SUMBER.map((s) => aggregateSumber(kode, s, start, end, grouping, wilayah))
  );
  const keys = new Set([...utama.keys(), ...logistik.keys()]);
  const merged = new Map<string, Agg>();
  for (const k of keys) {
    const u = utama.get(k) ?? EMPTY;
    const l = logistik.get(k) ?? EMPTY;
    merged.set(k, {
      nominalKecil: u.nominalKecil + l.nominalKecil,
      nominalBesar: u.nominalBesar + l.nominalBesar,
      qtyKecil: u.qtyKecil,
      qtyBesar: u.qtyBesar,
      dokumen: u.dokumen,
      agen: u.agen,
    });
  }
  return merged;
}

async function aggregateRange(kode: string, start: Date, end: Date): Promise<Agg> {
  return (await aggregate(kode, start, end, "all")).get("all") ?? EMPTY;
}

const nominalOf = (a: Agg) => a.nominalKecil + a.nominalBesar;
const qtyOf = (a: Agg) => a.qtyKecil + a.qtyBesar;
const hargaKecilOf = (a: Agg) => (a.qtyKecil ? a.nominalKecil / a.qtyKecil : 0);
const hargaBesarOf = (a: Agg) => (a.qtyBesar ? a.nominalBesar / a.qtyBesar : 0);

// ---------------------------------------------------------------------------
// Panel "Penjualan Hari Ini"
// ---------------------------------------------------------------------------

export interface PenjualanBalokHari {
  dateISO: string;
  nominal: number;
  qtyKecil: number;
  qtyBesar: number;
  dokumen: number;
  agen: number;
  hargaKecil: number;
  hargaBesar: number;
  kemarinQty: number;
  bulanLaluNominal: number;
  growthPercent: number | null;
}

export async function getPenjualanBalokHari(kode: string, dateISO: string): Promise<PenjualanBalokHari> {
  const day = new Date(`${dateISO}T00:00:00Z`);
  const bulanLalu = sameDayMonthsBack(day, 1);
  const [hari, kemarin, bl] = await Promise.all([
    aggregateRange(kode, day, addDays(day, 1)),
    aggregateRange(kode, addDays(day, -1), day),
    aggregateRange(kode, bulanLalu, addDays(bulanLalu, 1)),
  ]);
  const nominal = nominalOf(hari);
  const bulanLaluNominal = nominalOf(bl);
  return {
    dateISO,
    nominal,
    qtyKecil: hari.qtyKecil,
    qtyBesar: hari.qtyBesar,
    dokumen: hari.dokumen,
    agen: hari.agen,
    hargaKecil: hargaKecilOf(hari),
    hargaBesar: hargaBesarOf(hari),
    kemarinQty: qtyOf(kemarin),
    bulanLaluNominal,
    growthPercent: pctChange(nominal, bulanLaluNominal),
  };
}

// ---------------------------------------------------------------------------
// Panel bulanan (perbandingan + rata-rata)
// ---------------------------------------------------------------------------

export interface PerbandinganBalok {
  label: string; // "YYYY/MM"
  nominal: number;
  qty: number;
  nominalPct: number | null;
  qtyPct: number | null;
}

export interface RataRataBalok {
  balokPerHari: number;
  balokPerHariLalu: number;
  balokPerHariPct: number | null;
  hargaKecil: number;
  hargaKecilLalu: number;
  hargaKecilPct: number | null;
  hargaBesar: number;
  hargaBesarLalu: number;
  hargaBesarPct: number | null;
}

export interface PenjualanBalokBulan {
  monthISO: string; // "YYYY-MM-01"
  isCurrentMonth: boolean;
  nominal: number;
  qty: number;
  perbandingan: PerbandinganBalok[];
  rataRata: RataRataBalok;
}

function yearMonthLabel(d: Date): string {
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Bulan berjalan = s.d. hari ini (sebagian); bulan lampau = bulan penuh.
// Pembanding selalu bulan penuh — sama dengan getSalesComparisonForMonth Es Kristal.
export async function getPenjualanBalokBulan(kode: string, monthISO: string): Promise<PenjualanBalokBulan> {
  const today = getTodayWib();
  const monthStart = new Date(`${monthISO.slice(0, 7)}-01T00:00:00Z`);
  const isCurrentMonth =
    monthStart.getUTCFullYear() === today.getUTCFullYear() && monthStart.getUTCMonth() === today.getUTCMonth();
  const nextMonth = monthStartOf(monthStart, 1);
  const thisEnd = isCurrentMonth ? addDays(today, 1) : nextMonth;

  const lalu = monthStartOf(monthStart, -1);
  const tahunLalu = monthStartOf(monthStart, -12);
  const duaTahunLalu = monthStartOf(monthStart, -24);

  const [ini, bLalu, tLalu, dtLalu] = await Promise.all([
    aggregateRange(kode, monthStart, thisEnd),
    aggregateRange(kode, lalu, monthStart),
    aggregateRange(kode, tahunLalu, monthStartOf(tahunLalu, 1)),
    aggregateRange(kode, duaTahunLalu, monthStartOf(duaTahunLalu, 1)),
  ]);

  const nominal = nominalOf(ini);
  const qty = qtyOf(ini);
  const banding = (start: Date, a: Agg): PerbandinganBalok => ({
    label: yearMonthLabel(start),
    nominal: nominalOf(a),
    qty: qtyOf(a),
    nominalPct: pctChange(nominal, nominalOf(a)),
    qtyPct: pctChange(qty, qtyOf(a)),
  });

  const hariIni = isCurrentMonth ? today.getUTCDate() : daysInMonth(monthStart);
  const hariLalu = daysInMonth(lalu);
  const balokPerHari = hariIni ? qty / hariIni : 0;
  const balokPerHariLalu = hariLalu ? qtyOf(bLalu) / hariLalu : 0;

  return {
    monthISO: toISO(monthStart),
    isCurrentMonth,
    nominal,
    qty,
    perbandingan: [banding(lalu, bLalu), banding(tahunLalu, tLalu), banding(duaTahunLalu, dtLalu)],
    rataRata: {
      balokPerHari,
      balokPerHariLalu,
      balokPerHariPct: pctChange(balokPerHari, balokPerHariLalu),
      hargaKecil: hargaKecilOf(ini),
      hargaKecilLalu: hargaKecilOf(bLalu),
      hargaKecilPct: pctChange(hargaKecilOf(ini), hargaKecilOf(bLalu)),
      hargaBesar: hargaBesarOf(ini),
      hargaBesarLalu: hargaBesarOf(bLalu),
      hargaBesarPct: pctChange(hargaBesarOf(ini), hargaBesarOf(bLalu)),
    },
  };
}

// ---------------------------------------------------------------------------
// Tahun berjalan
// ---------------------------------------------------------------------------

export interface PenjualanBalokYtd {
  nominal: number;
  qtyKecil: number;
  qtyBesar: number;
  dokumen: number;
  agen: number;
  pembayaran: number;
  hargaRata: number;
}

// Pembayaran = uang muka di PMP_Pemesanan + setoran di PMP_Pembayaran,
// dari kedua DB — sama dengan komponen "Pembayaran" di modul Piutang.
async function getPembayaranSumber(kode: string, sumber: SumberAgen, start: Date, end: Date): Promise<number> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const branchId = ownBranchFilter(kode, sumber);
  const request = pool.request().input("start", sql.DateTime, start).input("end", sql.DateTime, end);
  if (branchId) request.input("branchId", sql.VarChar(16), branchId);
  const bf = branchId ? "AND BranchID = @branchId" : "";
  const result = await request.query(`
    SELECT
      (SELECT ISNULL(SUM(ISNULL(Pembayaran,0)),0) FROM PMP_Pemesanan
        WHERE ISNULL(IsDeleted,0) = 0 AND ISNULL(IsVoid,0) = 0 AND Tanggal >= @start AND Tanggal < @end ${bf})
      +
      (SELECT ISNULL(SUM(ISNULL(Pembayaran,0)),0) FROM PMP_Pembayaran
        WHERE ISNULL(IsDeleted,0) = 0 AND Tanggal >= @start AND Tanggal < @end ${bf}) AS Total
  `);
  return Number(result.recordset[0]?.Total ?? 0);
}

export async function getPenjualanBalokYtd(kode: string): Promise<PenjualanBalokYtd> {
  const today = getTodayWib();
  const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  const end = addDays(today, 1);
  const [agg, ...bayar] = await Promise.all([
    aggregateRange(kode, yearStart, end),
    ...SUMBER.map((s) => getPembayaranSumber(kode, s, yearStart, end)),
  ]);
  const a = agg as Agg;
  const qty = qtyOf(a);
  return {
    nominal: nominalOf(a),
    qtyKecil: a.qtyKecil,
    qtyBesar: a.qtyBesar,
    dokumen: a.dokumen,
    agen: a.agen,
    pembayaran: (bayar as number[]).reduce((s, v) => s + v, 0),
    hargaRata: qty ? nominalOf(a) / qty : 0,
  };
}

// ---------------------------------------------------------------------------
// Tren harian & bulanan
// ---------------------------------------------------------------------------

export interface TrenBalokPoint {
  key: string; // "YYYY-MM-DD" (harian) atau "YYYY-MM" (bulanan)
  nominal: number;
  qtyKecil: number;
  qtyBesar: number;
  dokumen: number;
  pendapatanGL?: number; // hanya bulanan
}

const MAX_HARI_TREN = 400;

// Rentang [startDate, endDate) dari FilterBar; endDate eksklusif. Semua hari
// diisi (hari tanpa penjualan = 0) supaya grafik tidak melompati tanggal.
export async function getTrenHarianBalok(kode: string, filter: DateRangeFilter): Promise<TrenBalokPoint[]> {
  const start = new Date(`${filter.startDate}T00:00:00Z`);
  let end = new Date(`${filter.endDate}T00:00:00Z`);
  if (!(end > start)) return [];
  if ((end.getTime() - start.getTime()) / 86_400_000 > MAX_HARI_TREN) end = addDays(start, MAX_HARI_TREN);
  const map = await aggregate(kode, start, end, "day", filter.wilayah);
  const points: TrenBalokPoint[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) {
    const key = toISO(d);
    const a = map.get(key) ?? EMPTY;
    points.push({ key, nominal: nominalOf(a), qtyKecil: a.qtyKecil, qtyBesar: a.qtyBesar, dokumen: a.dokumen });
  }
  return points;
}

// 12 bulan yang berakhir di bulan berjalan, digeser `yearsBack` tahun.
// Tooltip juga membawa Pendapatan GL (akun pendapatan resmi) sebagai pembanding.
export async function getTrenBulananBalok(kode: string, yearsBack = 0, wilayah?: string): Promise<TrenBalokPoint[]> {
  const today = getTodayWib();
  const endMonth = monthStartOf(today, 1 - yearsBack * 12);
  const startMonth = monthStartOf(endMonth, -12);
  const [map, glUtama, glLogistik] = await Promise.all([
    aggregate(kode, startMonth, endMonth, "month", wilayah),
    wilayah ? Promise.resolve(new Map<string, number>()) : getPendapatanByMonth(kode, "utama", startMonth, endMonth),
    wilayah ? Promise.resolve(new Map<string, number>()) : getPendapatanByMonth(kode, "logistik", startMonth, endMonth),
  ]);
  const points: TrenBalokPoint[] = [];
  for (let i = 0; i < 12; i++) {
    const key = toISO(monthStartOf(startMonth, i)).slice(0, 7);
    const a = map.get(key) ?? EMPTY;
    points.push({
      key,
      nominal: nominalOf(a),
      qtyKecil: a.qtyKecil,
      qtyBesar: a.qtyBesar,
      dokumen: a.dokumen,
      pendapatanGL: wilayah ? undefined : (glUtama.get(key) ?? 0) + (glLogistik.get(key) ?? 0),
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Daftar wilayah (untuk FilterBar)
// ---------------------------------------------------------------------------

export async function getWilayahListBalok(kode: string): Promise<string[]> {
  const names = new Set<string>();
  for (const s of SUMBER) {
    const { kode: physKode, label } = resolveAgenKoneksi(kode, s);
    const pool = await getCompanyPool(physKode, label);
    const result = await pool
      .request()
      .query(`SELECT DISTINCT LTRIM(RTRIM(Nama)) AS Nama FROM PMP_Wilayah WHERE ISNULL(IsDeleted,0) = 0 AND Nama IS NOT NULL`);
    for (const r of result.recordset as { Nama: string }[]) if (r.Nama) names.add(r.Nama);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "id"));
}

// ---------------------------------------------------------------------------
// Target pendapatan bulanan (DashboardBalokTarget di DB "utama" tiap PT —
// dibuat oleh scripts/create-balok-target-schema.ts). Bentuk keluaran sama
// dengan RevenueTarget Es Kristal supaya RevenueTargetPanel bisa dipakai ulang.
// ---------------------------------------------------------------------------

export async function getTargetBalok(kode: string, year: number, month: number): Promise<RevenueTarget> {
  const today = getTodayWib();
  const isCurrentMonth = year === today.getUTCFullYear() && month === today.getUTCMonth() + 1;
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const dim = daysInMonth(monthStart);
  const currentDay = isCurrentMonth ? today.getUTCDate() : dim;
  const remainingDays = isCurrentMonth ? dim - currentDay : 0;
  const end = isCurrentMonth ? addDays(today, 1) : monthStartOf(monthStart, 1);

  const pool = await getCompanyPool(kode, "utama");
  const [targetResult, realisasi] = await Promise.all([
    pool
      .request()
      .input("year", sql.Int, year)
      .input("month", sql.Int, month)
      .query(`SELECT TargetNominal, TargetQty FROM DashboardBalokTarget WHERE TargetYear = @year AND TargetMonth = @month`),
    aggregateRange(kode, monthStart, end),
  ]);
  const row = targetResult.recordset[0] as { TargetNominal: number; TargetQty: number } | undefined;
  const realNominal = nominalOf(realisasi);
  const realQty = qtyOf(realisasi);

  function compute(targetMonthly: number | null, real: number) {
    if (targetMonthly == null) {
      return { daily: null, toDate: null, growth: null, growthPct: null, besok: null };
    }
    const daily = targetMonthly / dim;
    const toDate = isCurrentMonth ? daily * currentDay : targetMonthly;
    const growth = real - toDate;
    return {
      daily,
      toDate,
      growth,
      growthPct: toDate ? (growth / toDate) * 100 : null,
      besok: remainingDays > 0 ? (targetMonthly - real) / remainingDays : null,
    };
  }

  const targetNominal = row ? Number(row.TargetNominal) : null;
  const targetQty = row ? Number(row.TargetQty) : null;
  const n = compute(targetNominal, realNominal);
  const q = compute(targetQty, realQty);

  return {
    Year: year,
    Month: month,
    DaysInMonth: dim,
    CurrentDay: currentDay,
    Today: isCurrentMonth ? toISO(today) : toISO(addDays(monthStartOf(monthStart, 1), -1)),
    RemainingDays: remainingDays,
    IsCurrentMonth: isCurrentMonth,

    TargetNominalMonthly: targetNominal,
    TargetNominalDaily: n.daily,
    TargetNominalToDate: n.toDate,
    RealisasiNominalToDate: realNominal,
    GrowthNominal: n.growth,
    GrowthNominalPercent: n.growthPct,
    TargetNominalBesok: n.besok,

    TargetQtyMonthly: targetQty,
    TargetQtyDaily: q.daily,
    TargetQtyToDate: q.toDate,
    RealisasiQtyToDate: realQty,
    GrowthQty: q.growth,
    GrowthQtyPercent: q.growthPct,
    TargetQtyBesok: q.besok,
  };
}

export async function setTargetBalok(
  kode: string,
  input: { year: number; month: number; targetNominal: number; targetQty: number; userId: string }
): Promise<void> {
  const pool = await getCompanyPool(kode, "utama");
  await pool
    .request()
    .input("year", sql.Int, input.year)
    .input("month", sql.Int, input.month)
    .input("targetNominal", sql.Decimal(23, 4), input.targetNominal)
    .input("targetQty", sql.Decimal(23, 4), input.targetQty)
    .input("userId", sql.VarChar(64), input.userId).query(`
      MERGE DashboardBalokTarget AS t
      USING (SELECT @year AS TargetYear, @month AS TargetMonth) AS src
      ON t.TargetYear = src.TargetYear AND t.TargetMonth = src.TargetMonth
      WHEN MATCHED THEN
        UPDATE SET TargetNominal = @targetNominal, TargetQty = @targetQty, UpdatedByUserID = @userId, UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (TargetYear, TargetMonth, TargetNominal, TargetQty, CreatedByUserID)
        VALUES (@year, @month, @targetNominal, @targetQty, @userId);
    `);
}
