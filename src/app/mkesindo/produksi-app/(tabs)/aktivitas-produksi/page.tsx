import type { Metadata } from "next";
import { requireProduksi } from "@/lib/require-access";
import { getUserById } from "@/lib/queries/akun";
import { getStafOperasionalOptions } from "@/lib/queries/akun";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getAnggotaTim } from "@/lib/queries/tim-produksi";
import { getMesinEventsForShift } from "@/lib/queries/produksi-mesin-event";
import { getCurrentShift, getAktivitasForShift, getQtyRecapForShift, getKehadiran, getAktivitasRiwayat } from "@/lib/queries/aktivitas-produksi";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export const metadata: Metadata = { title: "Aktivitas Produksi" };

export default async function ProduksiAppAktivitasProduksiPage() {
  const session = await requireProduksi();
  const { tanggalUsaha, shift } = getCurrentShift();
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);

  const [profile, current, qty, kehadiran, timAnggota, mesinList, mesinEvents, stafOperasionalOptions, riwayat] = await Promise.all([
    getUserById(Number(session.user.id)),
    getAktivitasForShift(tanggalUsaha, shift),
    getQtyRecapForShift(tanggalUsaha, shift),
    getKehadiran(tanggalUsaha, shift),
    getAnggotaTim(shift),
    getMesinList(),
    getMesinEventsForShift(businessDate, shift),
    getStafOperasionalOptions(),
    getAktivitasRiwayat(),
  ]);

  return (
    <ProduksiTabShell
      initialTab="aktivitas-produksi"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialAktivitasProduksi={{ current, qty, kehadiran, timAnggota, mesinList, mesinEvents, stafOperasionalOptions, riwayat }}
    />
  );
}
