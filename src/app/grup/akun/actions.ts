"use server";

import { revalidatePath } from "next/cache";
import { requireGrupAccess } from "@/lib/require-access";
import {
  createAkun,
  updateAkun,
  deleteAkun,
  resetAkunPassword,
  countActiveSuperAdmins,
  listAllPeran,
  listAkun,
  type CreateAkunInput,
  type UpdateAkunInput,
} from "@/lib/queries/akun";
import { getPabrikLocation, setPabrikLocation } from "@/lib/queries/pabrik-location";
import { getSiteSettings, setSiteSettings, type SiteSettings } from "@/lib/queries/site-settings";
import { getDocTemplate, saveDocTemplate, type DocTemplate, type DocType } from "@/lib/queries/doc-template";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

// Enforces the invariant from the design spec: an account is either
// cross-company Direktur (both null) or PT-scoped with a role in that PT
// (both set) — never a mismatched combination.
function assertScopeConsistent(perusahaanId: number | null, peranId: number | null) {
  if ((perusahaanId == null) !== (peranId == null)) {
    throw new AppError("Akun harus terhubung ke Perusahaan DAN Peran sekaligus, atau menjadi akun Direktur (tanpa keduanya).");
  }
}

export async function createAkunAction(input: CreateAkunInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    if (!input.nama.trim() || !input.username.trim() || input.password.length < 6) {
      throw new AppError("Nama, username wajib diisi dan password minimal 6 karakter.");
    }
    assertScopeConsistent(input.perusahaanId, input.peranId);
    try {
      await createAkun(input);
    } catch (err) {
      if (err instanceof Error && /username_key/i.test(err.message)) {
        throw new AppError("Username sudah digunakan, pilih username lain.");
      }
      throw err;
    }
    revalidatePath("/grup/akun");
  });
}

export async function updateAkunAction(input: UpdateAkunInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    if (!input.nama.trim()) throw new AppError("Nama wajib diisi.");
    assertScopeConsistent(input.perusahaanId, input.peranId);

    // The "last active superadmin" guard must be checked against the account's
    // CURRENT (database) perusahaanId, not the newly submitted one — otherwise
    // reassigning/deactivating the sole superadmin of PT A while editing it
    // into PT B (or converting it to Direktur) would never trip the check for
    // PT A. Mirrors the pattern deleteAkunAction already uses via listAkun().
    const current = (await listAkun()).find((a) => a.id === input.id);
    const currentPerusahaanId = current?.perusahaanId ?? null;

    if (currentPerusahaanId != null) {
      const peranList = await listAllPeran();
      const currentPeranIsSuperAdmin =
        current?.peranId != null ? peranList.find((p) => p.id === current.peranId)?.isSuperAdmin ?? false : false;
      const wasActiveSuperAdmin = (current?.isActive ?? false) && currentPeranIsSuperAdmin;

      if (wasActiveSuperAdmin) {
        const newPeranIsSuperAdmin =
          input.peranId != null ? peranList.find((p) => p.id === input.peranId)?.isSuperAdmin ?? false : false;
        const staysActiveSuperAdminInSamePt =
          input.perusahaanId === currentPerusahaanId && input.isActive && newPeranIsSuperAdmin;

        if (!staysActiveSuperAdminInSamePt) {
          const remaining = await countActiveSuperAdmins(currentPerusahaanId, input.id);
          if (remaining === 0) {
            throw new AppError(
              "Tidak bisa menonaktifkan atau mengubah peran akun ini — minimal harus ada satu Super Administrator aktif di PT tersebut."
            );
          }
        }
      }
    }

    await updateAkun(input);
    revalidatePath("/grup/akun");
  });
}

export async function resetAkunPasswordAction(id: number, newPassword: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    if (newPassword.length < 6) throw new AppError("Password minimal 6 karakter.");
    await resetAkunPassword(id, newPassword);
    revalidatePath("/grup/akun");
  });
}

export async function deleteAkunAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireGrupAccess();
    if (Number(session.user.id) === id) {
      throw new AppError("Tidak bisa menghapus akun Anda sendiri yang sedang digunakan untuk login.");
    }
    // Only PT-scoped accounts have the "last active superadmin" guard —
    // Direktur accounts (perusahaanId null) skip it entirely.
    const target = (await listAkun()).find((a) => a.id === id);
    if (target?.perusahaanId != null) {
      const remaining = await countActiveSuperAdmins(target.perusahaanId, id);
      if (remaining === 0) {
        throw new AppError("Tidak bisa menghapus akun ini — minimal harus ada satu Super Administrator aktif di PT tersebut.");
      }
    }
    await deleteAkun(id);
    revalidatePath("/grup/akun");
  });
}

export async function getPabrikLocationAction() {
  await requireGrupAccess();
  return getPabrikLocation();
}

export async function setPabrikLocationAction(input: {
  latitude: number;
  longitude: number;
  alamat: string | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await setPabrikLocation(input);
    revalidatePath("/grup/akun");
  });
}

export async function getSiteSettingsAction() {
  await requireGrupAccess();
  return getSiteSettings();
}

export async function setSiteSettingsAction(input: SiteSettings): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    if (!input.title.trim()) throw new AppError("Title tidak boleh kosong.");
    await setSiteSettings(input);
    revalidatePath("/grup/akun");
    revalidatePath("/", "layout");
  });
}

export async function getDocTemplateAction(docType: DocType): Promise<DocTemplate> {
  await requireGrupAccess();
  return getDocTemplate(docType);
}

export async function saveDocTemplateAction(input: DocTemplate): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    if (!input.headerTitle.trim()) throw new AppError("Judul kop surat tidak boleh kosong.");
    await saveDocTemplate(input);
    revalidatePath("/grup/akun");
  });
}
