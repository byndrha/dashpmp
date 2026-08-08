import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserById } from "@/lib/queries/akun";
import { canAccessAllPT } from "@/lib/require-access";
import { listPerusahaanForSwitcher } from "@/lib/queries/perusahaan";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { NotificationBell } from "@/components/dashboard/notification-bell";
import { UserMenu } from "@/components/dashboard/user-menu";
import { AppearanceMenu } from "@/components/dashboard/appearance-menu";
import { PullToRefresh } from "@/components/dashboard/pull-to-refresh";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  // Satpam accounts are confined to the mobile inspection UI at
  // /satpam-app — this runs before any individual page's own
  // requireXXX() guard, so it catches every route in this group (not
  // just "/"), the same way the Marketing→/pemasaran redirect in
  // (dashboard)/page.tsx already proves reliable for this exact pattern.
  // (Proxy also attempts this same redirect, but is not reliably invoked
  // for every route in this environment — this layout-level check is the
  // real guarantee, proxy is best-effort UX only.)
  if (session?.user?.isSatpam) {
    redirect("/satpam-app");
  }

  // Same reasoning as Satpam above, and NOT redundant with the isDriver
  // check that used to live in (dashboard)/page.tsx (BerandaPage) — that
  // page-level check ran AFTER requireModuleAccess("beranda"), so a Driver
  // Peran with no "beranda" module permission granted (the normal,
  // expected setup for a role that only ever uses the driver-app) got
  // bounced to /akses-ditolak before the isDriver redirect ever executed.
  // Confirmed live: a real test account (is_driver=true, salesman_id set,
  // beranda permission withheld) hit exactly this dead end. This
  // layout-level check runs before any page's own permission gate, so it
  // can't be short-circuited by a missing module permission.
  if (!session?.user?.isSuperAdmin && session?.user?.isDriver) {
    redirect("/driver-app");
  }

  // A native pmputra account with no cross-PT authority is confined to its
  // own route tree, mirroring requirePmputra()'s equivalent check. Redirects
  // to its own home rather than /akses-ditolak, consistent with the Satpam/
  // Driver redirects just above. Accounts with cross-PT authority (superadmin,
  // or "direktur" scope — Perusahaan "PMP Group", which sits above every PT)
  // are NOT redirected away: they're allowed to view this dashboard directly.
  const groupLevelAccess = session?.user ? canAccessAllPT(session.user) : false;
  if (!groupLevelAccess && session?.user?.accountScope === "pmputra") {
    redirect("/pmputra");
  }

  const [profile, perusahaanList] = await Promise.all([
    session?.user?.id ? getUserById(Number(session.user.id)) : Promise.resolve(null),
    listPerusahaanForSwitcher(),
  ]);

  return (
    <SidebarProvider>
      <AppSidebar
        permissions={session?.user?.permissions ?? {}}
        isSuperAdmin={session?.user?.isSuperAdmin ?? false}
        canSwitchPt={groupLevelAccess}
        perusahaanList={perusahaanList}
      />
      <SidebarInset>
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b bg-background px-4">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <span className="font-medium">Dashboard PMP Group</span>
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <AppearanceMenu />
            <UserMenu name={session?.user?.name ?? session?.user?.username ?? "User"} profile={profile} />
          </div>
        </header>
        {/* Named so children can opt into container queries (`@lg:`, `@5xl:`,
            etc.) keyed to the actual content width — which shrinks/grows
            with the sidebar's collapsed/expanded state — instead of the
            raw viewport width. A grid that looks fine at 2 columns on a
            tablet with the sidebar collapsed can be too cramped at the same
            viewport width with the sidebar expanded; container queries see
            that difference, `sm:`/`lg:` viewport breakpoints don't. */}
        <main className="@container/dashboard-main flex flex-1 flex-col gap-4 p-4">
          <AutoRefresh />
          <PullToRefresh>{children}</PullToRefresh>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
