import type { Metadata } from "next";
import { requireModuleAccess, canAccessAllPT } from "@/lib/require-access";
import { getCurrentShiftRows, getStokBahanBakuHistory, getSaldoAwal } from "@/lib/queries/stok-bahan-baku";
import { getAktivitasRiwayat } from "@/lib/queries/aktivitas-produksi";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { LaporanTabShell } from "@/components/dashboard/laporan-tab-shell";

export const metadata: Metadata = { title: "Laporan" };

export default async function LaporanPage() {
  const session = await requireModuleAccess("laporan");
  const canEdit = canAccessAllPT(session.user) || !!session.user.permissions.laporan?.canEdit;
  const canEditSaldoAwal = canAccessAllPT(session.user);

  const [{ current, rows }, history, saldoAwal, aktivitasRiwayat] = await Promise.all([
    getCurrentShiftRows(),
    getStokBahanBakuHistory(),
    getSaldoAwal(),
    getAktivitasRiwayat(),
  ]);

  const akunIds = [
    ...[...rows, ...history].flatMap((r) => [r.operasionalAkunId, r.produksiAkunId]),
    ...aktivitasRiwayat.map((r) => r.stafOperasionalAkunId),
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
      />
    </div>
  );
}
