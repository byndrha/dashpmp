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
  // the Postgres akun table — an akunId can show up here without being in
  // marketingAkunList for two different reasons, which must be labeled
  // differently: (a) the akun still exists but its peran changed away from
  // Marketing (e.g. promoted, or a Manager who personally submitted/was
  // credited for a Pengajuan) — show their real nama, historical credit
  // isn't fictional just because their current role changed; (b) the akun
  // was hard-deleted entirely — genuinely nothing to look up, show the
  // placeholder. A plain Marketing viewer only ever sees their own
  // (necessarily still-existing, still-Marketing) row, so this only
  // applies to non-plain-Marketing viewers.
  if (!isPlainMarketing) {
    const marketingAkunIds = new Set(marketingAkunList.map((a) => String(a.id)));
    const allAkunById = new Map(allAkun.map((a) => [String(a.id), a]));
    for (const [akunId, histori] of historiByAkunId) {
      if (marketingAkunIds.has(akunId)) continue;
      const akun = allAkunById.get(akunId);
      karyawanList.push({ akunId, nama: akun ? akun.nama : "Akun tidak ditemukan", histori });
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
