"use server";

import { revalidatePath } from "next/cache";
import { requireProduksiView } from "@/lib/require-access";
import { getMesinList, updateMesin, type MesinRow, type UpdateMesinInput } from "@/lib/queries/produksi-mesin";
import {
  getWarehouseMap,
  getRiwayatProduksi,
  getRiwayatProduksiForPosisi,
  createBatch,
  type PalletPosisiRow,
  type RiwayatProduksiRow,
  type CreateBatchInput,
} from "@/lib/queries/produksi-warehouse";
import {
  getDraftJadwalForProduksi,
  produksiStartMuat,
  produksiSelesaiMuat,
  type DraftJadwalForProduksi,
  type ProduksiSelesaiMuatInput,
} from "@/lib/queries/produksi-muatan";
import { getJadwalDetail, type JadwalDetailRow } from "@/lib/queries/pengiriman-jadwal";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function getMesinListAction(): Promise<ActionResult<MesinRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getMesinList();
  });
}

export async function updateMesinAction(input: UpdateMesinInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiView();
    if (!input.nama.trim()) throw new AppError("Nama mesin tidak boleh kosong.");
    if (input.kapasitasProduksiPerHari <= 0) throw new AppError("Kapasitas produksi harus lebih dari 0.");
    await updateMesin(input);
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
  });
}

export async function getWarehouseMapAction(): Promise<ActionResult<PalletPosisiRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getWarehouseMap();
  });
}

export interface RiwayatProduksiRowWithNama extends RiwayatProduksiRow {
  DicatatOlehNama: string;
}

export async function getRiwayatProduksiAction(): Promise<ActionResult<RiwayatProduksiRowWithNama[]>> {
  return runAction(async () => {
    await requireProduksiView();
    const rows = await getRiwayatProduksi();
    const namaMap = await getAkunNamaMap(rows.map((r) => r.DicatatOlehAkunID));
    return rows.map((r) => ({ ...r, DicatatOlehNama: namaMap.get(r.DicatatOlehAkunID) ?? "Tidak diketahui" }));
  });
}

// Riwayat scoped to one Pallete — shown at the top of TambahProduksiDialog.
export async function getRiwayatProduksiForPosisiAction(
  posisiId: number
): Promise<ActionResult<RiwayatProduksiRowWithNama[]>> {
  return runAction(async () => {
    await requireProduksiView();
    const rows = await getRiwayatProduksiForPosisi(posisiId);
    const namaMap = await getAkunNamaMap(rows.map((r) => r.DicatatOlehAkunID));
    return rows.map((r) => ({ ...r, DicatatOlehNama: namaMap.get(r.DicatatOlehAkunID) ?? "Tidak diketahui" }));
  });
}

export async function createBatchAction(
  input: Omit<CreateBatchInput, "dicatatOlehAkunId">
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    if (!input.jamPanen) {
      throw new AppError("Isi jam panen.");
    }
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
    await requireProduksiView();
    return getDraftJadwalForProduksi();
  });
}

// Step 1 of produksi-app's 2-step flow: records JamMulaiMuat only, no
// pallet allocation yet. The alokasi screen (step 2) only opens after this
// succeeds.
export async function produksiStartMuatAction(jadwalId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiView();
    const jadwalList = await getDraftJadwalForProduksi();
    const jadwal = jadwalList.find((j) => j.JadwalID === jadwalId);
    if (!jadwal) throw new AppError("Kartu Pengiriman ini sudah tidak tersedia.");
    await produksiStartMuat(jadwalId);
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/delivery");
  });
}

// Read-only — fetches the destination/qty list shown in the Ya/Tidak
// confirmation popup before step 2 commits to the real Selesai Muat.
export async function getJadwalDetailForProduksiAction(jadwalId: number): Promise<ActionResult<JadwalDetailRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getJadwalDetail(jadwalId);
  });
}

// Step 2: allocates pallet stock, then completes the real "Selesai Muat"
// transition (creates DeliveryOrder/SalesInvoice documents) — can reject
// with AppError if the driver/route on this Jadwal isn't ready yet (e.g.
// "Driver wajib diisi", "Rute belum berhasil divalidasi"), surfaced to the
// operator as-is so they know to finish Validasi Rute on desktop first.
export async function produksiSelesaiMuatAction(
  input: Omit<ProduksiSelesaiMuatInput, "dicatatOlehAkunId">
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    const totalQty10 = input.alokasi.reduce((sum, a) => sum + a.qty10KG, 0);
    const totalQty5 = input.alokasi.reduce((sum, a) => sum + a.qty5KG, 0);
    const jadwalList = await getDraftJadwalForProduksi();
    const jadwal = jadwalList.find((j) => j.JadwalID === input.jadwalId);
    if (!jadwal) throw new AppError("Kartu Pengiriman ini sudah tidak tersedia untuk diisi.");
    if (totalQty10 < jadwal.Qty10KGDibutuhkan || totalQty5 < jadwal.Qty5KGDibutuhkan) {
      throw new AppError("Jumlah yang dialokasikan belum mencukupi kebutuhan Kartu Pengiriman ini.");
    }
    await produksiSelesaiMuat({ ...input, dicatatOlehAkunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/delivery");
  });
}
