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
