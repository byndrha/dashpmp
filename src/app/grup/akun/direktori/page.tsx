import { requireGrupAccess } from "@/lib/require-access";
import { listAkunDirektori, listPerusahaanDirektori } from "@/lib/queries/akun-direktori";
import { AkunDirektoriList } from "@/components/dashboard/akun-direktori-list";

export default async function AkunDirektoriPage() {
  await requireGrupAccess();
  const [akunList, perusahaanList] = await Promise.all([listAkunDirektori(), listPerusahaanDirektori()]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Akun Direktori</h1>
        <p className="text-sm text-muted-foreground">
          Akun Direktur (ringkasan PMP Group) dan Finance PT Prima Maesa Putra — terpisah dari akun MKEsindo di
          halaman Akun.
        </p>
      </div>
      <AkunDirektoriList akunList={akunList} perusahaanList={perusahaanList} />
    </div>
  );
}
