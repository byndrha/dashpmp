import { auth } from "@/lib/auth";
import { requireGrupAccess } from "@/lib/require-access";
import { GrupSidebar } from "@/components/dashboard/grup-sidebar";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

// PMP Group (holding) shell — Ringkasan + Administrasi (Akun/Perusahaan/
// Akun Direktori), deliberately separate from PT Mitra Kelola Esindo's own
// AppSidebar. See requireGrupAccess for who can reach this (a real
// Direktur account, or today's MSSQL superadmin bridging in).
export default async function GrupLayout({ children }: { children: React.ReactNode }) {
  await requireGrupAccess();
  const session = await auth();

  return (
    <SidebarProvider>
      <GrupSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b bg-background px-4">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <span className="font-medium">PMP Group</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{session?.user?.name ?? session?.user?.username}</span>
            <SignOutButton />
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
