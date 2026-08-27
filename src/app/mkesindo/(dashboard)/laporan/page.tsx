import type { Metadata } from "next";
import { requireModuleAccess, canAccessAllPT } from "@/lib/require-access";
import { getCurrentShiftRows, getStokBahanBakuHistory, getSaldoAwal } from "@/lib/queries/stok-bahan-baku";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { LaporanStokBahanBaku } from "@/components/dashboard/laporan-stok-bahan-baku";

export const metadata: Metadata = { title: "Laporan" };

export default async function LaporanPage() {
  const session = await requireModuleAccess("laporan");
  const canEdit = canAccessAllPT(session.user) || !!session.user.permissions.laporan?.canEdit;
  const canEditSaldoAwal = canAccessAllPT(session.user);

  const [{ current, rows }, history, saldoAwal] = await Promise.all([
    getCurrentShiftRows(),
    getStokBahanBakuHistory(),
    getSaldoAwal(),
  ]);

  const akunIds = [...rows, ...history].flatMap((r) => [r.operasionalAkunId, r.produksiAkunId]).filter((id): id is number => id != null);
  const namaMap = await getAkunNamaMap(akunIds);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Laporan</h1>
      <LaporanStokBahanBaku
        canEdit={canEdit}
        canEditSaldoAwal={canEditSaldoAwal}
        current={current}
        initialCurrentRows={rows}
        initialHistory={history}
        initialSaldoAwal={saldoAwal}
        namaMap={Object.fromEntries(namaMap)}
      />
    </div>
  );
}
