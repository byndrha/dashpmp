// src/app/pmpersada/(dashboard)/mitra/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePmpersadaKeuangan } from "@/lib/require-access";
import { runAction, type ActionResult } from "@/lib/action-result";
import {
  getMitraList,
  getWilayahOptions,
  setMitraSuspended,
  deleteMitra,
  type MitraCard,
  type SumberAgen,
} from "@/lib/queries/mitra-es-balok";
import type { MitraFormKonteksEsBalok, MitraLengkapEsBalokInput } from "@/lib/queries/mitra-es-balok-lokasi";
import type { BisnisKompetitor, Kompetitor } from "@/lib/queries/kompetitor";
import {
  aksiJadikanLokasiUtamaEsBalok,
  aksiKonteksFormEsBalok,
  aksiMuatKartuEsBalok,
  aksiSimpanMitraEsBalok,
  aksiTambahKompetitorEsBalok,
  pathMitraTerdampak,
} from "@/lib/mitra-es-balok-aksi";

const KODE = "pmpersada";
const gerbang = requirePmpersadaKeuangan;

function segarkan(sumber: string) {
  for (const p of pathMitraTerdampak(KODE, sumber)) revalidatePath(p);
}

export async function getMitraListAction() {
  await gerbang();
  return getMitraList(KODE);
}

export async function getWilayahOptionsAction(sumber: SumberAgen) {
  await gerbang();
  return getWilayahOptions(KODE, sumber);
}

// Satu-satunya jalur simpan form Mitra (tambah & edit). agenDetailId = baris
// PMP_AgenDetail milik kartu yang diedit (Agen bisa punya >1); NIK dibuang
// di server bila sesi tanpa hak ubah.
export async function simpanMitraLengkapEsBalokAction(
  sumber: SumberAgen,
  agenId: string | null,
  input: MitraLengkapEsBalokInput,
  agenDetailId: string | null = null
): Promise<ActionResult<string>> {
  return runAction(async () => {
    const session = await gerbang();
    const id = await aksiSimpanMitraEsBalok(KODE, session.user, sumber, agenId, agenDetailId, input);
    segarkan(sumber);
    return id;
  });
}

export async function jadikanLokasiUtamaEsBalokAction(
  sumber: SumberAgen,
  agenId: string,
  agenDetailId: string | null,
  lokasiPengirimanId: number
): Promise<ActionResult<{ wilayahLama: string | null; wilayahBaru: string | null }>> {
  return runAction(async () => {
    const session = await gerbang();
    const hasil = await aksiJadikanLokasiUtamaEsBalok(KODE, session.user, sumber, agenId, agenDetailId, lokasiPengirimanId);
    segarkan(sumber);
    return hasil;
  });
}

export async function tambahKompetitorEsBalokAction(bisnis: BisnisKompetitor, nama: string): Promise<ActionResult<Kompetitor>> {
  return runAction(async () => {
    const session = await gerbang();
    return aksiTambahKompetitorEsBalok(session.user, bisnis, nama);
  });
}

export async function getMitraFormKonteksEsBalokAction(
  sumber: SumberAgen,
  agenId: string | null
): Promise<ActionResult<MitraFormKonteksEsBalok>> {
  return runAction(async () => {
    const session = await gerbang();
    return aksiKonteksFormEsBalok(KODE, session.user, sumber, agenId);
  });
}

export async function getMitraCardEsBalokAction(
  sumber: SumberAgen,
  agenId: string,
  agenDetailId: string | null
): Promise<ActionResult<MitraCard | null>> {
  return runAction(async () => {
    await gerbang();
    return aksiMuatKartuEsBalok(KODE, sumber, agenId, agenDetailId);
  });
}

export async function setMitraSuspendedAction(sumber: SumberAgen, agenId: string, isActive: boolean) {
  await gerbang();
  await setMitraSuspended(KODE, sumber, agenId, isActive);
  segarkan(sumber);
}

export async function deleteMitraAction(sumber: SumberAgen, agenId: string) {
  await gerbang();
  await deleteMitra(KODE, sumber, agenId);
  segarkan(sumber);
}
