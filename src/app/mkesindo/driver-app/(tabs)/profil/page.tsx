import { requireDriver } from "@/lib/require-access";
import { getDriverProfiles } from "@/lib/queries/driver-profile";
import { DriverTabShell } from "@/components/driver-app/driver-tab-shell";

export default async function DriverProfilPage() {
  const session = await requireDriver();
  const salesmanId = session.user.salesmanId;
  const profile = salesmanId ? (await getDriverProfiles()).find((d) => d.SalesmanID === salesmanId) ?? null : null;

  return (
    <DriverTabShell
      initialTab="profil"
      driverName={session.user.name ?? session.user.username}
      initialProfil={profile}
    />
  );
}
