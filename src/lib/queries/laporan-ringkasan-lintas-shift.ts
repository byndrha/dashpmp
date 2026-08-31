import { getPool, sql } from "@/lib/db";
import { getReportShift, type ShiftNumber } from "@/lib/report-shift";
import { getStokBahanBakuHistory } from "@/lib/queries/stok-bahan-baku";
import { JENIS_BARANG_LIST, type JenisBarang } from "@/lib/stok-bahan-baku-shared";
import { getAktivitasRiwayat } from "@/lib/queries/aktivitas-produksi";
import { hitungTotalDenda } from "@/lib/aktivitas-produksi-shared";
import { getAktivitasMuatanDistribusi } from "@/lib/queries/laporan-muatan-distribusi";
import { getKasKecilHistory } from "@/lib/queries/kas-kecil";

export interface KantongEkivalenProduksiRow {
  tanggalUsaha: string;
  shift: ShiftNumber;
  totalKantongEkivalen: number;
}

// Bulk, whole-month version of getQtyRecapForShift's kantong-ekivalen
// formula (aktivitas-produksi.ts) -- that function only computes ONE
// shift at a time, this computes every shift in a month in 2 queries
// instead of up to ~90 round trips. 10KG groups directly on
// DashboardProduksiBatch's own stored TanggalLabel/Shift columns (no
// bucketing arithmetic needed -- matches getQtyRecapForShift's own
// approach exactly, TanggalLabel is already a stored label, not a raw
// timestamp). 5KG needs the same WIB-offset shift-bucketing SQL already
// established in laporan-muatan-distribusi.ts (Tahap 3) -- duplicated
// here rather than imported, matching that file's own precedent of
// duplicating its shared SQL text within itself rather than creating
// cross-file coupling for a few lines of SQL.
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

export async function getKantongEkivalenProduksiPerBulan(tahun: number, bulan: number): Promise<KantongEkivalenProduksiRow[]> {
  const pool = await getPool();
  const awalBulan = new Date(Date.UTC(tahun, bulan - 1, 1));
  const akhirBulan = new Date(Date.UTC(tahun, bulan, 1));

  const batchResult = await pool
    .request()
    .input("awalBulan", sql.Date, awalBulan)
    .input("akhirBulan", sql.Date, akhirBulan).query(`
      SELECT TanggalLabel, Shift, SUM(Qty10KG) AS Total10KG
      FROM DashboardProduksiBatch
      WHERE IsDeleted = 0 AND TanggalLabel >= @awalBulan AND TanggalLabel < @akhirBulan
      GROUP BY TanggalLabel, Shift
    `);

  // Coarse pre-filter pada JamSelesaiMuat -- murni performa, korektnya
  // datang dari WHERE pada TanggalUsaha hasil hitung SQL di bawah, sama
  // pola seperti laporan-muatan-distribusi.ts.
  const awalMuat = new Date(awalBulan.getTime() - 2 * 24 * 60 * 60 * 1000);
  const akhirMuat = new Date(akhirBulan.getTime() + 1 * 24 * 60 * 60 * 1000);
  const jadwalResult = await pool
    .request()
    .input("awalMuat", sql.DateTime, awalMuat)
    .input("akhirMuat", sql.DateTime, akhirMuat)
    .input("awalBulan", sql.Date, awalBulan)
    .input("akhirBulan", sql.Date, akhirBulan).query(`
      WITH JadwalShift AS (
        SELECT
          j.Qty5KGDimuat,
          ${TANGGAL_USAHA_CASE} AS TanggalUsaha,
          ${SHIFT_CASE} AS Shift
        FROM DashboardPengirimanJadwal j
        WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL
          AND j.JamSelesaiMuat >= @awalMuat AND j.JamSelesaiMuat < @akhirMuat
      )
      SELECT TanggalUsaha, Shift, SUM(Qty5KGDimuat) AS Total5KG
      FROM JadwalShift
      WHERE TanggalUsaha >= @awalBulan AND TanggalUsaha < @akhirBulan
      GROUP BY TanggalUsaha, Shift
    `);

  const map = new Map<string, { tanggalUsaha: string; shift: ShiftNumber; total10KG: number; total5KG: number }>();
  const keyOf = (tanggalUsaha: string, shift: number) => `${tanggalUsaha}|${shift}`;

  for (const row of batchResult.recordset as { TanggalLabel: Date; Shift: number; Total10KG: number }[]) {
    const tanggalUsaha = row.TanggalLabel.toISOString().slice(0, 10);
    const shift = row.Shift as ShiftNumber;
    const key = keyOf(tanggalUsaha, shift);
    const entry = map.get(key) ?? { tanggalUsaha, shift, total10KG: 0, total5KG: 0 };
    entry.total10KG += row.Total10KG;
    map.set(key, entry);
  }
  for (const row of jadwalResult.recordset as { TanggalUsaha: Date; Shift: number; Total5KG: number }[]) {
    const tanggalUsaha = row.TanggalUsaha.toISOString().slice(0, 10);
    const shift = row.Shift as ShiftNumber;
    const key = keyOf(tanggalUsaha, shift);
    const entry = map.get(key) ?? { tanggalUsaha, shift, total10KG: 0, total5KG: 0 };
    entry.total5KG += row.Total5KG;
    map.set(key, entry);
  }

  return Array.from(map.values()).map((v) => ({
    tanggalUsaha: v.tanggalUsaha,
    shift: v.shift,
    totalKantongEkivalen: v.total10KG + v.total5KG / 2,
  }));
}

export interface BahanBakuPerJenisRingkasan {
  jenisBarang: JenisBarang;
  sisaGudangAkhir: number;
  sisaInventoriAkhir: number;
  stokMasukInventoriOperasional: number;
}

export interface RingkasanShiftRow {
  tanggalUsaha: string;
  shift: ShiftNumber;
  skorKelengkapan: number; // 0-3: Bahan Baku + Produksi + Kas Kecil saja
  bahanBakuLengkap: boolean;
  bahanBakuPerJenis: BahanBakuPerJenisRingkasan[];
  bahanBakuKantongEkivalenMasuk: number;
  produksiLengkap: boolean;
  produksiTimId: number | null;
  produksiStafOperasionalAkunId: number | null;
  produksiTotalKantongEkivalen: number;
  produksiTotalDenda: number;
  muatanJumlahMuat: number;
  muatanTotalKantongEkivalen: number;
  muatanJumlahKendala: number;
  kasKecilLengkap: boolean;
  kasKecilKasMasuk: number;
  kasKecilTotalPengeluaran: number;
  kasKecilSaldoAkhir: number;
}

function keyOf(tanggalUsaha: string, shift: number): string {
  return `${tanggalUsaha}|${shift}`;
}

// Menggabungkan Tahap 1/2/3/4 jadi satu baris per (TanggalUsaha, Shift).
// Bahan Baku/Produksi/Kas Kecil "lengkap" ditentukan murni dari APAKAH
// barisnya muncul di riwayat masing-masing (ketiga fungsi sumber hanya
// mengembalikan baris yang BENAR-BENAR ada di DB, tidak pernah
// mensintesis baris kosong) -- tidak perlu query terpisah untuk cek
// "sudah diisi atau belum".
export async function getRingkasanLintasShift(tahun: number, bulan: number): Promise<RingkasanShiftRow[]> {
  const { shift: shiftBerjalan, businessDate: businessDateBerjalan } = getReportShift("work");
  const tanggalUsahaBerjalan = businessDateBerjalan.toISOString().slice(0, 10);

  const [bahanBakuHistory, aktivitasRiwayat, kantongEkivalenProduksi, muatanDistribusi, kasKecilHistory] = await Promise.all([
    getStokBahanBakuHistory(400),
    getAktivitasRiwayat(120),
    getKantongEkivalenProduksiPerBulan(tahun, bulan),
    getAktivitasMuatanDistribusi(tahun, bulan),
    getKasKecilHistory(120),
  ]);

  const awalBulan = `${tahun}-${String(bulan).padStart(2, "0")}-01`;
  const akhirBulan = new Date(Date.UTC(tahun, bulan, 1)).toISOString().slice(0, 10);
  const dalamBulan = (tanggalUsaha: string) => tanggalUsaha >= awalBulan && tanggalUsaha < akhirBulan;

  const bahanBakuBulanIni = bahanBakuHistory.filter((r) => dalamBulan(r.tanggalUsaha));
  const aktivitasBulanIni = aktivitasRiwayat.filter((r) => dalamBulan(r.tanggalUsaha));
  const kasKecilBulanIni = kasKecilHistory.filter((r) => dalamBulan(r.tanggalUsaha));

  const bahanBakuPerShift = new Map<string, BahanBakuPerJenisRingkasan[]>();
  for (const r of bahanBakuBulanIni) {
    const key = keyOf(r.tanggalUsaha, r.shift);
    const list = bahanBakuPerShift.get(key) ?? [];
    list.push({
      jenisBarang: r.jenisBarang,
      sisaGudangAkhir: r.sisaGudangAkhir,
      sisaInventoriAkhir: r.sisaInventoriAkhir,
      stokMasukInventoriOperasional: r.stokMasukInventoriOperasional,
    });
    bahanBakuPerShift.set(key, list);
  }

  const aktivitasPerShift = new Map(aktivitasBulanIni.map((r) => [keyOf(r.tanggalUsaha, r.shift), r]));
  const kantongProduksiPerShift = new Map(kantongEkivalenProduksi.map((r) => [keyOf(r.tanggalUsaha, r.shift), r]));
  const kasKecilPerShift = new Map(kasKecilBulanIni.map((r) => [keyOf(r.tanggalUsaha, r.shift), r]));

  const muatanPerShift = new Map<string, { jumlahMuat: number; totalKantongEkivalen: number; jumlahKendala: number }>();
  for (const r of muatanDistribusi) {
    const key = keyOf(r.tanggalUsaha, r.shift);
    const entry = muatanPerShift.get(key) ?? { jumlahMuat: 0, totalKantongEkivalen: 0, jumlahKendala: 0 };
    entry.jumlahMuat += r.jumlahMuat;
    entry.totalKantongEkivalen += r.totalKantongEkivalen;
    entry.jumlahKendala += r.jumlahKendala;
    muatanPerShift.set(key, entry);
  }

  // Union semua (TanggalUsaha, Shift) yang muncul di mana pun, DITAMBAH
  // shift yang sedang berjalan sekarang (supaya Kartu Detail Shift --
  // spec Bagian 2 -- selalu punya baris untuk ditampilkan meski shift itu
  // baru dan belum ada data sama sekali di tahap manapun).
  const semuaKey = new Set<string>([
    ...bahanBakuPerShift.keys(),
    ...aktivitasPerShift.keys(),
    ...kantongProduksiPerShift.keys(),
    ...muatanPerShift.keys(),
    ...kasKecilPerShift.keys(),
  ]);
  if (dalamBulan(tanggalUsahaBerjalan)) {
    semuaKey.add(keyOf(tanggalUsahaBerjalan, shiftBerjalan));
  }

  const rows: RingkasanShiftRow[] = Array.from(semuaKey).map((key) => {
    const [tanggalUsaha, shiftStr] = key.split("|");
    const shift = Number(shiftStr) as ShiftNumber;

    const bahanBakuPerJenis = bahanBakuPerShift.get(key) ?? [];
    const bahanBakuLengkap = bahanBakuPerJenis.length === JENIS_BARANG_LIST.length;
    const masuk10 = bahanBakuPerJenis.find((b) => b.jenisBarang === "Plastik10KG")?.stokMasukInventoriOperasional ?? 0;
    const masuk5 = bahanBakuPerJenis.find((b) => b.jenisBarang === "Plastik5KG")?.stokMasukInventoriOperasional ?? 0;
    const bahanBakuKantongEkivalenMasuk = masuk10 + masuk5 / 2;

    const aktivitas = aktivitasPerShift.get(key);
    const produksiLengkap = aktivitas != null;
    const kantongProduksi = kantongProduksiPerShift.get(key);
    const muatan = muatanPerShift.get(key) ?? { jumlahMuat: 0, totalKantongEkivalen: 0, jumlahKendala: 0 };
    const kasKecil = kasKecilPerShift.get(key);
    const kasKecilLengkap = kasKecil != null;

    const skorKelengkapan = (bahanBakuLengkap ? 1 : 0) + (produksiLengkap ? 1 : 0) + (kasKecilLengkap ? 1 : 0);

    return {
      tanggalUsaha,
      shift,
      skorKelengkapan,
      bahanBakuLengkap,
      bahanBakuPerJenis,
      bahanBakuKantongEkivalenMasuk,
      produksiLengkap,
      produksiTimId: aktivitas?.timId ?? null,
      produksiStafOperasionalAkunId: aktivitas?.stafOperasionalAkunId ?? null,
      produksiTotalKantongEkivalen: kantongProduksi?.totalKantongEkivalen ?? 0,
      produksiTotalDenda: aktivitas ? hitungTotalDenda(aktivitas.pecahKemasanQty, aktivitas.esJatuhQty) : 0,
      muatanJumlahMuat: muatan.jumlahMuat,
      muatanTotalKantongEkivalen: muatan.totalKantongEkivalen,
      muatanJumlahKendala: muatan.jumlahKendala,
      kasKecilLengkap,
      kasKecilKasMasuk: kasKecil?.kasMasuk ?? 0,
      kasKecilTotalPengeluaran: kasKecil?.totalPengeluaran ?? 0,
      kasKecilSaldoAkhir: kasKecil?.saldoAkhir ?? 0,
    };
  });

  // Kronologis Shift 2 -> 3 -> 1 dalam satu TanggalUsaha (lihat Global
  // Constraints) -- bukan ORDER BY Shift mentah.
  const shiftRank: Record<ShiftNumber, number> = { 2: 1, 3: 2, 1: 3 };
  rows.sort((a, b) => {
    if (a.tanggalUsaha !== b.tanggalUsaha) return a.tanggalUsaha.localeCompare(b.tanggalUsaha);
    return shiftRank[a.shift] - shiftRank[b.shift];
  });

  return rows;
}
