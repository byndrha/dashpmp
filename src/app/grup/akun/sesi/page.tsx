import { requireGrupAccess } from "@/lib/require-access";
import { listActiveSesi } from "@/lib/queries/akun";
import { AkunSesiList } from "@/components/dashboard/akun-sesi-list";

export default async function AkunSesiPage() {
  await requireGrupAccess();
  const sesiList = await listActiveSesi();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Sesi Login Aktif</h1>
        <p className="text-sm text-muted-foreground">
          Daftar seluruh sesi login yang sedang aktif di seluruh sistem — hanya Super Administrator/Direktur yang
          dapat melihat dan mengatur halaman ini.
        </p>
      </div>
      <AkunSesiList sesiList={sesiList} />
    </div>
  );
}
