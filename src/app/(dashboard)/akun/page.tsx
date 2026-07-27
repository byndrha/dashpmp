import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requireSuperAdmin } from "@/lib/require-access";
import { listUsers, listRoles } from "@/lib/queries/akun";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";
import { getSiteSettings } from "@/lib/queries/site-settings";
import { AkunList } from "@/components/dashboard/akun-list";
import { PabrikLocationSettings } from "@/components/dashboard/pabrik-location-settings";
import { SiteSettingsPanel } from "@/components/dashboard/site-settings-panel";
import { Button } from "@/components/ui/button";

export default async function AkunPage() {
  await requireSuperAdmin();
  const [users, roles, pabrikLocation, siteSettings] = await Promise.all([
    listUsers(),
    listRoles(),
    getPabrikLocation(),
    getSiteSettings(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Akun</h1>
        <Button variant="outline" render={<Link href="/akun/peran" />}>
          <ShieldCheck className="size-4" />
          Peran &amp; Otoritas
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Hanya Super Administrator yang dapat melihat dan mengatur seluruh akun serta otoritasnya.
      </p>
      <AkunList users={users} roles={roles} />
      <PabrikLocationSettings initial={pabrikLocation} />
      <SiteSettingsPanel initial={siteSettings} />
    </div>
  );
}
