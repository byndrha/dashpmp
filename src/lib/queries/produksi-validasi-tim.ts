import { getPool, sql } from "@/lib/db";
import { getShiftWindow, type ShiftNumber } from "@/lib/report-shift";
import { naiveWibToUtcInstant } from "@/lib/business-date";

export interface ValidasiShiftItem {
  lengkap: boolean;
  detail: string;
}

export interface ValidasiShift {
  kualitas: ValidasiShiftItem;
  pallet: ValidasiShiftItem;
  muatan: ValidasiShiftItem;
}

const SHIFT_LIST: ShiftNumber[] = [1, 2, 3];

// 3 validasi per (TanggalUsaha, Shift) untuk SATU bulan kalender sekaligus
// -- dipakai 3 titik centang di kotak huruf Tim, jadwal-tim-bulanan.tsx.
// Bukan per-Tim (Kualitas/Batch/Pengiriman tidak menyimpan TimID), murni
// menandai KELENGKAPAN shift itu sendiri -- lihat spec Bagian 4 (proyek
// varian/TakeAway-FIFO) dan spec Bagian 4 (proyek alokasi Armada-5KG).
export async function getValidasiBulan(tahun: number, bulan: number): Promise<Record<string, ValidasiShift>> {
  const pool = await getPool();
  const awal = new Date(Date.UTC(tahun, bulan - 1, 1));
  const akhir = new Date(Date.UTC(tahun, bulan, 1));
  const start = naiveWibToUtcInstant(new Date(Date.UTC(tahun, bulan - 1, 0, 0, 0, 0)));
  const end = naiveWibToUtcInstant(new Date(Date.UTC(tahun, bulan, 2, 0, 0, 0)));

  const [mesinAktifResult, kualitasResult, sisaKualitasResult, armada10Result, armada5Result, takeAwayResult] = await Promise.all([
    pool.request().query(`SELECT MesinID FROM DashboardProduksiMesin WHERE Status = 'AKTIF'`),
    pool
      .request()
      .input("awal", sql.Date, awal)
      .input("akhir", sql.Date, akhir).query(`
        SELECT DISTINCT TanggalLabel, Shift, MesinID
        FROM DashboardProduksiKualitas
        WHERE TanggalLabel >= @awal AND TanggalLabel < @akhir
      `),
    pool
      .request()
      .input("awal", sql.Date, awal)
      .input("akhir", sql.Date, akhir).query(`
        SELECT k.TanggalLabel, k.Shift, k.KualitasID, k.Qty10KG,
               ISNULL((SELECT SUM(b.Qty10KG) FROM DashboardProduksiBatch b WHERE b.KualitasID = k.KualitasID AND b.IsDeleted = 0), 0) +
               ISNULL((SELECT SUM(ta.Qty) FROM DashboardTakeAwayAlokasi ta WHERE ta.KualitasID = k.KualitasID AND ta.SumberTipe = 'KUALITAS'), 0)
               AS TotalTeralokasi
        FROM DashboardProduksiKualitas k
        WHERE k.TanggalLabel >= @awal AND k.TanggalLabel < @akhir AND k.Variant = '10kg' AND k.Qty10KG IS NOT NULL
      `),
    // Bukti A: Armada 10KG -- JamSelesaiMuat hanya dihitung kalau JadwalID
    // punya minimal satu baris DashboardProduksiMuatanDetail (baris itu
    // hanya tercipta kalau klaim atomik ke DashboardProduksiBatch berhasil
    // di produksiSelesaiMuat) -- menangkap celah "Selesai Muat armada tanpa
    // alokasi pallet nyata".
    pool
      .request()
      .input("start", sql.DateTime, start)
      .input("end", sql.DateTime, end).query(`
        SELECT DISTINCT j.JamSelesaiMuat
        FROM DashboardPengirimanJadwal j
        INNER JOIN DashboardProduksiMuatanDetail d ON d.JadwalID = j.JadwalID
        WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL AND j.JamSelesaiMuat BETWEEN @start AND @end
      `),
    // Bukti B: Armada 5KG -- sama seperti Bukti A tapi lewat
    // DashboardArmadaAlokasi (baris itu hanya tercipta kalau
    // allocateArmadaStock5KG berhasil).
    pool
      .request()
      .input("start", sql.DateTime, start)
      .input("end", sql.DateTime, end).query(`
        SELECT DISTINCT j.JamSelesaiMuat
        FROM DashboardPengirimanJadwal j
        INNER JOIN DashboardArmadaAlokasi a ON a.JadwalID = j.JadwalID
        WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL AND j.JamSelesaiMuat BETWEEN @start AND @end
      `),
    // Bukti C: TakeAway (10KG & 5KG) -- JamSelesaiMuat hanya dihitung kalau
    // TakeAwayMuatanID punya minimal satu baris DashboardTakeAwayAlokasi
    // (SumberTipe apa saja -- KUALITAS atau BATCH, keduanya bukti alokasi
    // nyata; untuk 5kg SumberTipe memang selalu KUALITAS by design).
    pool
      .request()
      .input("start", sql.DateTime, start)
      .input("end", sql.DateTime, end).query(`
        SELECT DISTINCT tam.JamSelesaiMuat
        FROM DashboardTakeAwayMuatan tam
        INNER JOIN DashboardTakeAwayAlokasi ta ON ta.TakeAwayMuatanID = tam.TakeAwayMuatanID
        WHERE tam.IsDeleted = 0 AND tam.JamSelesaiMuat IS NOT NULL AND tam.JamSelesaiMuat BETWEEN @start AND @end
      `),
  ]);

  const mesinAktifIds = new Set((mesinAktifResult.recordset as { MesinID: number }[]).map((r) => r.MesinID));

  // Centang 1: per (tanggal, shift) -> Set MesinID yang sudah dicek.
  const mesinDicekByShift = new Map<string, Set<number>>();
  for (const r of kualitasResult.recordset as { TanggalLabel: Date; Shift: ShiftNumber; MesinID: number }[]) {
    const key = `${r.TanggalLabel.toISOString().slice(0, 10)}|${r.Shift}`;
    if (!mesinDicekByShift.has(key)) mesinDicekByShift.set(key, new Set());
    mesinDicekByShift.get(key)!.add(r.MesinID);
  }

  // Centang 2: per (tanggal, shift) -> apakah ADA entri 10kg dengan sisa > 0.
  const adaSisaByShift = new Map<string, boolean>();
  const adaEntri10KGByShift = new Set<string>();
  for (const r of sisaKualitasResult.recordset as { TanggalLabel: Date; Shift: ShiftNumber; Qty10KG: number; TotalTeralokasi: number }[]) {
    const key = `${r.TanggalLabel.toISOString().slice(0, 10)}|${r.Shift}`;
    adaEntri10KGByShift.add(key);
    const sisa = Math.max(0, r.Qty10KG - r.TotalTeralokasi);
    if (sisa > 0) adaSisaByShift.set(key, true);
  }

  // Centang 3: gabungkan 3 bukti alokasi nyata (Armada 10KG, Armada 5KG,
  // TakeAway), cocokkan ke jendela shift tiap hari dalam bulan ini.
  const semuaJamSelesaiDenganBukti: Date[] = [
    ...(armada10Result.recordset as { JamSelesaiMuat: Date }[]).map((r) => r.JamSelesaiMuat),
    ...(armada5Result.recordset as { JamSelesaiMuat: Date }[]).map((r) => r.JamSelesaiMuat),
    ...(takeAwayResult.recordset as { JamSelesaiMuat: Date }[]).map((r) => r.JamSelesaiMuat),
  ];

  const hasil: Record<string, ValidasiShift> = {};
  const daysInMonth = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const tanggalUsaha = new Date(Date.UTC(tahun, bulan - 1, day)).toISOString().slice(0, 10);
    for (const shift of SHIFT_LIST) {
      const key = `${tanggalUsaha}|${shift}`;
      const mesinDicek = mesinDicekByShift.get(key) ?? new Set<number>();
      const mesinBelum = [...mesinAktifIds].filter((id) => !mesinDicek.has(id));

      const adaEntri10KG = adaEntri10KGByShift.has(key);
      const adaSisa = adaSisaByShift.get(key) ?? false;

      const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
      const window = getShiftWindow(businessDate, shift, "work");
      const startUtc = naiveWibToUtcInstant(window.start);
      const endUtc = naiveWibToUtcInstant(window.end);
      const adaMuatan = semuaJamSelesaiDenganBukti.some((t) => t >= startUtc && t <= endUtc);

      hasil[key] = {
        kualitas: {
          lengkap: mesinBelum.length === 0,
          detail:
            mesinBelum.length === 0
              ? "Semua mesin aktif sudah dicek."
              : `${mesinAktifIds.size - mesinBelum.length} dari ${mesinAktifIds.size} mesin sudah dicek.`,
        },
        pallet: {
          lengkap: !adaEntri10KG || !adaSisa,
          detail: !adaEntri10KG ? "Belum ada hasil panen 10KG." : adaSisa ? "Masih ada sisa belum dipallet." : "Semua sudah masuk pallet.",
        },
        muatan: {
          lengkap: adaMuatan,
          detail: adaMuatan
            ? "Sudah ada Selesai Muat dengan bukti alokasi stok pada shift ini."
            : "Belum ada Selesai Muat dengan bukti alokasi stok pada shift ini.",
        },
      };
    }
  }
  return hasil;
}
