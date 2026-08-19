import { requireGrupAccess } from "@/lib/require-access";
import { listPerusahaan } from "@/lib/queries/perusahaan";
import { listPerusahaanDirektori } from "@/lib/queries/akun";
import { listAllKoneksi } from "@/lib/queries/perusahaan-koneksi";
import { listAllGDriveKoneksi } from "@/lib/queries/perusahaan-gdrive";
import { PerusahaanList } from "@/components/dashboard/perusahaan-list";

export default async function PerusahaanPage() {
  await requireGrupAccess();
  const [rows, perusahaanDirektoriOptions, koneksi, gdriveKoneksi] = await Promise.all([
    listPerusahaan(),
    listPerusahaanDirektori(),
    listAllKoneksi(),
    listAllGDriveKoneksi(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Perusahaan</h1>
      <p className="text-sm text-muted-foreground">
        Registry PT — tautkan ke Perusahaan (Postgres) untuk mengatur koneksi database yang benar-benar dipakai
        dashboard.
      </p>
      <PerusahaanList
        rows={rows}
        perusahaanDirektoriOptions={perusahaanDirektoriOptions}
        koneksi={koneksi}
        gdriveKoneksi={gdriveKoneksi}
      />
    </div>
  );
}
