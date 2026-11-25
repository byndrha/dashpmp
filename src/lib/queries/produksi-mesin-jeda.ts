import { getPool, sql } from "@/lib/db";
import { isPenyebabJeda, type JedaMesinRow, type PenyebabJeda } from "@/lib/produksi-mesin-jeda";

// Catatan Jeda Mesin (DashboardProduksiMesinJeda, lihat
// scripts/create-produksi-mesin-jeda-table.ts). Waktu disimpan naive-WIB:
// "YYYY-MM-DDTHH:mm" <-> Date yang komponen UTC-nya = jam dinding WIB
// (konvensi yang sama dengan getNaiveWibNow / DashboardProduksiMesinEvent).
function keDate(naive: string): Date {
  return new Date(`${naive.slice(0, 16)}:00Z`);
}
function keNaive(d: Date): string {
  return d.toISOString().slice(0, 16);
}

export async function getJedaMesinSejak(mulaiNaive: string): Promise<JedaMesinRow[]> {
  const pool = await getPool();
  const result = await pool.request().input("mulai", sql.DateTime, keDate(mulaiNaive)).query(`
    SELECT JedaID, MesinID, WaktuMulai, WaktuSelesai, Penyebab, Keterangan, DicatatOlehAkunID
    FROM DashboardProduksiMesinJeda
    WHERE IsDeleted = 0 AND WaktuSelesai >= @mulai
    ORDER BY WaktuMulai DESC
  `);
  return (
    result.recordset as {
      JedaID: number;
      MesinID: number;
      WaktuMulai: Date;
      WaktuSelesai: Date;
      Penyebab: string;
      Keterangan: string | null;
      DicatatOlehAkunID: number;
    }[]
  ).map((r) => ({
    jedaId: r.JedaID,
    mesinId: r.MesinID,
    waktuMulai: keNaive(r.WaktuMulai),
    waktuSelesai: keNaive(r.WaktuSelesai),
    penyebab: isPenyebabJeda(r.Penyebab) ? r.Penyebab : "LAINNYA",
    keterangan: r.Keterangan,
    dicatatOlehAkunId: r.DicatatOlehAkunID,
  }));
}

export interface SimpanJedaInput {
  mesinId: number;
  waktuMulai: string; // naive-WIB "YYYY-MM-DDTHH:mm"
  waktuSelesai: string;
  penyebab: PenyebabJeda;
  keterangan: string | null;
}

export async function createJedaMesin(input: SimpanJedaInput, akunId: number): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("mesinId", sql.Int, input.mesinId)
    .input("mulai", sql.DateTime, keDate(input.waktuMulai))
    .input("selesai", sql.DateTime, keDate(input.waktuSelesai))
    .input("penyebab", sql.VarChar(30), input.penyebab)
    .input("keterangan", sql.NVarChar(500), input.keterangan)
    .input("akunId", sql.Int, akunId).query(`
      INSERT INTO DashboardProduksiMesinJeda (MesinID, WaktuMulai, WaktuSelesai, Penyebab, Keterangan, DicatatOlehAkunID)
      OUTPUT INSERTED.JedaID
      VALUES (@mesinId, @mulai, @selesai, @penyebab, @keterangan, @akunId)
    `);
  return (result.recordset[0] as { JedaID: number }).JedaID;
}

export async function updateJedaMesin(jedaId: number, input: SimpanJedaInput): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("jedaId", sql.Int, jedaId)
    .input("mesinId", sql.Int, input.mesinId)
    .input("mulai", sql.DateTime, keDate(input.waktuMulai))
    .input("selesai", sql.DateTime, keDate(input.waktuSelesai))
    .input("penyebab", sql.VarChar(30), input.penyebab)
    .input("keterangan", sql.NVarChar(500), input.keterangan).query(`
      UPDATE DashboardProduksiMesinJeda
      SET MesinID = @mesinId, WaktuMulai = @mulai, WaktuSelesai = @selesai, Penyebab = @penyebab,
          Keterangan = @keterangan, ModifiedDate = GETDATE()
      WHERE JedaID = @jedaId AND IsDeleted = 0
    `);
}

export async function deleteJedaMesin(jedaId: number): Promise<void> {
  const pool = await getPool();
  await pool.request().input("jedaId", sql.Int, jedaId).query(`
    UPDATE DashboardProduksiMesinJeda SET IsDeleted = 1, ModifiedDate = GETDATE()
    WHERE JedaID = @jedaId AND IsDeleted = 0
  `);
}
