import type { Metadata } from "next";
import { requireModuleAccess, canAccessAllPT } from "@/lib/require-access";
import { getCurrentShiftRows, getStokBahanBakuHistory, getSaldoAwal } from "@/lib/queries/stok-bahan-baku";
import { getAktivitasRiwayat } from "@/lib/queries/aktivitas-produksi";
import { getAktivitasMuatanDistribusi } from "@/lib/queries/laporan-muatan-distribusi";
import { getSaldoAwalKasKecil, getKasKecilHistory, getCurrentShiftKasKecil } from "@/lib/queries/kas-kecil";
import { getRingkasanLintasShift } from "@/lib/queries/laporan-ringkasan-lintas-shift";
import { getAllTim } from "@/lib/queries/tim-produksi";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { getReportShift } from "@/lib/report-shift";
import { LaporanTabShell } from "@/components/dashboard/laporan-tab-shell";

export const metadata: Metadata = { title: "Laporan" };

export default async function LaporanPage() {
  const session = await requireModuleAccess("laporan");
  const canEdit = canAccessAllPT(session.user) || !!session.user.permissions.laporan?.canEdit;
  const canEditSaldoAwal = canAccessAllPT(session.user);

  const { businessDate } = getReportShift("work");
  const tahunAwal = businessDate.getUTCFullYear();
  const bulanAwal = businessDate.getUTCMonth() + 1;

  const [
    { current, rows },
    history,
    saldoAwal,
    aktivitasRiwayat,
    muatanDistribusiRowsAwal,
    kasKecilSaldoAwal,
    kasKecilHistory,
    kasKecilCurrentShift,
    ringkasanRowsAwal,
    timList,
  ] = await Promise.all([
    getCurrentShiftRows(),
    getStokBahanBakuHistory(),
    getSaldoAwal(),
    getAktivitasRiwayat(),
    getAktivitasMuatanDistribusi(tahunAwal, bulanAwal),
    getSaldoAwalKasKecil(),
    getKasKecilHistory(),
    getCurrentShiftKasKecil(),
    getRingkasanLintasShift(tahunAwal, bulanAwal),
    getAllTim(),
  ]);

  const akunIds = [
    ...[...rows, ...history].flatMap((r) => [r.operasionalAkunId, r.produksiAkunId]),
    ...aktivitasRiwayat.map((r) => r.stafOperasionalAkunId),
    ...kasKecilHistory.map((r) => r.diisiOlehAkunId),
    ...ringkasanRowsAwal.map((r) => r.produksiStafOperasionalAkunId),
  ].filter((id): id is number => id != null);
  const namaMap = await getAkunNamaMap(akunIds);
  const timNamaMap = Object.fromEntries(timList.map((t) => [t.timId, t.nama]));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Laporan</h1>
      <LaporanTabShell
        canEdit={canEdit}
        canEditSaldoAwal={canEditSaldoAwal}
        current={current}
        initialCurrentRows={rows}
        initialHistory={history}
        initialSaldoAwal={saldoAwal}
        namaMap={Object.fromEntries(namaMap)}
        aktivitasRiwayat={aktivitasRiwayat}
        muatanDistribusiTahunAwal={tahunAwal}
        muatanDistribusiBulanAwal={bulanAwal}
        muatanDistribusiRowsAwal={muatanDistribusiRowsAwal}
        kasKecilCurrent={kasKecilCurrentShift.current}
        kasKecilInitialRow={kasKecilCurrentShift.row}
        kasKecilInitialHistory={kasKecilHistory}
        kasKecilInitialSaldoAwal={kasKecilSaldoAwal}
        ringkasanTahunAwal={tahunAwal}
        ringkasanBulanAwal={bulanAwal}
        ringkasanRowsAwal={ringkasanRowsAwal}
        timNamaMap={timNamaMap}
      />
    </div>
  );
}
