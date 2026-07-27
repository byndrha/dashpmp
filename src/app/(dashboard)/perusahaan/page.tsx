import { requireSuperAdmin } from "@/lib/require-access";
import { listPerusahaan } from "@/lib/queries/perusahaan";
import { PerusahaanList } from "@/components/dashboard/perusahaan-list";

export default async function PerusahaanPage() {
  await requireSuperAdmin();
  const rows = await listPerusahaan();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Perusahaan</h1>
      <p className="text-sm text-muted-foreground">
        Registry PT — hanya Super Administrator yang dapat melihat dan mengatur data ini. Menyimpan konfigurasi PT baru
        untuk pembangunan dashboard berikutnya, belum mengubah database yang sedang dipakai dashboard ini.
      </p>
      <PerusahaanList rows={rows} />
    </div>
  );
}
