import { getPool, sql } from "@/lib/db";
import type { StatusMesin } from "@/lib/produksi-mesin-status";

export type { StatusMesin } from "@/lib/produksi-mesin-status";

export interface MesinRow {
  MesinID: number;
  Nama: string;
  Status: StatusMesin;
  KapasitasProduksiPerHari: number;
  KonsumsiListrikKWh: number;
  LamaProduksiMenit: number;
  LamaPengemasanMenit: number;
}

export async function getMesinList(): Promise<MesinRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT MesinID, Nama, Status, KapasitasProduksiPerHari, KonsumsiListrikKWh, LamaProduksiMenit, LamaPengemasanMenit
    FROM DashboardProduksiMesin
    WHERE IsDeleted = 0
    ORDER BY MesinID
  `);
  return result.recordset;
}

export interface UpdateMesinInput {
  mesinId: number;
  nama: string;
  status: StatusMesin;
  kapasitasProduksiPerHari: number;
  konsumsiListrikKWh: number;
  lamaProduksiMenit: number;
  lamaPengemasanMenit: number;
}

export async function updateMesin(input: UpdateMesinInput): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("mesinId", sql.Int, input.mesinId)
    .input("nama", sql.VarChar(100), input.nama)
    .input("status", sql.VarChar(20), input.status)
    .input("kapasitas", sql.Int, input.kapasitasProduksiPerHari)
    .input("listrik", sql.Decimal(10, 2), input.konsumsiListrikKWh)
    .input("lamaProduksi", sql.Int, input.lamaProduksiMenit)
    .input("lamaKemas", sql.Int, input.lamaPengemasanMenit)
    .query(`
      UPDATE DashboardProduksiMesin
      SET Nama = @nama, Status = @status, KapasitasProduksiPerHari = @kapasitas, KonsumsiListrikKWh = @listrik,
          LamaProduksiMenit = @lamaProduksi, LamaPengemasanMenit = @lamaKemas, ModifiedDate = GETDATE()
      WHERE MesinID = @mesinId AND IsDeleted = 0
    `);
}
