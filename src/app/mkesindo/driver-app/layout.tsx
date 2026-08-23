import { requireDriver } from "@/lib/require-access";
import { getActiveIstirahat } from "@/lib/queries/driver-istirahat";
import { IstirahatOverlay } from "@/components/driver-app/istirahat-overlay";

// Shared parent for (tabs)/layout.tsx and jadwal/[jadwalId]/page.tsx, which
// otherwise have no common ancestor — the istirahat lock overlay needs to
// apply app-wide regardless of which driver-app screen is open. Checked
// fresh on every server render (never cached) so the lock's truth always
// matches the DB row, surviving the app being force-closed and reopened.
export default async function DriverAppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireDriver();
  const activeIstirahat = session.user.salesmanId ? await getActiveIstirahat(session.user.salesmanId) : null;

  return (
    <>
      {children}
      <IstirahatOverlay initialIstirahat={activeIstirahat} />
    </>
  );
}
