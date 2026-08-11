import { requirePmpersada, canAccessAllPT } from "@/lib/require-access";
import { listPerusahaanForSwitcher } from "@/lib/queries/perusahaan";
import { PmpersadaSidebar } from "@/components/dashboard/pmpersada-sidebar";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export default async function PmpersadaLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePmpersada();
  const perusahaanList = await listPerusahaanForSwitcher();
  const canSwitchPt = canAccessAllPT(session.user);

  return (
    <SidebarProvider>
      <PmpersadaSidebar canSwitchPt={canSwitchPt} perusahaanList={perusahaanList} />
      <SidebarInset>
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b bg-background px-4">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <span className="font-medium">PT Putra Maesa Persada</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{session?.user?.name ?? session?.user?.username}</span>
            <SignOutButton />
          </div>
        </header>
        <main className="@container/dashboard-main flex flex-1 flex-col gap-4 p-4">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
