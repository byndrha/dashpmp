import { getPool, sql } from "@/lib/db";
import type { ShiftNumber } from "@/lib/report-shift";

export interface KendalaPerJenis {
  jenisKendala: string;
  jumlah: number;
}

export interface AktivitasMuatanDistribusiRow {
  tanggalUsaha: string;
  shift: ShiftNumber;
  salesmanId: string;
  driverName: string;
  jumlahMuat: number;
  totalQty10KG: number;
  totalQty5KG: number;
  totalKantongEkivalen: number;
  jumlahKendala: number;
  kendalaPerJenis: KendalaPerJenis[];
  totalLiterBBM: number;
  totalNominalBBM: number;
  jumlahSesiIstirahat: number;
  totalDurasiIstirahatMenit: number;
}

// Bucketing shift dihitung LANGSUNG di SQL (DATEADD(HOUR, 7, ...) pada
// JamSelesaiMuat, kolom true-UTC terkonfirmasi -- lihat spec Tahap 2
// Bagian 5), BUKAN via getShiftWindow/naiveWibToUtcInstant di JS --
// karena JamSelesaiMuat tidak pernah dibaca balik jadi objek Date JS untuk
// dimanipulasi, hanya dibandingkan/dikelompokkan di dalam SQL, menghindari
// ambiguitas bagaimana driver `mssql` merepresentasikan nilai DATETIME
// yang di-fetch. Logika CASE di bawah mencerminkan persis
// getShiftNumber/getBusinessDateWithRollover di report-shift.ts/
// business-date.ts (rollover hour 15 untuk "work"): Shift 3 untuk jam WIB
// >=23 atau <7, Shift 1 untuk <15, selain itu Shift 2; tanggal usaha maju
// 1 hari begitu jam WIB >= 15.
const JADWAL_SHIFT_FROM = `
  DashboardPengirimanJadwal j
  LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
`;

const SHIFT_CASE = `
  CASE
    WHEN DATEPART(HOUR, DATEADD(HOUR, 7, j.JamSelesaiMuat)) >= 23
      OR DATEPART(HOUR, DATEADD(HOUR, 7, j.JamSelesaiMuat)) < 7 THEN 3
    WHEN DATEPART(HOUR, DATEADD(HOUR, 7, j.JamSelesaiMuat)) < 15 THEN 1
    ELSE 2
  END
`;

const TANGGAL_USAHA_CASE = `
  CASE
    WHEN DATEPART(HOUR, DATEADD(HOUR, 7, j.JamSelesaiMuat)) >= 15
      THEN CAST(DATEADD(DAY, 1, DATEADD(HOUR, 7, j.JamSelesaiMuat)) AS DATE)
    ELSE CAST(DATEADD(HOUR, 7, j.JamSelesaiMuat) AS DATE)
  END
`;

// Urutan kronologis dalam satu TanggalUsaha adalah Shift 2 -> 3 -> 1
// (lihat Global Constraints), bukan urutan angka -- dipetakan ke rank
// 1/2/3 untuk ORDER BY.
const SHIFT_SORT_RANK = `CASE js.Shift WHEN 2 THEN 1 WHEN 3 THEN 2 WHEN 1 THEN 3 END`;

export async function getAktivitasMuatanDistribusi(tahun: number, bulan: number): Promise<AktivitasMuatanDistribusiRow[]> {
  const pool = await getPool();
  const awalBulan = new Date(Date.UTC(tahun, bulan - 1, 1));
  const akhirBulan = new Date(Date.UTC(tahun, bulan, 1));
  // Filter kasar pada JamSelesaiMuat -- murni untuk performa (membatasi
  // baris yang perlu di-scan), bukan sumber kebenaran shift. Kebenaran
  // datang dari WHERE pada TanggalUsaha hasil hitung SQL di bawah. Buffer
  // 2 hari di awal cukup menutupi kuirk "Shift 2 jatuh di tanggal
  // sebelumnya" (lihat getShiftWindow di report-shift.ts).
  const awalMuat = new Date(awalBulan.getTime() - 2 * 24 * 60 * 60 * 1000);
  const akhirMuat = new Date(akhirBulan.getTime() + 1 * 24 * 60 * 60 * 1000);

  const utamaResult = await pool
    .request()
    .input("awalMuat", sql.DateTime, awalMuat)
    .input("akhirMuat", sql.DateTime, akhirMuat)
    .input("awalBulan", sql.Date, awalBulan)
    .input("akhirBulan", sql.Date, akhirBulan).query(`
      WITH JadwalShift AS (
        SELECT
          j.JadwalID,
          j.SalesmanID,
          sm.Name AS DriverName,
          j.Qty5KGDimuat,
          ${TANGGAL_USAHA_CASE} AS TanggalUsaha,
          ${SHIFT_CASE} AS Shift
        FROM ${JADWAL_SHIFT_FROM}
        WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL
          AND j.JamSelesaiMuat >= @awalMuat AND j.JamSelesaiMuat < @akhirMuat
      ),
      Qty10PerJadwal AS (
        SELECT JadwalID, SUM(Qty10KGDiambil) AS TotalQty10KG
        FROM DashboardProduksiMuatanDetail
        GROUP BY JadwalID
      ),
      KendalaPerJadwal AS (
        SELECT JadwalID, COUNT(*) AS JumlahKendala
        FROM DashboardPengirimanKendala
        GROUP BY JadwalID
      ),
      BBMPerJadwal AS (
        SELECT JadwalID, SUM(Liter) AS TotalLiter, SUM(NominalAsli + NominalEkstra) AS TotalNominal
        FROM DashboardPengirimanBBM
        WHERE WaktuIsi IS NOT NULL
        GROUP BY JadwalID
      ),
      IstirahatPerJadwal AS (
        SELECT JadwalID, COUNT(*) AS JumlahSesi,
               SUM(DATEDIFF(MINUTE, WaktuMulai, ISNULL(WaktuSelesai, GETDATE()))) AS TotalDurasiMenit
        FROM DashboardPengirimanIstirahat
        GROUP BY JadwalID
      )
      SELECT
        js.TanggalUsaha,
        js.Shift,
        js.SalesmanID,
        js.DriverName,
        COUNT(*) AS JumlahMuat,
        ISNULL(SUM(q10.TotalQty10KG), 0) AS TotalQty10KG,
        ISNULL(SUM(js.Qty5KGDimuat), 0) AS TotalQty5KG,
        ISNULL(SUM(k.JumlahKendala), 0) AS JumlahKendala,
        ISNULL(SUM(b.TotalLiter), 0) AS TotalLiterBBM,
        ISNULL(SUM(b.TotalNominal), 0) AS TotalNominalBBM,
        ISNULL(SUM(i.JumlahSesi), 0) AS JumlahSesiIstirahat,
        ISNULL(SUM(i.TotalDurasiMenit), 0) AS TotalDurasiIstirahatMenit
      FROM JadwalShift js
      LEFT JOIN Qty10PerJadwal q10 ON q10.JadwalID = js.JadwalID
      LEFT JOIN KendalaPerJadwal k ON k.JadwalID = js.JadwalID
      LEFT JOIN BBMPerJadwal b ON b.JadwalID = js.JadwalID
      LEFT JOIN IstirahatPerJadwal i ON i.JadwalID = js.JadwalID
      WHERE js.TanggalUsaha >= @awalBulan AND js.TanggalUsaha < @akhirBulan
      GROUP BY js.TanggalUsaha, js.Shift, js.SalesmanID, js.DriverName
      ORDER BY js.TanggalUsaha, ${SHIFT_SORT_RANK}
    `);

  const kendalaResult = await pool
    .request()
    .input("awalMuat", sql.DateTime, awalMuat)
    .input("akhirMuat", sql.DateTime, akhirMuat)
    .input("awalBulan", sql.Date, awalBulan)
    .input("akhirBulan", sql.Date, akhirBulan).query(`
      WITH JadwalShift AS (
        SELECT
          j.JadwalID,
          j.SalesmanID,
          ${TANGGAL_USAHA_CASE} AS TanggalUsaha,
          ${SHIFT_CASE} AS Shift
        FROM ${JADWAL_SHIFT_FROM}
        WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL
          AND j.JamSelesaiMuat >= @awalMuat AND j.JamSelesaiMuat < @akhirMuat
      )
      SELECT js.TanggalUsaha, js.Shift, js.SalesmanID, k.JenisKendala, COUNT(*) AS Jumlah
      FROM JadwalShift js
      JOIN DashboardPengirimanKendala k ON k.JadwalID = js.JadwalID
      WHERE js.TanggalUsaha >= @awalBulan AND js.TanggalUsaha < @akhirBulan
      GROUP BY js.TanggalUsaha, js.Shift, js.SalesmanID, k.JenisKendala
    `);

  const kendalaMap = new Map<string, KendalaPerJenis[]>();
  for (const row of kendalaResult.recordset as {
    TanggalUsaha: Date;
    Shift: number;
    SalesmanID: string;
    JenisKendala: string;
    Jumlah: number;
  }[]) {
    const key = `${row.TanggalUsaha.toISOString().slice(0, 10)}-${row.Shift}-${row.SalesmanID}`;
    const list = kendalaMap.get(key) ?? [];
    list.push({ jenisKendala: row.JenisKendala, jumlah: row.Jumlah });
    kendalaMap.set(key, list);
  }

  return (
    utamaResult.recordset as {
      TanggalUsaha: Date;
      Shift: number;
      SalesmanID: string;
      DriverName: string | null;
      JumlahMuat: number;
      TotalQty10KG: number;
      TotalQty5KG: number;
      JumlahKendala: number;
      TotalLiterBBM: number;
      TotalNominalBBM: number;
      JumlahSesiIstirahat: number;
      TotalDurasiIstirahatMenit: number;
    }[]
  ).map((r) => {
    const tanggalUsaha = r.TanggalUsaha.toISOString().slice(0, 10);
    const key = `${tanggalUsaha}-${r.Shift}-${r.SalesmanID}`;
    return {
      tanggalUsaha,
      shift: r.Shift as ShiftNumber,
      salesmanId: r.SalesmanID,
      driverName: r.DriverName ?? "Tidak diketahui",
      jumlahMuat: r.JumlahMuat,
      totalQty10KG: r.TotalQty10KG,
      totalQty5KG: r.TotalQty5KG,
      totalKantongEkivalen: r.TotalQty10KG + r.TotalQty5KG / 2,
      jumlahKendala: r.JumlahKendala,
      kendalaPerJenis: kendalaMap.get(key) ?? [],
      totalLiterBBM: r.TotalLiterBBM,
      totalNominalBBM: r.TotalNominalBBM,
      jumlahSesiIstirahat: r.JumlahSesiIstirahat,
      totalDurasiIstirahatMenit: r.TotalDurasiIstirahatMenit,
    };
  });
}
