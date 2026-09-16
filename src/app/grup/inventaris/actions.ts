"use server";

import { revalidatePath } from "next/cache";
import { requireInventarisAccess } from "@/lib/require-access";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";
import {
  createVendor, updateVendor, addVendorLokasi, updateVendorLokasi, deleteVendorLokasi,
  addVendorPic, updateVendorPic, deleteVendorPic, addVendorPicInternal, removeVendorPicInternal,
  getVendor, listVendorLokasi, listVendorPic,
  type VendorInput, type VendorLokasiInput, type VendorPicInput,
} from "@/lib/queries/inventaris-vendor";
import {
  listVendorKategori, createVendorKategori, renameVendorKategori, deleteVendorKategori,
  addVendorProduk, updateVendorProduk, deleteVendorProduk,
  type VendorProdukInput,
} from "@/lib/queries/inventaris-produk";
import { addVendorPengiriman, deleteVendorPengiriman, type VendorPengirimanInput } from "@/lib/queries/inventaris-pengiriman";
import { createBusinessPartnerForVendor, updateBusinessPartnerFromVendor } from "@/lib/queries/inventaris-businesspartner-sync";
import { getPgPool } from "@/lib/pg";

function assertVendorInput(input: VendorInput) {
  if (!input.nama.trim()) throw new AppError("Nama vendor wajib diisi.");
}

export async function createVendorAction(input: VendorInput): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requireInventarisAccess();
    assertVendorInput(input);
    const id = await createVendor(input);
    revalidatePath("/grup/inventaris");
    return id;
  });
}

export async function updateVendorAction(id: number, input: VendorInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    assertVendorInput(input);
    await updateVendor(id, input);

    // Keep every linked company's BusinessPartner in sync (Global
    // Constraints: Postgres -> MSSQL, one-way, on every edit).
    const pgPool = getPgPool();
    const links = await pgPool.query(
      `SELECT vpl.business_partner_id, p.kode FROM vendor_perusahaan_link vpl JOIN perusahaan p ON p.id = vpl.perusahaan_id WHERE vpl.vendor_id = $1`,
      [id]
    );
    const [vendor, lokasiList, picList] = await Promise.all([getVendor(id), listVendorLokasi(id), listVendorPic(id)]);
    if (!vendor) throw new AppError("Vendor tidak ditemukan.");
    const picUtama = picList.find((p) => p.urutan === 0);
    const alamatUtama = lokasiList[0]?.alamat ?? null;
    for (const link of links.rows as { business_partner_id: string; kode: string }[]) {
      await updateBusinessPartnerFromVendor(
        link.kode,
        link.business_partner_id,
        vendor,
        picUtama ? { nama: picUtama.nama, telepon: picUtama.telepon } : null,
        alamatUtama
      );
    }
    revalidatePath("/grup/inventaris");
    revalidatePath(`/grup/inventaris/vendor/${id}`);
  });
}

export async function addVendorLokasiAction(vendorId: number, input: VendorLokasiInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    if (!input.namaLokasi.trim()) throw new AppError("Nama lokasi wajib diisi.");
    await addVendorLokasi(vendorId, input);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function updateVendorLokasiAction(id: number, vendorId: number, input: VendorLokasiInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    if (!input.namaLokasi.trim()) throw new AppError("Nama lokasi wajib diisi.");
    await updateVendorLokasi(id, input);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function deleteVendorLokasiAction(id: number, vendorId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await deleteVendorLokasi(id);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function addVendorPicAction(vendorId: number, input: VendorPicInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    if (!input.nama.trim()) throw new AppError("Nama PIC wajib diisi.");
    await addVendorPic(vendorId, input);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function updateVendorPicAction(id: number, vendorId: number, input: VendorPicInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    if (!input.nama.trim()) throw new AppError("Nama PIC wajib diisi.");
    await updateVendorPic(id, input);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function deleteVendorPicAction(id: number, vendorId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await deleteVendorPic(id);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function addVendorPicInternalAction(vendorId: number, perusahaanId: number, akunId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await addVendorPicInternal(vendorId, perusahaanId, akunId);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function removeVendorPicInternalAction(id: number, vendorId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await removeVendorPicInternal(id);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function listVendorKategoriAction(): Promise<ActionResult<Awaited<ReturnType<typeof listVendorKategori>>>> {
  return runAction(async () => {
    await requireInventarisAccess();
    return listVendorKategori();
  });
}

export async function createVendorKategoriAction(nama: string): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requireInventarisAccess();
    if (!nama.trim()) throw new AppError("Nama kategori wajib diisi.");
    const id = await createVendorKategori(nama.trim());
    revalidatePath("/grup/inventaris");
    return id;
  });
}

export async function renameVendorKategoriAction(id: number, nama: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    if (!nama.trim()) throw new AppError("Nama kategori wajib diisi.");
    await renameVendorKategori(id, nama.trim());
    revalidatePath("/grup/inventaris");
  });
}

export async function deleteVendorKategoriAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await deleteVendorKategori(id);
    revalidatePath("/grup/inventaris");
  });
}

export async function addVendorProdukAction(vendorId: number, input: VendorProdukInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await addVendorProduk(vendorId, input);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function updateVendorProdukAction(id: number, vendorId: number, input: VendorProdukInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await updateVendorProduk(id, input);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function deleteVendorProdukAction(id: number, vendorId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await deleteVendorProduk(id);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

// Links a vendor to a company: creates a brand-new BusinessPartner row
// (Task 5) and records the resulting ID in vendor_perusahaan_link. Caller
// (Task 10's UI) is responsible for offering "link to an EXISTING
// BusinessPartnerID instead" as a separate, simpler path (a direct INSERT
// into vendor_perusahaan_link with a staff-provided BusinessPartnerID —
// wire that as a second action here, linkVendorToExistingBusinessPartnerAction,
// if the UI task needs it) — this action only covers the "brand-new vendor"
// path described in the spec.
//
// Pre-check guard (controller ruling, carried forward from Task 4/5
// review): vendor_perusahaan_link has a DB-level UNIQUE(vendor_id,
// perusahaan_id) constraint. Without this check, a duplicate call (e.g. a
// double-click or retry) would first successfully create a brand-new real
// BusinessPartner row in MSSQL via createBusinessPartnerForVendor — a live
// financial-data side effect with no rollback — and only THEN fail on the
// vendor_perusahaan_link INSERT, leaving an orphaned BusinessPartner row in
// live accounting data. So check for an existing link first and bail out
// before touching MSSQL at all, mirroring deleteVendorKategori's in-use
// guard pattern (query first, throw AppError if found, otherwise proceed).
export async function linkVendorToPerusahaanAction(
  vendorId: number,
  perusahaanId: number,
  perusahaanKode: string,
  termOfPaymentId: string,
  isSuspended: boolean
): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    const pgPool = getPgPool();
    const existing = await pgPool.query(
      `SELECT 1 FROM vendor_perusahaan_link WHERE vendor_id = $1 AND perusahaan_id = $2`,
      [vendorId, perusahaanId]
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new AppError("Vendor ini sudah terhubung ke perusahaan tersebut.");
    }

    const [vendor, lokasiList, picList] = await Promise.all([getVendor(vendorId), listVendorLokasi(vendorId), listVendorPic(vendorId)]);
    if (!vendor) throw new AppError("Vendor tidak ditemukan.");
    const picUtama = picList.find((p) => p.urutan === 0);
    const businessPartnerId = await createBusinessPartnerForVendor({
      perusahaanKode,
      vendor,
      picUtama: picUtama ? { nama: picUtama.nama, telepon: picUtama.telepon } : null,
      lokasiUtama: lokasiList[0] ? { alamat: lokasiList[0].alamat } : null,
      termOfPaymentId,
      isSuspended,
    });
    await pgPool.query(
      `INSERT INTO vendor_perusahaan_link (vendor_id, perusahaan_id, business_partner_id, term_of_payment_id, is_suspended)
       VALUES ($1, $2, $3, $4, $5)`,
      [vendorId, perusahaanId, businessPartnerId, termOfPaymentId, isSuspended]
    );
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}

export async function addVendorPengirimanAction(input: VendorPengirimanInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireInventarisAccess();
    // This is a directly-invocable Server Action, so a caller could send any
    // dicatatOlehAkunId they like — override it with the actual signed-in
    // user's id rather than trusting the client-supplied value (the UI's own
    // currentAkunId is now harmlessly redundant with this server-side check).
    const safeInput: VendorPengirimanInput = { ...input, dicatatOlehAkunId: Number(session.user.id) };
    await addVendorPengiriman(safeInput);
    revalidatePath("/grup/inventaris");
  });
}

export async function deleteVendorPengirimanAction(id: number, vendorId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireInventarisAccess();
    await deleteVendorPengiriman(id);
    revalidatePath(`/grup/inventaris/vendor/${vendorId}`);
  });
}
