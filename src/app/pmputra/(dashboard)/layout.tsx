import { redirect } from "next/navigation";
import { requirePmputra, canAccessAllPT } from "@/lib/require-access";
import { bolehKelolaProduksi } from "@/lib/permissions";
import { listPerusahaanForSwitcher } from "@/lib/queries/perusahaan";
import { PmputraSidebar } from "@/components/dashboard/pmputra-sidebar";
import { KakiSidebar, TombolHalaman } from "@/components/dashboard/sidebar-kaki";
import { KELAS_HALAMAN } from "@/lib/kelas-halaman";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

// Reuses the same Sidebar shell shape as the MKEsindo (Es Kristal) dashboard
// — per the user's explicit choice — but with its own nav (module
// placeholders, no live data yet). PTSwitcher only renders for an account
// with cross-PT authority (superadmin, or "direktur" scope) visiting this
// PT — a native pmputra-scoped account only ever sees this one company, so
// it never shows for them.
export default async function PmputraLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePmputra();

  // Akun operator produksi (is_produksi) dikurung di aplikasi HP
  // /pmputra/produksi-app — rute itu di luar route group (dashboard) ini,
  // jadi redirect ini tidak pernah mengarah ke dirinya sendiri. Admin
  // produksi dan Direktur/superadmin tetap boleh membuka dashboard.
  if (session.user.isProduksi && !bolehKelolaProduksi(session.user) && !canAccessAllPT(session.user)) {
    redirect("/pmputra/produksi-app");
  }

  const perusahaanList = await listPerusahaanForSwitcher();
  const canSwitchPt = canAccessAllPT(session.user);

  return (
    <SidebarProvider>
      <PmputraSidebar
        canSwitchPt={canSwitchPt}
        perusahaanList={perusahaanList}
        kaki={<KakiSidebar nama={session?.user?.name ?? session?.user?.username ?? "User"} />}
      />
      <SidebarInset>
        <main data-slot="halaman" className={`${KELAS_HALAMAN} @container/dashboard-main flex flex-1 flex-col gap-4 p-4`}>
          <TombolHalaman />
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
