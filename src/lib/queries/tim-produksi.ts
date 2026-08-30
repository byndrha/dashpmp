import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";

export interface TimRow {
  timId: number;
  nama: string;
  kepalaAkunId: number | null;
}

export interface AnggotaTimRow {
  anggotaId: number;
  timId: number;
  timNama: string;
  nama: string;
}

export async function getAllTim(): Promise<TimRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TimID, Nama, KepalaAkunID FROM DashboardTimProduksi WHERE IsDeleted = 0 ORDER BY Nama
  `);
  return (result.recordset as { TimID: number; Nama: string; KepalaAkunID: number | null }[]).map((r) => ({
    timId: r.TimID,
    nama: r.Nama,
    kepalaAkunId: r.KepalaAkunID,
  }));
}

export async function updateTimKepala(timId: number, kepalaAkunId: number | null): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("timId", sql.Int, timId)
    .input("kepalaAkunId", sql.Int, kepalaAkunId)
    .query(`UPDATE DashboardTimProduksi SET KepalaAkunID = @kepalaAkunId, ModifiedDate = GETDATE() WHERE TimID = @timId`);
}

// Dipakai panel "Tim Saya" di produksi-app -- mencari Tim milik akun yang
// sedang login lewat KepalaAkunID, bukan lewat ID Tim yang dikirim client
// (supaya seorang Kepala Produksi tidak bisa mengklaim Tim orang lain).
export async function getTimByKepalaAkunId(akunId: number): Promise<{ timId: number; nama: string } | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("akunId", sql.Int, akunId)
    .query(`SELECT TOP 1 TimID, Nama FROM DashboardTimProduksi WHERE KepalaAkunID = @akunId AND IsDeleted = 0`);
  const row = result.recordset[0] as { TimID: number; Nama: string } | undefined;
  return row ? { timId: row.TimID, nama: row.Nama } : null;
}

// Roster aktif satu Tim -- dipakai sebagai default Susunan Tim (lihat
// getSusunanTim/setTimBertugas di aktivitas-produksi.ts) dan panel admin.
export async function getAnggotaTim(timId: number): Promise<AnggotaTimRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("timId", sql.Int, timId)
    .query(`
      SELECT a.AnggotaID, a.TimID, t.Nama AS TimNama, a.Nama
      FROM DashboardTimProduksiAnggota a
      JOIN DashboardTimProduksi t ON t.TimID = a.TimID
      WHERE a.TimID = @timId AND a.IsDeleted = 0
      ORDER BY a.Nama
    `);
  return (result.recordset as { AnggotaID: number; TimID: number; TimNama: string; Nama: string }[]).map((r) => ({
    anggotaId: r.AnggotaID,
    timId: r.TimID,
    timNama: r.TimNama,
    nama: r.Nama,
  }));
}

export async function tambahAnggotaTim(timId: number, nama: string): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("timId", sql.Int, timId)
    .input("nama", sql.VarChar(100), nama)
    .query(`
      INSERT INTO DashboardTimProduksiAnggota (TimID, Nama)
      OUTPUT INSERTED.AnggotaID
      VALUES (@timId, @nama)
    `);
  return (result.recordset[0] as { AnggotaID: number }).AnggotaID;
}

// Soft-remove only -- lihat catatan yang sama di versi lama fungsi ini:
// baris DashboardAktivitasProduksiKehadiran masa lalu harus tetap
// resolve ke nama asli untuk Riwayat.
export async function hapusAnggotaTim(anggotaId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("anggotaId", sql.Int, anggotaId)
    .query(`UPDATE DashboardTimProduksiAnggota SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE AnggotaID = @anggotaId`);
}

// Versi ter-scoped untuk panel swalayan "Tim Saya" -- gagal (AppError) kalau
// anggotaId bukan milik timId, supaya Kepala Tim A tidak bisa menonaktifkan
// anggota Tim B lewat request yang dimanipulasi (client hanya mengirim
// anggotaId; timId selalu berasal dari lookup server-side terhadap sesi
// login, lihat hapusAnggotaTimSayaAction di actions.ts).
export async function hapusAnggotaTimIfOwned(anggotaId: number, timId: number): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("anggotaId", sql.Int, anggotaId)
    .input("timId", sql.Int, timId)
    .query(`
      UPDATE DashboardTimProduksiAnggota
      SET IsDeleted = 1, ModifiedDate = GETDATE()
      OUTPUT INSERTED.AnggotaID
      WHERE AnggotaID = @anggotaId AND TimID = @timId AND IsDeleted = 0
    `);
  if (result.recordset.length === 0) throw new AppError("Anggota ini bukan bagian dari Tim Anda.");
}

// Semua tim sekaligus -- dipakai dropdown "tambah dari tim lain" (Susunan
// Tim) dan panel admin Tim Produksi.
export async function getSemuaAnggotaTim(): Promise<AnggotaTimRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT a.AnggotaID, a.TimID, t.Nama AS TimNama, a.Nama
    FROM DashboardTimProduksiAnggota a
    JOIN DashboardTimProduksi t ON t.TimID = a.TimID
    WHERE a.IsDeleted = 0
    ORDER BY t.Nama, a.Nama
  `);
  return (result.recordset as { AnggotaID: number; TimID: number; TimNama: string; Nama: string }[]).map((r) => ({
    anggotaId: r.AnggotaID,
    timId: r.TimID,
    timNama: r.TimNama,
    nama: r.Nama,
  }));
}

// Edit nama dan/atau Tim seorang anggota -- panel admin saja. Tidak
// menyentuh Susunan Tim shift lampau manapun (Kehadiran mereferensikan
// AnggotaID langsung, independen dari TimID saat ini -- sama seperti
// versi lama fungsi ini terhadap kolom Shift).
export async function updateAnggotaTim(anggotaId: number, input: { nama: string; timId: number }): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("anggotaId", sql.Int, anggotaId)
    .input("nama", sql.VarChar(100), input.nama)
    .input("timId", sql.Int, input.timId)
    .query(`UPDATE DashboardTimProduksiAnggota SET Nama = @nama, TimID = @timId, ModifiedDate = GETDATE() WHERE AnggotaID = @anggotaId`);
}
