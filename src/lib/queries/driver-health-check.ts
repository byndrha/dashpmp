import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import {
  hariIniWibISO,
  layakBerangkat,
  nilaiHealthCheck,
  type MasukanHealthCheck,
} from "@/lib/health-check-driver";
import { getSimDriver } from "@/lib/queries/driver-profile";
import { verifikasiDanPakaiKodeAmbilAlih } from "@/lib/queries/kode-ambil-alih";

// Driver Health Check — riwayat pemeriksaan kelayakan driver per
// keberangkatan (DashboardDriverHealthCheck, satu baris per pemeriksaan).
// Status yang berlaku untuk sebuah Jadwal = baris TERBARU untuk pasangan
// (JadwalID, SalesmanID). Sengaja TIDAK mengimpor pengiriman-jadwal.ts
// (yang mengimpor modul ini untuk gerbang Selesai Muat) — status Jadwal
// dibaca langsung di sini.

export interface HealthCheckRow {
  HealthCheckID: number;
  JadwalID: number;
  SalesmanID: string;
  Sistolik: number | null;
  Diastolik: number | null;
  KadarAlkohol: number | null;
  PandanganLolos: boolean | null;
  SimDibawa: boolean;
  SimBerlakuHingga: string | null;
  Lolos: boolean;
  AlasanGagal: string | null;
  Catatan: string | null;
  DiperiksaOlehAkunID: number;
  DiperiksaPada: string;
  AmbilAlih: boolean;
  AmbilAlihAlasan: string | null;
  AmbilAlihOlehAkunID: number | null;
  AmbilAlihPada: string | null;
}

interface HealthCheckDbRow extends Omit<HealthCheckRow, "KadarAlkohol" | "SimBerlakuHingga" | "DiperiksaPada" | "AmbilAlihPada"> {
  KadarAlkohol: number | string | null;
  SimBerlakuHingga: Date | null;
  DiperiksaPada: Date;
  AmbilAlihPada: Date | null;
}

const KOLOM = `
  HealthCheckID, JadwalID, SalesmanID, Sistolik, Diastolik, KadarAlkohol, PandanganLolos,
  SimDibawa, SimBerlakuHingga, Lolos, AlasanGagal, Catatan, DiperiksaOlehAkunID, DiperiksaPada,
  AmbilAlih, AmbilAlihAlasan, AmbilAlihOlehAkunID, AmbilAlihPada
`;

// DATE -> "YYYY-MM-DD" (Date tengah malam UTC); DATETIME -> ISO, sama
// seperti CheckedAt di vehicle-check.ts. DECIMAL bisa datang sebagai string.
function keRow(r: HealthCheckDbRow): HealthCheckRow {
  return {
    ...r,
    KadarAlkohol: r.KadarAlkohol == null ? null : Number(r.KadarAlkohol),
    SimBerlakuHingga: r.SimBerlakuHingga ? r.SimBerlakuHingga.toISOString().slice(0, 10) : null,
    DiperiksaPada: r.DiperiksaPada.toISOString(),
    AmbilAlihPada: r.AmbilAlihPada ? r.AmbilAlihPada.toISOString() : null,
  };
}

const BATAS_TEKS = 400;

async function getStatusJadwal(jadwalId: number): Promise<string | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT Status FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const row = result.recordset[0] as { Status: string } | undefined;
  return row ? row.Status : null;
}

async function pastikanJadwalDraft(jadwalId: number): Promise<void> {
  const status = await getStatusJadwal(jadwalId);
  if (status == null) throw new AppError("Keberangkatan tidak ditemukan.");
  if (status !== "Draft") {
    throw new AppError("Health Check hanya bisa dilakukan sebelum muat selesai (keberangkatan masih Draf).");
  }
}

export async function getHealthCheckTerbaru(jadwalId: number, salesmanId: string): Promise<HealthCheckRow | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .query(`
      SELECT TOP 1 ${KOLOM}
      FROM DashboardDriverHealthCheck
      WHERE JadwalID = @jadwalId AND SalesmanID = @salesmanId
      ORDER BY HealthCheckID DESC
    `);
  const row = result.recordset[0] as HealthCheckDbRow | undefined;
  return row ? keRow(row) : null;
}

async function getHealthCheckById(healthCheckId: number): Promise<HealthCheckRow> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, healthCheckId)
    .query(`SELECT ${KOLOM} FROM DashboardDriverHealthCheck WHERE HealthCheckID = @id`);
  const row = result.recordset[0] as HealthCheckDbRow | undefined;
  if (!row) throw new AppError("Data Health Check tidak ditemukan.");
  return keRow(row);
}

// Server tidak mempercayai hasil dari klien: SIM dibaca ulang dari DB dan
// penilaian dihitung ulang di sini sebelum disimpan.
export async function simpanHealthCheck(input: {
  jadwalId: number;
  salesmanId: string;
  masukan: Omit<MasukanHealthCheck, "sims">;
  catatan: string | null;
  akunId: number;
}): Promise<HealthCheckRow> {
  await pastikanJadwalDraft(input.jadwalId);

  const sims = await getSimDriver(input.salesmanId);
  const hasil = nilaiHealthCheck({ ...input.masukan, sims }, hariIniWibISO());
  const alasanGagal = hasil.alasanGagal.length > 0 ? hasil.alasanGagal.join("; ").slice(0, BATAS_TEKS) : null;
  const m = input.masukan;

  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, input.jadwalId)
    .input("salesmanId", sql.VarChar(16), input.salesmanId)
    .input("sistolik", sql.Int, m.sistolik)
    .input("diastolik", sql.Int, m.diastolik)
    .input("kadarAlkohol", sql.Decimal(6, 3), m.kadarAlkohol)
    .input("pandanganLolos", sql.Bit, m.pandanganLolos)
    .input("simDibawa", sql.Bit, m.simDibawa)
    .input("simBerlakuHingga", sql.Date, hasil.simTerbaik?.berlakuHingga ?? null)
    .input("lolos", sql.Bit, hasil.lolos)
    .input("alasanGagal", sql.NVarChar(BATAS_TEKS), alasanGagal)
    .input("catatan", sql.NVarChar(BATAS_TEKS), input.catatan)
    .input("akunId", sql.Int, input.akunId)
    .query(`
      INSERT INTO DashboardDriverHealthCheck
        (JadwalID, SalesmanID, Sistolik, Diastolik, KadarAlkohol, PandanganLolos, SimDibawa,
         SimBerlakuHingga, Lolos, AlasanGagal, Catatan, DiperiksaOlehAkunID, DiperiksaPada, AmbilAlih)
      OUTPUT INSERTED.HealthCheckID
      VALUES
        (@jadwalId, @salesmanId, @sistolik, @diastolik, @kadarAlkohol, @pandanganLolos, @simDibawa,
         @simBerlakuHingga, @lolos, @alasanGagal, @catatan, @akunId, GETDATE(), 0)
    `);
  const id = (result.recordset[0] as { HealthCheckID: number }).HealthCheckID;
  return getHealthCheckById(id);
}

// Semua validasi dilakukan SEBELUM kode diverifikasi, supaya permintaan
// yang pasti ditolak tidak "membakar" kode ambil alih yang masih berlaku.
export async function ambilAlihHealthCheck(input: {
  jadwalId: number;
  salesmanId: string;
  kode: string;
  alasan: string;
  akunId: number;
}): Promise<HealthCheckRow> {
  const alasan = input.alasan.trim();
  if (!alasan) throw new AppError("Alasan ambil alih wajib diisi.");
  if (alasan.length > BATAS_TEKS) throw new AppError(`Alasan ambil alih maksimal ${BATAS_TEKS} karakter.`);

  const terbaru = await getHealthCheckTerbaru(input.jadwalId, input.salesmanId);
  if (!terbaru) throw new AppError("Belum ada Health Check untuk driver ini — lakukan Health Check terlebih dahulu.");
  if (terbaru.Lolos) throw new AppError("Health Check terbaru sudah lolos — tidak perlu ambil alih.");
  if (terbaru.AmbilAlih) throw new AppError("Health Check terbaru sudah diambil alih.");
  await pastikanJadwalDraft(input.jadwalId);

  await verifikasiDanPakaiKodeAmbilAlih(input.kode, input.akunId, input.jadwalId, "HEALTH_CHECK");

  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, terbaru.HealthCheckID)
    .input("jadwalId", sql.Int, input.jadwalId)
    .input("salesmanId", sql.VarChar(16), input.salesmanId)
    .input("alasan", sql.NVarChar(BATAS_TEKS), alasan)
    .input("akunId", sql.Int, input.akunId)
    .query(`
      UPDATE DashboardDriverHealthCheck
      SET AmbilAlih = 1, AmbilAlihAlasan = @alasan, AmbilAlihOlehAkunID = @akunId, AmbilAlihPada = GETDATE()
      WHERE HealthCheckID = @id AND Lolos = 0 AND AmbilAlih = 0
        AND HealthCheckID = (
          SELECT MAX(HealthCheckID) FROM DashboardDriverHealthCheck
          WHERE JadwalID = @jadwalId AND SalesmanID = @salesmanId
        )
    `);
  if (result.rowsAffected[0] === 0) {
    throw new AppError("Health Check terbaru berubah atau sudah diambil alih — muat ulang lalu coba lagi.");
  }
  return getHealthCheckById(terbaru.HealthCheckID);
}

/** Gerbang Selesai Muat: driver jadwal saat ini harus lolos atau diambil alih. */
export async function assertDriverLayakBerangkat(jadwalId: number, salesmanId: string): Promise<void> {
  const terbaru = await getHealthCheckTerbaru(jadwalId, salesmanId);
  if (!layakBerangkat(terbaru)) {
    throw new AppError(
      "Driver belum lolos Health Check untuk keberangkatan ini — lakukan Health Check, ganti driver, atau ambil alih dengan kode.",
    );
  }
}

/**
 * Pra-gerbang untuk selesaiMuatAction: baca driver jadwal saat ini lalu
 * jalankan gerbang Health Check SEBELUM kode SELESAI_MUAT diverifikasi,
 * supaya penolakan Health Check tidak "membakar" kode tersebut. Gerbang di
 * dalam selesaiMuat tetap berlaku (dan klaim UPDATE-nya terikat SalesmanID).
 */
export async function assertDriverJadwalLayakBerangkat(jadwalId: number): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT SalesmanID FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const row = result.recordset[0] as { SalesmanID: string | null } | undefined;
  if (!row) throw new AppError("Keberangkatan tidak ditemukan.");
  if (!row.SalesmanID) throw new AppError("Driver wajib diisi sebelum menyelesaikan muat.");
  await assertDriverLayakBerangkat(jadwalId, row.SalesmanID);
}
