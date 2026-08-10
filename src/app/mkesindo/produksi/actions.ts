"use server";

import { revalidatePath } from "next/cache";
import { requireProduksi } from "@/lib/require-access";
import { getMesinList, updateMesin, type MesinRow, type UpdateMesinInput } from "@/lib/queries/produksi-mesin";
import {
  getWarehouseMap,
  getRiwayatProduksi,
  createBatch,
  type PalletPosisiRow,
  type RiwayatProduksiRow,
  type CreateBatchInput,
} from "@/lib/queries/produksi-warehouse";
import {
  getDraftJadwalForProduksi,
  produksiMulaiMuat,
  type DraftJadwalForProduksi,
  type ProduksiMulaiMuatInput,
} from "@/lib/queries/produksi-muatan";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { getBusinessDateISO } from "@/lib/business-date";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function getMesinListAction(): Promise<ActionResult<MesinRow[]>> {
  return runAction(async () => {
    await requireProduksi();
    return getMesinList();
  });
}

export async function updateMesinAction(input: UpdateMesinInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksi();
    if (!input.nama.trim()) throw new AppError("Nama mesin tidak boleh kosong.");
    if (input.kapasitasProduksiPerHari <= 0) throw new AppError("Kapasitas produksi harus lebih dari 0.");
    await updateMesin(input);
    revalidatePath("/mkesindo/produksi");
  });
}

export async function getWarehouseMapAction(): Promise<ActionResult<PalletPosisiRow[]>> {
  return runAction(async () => {
    await requireProduksi();
    return getWarehouseMap();
  });
}

export interface RiwayatProduksiRowWithNama extends RiwayatProduksiRow {
  DicatatOlehNama: string;
}

export async function getRiwayatProduksiAction(): Promise<ActionResult<RiwayatProduksiRowWithNama[]>> {
  return runAction(async () => {
    await requireProduksi();
    const rows = await getRiwayatProduksi();
    const namaMap = await getAkunNamaMap(rows.map((r) => r.DicatatOlehAkunID));
    return rows.map((r) => ({ ...r, DicatatOlehNama: namaMap.get(r.DicatatOlehAkunID) ?? "Tidak diketahui" }));
  });
}

export async function createBatchAction(
  input: Omit<CreateBatchInput, "dicatatOlehAkunId">
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const session = await requireProduksi();
    if (input.qty10KG <= 0 && input.qty5KG <= 0) {
      throw new AppError("Isi jumlah kantong 10kg atau 5kg minimal satu.");
    }
    const batchId = await createBatch({ ...input, dicatatOlehAkunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi");
    return batchId;
  });
}

export async function getDraftJadwalForProduksiAction(): Promise<ActionResult<DraftJadwalForProduksi[]>> {
  return runAction(async () => {
    await requireProduksi();
    return getDraftJadwalForProduksi(getBusinessDateISO());
  });
}

export async function produksiMulaiMuatAction(
  input: Omit<ProduksiMulaiMuatInput, "dicatatOlehAkunId">
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksi();
    const totalQty10 = input.alokasi.reduce((sum, a) => sum + a.qty10KG, 0);
    const totalQty5 = input.alokasi.reduce((sum, a) => sum + a.qty5KG, 0);
    const jadwalList = await getDraftJadwalForProduksi(getBusinessDateISO());
    const jadwal = jadwalList.find((j) => j.JadwalID === input.jadwalId);
    if (!jadwal) throw new AppError("Kartu Pengiriman ini sudah tidak tersedia untuk diisi.");
    if (totalQty10 < jadwal.Qty10KGDibutuhkan || totalQty5 < jadwal.Qty5KGDibutuhkan) {
      throw new AppError("Jumlah yang dialokasikan belum mencukupi kebutuhan Kartu Pengiriman ini.");
    }
    await produksiMulaiMuat({ ...input, dicatatOlehAkunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/delivery");
  });
}
