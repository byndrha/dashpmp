"use server";

import { revalidatePath } from "next/cache";
import { requireGrupAccess } from "@/lib/require-access";
import { getPool, sql } from "@/lib/db";
import {
  listAkunDirektori,
  listPerusahaanDirektori,
  createAkunDirektori,
  updateAkunDirektori,
  resetAkunDirektoriPassword,
  deleteAkunDirektori,
  type AkunDirektoriScope,
} from "@/lib/queries/akun-direktori";

export async function listAkunDirektoriAction() {
  await requireGrupAccess();
  return listAkunDirektori();
}

export async function listPerusahaanDirektoriAction() {
  await requireGrupAccess();
  return listPerusahaanDirektori();
}

// Postgres akun_direktori.username is checked first in auth.ts's
// authorize(), so a username that also exists in MSSQL DashboardUser would
// silently shadow that MKEsindo account — reject it here instead.
async function usernameExistsInMkesindo(username: string): Promise<boolean> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("username", sql.VarChar(128), username)
    .query(`SELECT 1 FROM DashboardUser WHERE Username = @username`);
  return result.recordset.length > 0;
}

export async function createAkunDirektoriAction(input: {
  nama: string;
  username: string;
  password: string;
  email: string | null;
  scope: AkunDirektoriScope;
  perusahaanId: number | null;
}) {
  await requireGrupAccess();
  if (!input.nama.trim() || !input.username.trim() || input.password.length < 6) {
    throw new Error("Nama, username wajib diisi dan password minimal 6 karakter.");
  }
  if (input.scope === "pmputra" && input.perusahaanId == null) {
    throw new Error("Akun Finance PMPutra harus terhubung ke Perusahaan.");
  }
  if (await usernameExistsInMkesindo(input.username)) {
    throw new Error("Username sudah dipakai oleh akun MKEsindo — pilih username lain.");
  }
  try {
    await createAkunDirektori(input);
  } catch (err) {
    if (err instanceof Error && /akun_direktori_username_key/i.test(err.message)) {
      throw new Error("Username sudah digunakan, pilih username lain.");
    }
    throw err;
  }
  revalidatePath("/grup/akun/direktori");
}

export async function updateAkunDirektoriAction(input: {
  id: number;
  nama: string;
  email: string | null;
  scope: AkunDirektoriScope;
  perusahaanId: number | null;
  isActive: boolean;
}) {
  await requireGrupAccess();
  if (!input.nama.trim()) throw new Error("Nama wajib diisi.");
  if (input.scope === "pmputra" && input.perusahaanId == null) {
    throw new Error("Akun Finance PMPutra harus terhubung ke Perusahaan.");
  }
  await updateAkunDirektori(input);
  revalidatePath("/grup/akun/direktori");
}

export async function resetAkunDirektoriPasswordAction(id: number, newPassword: string) {
  await requireGrupAccess();
  if (newPassword.length < 6) throw new Error("Password minimal 6 karakter.");
  await resetAkunDirektoriPassword(id, newPassword);
  revalidatePath("/grup/akun/direktori");
}

export async function deleteAkunDirektoriAction(id: number) {
  await requireGrupAccess();
  await deleteAkunDirektori(id);
  revalidatePath("/grup/akun/direktori");
}
