import { requireSatpam } from "@/lib/require-access";

// Shared auth gate for every tab under (tabs)/ -- each page.tsx below also
// calls requireSatpam() itself (needed for session.user.id/name regardless),
// this is defense-in-depth, same pattern as driver-app's (tabs)/layout.tsx.
export default async function SatpamTabsLayout({ children }: { children: React.ReactNode }) {
  await requireSatpam();
  return children;
}
