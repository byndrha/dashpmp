import type { Metadata } from "next";
import { requireModuleAccess, canAccessAllPT } from "@/lib/require-access";
import { getCurrentShiftRows, getStokBahanBakuHistory, getSaldoAwal } from "@/lib/queries/stok-bahan-baku";
import { getAktivitasRiwayat } from "@/lib/queries/aktivitas-produksi";
import { getAktivitasMuatanDistribusi } from "@/lib/queries/laporan-muatan-distribusi";
import { getSaldoAwalKasKecil, getKasKecilHistory, getCurrentShiftKasKecil } from "@/lib/queries/kas-kecil";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { getReportShift } from "@/lib/report-shift";
import { LaporanTabShell } from "@/components/dashboard/laporan-tab-shell";

export const metadata: Metadata = { title: "Laporan" };

export default async function LaporanPage() {
  const session = await requireModuleAccess("laporan");
  const canEdit = canAccessAllPT(session.user) || !!session.user.permissions.laporan?.canEdit;
  const canEditSaldoAwal = canAccessAllPT(session.user);

  const { businessDate } = getReportShift("work");
  const muatanDistribusiTahunAwal = businessDate.getUTCFullYear();
  const muatanDistribusiBulanAwal = businessDate.getUTCMonth() + 1;

  const [
    { current, rows },
    history,
    saldoAwal,
    aktivitasRiwayat,
    muatanDistribusiRowsAwal,
    kasKecilSaldoAwal,
    kasKecilHistory,
    kasKecilCurrentShift,
  ] = await Promise.all([
    getCurrentShiftRows(),
    getStokBahanBakuHistory(),
    getSaldoAwal(),
    getAktivitasRiwayat(),
    getAktivitasMuatanDistribusi(muatanDistribusiTahunAwal, muatanDistribusiBulanAwal),
    getSaldoAwalKasKecil(),
    getKasKecilHistory(),
    getCurrentShiftKasKecil(),
  ]);

  const akunIds = [
    ...[...rows, ...history].flatMap((r) => [r.operasionalAkunId, r.produksiAkunId]),
    ...aktivitasRiwayat.map((r) => r.stafOperasionalAkunId),
    ...kasKecilHistory.map((r) => r.diisiOlehAkunId),
  ].filter((id): id is number => id != null);
  const namaMap = await getAkunNamaMap(akunIds);

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
        muatanDistribusiTahunAwal={muatanDistribusiTahunAwal}
        muatanDistribusiBulanAwal={muatanDistribusiBulanAwal}
        muatanDistribusiRowsAwal={muatanDistribusiRowsAwal}
        kasKecilCurrent={kasKecilCurrentShift.current}
        kasKecilInitialRow={kasKecilCurrentShift.row}
        kasKecilInitialHistory={kasKecilHistory}
        kasKecilInitialSaldoAwal={kasKecilSaldoAwal}
      />
    </div>
  );
}
