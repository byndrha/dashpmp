import type { Metadata } from "next";
import { requireProduksi } from "@/lib/require-access";
import { getReportShift } from "@/lib/report-shift";
import {
  getKartuPengirimanBelumSelesaiUntukPeriode,
  getKartuPengirimanSelesaiUntukPeriode,
} from "@/lib/queries/produksi-muatan";
import { RiwayatKartuPengirimanView } from "@/components/produksi-app/riwayat-kartu-pengiriman-view";

export const metadata: Metadata = { title: "Riwayat Kartu Pengiriman" };

export default async function ProduksiAppRiwayatPage() {
  await requireProduksi();
  const { shift, businessDate } = getReportShift("work");
  const [belumSelesai, selesai] = await Promise.all([
    getKartuPengirimanBelumSelesaiUntukPeriode(businessDate, shift),
    getKartuPengirimanSelesaiUntukPeriode(businessDate, shift),
  ]);

  return (
    <RiwayatKartuPengirimanView
      initialTanggalUsahaISO={businessDate.toISOString().slice(0, 10)}
      initialShift={shift}
      initialBelumSelesai={belumSelesai}
      initialSelesai={selesai}
    />
  );
}
