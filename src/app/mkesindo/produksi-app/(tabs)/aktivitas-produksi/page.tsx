import type { Metadata } from "next";
import { requireProduksi } from "@/lib/require-access";
import { getUserById, getAkunNamaMap, getStafOperasionalOptions } from "@/lib/queries/akun";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getMesinEventsForShift } from "@/lib/queries/produksi-mesin-event";
import { getCurrentShift, getAktivitasForShift, getQtyRecapForShift, getSusunanTim, getAktivitasRiwayat } from "@/lib/queries/aktivitas-produksi";
import { getAllTim, getTimByKepalaAkunId, getAnggotaTim } from "@/lib/queries/tim-produksi";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export const metadata: Metadata = { title: "Aktivitas Produksi" };

export default async function ProduksiAppAktivitasProduksiPage() {
  const session = await requireProduksi();
  const { tanggalUsaha, shift } = getCurrentShift();
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);

  const [profile, current, qty, susunanTim, mesinList, mesinEvents, stafOperasionalOptions, timList, riwayat] = await Promise.all([
    getUserById(Number(session.user.id)),
    getAktivitasForShift(tanggalUsaha, shift),
    getQtyRecapForShift(tanggalUsaha, shift),
    getSusunanTim(tanggalUsaha, shift),
    getMesinList(),
    getMesinEventsForShift(businessDate, shift),
    getStafOperasionalOptions(),
    getAllTim(),
    getAktivitasRiwayat(),
  ]);
  const namaMap = await getAkunNamaMap(current.stafOperasionalAkunId != null ? [current.stafOperasionalAkunId] : []);
  const stafOperasionalNama = current.stafOperasionalAkunId != null ? (namaMap.get(current.stafOperasionalAkunId) ?? null) : null;

  const timSayaBase = await getTimByKepalaAkunId(Number(session.user.id));
  const timSaya = timSayaBase ? { ...timSayaBase, anggota: await getAnggotaTim(timSayaBase.timId) } : null;

  return (
    <ProduksiTabShell
      initialTab="aktivitas-produksi"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialAktivitasProduksi={{ current, qty, susunanTim, stafOperasionalNama, mesinList, mesinEvents, stafOperasionalOptions, timList, timSaya, riwayat }}
    />
  );
}
