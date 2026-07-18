import { auth } from "@/lib/auth";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { UserMenu } from "@/components/dashboard/user-menu";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <span className="font-medium">Dashboard PMP Group</span>
          </div>
          <UserMenu name={session?.user?.name ?? session?.user?.username ?? "User"} />
        </header>
        {/* Named so children can opt into container queries (`@lg:`, `@5xl:`,
            etc.) keyed to the actual content width — which shrinks/grows
            with the sidebar's collapsed/expanded state — instead of the
            raw viewport width. A grid that looks fine at 2 columns on a
            tablet with the sidebar collapsed can be too cramped at the same
            viewport width with the sidebar expanded; container queries see
            that difference, `sm:`/`lg:` viewport breakpoints don't. */}
        <main className="@container/dashboard-main flex flex-1 flex-col gap-4 p-4">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
