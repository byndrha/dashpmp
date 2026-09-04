"use server";

import { revalidatePath } from "next/cache";
import { requireProduksiView, requireProduksiAdmin } from "@/lib/require-access";
import { getMesinList, updateMesin, type MesinRow, type UpdateMesinInput } from "@/lib/queries/produksi-mesin";
import {
  getWarehouseMap,
  getRiwayatProduksi,
  getRiwayatProduksiForPosisi,
  createBatch,
  updateBatchQty,
  deleteBatch,
  getBatchAktifForAlokasi,
  type PalletPosisiRow,
  type RiwayatProduksiRow,
  type CreateBatchInput,
  type BatchAktifRow,
} from "@/lib/queries/produksi-warehouse";
import {
  getDraftJadwalForProduksi,
  getAllDraftJadwalForProduksi,
  getKartuPengirimanBelumSelesaiUntukPeriode,
  getKartuPengirimanSelesaiUntukPeriode,
  produksiStartMuat,
  produksiSelesaiMuat,
  produksiSelesaiMuatManual,
  type DraftJadwalForProduksi,
  type SelesaiMuatJadwalForProduksi,
  type ProduksiSelesaiMuatInput,
} from "@/lib/queries/produksi-muatan";
import { getJadwalDetail, type JadwalDetailRow } from "@/lib/queries/pengiriman-jadwal";
import { getJadwalBulan, setJadwalTim, hapusJadwalTim, type JadwalTimRow } from "@/lib/queries/jadwal-tim-produksi";
import { getAkunNamaMap, getStafOperasionalOptions, getProduksiAkunOptions, type StafOperasionalOption } from "@/lib/queries/akun";
import {
  getKualitasRiwayat,
  createKualitas,
  type KualitasRow,
  type CreateKualitasInput,
} from "@/lib/queries/produksi-kualitas";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";
import {
  getCurrentShiftRows,
  getStokBahanBakuHistory,
  upsertProduksiStok,
  type StokBahanBakuRow,
  type CurrentShiftInfo,
  type UpsertProduksiStokInput,
} from "@/lib/queries/stok-bahan-baku";
import {
  getAllTim,
  getAnggotaTim,
  getSemuaAnggotaTim,
  tambahAnggotaTim,
  updateAnggotaTim,
  hapusAnggotaTim,
  hapusAnggotaTimIfOwned,
  updateTimKepala,
  updateTimWakilKepala,
  getTimByKepalaAkunId,
  type AnggotaTimRow,
  type TimRow,
} from "@/lib/queries/tim-produksi";
import { catatMesinEvent, getMesinEventsForShift, type JenisMesinEvent, type MesinEventRow } from "@/lib/queries/produksi-mesin-event";
import {
  getCurrentShift,
  getAktivitasForShift,
  getAktivitasRiwayat,
  upsertStafOperasional,
  upsertKerusakan,
  getSusunanTim,
  setSusunanTim,
  setTimBertugas,
  setKepalaHadir,
  setWakilHadir,
  getQtyRecapForShift,
  type AktivitasShiftInfo,
  type QtyRecap,
  type KerusakanInput,
  type SusunanTimRow,
} from "@/lib/queries/aktivitas-produksi";
import type { ShiftNumber } from "@/lib/report-shift";
import { getPool } from "@/lib/db";
import { enqueuePrintJob } from "@/lib/queries/print-queue";
import {
  getTakeAwayMuatanPending,
  getTakeAwayMuatanSelesaiRecent,
  takeAwayMulaiMuat,
  takeAwaySelesaiMuat,
  type TakeAwayMuatanPendingRow,
  type TakeAwayMuatanSelesaiRow,
} from "@/lib/queries/takeaway-muatan";

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

export async function getBatchAktifForAlokasiAction(): Promise<ActionResult<BatchAktifRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getBatchAktifForAlokasi();
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

// Riwayat scoped to one Pallete — shown at the top of TambahProduksiDialog
// (mobile, no windowEndISO — top-10 most recent) and the desktop "Riwayat &
// Kelola Stok Pallete Ini" panel (windowEndISO set — 24-jam window ending
// at that moment, for its prev/next period buttons).
export async function getRiwayatProduksiForPosisiAction(
  posisiId: number,
  windowEndISO?: string
): Promise<ActionResult<RiwayatProduksiRowWithNama[]>> {
  return runAction(async () => {
    await requireProduksiView();
    const rows = await getRiwayatProduksiForPosisi(posisiId, windowEndISO ? { windowEnd: new Date(windowEndISO) } : undefined);
    const namaMap = await getAkunNamaMap(rows.map((r) => r.DicatatOlehAkunID));
    return rows.map((r) => ({ ...r, DicatatOlehNama: namaMap.get(r.DicatatOlehAkunID) ?? "Tidak diketahui" }));
  });
}

export async function createBatchAction(
  input: Omit<CreateBatchInput, "dicatatOlehAkunId">
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    if (!input.kualitasId) {
      throw new AppError("Pilih Pemeriksaan Kualitas terkait.");
    }
    if (input.qty10KG <= 0) {
      throw new AppError("Isi jumlah kantong 10kg.");
    }
    const batchId = await createBatch({ ...input, dicatatOlehAkunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
    return batchId;
  });
}

// Koreksi admin/desktop untuk input stok yang salah catat — lihat
// updateBatchQty di produksi-warehouse.ts untuk aturan lengkapnya (tidak
// bisa di bawah jumlah yang sudah terpakai, kapasitas pallet dan plafon
// Kualitas dicek ulang).
export async function updateBatchQtyAction(batchId: number, qty10KG: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiView();
    if (!qty10KG || qty10KG <= 0) throw new AppError("Isi jumlah kantong 10kg.");
    await updateBatchQty({ batchId, qty10KG });
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
  });
}

// Koreksi admin/desktop untuk input stok yang salah catat — hanya berhasil
// kalau belum ada sama sekali yang terpakai, lihat deleteBatch di
// produksi-warehouse.ts.
export async function deleteBatchAction(batchId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiView();
    await deleteBatch(batchId);
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
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
    // Unfiltered on purpose — this card may belong to either the
    // Pengiriman (current) or Riwayat (previous period) tab; both are
    // equally valid targets for Mulai Muat.
    const jadwalList = await getAllDraftJadwalForProduksi();
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
    // Unfiltered — same reasoning as produksiStartMuatAction above.
    const jadwalList = await getAllDraftJadwalForProduksi();
    const jadwal = jadwalList.find((j) => j.JadwalID === input.jadwalId);
    if (!jadwal) throw new AppError("Kartu Pengiriman ini sudah tidak tersedia untuk diisi.");
    if (totalQty10 < jadwal.Qty10KGDibutuhkan || input.qty5KGDimuat < jadwal.Qty5KGDibutuhkan) {
      throw new AppError("Jumlah yang dialokasikan belum mencukupi kebutuhan Kartu Pengiriman ini.");
    }
    await produksiSelesaiMuat({ ...input, dicatatOlehAkunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/delivery");
  });
}

// Quick "Selesai Muat" shortcut, triggered from the card's top-right button
// instead of going through the alokasi (Stok Es) screen — no pallet stock is
// touched. Same Draft-only/driver/route validation as produksiSelesaiMuat
// above, just without the allocation step first.
export async function produksiSelesaiMuatManualAction(jadwalId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiView();
    await produksiSelesaiMuatManual(jadwalId);
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/delivery");
  });
}

export async function getKartuPengirimanBelumSelesaiAction(
  tanggalUsahaISO: string,
  shift: ShiftNumber
): Promise<ActionResult<DraftJadwalForProduksi[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getKartuPengirimanBelumSelesaiUntukPeriode(new Date(tanggalUsahaISO), shift);
  });
}

export async function getKartuPengirimanSelesaiAction(
  tanggalUsahaISO: string,
  shift: ShiftNumber
): Promise<ActionResult<SelesaiMuatJadwalForProduksi[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getKartuPengirimanSelesaiUntukPeriode(new Date(tanggalUsahaISO), shift);
  });
}

export async function getKualitasRiwayatAction(): Promise<ActionResult<KualitasRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getKualitasRiwayat();
  });
}

export async function createKualitasAction(
  input: Omit<CreateKualitasInput, "dicatatOlehUserId">
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    if (!input.mesinId) throw new AppError("Pilih mesin yang dipakai.");
    if (!input.waktu) throw new AppError("Isi waktu pemeriksaan.");
    if (!input.qty10KG || input.qty10KG <= 0) throw new AppError("Isi QTY 10 KG Kantong Es.");
    const kualitasId = await createKualitas({ ...input, dicatatOlehUserId: session.user.id });
    revalidatePath("/mkesindo/produksi-app");
    return kualitasId;
  });
}

export async function getCurrentShiftRowsForProduksiAction(): Promise<
  ActionResult<{ current: CurrentShiftInfo; rows: StokBahanBakuRow[]; history: StokBahanBakuRow[] }>
> {
  return runAction(async () => {
    await requireProduksiView();
    const [{ current, rows }, history] = await Promise.all([getCurrentShiftRows(), getStokBahanBakuHistory()]);
    return { current, rows, history };
  });
}

export async function upsertProduksiStokAction(
  input: Omit<UpsertProduksiStokInput, "akunId">
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    if (input.stokDipakaiProduksi < 0 || input.stokRusakProduksi < 0) {
      throw new AppError("Jumlah tidak boleh negatif.");
    }
    await upsertProduksiStok({ ...input, akunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/laporan");
  });
}

export async function getStafOperasionalOptionsAction(): Promise<ActionResult<StafOperasionalOption[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getStafOperasionalOptions();
  });
}

export async function getAllTimAction(): Promise<ActionResult<TimRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getAllTim();
  });
}

export async function updateTimKepalaAction(timId: number, kepalaAkunId: number | null): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiAdmin();
    await updateTimKepala(timId, kepalaAkunId);
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
  });
}

export async function updateTimWakilKepalaAction(timId: number, wakilKepalaAkunId: number | null): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiAdmin();
    await updateTimWakilKepala(timId, wakilKepalaAkunId);
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
  });
}

export async function getProduksiAkunOptionsAction(): Promise<ActionResult<StafOperasionalOption[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getProduksiAkunOptions();
  });
}

export async function getAnggotaTimAction(timId: number): Promise<ActionResult<AnggotaTimRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getAnggotaTim(timId);
  });
}

export async function getSemuaAnggotaTimAction(): Promise<ActionResult<AnggotaTimRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getSemuaAnggotaTim();
  });
}

export async function updateAnggotaTimAction(anggotaId: number, input: { nama: string; timId: number }): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiView();
    if (!input.nama.trim()) throw new AppError("Nama anggota tidak boleh kosong.");
    await updateAnggotaTim(anggotaId, { nama: input.nama.trim(), timId: input.timId });
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
  });
}

export async function tambahAnggotaTimAction(timId: number, nama: string): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requireProduksiView();
    if (!nama.trim()) throw new AppError("Nama anggota tidak boleh kosong.");
    const id = await tambahAnggotaTim(timId, nama.trim());
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/produksi");
    return id;
  });
}

export async function hapusAnggotaTimAction(anggotaId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiView();
    await hapusAnggotaTim(anggotaId);
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/produksi");
  });
}

export async function catatMesinEventAction(mesinId: number, jenisEvent: JenisMesinEvent): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    await catatMesinEvent(mesinId, jenisEvent, Number(session.user.id));
    revalidatePath("/mkesindo/produksi-app");
  });
}

export async function getMesinEventsForShiftAction(tanggalUsaha: string, shift: ShiftNumber): Promise<ActionResult<MesinEventRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
    return getMesinEventsForShift(businessDate, shift);
  });
}

export async function getCurrentAktivitasProduksiAction(): Promise<
  ActionResult<{
    current: AktivitasShiftInfo;
    qty: QtyRecap;
    susunanTim: SusunanTimRow[];
    stafOperasionalNama: string | null;
    kepalaNama: string | null;
    wakilKepalaNama: string | null;
  }>
> {
  return runAction(async () => {
    await requireProduksiView();
    const { tanggalUsaha, shift } = getCurrentShift();
    const [current, qty, susunanTim] = await Promise.all([
      getAktivitasForShift(tanggalUsaha, shift),
      getQtyRecapForShift(tanggalUsaha, shift),
      getSusunanTim(tanggalUsaha, shift),
    ]);
    const akunIds = [current.stafOperasionalAkunId, current.kepalaAkunId, current.wakilKepalaAkunId].filter(
      (id): id is number => id != null
    );
    const namaMap = await getAkunNamaMap(akunIds);
    return {
      current,
      qty,
      susunanTim,
      stafOperasionalNama:
        current.stafOperasionalAkunId != null
          ? (namaMap.get(current.stafOperasionalAkunId) ?? null)
          : null,
      kepalaNama: current.kepalaAkunId != null ? (namaMap.get(current.kepalaAkunId) ?? null) : null,
      wakilKepalaNama: current.wakilKepalaAkunId != null ? (namaMap.get(current.wakilKepalaAkunId) ?? null) : null,
    };
  });
}

export async function getAktivitasRiwayatAction(): Promise<ActionResult<AktivitasShiftInfo[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getAktivitasRiwayat();
  });
}

// Used by the Riwayat list when a past row is opened: full detail for
// ONE specific past shift (its own qty recap + kehadiran + team roster),
// fetched on demand rather than eagerly for every row.
export async function getAktivitasDetailAction(
  tanggalUsaha: string,
  shift: ShiftNumber
): Promise<
  ActionResult<{
    current: AktivitasShiftInfo;
    qty: QtyRecap;
    susunanTim: SusunanTimRow[];
    stafOperasionalNama: string | null;
    kepalaNama: string | null;
    wakilKepalaNama: string | null;
  }>
> {
  return runAction(async () => {
    await requireProduksiView();
    const [current, qty, susunanTim] = await Promise.all([
      getAktivitasForShift(tanggalUsaha, shift),
      getQtyRecapForShift(tanggalUsaha, shift),
      getSusunanTim(tanggalUsaha, shift),
    ]);
    const akunIds = [current.stafOperasionalAkunId, current.kepalaAkunId, current.wakilKepalaAkunId].filter(
      (id): id is number => id != null
    );
    const namaMap = await getAkunNamaMap(akunIds);
    return {
      current,
      qty,
      susunanTim,
      stafOperasionalNama:
        current.stafOperasionalAkunId != null
          ? (namaMap.get(current.stafOperasionalAkunId) ?? null)
          : null,
      kepalaNama: current.kepalaAkunId != null ? (namaMap.get(current.kepalaAkunId) ?? null) : null,
      wakilKepalaNama: current.wakilKepalaAkunId != null ? (namaMap.get(current.wakilKepalaAkunId) ?? null) : null,
    };
  });
}

export async function upsertStafOperasionalAction(tanggalUsaha: string, shift: ShiftNumber, stafOperasionalAkunId: number | null): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    await upsertStafOperasional(tanggalUsaha, shift, stafOperasionalAkunId, Number(session.user.id));
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/laporan");
  });
}

export async function upsertKerusakanAction(tanggalUsaha: string, shift: ShiftNumber, input: KerusakanInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    if (input.pecahKemasanQty < 0 || input.esJatuhQty < 0 || input.gantiReturnQty < 0 || input.sealerJebolQty < 0) {
      throw new AppError("Jumlah tidak boleh negatif.");
    }
    await upsertKerusakan(tanggalUsaha, shift, input, Number(session.user.id));
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/laporan");
  });
}

export async function setSusunanTimAction(tanggalUsaha: string, shift: ShiftNumber, anggotaIds: number[]): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    await setSusunanTim(tanggalUsaha, shift, anggotaIds, Number(session.user.id));
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/laporan");
  });
}

export async function getJadwalBulanAction(tahun: number, bulan: number): Promise<ActionResult<JadwalTimRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getJadwalBulan(tahun, bulan);
  });
}

export async function setJadwalTimAction(tanggalUsaha: string, shift: ShiftNumber, timId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiAdmin();
    await setJadwalTim(tanggalUsaha, shift, timId, Number(session.user.id));
    revalidatePath("/mkesindo/produksi");
  });
}

export async function hapusJadwalTimAction(tanggalUsaha: string, shift: ShiftNumber): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiAdmin();
    await hapusJadwalTim(tanggalUsaha, shift);
    revalidatePath("/mkesindo/produksi");
  });
}

export async function setTimBertugasAction(tanggalUsaha: string, shift: ShiftNumber, timId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    await setTimBertugas(tanggalUsaha, shift, timId, Number(session.user.id));
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/laporan");
  });
}

export async function setKepalaHadirAction(tanggalUsaha: string, shift: ShiftNumber, hadir: boolean): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    await setKepalaHadir(tanggalUsaha, shift, hadir, Number(session.user.id));
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/laporan");
  });
}

export async function setWakilHadirAction(tanggalUsaha: string, shift: ShiftNumber, hadir: boolean): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    await setWakilHadir(tanggalUsaha, shift, hadir, Number(session.user.id));
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/laporan");
  });
}

export async function getTimSayaAction(): Promise<ActionResult<{ timId: number; nama: string; anggota: AnggotaTimRow[] } | null>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    const tim = await getTimByKepalaAkunId(Number(session.user.id));
    if (!tim) return null;
    const anggota = await getAnggotaTim(tim.timId);
    return { ...tim, anggota };
  });
}

export async function tambahAnggotaTimSayaAction(nama: string): Promise<ActionResult<number>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    if (!nama.trim()) throw new AppError("Nama anggota tidak boleh kosong.");
    const tim = await getTimByKepalaAkunId(Number(session.user.id));
    if (!tim) throw new AppError("Anda bukan Kepala Produksi tim manapun.");
    const id = await tambahAnggotaTim(tim.timId, nama.trim());
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/produksi");
    return id;
  });
}

export async function hapusAnggotaTimSayaAction(anggotaId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    const tim = await getTimByKepalaAkunId(Number(session.user.id));
    if (!tim) throw new AppError("Anda bukan Kepala Produksi tim manapun.");
    await hapusAnggotaTimIfOwned(anggotaId, tim.timId);
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/produksi");
  });
}

export async function getTakeAwayMuatanPendingAction(): Promise<ActionResult<TakeAwayMuatanPendingRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getTakeAwayMuatanPending();
  });
}

export async function getTakeAwayMuatanSelesaiAction(): Promise<ActionResult<TakeAwayMuatanSelesaiRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getTakeAwayMuatanSelesaiRecent();
  });
}

export async function takeAwayMulaiMuatAction(takeAwayMuatanId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiView();
    await takeAwayMulaiMuat(takeAwayMuatanId);
    revalidatePath("/mkesindo/produksi-app");
  });
}

// Menyelesaikan muat: membuat DeliveryOrder+SalesInvoice yang sebenarnya
// (ditunda dari saat order dibuat sampai di sini — lihat takeAwaySelesaiMuat
// di takeaway-muatan.ts), lalu mengantre SI untuk dicetak — persis seperti
// enqueuePrintJob yang dulu dipanggil langsung dari createTakeAwayPemesananAction.
export async function takeAwaySelesaiMuatAction(takeAwayMuatanId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    const result = await takeAwaySelesaiMuat(takeAwayMuatanId, Number(session.user.id));
    const pool = await getPool();
    await enqueuePrintJob(pool, result.salesInvoiceId, null, false);
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/pemesanan");
    revalidatePath("/mkesindo/delivery");
    revalidatePath("/mkesindo/laporan");
  });
}
