import { redirect } from "next/navigation";
import { requirePmpakis, canAccessAllPT } from "@/lib/require-access";
import { bolehKelolaProduksi } from "@/lib/permissions";
import { listPerusahaanForSwitcher } from "@/lib/queries/perusahaan";
import { PmpakisSidebar } from "@/components/dashboard/pmpakis-sidebar";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
import { AppearanceMenu } from "@/components/dashboard/appearance-menu";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export default async function PmpakisLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePmpakis();

  // Akun operator produksi (is_produksi) dikurung di aplikasi HP
  // /pmpakis/produksi-app — rute itu di luar route group (dashboard) ini,
  // jadi redirect ini tidak pernah mengarah ke dirinya sendiri. Admin
  // produksi dan Direktur/superadmin tetap boleh membuka dashboard.
  if (session.user.isProduksi && !bolehKelolaProduksi(session.user) && !canAccessAllPT(session.user)) {
    redirect("/pmpakis/produksi-app");
  }

  const perusahaanList = await listPerusahaanForSwitcher();
  const canSwitchPt = canAccessAllPT(session.user);

  return (
    <SidebarProvider>
      <PmpakisSidebar canSwitchPt={canSwitchPt} perusahaanList={perusahaanList} />
      <SidebarInset>
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b bg-background px-4">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <span className="font-medium">PT Panen Mutiara Pakis</span>
          </div>
          <div className="flex items-center gap-3">
            <AppearanceMenu />
            <span className="text-sm text-muted-foreground">{session?.user?.name ?? session?.user?.username}</span>
            <SignOutButton />
          </div>
        </header>
        <main className="@container/dashboard-main flex flex-1 flex-col gap-4 p-4">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
