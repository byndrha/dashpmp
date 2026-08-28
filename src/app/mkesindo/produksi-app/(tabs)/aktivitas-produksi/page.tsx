import type { Metadata } from "next";
import { requireProduksi } from "@/lib/require-access";
import { getUserById, getAkunNamaMap, getStafOperasionalOptions } from "@/lib/queries/akun";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getMesinEventsForShift } from "@/lib/queries/produksi-mesin-event";
import { getCurrentShift, getAktivitasForShift, getQtyRecapForShift, getSusunanTim, getAktivitasRiwayat } from "@/lib/queries/aktivitas-produksi";
import { getAnggotaTim } from "@/lib/queries/tim-produksi";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export const metadata: Metadata = { title: "Aktivitas Produksi" };

export default async function ProduksiAppAktivitasProduksiPage() {
  const session = await requireProduksi();
  const { tanggalUsaha, shift } = getCurrentShift();
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);

  const [
  profile,
  current,
  qty,
  susunanTim,
  timAnggota,
  mesinList,
  mesinEvents,
  stafOperasionalOptions,
  riwayat,
] = await Promise.all([
    getUserById(Number(session.user.id)),
    getAktivitasForShift(tanggalUsaha, shift),
    getQtyRecapForShift(tanggalUsaha, shift),
    getSusunanTim(tanggalUsaha, shift),
    getAnggotaTim(shift),
    getMesinList(),
    getMesinEventsForShift(businessDate, shift),
    getStafOperasionalOptions(),
    getAktivitasRiwayat(),
  ]);
  const namaMap = await getAkunNamaMap(current.stafOperasionalAkunId != null ? [current.stafOperasionalAkunId] : []);
  const stafOperasionalNama = current.stafOperasionalAkunId != null ? (namaMap.get(current.stafOperasionalAkunId) ?? null) : null;

  return (
    <ProduksiTabShell
      initialTab="aktivitas-produksi"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialAktivitasProduksi={{
        current,
        qty,
        susunanTim,
        timAnggota,
        stafOperasionalNama,
        mesinList,
        mesinEvents,
        stafOperasionalOptions,
        riwayat,
      }}
    />
  );
}
