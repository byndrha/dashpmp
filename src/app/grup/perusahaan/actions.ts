"use server";

import { revalidatePath } from "next/cache";
import { requireGrupAccess } from "@/lib/require-access";
import { createPerusahaan, updatePerusahaan, softDeletePerusahaan, type PerusahaanInput } from "@/lib/queries/perusahaan";
import { PERUSAHAAN_JENIS_BISNIS } from "@/lib/perusahaan-status";
import { upsertKoneksi, deleteKoneksi, type UpsertKoneksiInput } from "@/lib/queries/perusahaan-koneksi";
import { deleteGDriveKoneksi } from "@/lib/queries/perusahaan-gdrive";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";
import {
  listMetodePembayaran,
  upsertMetodePembayaran,
  getMetodePembayaranById,
  setQrisStatisImagePath,
  getSnapBiKredensial,
  upsertSnapBiKredensial,
  type MetodePembayaranRow,
  type UpsertMetodePembayaranInput,
  type UpsertSnapBiKredensialInput,
} from "@/lib/queries/metode-pembayaran";
import { uploadFile } from "@/lib/storage/google-drive";

function assertValid(input: PerusahaanInput) {
  if (!input.nama.trim()) throw new AppError("Nama PT wajib diisi.");
  if (input.status === "StandaloneHTML" && !input.standaloneUrl?.trim()) {
    throw new AppError("URL Standalone wajib diisi untuk status Standalone HTML.");
  }
  // Locked enum — every module that branches on business type depends on
  // this never being an arbitrary string (see PERUSAHAAN_JENIS_BISNIS).
  if (!input.jenisBisnis || !(PERUSAHAAN_JENIS_BISNIS as readonly string[]).includes(input.jenisBisnis)) {
    throw new AppError("Jenis Bisnis wajib dipilih (Es Kristal atau Es Balok).");
  }
}

export async function createPerusahaanAction(input: PerusahaanInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    assertValid(input);
    await createPerusahaan(input);
    revalidatePath("/grup/perusahaan");
  });
}

export async function updatePerusahaanAction(id: number, input: PerusahaanInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    assertValid(input);
    await updatePerusahaan(id, input);
    revalidatePath("/grup/perusahaan");
  });
}

export async function deletePerusahaanAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await softDeletePerusahaan(id);
    revalidatePath("/grup/perusahaan");
  });
}

export async function upsertKoneksiAction(input: UpsertKoneksiInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    if (!input.host.trim() || !input.dbName.trim() || !input.dbUser.trim()) {
      throw new AppError("Host, Nama Database, dan Username wajib diisi untuk setiap koneksi.");
    }
    if (!Number.isFinite(input.port) || input.port <= 0) {
      throw new AppError("Port harus berupa angka positif untuk setiap koneksi.");
    }
    await upsertKoneksi(input);
    revalidatePath("/grup/perusahaan");
  });
}

export async function deleteKoneksiAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await deleteKoneksi(id);
    revalidatePath("/grup/perusahaan");
  });
}

export async function disconnectGDriveAction(perusahaanId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await deleteGDriveKoneksi(perusahaanId);
    revalidatePath("/grup/perusahaan");
  });
}

export async function listMetodePembayaranAction(perusahaanId: number): Promise<ActionResult<MetodePembayaranRow[]>> {
  return runAction(async () => {
    await requireGrupAccess();
    return listMetodePembayaran(perusahaanId);
  });
}

export async function upsertMetodePembayaranAction(input: UpsertMetodePembayaranInput): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requireGrupAccess();
    if (!input.kode.trim()) throw new AppError("Kode metode pembayaran wajib diisi.");
    if (!input.coaId.trim()) throw new AppError("Chart of Account wajib dipilih.");
    if (input.konteks.length === 0) throw new AppError("Pilih minimal satu konteks (Driver/Kasir/Publik).");
    const id = await upsertMetodePembayaran(input);
    revalidatePath("/grup/perusahaan");
    return id;
  });
}

export async function uploadQrisStatisImageAction(formData: FormData): Promise<ActionResult<string>> {
  return runAction(async () => {
    await requireGrupAccess();
    const file = formData.get("file");
    const metodeIdRaw = formData.get("metodeId");
    if (!(file instanceof File)) throw new AppError("File tidak ditemukan.");
    if (typeof metodeIdRaw !== "string" || !metodeIdRaw.trim()) throw new AppError("metodeId wajib diisi.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new AppError("Format file harus JPG, PNG, atau WEBP.");
    if (file.size > 5 * 1024 * 1024) throw new AppError("Ukuran file maksimal 5MB.");

    const metodeId = Number(metodeIdRaw);
    const metode = await getMetodePembayaranById(metodeId);
    if (!metode) throw new AppError("Metode pembayaran tidak ditemukan.");
    if (metode.jenis !== "qris_static") throw new AppError("Upload gambar hanya berlaku untuk metode QRIS Statis.");

    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const bytes = await file.arrayBuffer();
    const uploaded = await uploadFile(metode.perusahaanKode, ["metode-pembayaran"], `${metode.kode}.${ext}`, Buffer.from(bytes), file.type);
    await setQrisStatisImagePath(metodeId, uploaded.publicPath);
    revalidatePath("/grup/perusahaan");
    return uploaded.publicPath;
  });
}

export async function getSnapBiKredensialStatusAction(
  perusahaanId: number
): Promise<ActionResult<{ configured: boolean; clientId: string; merchantId: string; partnerId: string } | null>> {
  return runAction(async () => {
    await requireGrupAccess();
    const cred = await getSnapBiKredensial(perusahaanId);
    if (!cred) return null;
    return { configured: true, clientId: cred.clientId, merchantId: cred.merchantId, partnerId: cred.partnerId };
  });
}

export async function upsertSnapBiKredensialAction(input: UpsertSnapBiKredensialInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    if (!input.clientId.trim() || !input.clientSecret.trim() || !input.merchantId.trim() || !input.partnerId.trim()) {
      throw new AppError("Semua field kredensial Snap BI wajib diisi.");
    }
    await upsertSnapBiKredensial(input);
    revalidatePath("/grup/perusahaan");
  });
}
