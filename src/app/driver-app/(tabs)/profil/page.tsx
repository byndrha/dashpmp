import { requireDriver } from "@/lib/require-access";
import { getDriverProfiles } from "@/lib/queries/driver-profile";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { ProfilLogoutButton } from "@/components/driver-app/profil-logout-button";

export default async function DriverProfilPage() {
  const session = await requireDriver();
  const salesmanId = session.user.salesmanId;
  const profile = salesmanId ? (await getDriverProfiles()).find((d) => d.SalesmanID === salesmanId) ?? null : null;

  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="font-display text-lg font-semibold">Profil</h1>
      <Card>
        <CardContent className="flex flex-col gap-2 px-4 py-3 text-sm">
          <p className="font-medium">{profile?.Name ?? session.user.name}</p>
          {profile ? (
            <>
              <p className="text-xs text-muted-foreground">Bergabung sejak: {profile.BergabungSejak ? formatDate(profile.BergabungSejak) : "-"}</p>
              <p className="text-xs text-muted-foreground">SIM: {profile.SimTypes.length > 0 ? profile.SimTypes.join(", ") : "-"}</p>
            </>
          ) : (
            <p className="text-xs text-destructive">Akun ini belum ditautkan ke data Driver, hubungi Admin.</p>
          )}
        </CardContent>
      </Card>
      <ProfilLogoutButton />
    </div>
  );
}
