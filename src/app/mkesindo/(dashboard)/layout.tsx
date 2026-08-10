import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getUserById } from "@/lib/queries/akun";
import { canAccessAllPT } from "@/lib/require-access";
import { MARKETING_ROLE_ID } from "@/lib/roles";
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

  // Since the /mkesindo route restructuring, this layout physically wraps
  // driver-app and satpam-app too (they live at src/app/mkesindo/driver-app
  // and src/app/mkesindo/satpam-app — Next.js's App Router nests every
  // descendant folder under its nearest layout.tsx, with no way to opt a
  // subfolder out while keeping the same URL prefix). Read the real request
  // path (forwarded by middleware.ts as a header, since Server Components
  // don't otherwise see it) so these redirects don't fire against their own
  // destination — without this guard, a Satpam/Driver account landing on
  // its own confined app self-redirected to itself forever
  // (ERR_TOO_MANY_REDIRECTS in production, confirmed 2026-08-09).
  const pathname = (await headers()).get("x-pathname") ?? "";

  // Satpam accounts are confined to the mobile inspection UI at
  // /mkesindo/satpam-app — this runs before any individual page's own
  // requireXXX() guard, so it catches every OTHER route in this group.
  // (Proxy also attempts this same redirect, but is not reliably invoked
  // for every route in this environment — this layout-level check is the
  // real guarantee, proxy is best-effort UX only.)
  if (session?.user?.isSatpam && !pathname.startsWith("/mkesindo/satpam-app")) {
    redirect("/mkesindo/satpam-app");
  }

  // Marketing accounts are confined to /mkesindo/pemasaran — Beranda's KPIs
  // aren't relevant to their day-to-day work. This check used to live in
  // (dashboard)/page.tsx (BerandaPage), AFTER requireModuleAccess("beranda")
  // — so a Marketing Peran without "beranda" module permission (the normal
  // setup for a role that only ever needs Pemasaran) got bounced to
  // /akses-ditolak before this redirect ever ran, the exact same class of
  // bug already fixed for Driver below. Confirmed root cause 2026-08-10 —
  // a real Marketing account reported landing on /akses-ditolak after
  // login. This layout-level check runs before any page's own permission
  // gate, so it can't be short-circuited by a missing module permission.
  if (!session?.user?.isSuperAdmin && session?.user?.roleId === MARKETING_ROLE_ID && !pathname.startsWith("/mkesindo/pemasaran")) {
    redirect("/mkesindo/pemasaran");
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
  if (!session?.user?.isSuperAdmin && session?.user?.isDriver && !pathname.startsWith("/mkesindo/driver-app")) {
    redirect("/mkesindo/driver-app");
  }

  // Same reasoning as Satpam/Driver above, but is_produksi accounts land on
  // /mkesindo/produksi-app (the mobile action app) on login, not
  // /mkesindo/produksi (the desktop view-only module, now a regular
  // permission-gated module like Pengiriman/Penjualan — see
  // docs/superpowers/specs/2026-08-11-modul-produksi-perluasan-design.md).
  // The prefix check below matches both "/mkesindo/produksi-app" and
  // "/mkesindo/produksi" itself (the latter starts with the same string),
  // so an is_produksi account that navigates to either one from here is
  // never bounced back — only landing anywhere else in the dashboard tree
  // triggers this redirect, straight to produksi-app.
  if (!session?.user?.isSuperAdmin && session?.user?.isProduksi && !pathname.startsWith("/mkesindo/produksi")) {
    redirect("/mkesindo/produksi-app");
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
