import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requirePmpersada, canAccessAllPT } from "@/lib/require-access";
import { listPerusahaanForSwitcher } from "@/lib/queries/perusahaan";
import { PmpersadaSidebar } from "@/components/dashboard/pmpersada-sidebar";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export default async function PmpersadaLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePmpersada();

  // is_produksi-only accounts (floor operators) land here on bare "/pmpersada"
  // via middleware.ts's accountScope redirect, but this generic dashboard
  // root is useless to them — it's the PT-wide placeholder shell, not their
  // job. Bounce them straight to /pmpersada/produksi-app, mirroring
  // src/app/mkesindo/(dashboard)/layout.tsx's isDriver/isSatpam/isProduksi
  // redirects. /pmpersada/produksi itself is exempt: an is_produksi account
  // is deliberately allowed to view that desktop module read-only (its own
  // page gates Override Tahap/Koreksi Batch behind canAccessAllPT), so this
  // must not redirect a request already headed there — same reasoning as
  // the MKEsindo layout's own produksi/produksi-app prefix check. Admin-level
  // accounts (canAccessAllPT) are exempt everywhere and see the desktop
  // shell normally.
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (session.user.isProduksi && !canAccessAllPT(session.user) && !pathname.startsWith("/pmpersada/produksi")) {
    redirect("/pmpersada/produksi-app");
  }

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
