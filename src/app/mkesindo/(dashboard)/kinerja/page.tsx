import type { Metadata } from "next";
import { requireModuleAccess } from "@/lib/require-access";
import { getJabatanByPeranId, getAspekKinerjaList } from "@/lib/queries/kinerja-jabatan";
import { getCalculator } from "@/lib/kinerja/registry";
import { listAkun } from "@/lib/queries/akun";
import { MARKETING_ROLE_ID } from "@/lib/roles";
import { KinerjaPenjualanTable } from "@/components/dashboard/kinerja-penjualan-table";

export const metadata: Metadata = { title: "Kinerja" };

export default async function KinerjaPage() {
  const session = await requireModuleAccess("kinerja");

  const jabatan = await getJabatanByPeranId(MARKETING_ROLE_ID);
  if (!jabatan) {
    return <p className="text-sm text-muted-foreground">Jabatan Marketing and Collection belum dikonfigurasi.</p>;
  }
  const aspekList = await getAspekKinerjaList(jabatan.id);
  const aspekPenjualan = aspekList.find((a) => a.kode === "penjualan");
  if (!aspekPenjualan) {
    return <p className="text-sm text-muted-foreground">Aspek Penjualan belum dikonfigurasi untuk jabatan ini.</p>;
  }

  const calculator = getCalculator(jabatan.kode, aspekPenjualan.kode);
  if (!calculator) {
    return <p className="text-sm text-muted-foreground">Business rule untuk aspek ini belum tersedia.</p>;
  }

  const [historiByAkunId, allAkun] = await Promise.all([calculator.hitungHistoriSemuaKaryawan(), listAkun()]);

  const isPlainMarketing = !session.user.isSuperAdmin && session.user.roleId === MARKETING_ROLE_ID;
  // listAkun() does not filter by is_active — a deactivated Marketing
  // employee's historical row still appears here, per the spec's edge
  // case 2 (kredit NOO tetap melekat walau akun dinonaktifkan).
  const marketingAkunList = allAkun.filter((a) => a.peranId === MARKETING_ROLE_ID);
  const visibleAkunList = isPlainMarketing
    ? marketingAkunList.filter((a) => String(a.id) === session.user.id)
    : marketingAkunList;

  const karyawanList = visibleAkunList.map((akun) => ({
    akunId: String(akun.id),
    nama: akun.nama,
    histori: historiByAkunId.get(String(akun.id)) ?? { akunId: String(akun.id), bulanList: [] },
  }));

  // historiByAkunId is sourced independently from MSSQL and never references
  // the Postgres akun table — if an akun is later hard-deleted but still has
  // computed history, that history must not silently disappear. A plain
  // Marketing viewer only ever sees their own (necessarily still-existing)
  // row, so this only applies to non-plain-Marketing viewers.
  if (!isPlainMarketing) {
    const knownAkunIds = new Set(marketingAkunList.map((a) => String(a.id)));
    for (const [akunId, histori] of historiByAkunId) {
      if (!knownAkunIds.has(akunId)) {
        karyawanList.push({ akunId, nama: "Akun tidak ditemukan", histori });
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Kinerja Karyawan</h1>
      <p className="text-sm text-muted-foreground">
        {jabatan.nama} — Aspek {aspekPenjualan.nama}, dihitung dari jumlah {aspekPenjualan.satuan}.
      </p>
      <KinerjaPenjualanTable
        jabatanNama={jabatan.nama}
        aspekNama={aspekPenjualan.nama}
        satuan={aspekPenjualan.satuan}
        karyawanList={karyawanList}
      />
    </div>
  );
}
