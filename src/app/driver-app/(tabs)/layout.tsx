import { requireDriver } from "@/lib/require-access";
import { DriverBottomNav } from "@/components/driver-app/bottom-nav";

export default async function DriverTabsLayout({ children }: { children: React.ReactNode }) {
  await requireDriver();
  return (
    <div className="flex min-h-dvh flex-col bg-background pb-16">
      <div className="flex-1">{children}</div>
      <DriverBottomNav />
    </div>
  );
}
