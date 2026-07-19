import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSuperAdmin } from "@/lib/require-access";
import { listRoles, getRolePermissions } from "@/lib/queries/akun";
import { PeranEditor } from "@/components/dashboard/peran-editor";
import { Button } from "@/components/ui/button";

export default async function PeranPage() {
  await requireSuperAdmin();
  const [roles, permissions] = await Promise.all([listRoles(), getRolePermissions()]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" render={<Link href="/akun" />}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-display text-xl font-semibold">Peran &amp; Otoritas</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Atur peran dan modul apa saja yang bisa dilihat/diubah oleh setiap peran. Super
        Administrator selalu memiliki akses penuh dan tidak bisa diubah.
      </p>
      <PeranEditor roles={roles} permissions={permissions} />
    </div>
  );
}
