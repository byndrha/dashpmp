import { getPool, sql } from "@/lib/db";

export interface AnggotaTimRow {
  anggotaId: number;
  shift: 1 | 2 | 3;
  nama: string;
}

// One of the 3 fixed teams' active roster — Shift IS the team identifier
// (Tim Shift 1/2/3 are permanent, not a rotating assignment).
export async function getAnggotaTim(shift: 1 | 2 | 3): Promise<AnggotaTimRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("shift", sql.TinyInt, shift)
    .query(`
      SELECT AnggotaID, Shift, Nama FROM DashboardTimProduksiAnggota
      WHERE Shift = @shift AND IsDeleted = 0
      ORDER BY Nama
    `);
  return (result.recordset as { AnggotaID: number; Shift: number; Nama: string }[]).map((r) => ({
    anggotaId: r.AnggotaID,
    shift: r.Shift as 1 | 2 | 3,
    nama: r.Nama,
  }));
}

export async function tambahAnggotaTim(shift: 1 | 2 | 3, nama: string): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("shift", sql.TinyInt, shift)
    .input("nama", sql.VarChar(100), nama)
    .query(`
      INSERT INTO DashboardTimProduksiAnggota (Shift, Nama)
      OUTPUT INSERTED.AnggotaID
      VALUES (@shift, @nama)
    `);
  return (result.recordset[0] as { AnggotaID: number }).AnggotaID;
}

// Soft-remove only — a member's past DashboardAktivitasProduksiKehadiran
// rows must keep resolving to a real name for historical Riwayat views.
export async function hapusAnggotaTim(anggotaId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("anggotaId", sql.Int, anggotaId)
    .query(`UPDATE DashboardTimProduksiAnggota SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE AnggotaID = @anggotaId`);
}

// All 3 teams' active rosters combined, for the cross-team "tambah dari
// tim lain" dropdown on the per-shift roster (tim-produksi-roster.tsx) and
// the admin management section on /mkesindo/produksi.
export async function getSemuaAnggotaTim(): Promise<AnggotaTimRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT AnggotaID, Shift, Nama FROM DashboardTimProduksiAnggota
    WHERE IsDeleted = 0
    ORDER BY Shift, Nama
  `);
  return (result.recordset as { AnggotaID: number; Shift: number; Nama: string }[]).map((r) => ({
    anggotaId: r.AnggotaID,
    shift: r.Shift as 1 | 2 | 3,
    nama: r.Nama,
  }));
}

// Edits a member's name and/or which permanent team (Shift) they belong
// to -- used by the new admin management section only. Does not touch any
// past shift's already-saved susunan tim (DashboardAktivitasProduksiKehadiran
// rows reference AnggotaID directly, independent of this table's own Shift
// column, so a past roster entry keeps showing the name/team that was true
// at the time -- acceptable, matches how every other historical-name
// lookup in this app already behaves, e.g. DicatatOlehNama).
export async function updateAnggotaTim(anggotaId: number, input: { nama: string; shift: 1 | 2 | 3 }): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("anggotaId", sql.Int, anggotaId)
    .input("nama", sql.VarChar(100), input.nama)
    .input("shift", sql.TinyInt, input.shift)
    .query(`UPDATE DashboardTimProduksiAnggota SET Nama = @nama, Shift = @shift, ModifiedDate = GETDATE() WHERE AnggotaID = @anggotaId`);
}
