import { auth } from "@/lib/auth";
import { requireGrupShellAccess, canAccessAllPT } from "@/lib/require-access";
import { listPerusahaanForSwitcher } from "@/lib/queries/perusahaan";
import { GrupSidebar } from "@/components/dashboard/grup-sidebar";
import { KakiSidebar, TombolHalaman } from "@/components/dashboard/sidebar-kaki";
import { KELAS_HALAMAN } from "@/lib/kelas-halaman";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

// PMP Group (holding) shell — Ringkasan + Administrasi (Akun/Perusahaan/
// Akun Direktori) + Inventaris, deliberately separate from PT Mitra Kelola
// Esindo's own AppSidebar. Gated by requireGrupShellAccess() (a real
// Direktur/superadmin, OR a canAksesInventaris account reaching for
// /grup/inventaris) — NOT requireGrupAccess(), which is stricter and stays
// enforced independently by the Akun/Perusahaan pages and Server Actions
// themselves. See requireGrupShellAccess's own comment in require-access.ts.
export default async function GrupLayout({ children }: { children: React.ReactNode }) {
  await requireGrupShellAccess();
  const [session, perusahaanList] = await Promise.all([auth(), listPerusahaanForSwitcher()]);
  const canSwitchPt = session?.user ? canAccessAllPT(session.user) : false;
  // Nav-visibility check only (mirrors requireInventarisAccess's own
  // condition) — the route itself is still gated server-side by that
  // function on the /grup/inventaris page, this just decides whether the
  // link is worth showing.
  const canAccessInventaris = session?.user ? canSwitchPt || !!session.user.canAksesInventaris : false;

  return (
    <SidebarProvider>
      <GrupSidebar
        canSwitchPt={canSwitchPt}
        canAccessInventaris={canAccessInventaris}
        perusahaanList={perusahaanList}
        kaki={<KakiSidebar nama={session?.user?.name ?? session?.user?.username ?? "User"} />}
      />
      <SidebarInset>
        <main data-slot="halaman" className={`${KELAS_HALAMAN} flex flex-1 flex-col gap-4 p-4`}>
          <TombolHalaman />
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
