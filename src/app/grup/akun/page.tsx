import Link from "next/link";
import { ShieldCheck, Monitor } from "lucide-react";
import { requireGrupAccess } from "@/lib/require-access";
import { listAkun, listPerusahaanDirektori, listAllPeran } from "@/lib/queries/akun";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";
import { getSiteSettings } from "@/lib/queries/site-settings";
import { getDocTemplate } from "@/lib/queries/doc-template";
import { getDriverProfiles } from "@/lib/queries/driver-profile";
import { AkunList } from "@/components/dashboard/akun-list";
import { PabrikLocationSettings } from "@/components/dashboard/pabrik-location-settings";
import { SiteSettingsPanel } from "@/components/dashboard/site-settings-panel";
import { DocTemplatePanel } from "@/components/dashboard/doc-template-panel";
import { Button } from "@/components/ui/button";

export default async function AkunPage() {
  await requireGrupAccess();
  const [akunList, perusahaanList, peranList, pabrikLocation, siteSettings, docTemplate, driverProfiles] = await Promise.all([
    listAkun(),
    listPerusahaanDirektori(),
    listAllPeran(),
    getPabrikLocation(),
    getSiteSettings(),
    getDocTemplate("DeliveryOrder"),
    getDriverProfiles(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Akun</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" render={<Link href="/grup/akun/sesi" />}>
            <Monitor className="size-4" />
            Sesi Login Aktif
          </Button>
          <Button variant="outline" render={<Link href="/grup/akun/peran" />}>
            <ShieldCheck className="size-4" />
            Peran &amp; Otoritas
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Kelola seluruh akun untuk setiap PT, termasuk akun Direktur PMP Group — hanya Super Administrator/Direktur
        yang dapat melihat dan mengatur halaman ini.
      </p>
      <AkunList akunList={akunList} perusahaanList={perusahaanList} peranList={peranList} driverProfiles={driverProfiles} />
      <PabrikLocationSettings initial={pabrikLocation} />
      <SiteSettingsPanel initial={siteSettings} />
      <DocTemplatePanel initial={docTemplate} />
    </div>
  );
}
