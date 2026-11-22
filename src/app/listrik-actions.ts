"use server";

import { revalidatePath } from "next/cache";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";
import { KODE_ES_BALOK, sesiListrik } from "@/lib/listrik-akses";
import { currentEskristalKode } from "@/lib/tenant-request";
import {
  getPengaturanListrik,
  batalkanBacaanMeter,
  catatBacaanMeter,
  getBacaanTerakhir,
  simpanPengaturanListrik,
  type InputPengaturanListrik,
} from "@/lib/queries/listrik";
import {
  LABEL_SLOT,
  type BacaanMeter,
  type PengaturanListrik,
  type SlotListrik,
} from "@/lib/listrik";

// Aksi modul Kelistrikan — dipakai bersama oleh Es Kristal (MKEsindo/tenant)
// dan tiga PT Es Balok, dibedakan `kode`.

function segarkan(kode: string) {
  if (KODE_ES_BALOK.includes(kode)) revalidatePath(`/${kode}/listrik`);
  else revalidatePath("/mkesindo/electricity");
}

const angkaOpsional = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new AppError("Angka tidak valid.");
  return n;
};

/** Konteks form Catat Meter. kode null = perusahaan Es Kristal sesi ini (aplikasi produksi Es Kristal). */
export async function getKonteksCatatMeterAction(
  kode: string | null
): Promise<ActionResult<{ kode: string; pengaturan: PengaturanListrik }>> {
  return runAction(async () => {
    const k = kode ?? (await currentEskristalKode());
    await sesiListrik(k, "catat");
    return { kode: k, pengaturan: await getPengaturanListrik(k) };
  });
}

export async function getBacaanTerakhirAction(
  kode: string
): Promise<ActionResult<BacaanMeter | null>> {
  return runAction(async () => {
    await sesiListrik(kode, "catat");
    return getBacaanTerakhir(kode);
  });
}

export async function catatBacaanMeterAction(
  kode: string,
  input: {
    kwhTotal: number | null;
    kwhLwbp: number | null;
    kwhWbp: number | null;
    kvarh: number | null;
    fotoPath: string | null;
    fotoLat: number | null;
    fotoLng: number | null;
    catatan: string | null;
  }
): Promise<ActionResult<{ slot: SlotListrik; label: string }>> {
  return runAction(async () => {
    const oleh = await sesiListrik(kode, "catat");
    if (!input.fotoPath) throw new AppError("Foto meter wajib diambil.");
    const hasil = await catatBacaanMeter(
      kode,
      {
        kwhTotal: angkaOpsional(input.kwhTotal),
        kwhLwbp: angkaOpsional(input.kwhLwbp),
        kwhWbp: angkaOpsional(input.kwhWbp),
        kvarh: angkaOpsional(input.kvarh),
        fotoPath: input.fotoPath,
        fotoLat: input.fotoLat,
        fotoLng: input.fotoLng,
        catatan: input.catatan?.trim() || null,
        sumber: "manual",
      },
      oleh
    );
    segarkan(kode);
    return { slot: hasil.slot, label: LABEL_SLOT[hasil.slot] };
  });
}

export async function batalkanBacaanMeterAction(
  kode: string,
  id: string,
  alasan: string
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const oleh = await sesiListrik(kode, "kelola");
    if (!alasan.trim()) throw new AppError("Alasan pembatalan wajib diisi.");
    await batalkanBacaanMeter(kode, id, alasan.trim(), oleh.nama);
    segarkan(kode);
    return null;
  });
}

export async function simpanPengaturanListrikAction(
  kode: string,
  p: InputPengaturanListrik
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const oleh = await sesiListrik(kode, "kelola");
    const jamMulai = Number(p.jamWbpMulai);
    const jamSelesai = Number(p.jamWbpSelesai);
    if (
      !Number.isInteger(jamMulai) ||
      !Number.isInteger(jamSelesai) ||
      jamMulai < 0 ||
      jamSelesai > 23 ||
      jamMulai >= jamSelesai
    ) {
      throw new AppError(
        "Jam WBP tidak valid (jam mulai harus lebih awal dari jam selesai)."
      );
    }
    const faktorK = angkaOpsional(p.faktorK);
    if (faktorK != null && (faktorK < 1 || faktorK > 3))
      throw new AppError("Faktor K biasanya antara 1,4 dan 2.");
    const positif = (v: unknown, nama: string) => {
      const n = angkaOpsional(v);
      if (n === 0) throw new AppError(`${nama} harus lebih dari 0.`);
      return n;
    };
    await simpanPengaturanListrik(
      kode,
      {
        golongan: p.golongan?.trim() || null,
        dayaKva: positif(p.dayaKva, "Daya kontrak"),
        faktorKali: positif(p.faktorKali, "Faktor kali"),
        hargaLwbp: positif(p.hargaLwbp, "Harga LWBP"),
        faktorK,
        jamWbpMulai: jamMulai,
        jamWbpSelesai: jamSelesai,
        registerTerpisah: Boolean(p.registerTerpisah),
      },
      oleh
    );
    segarkan(kode);
    return null;
  });
}
