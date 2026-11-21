import { redirect } from "next/navigation";
import { requirePmpersada, canAccessAllPT } from "@/lib/require-access";
import { bolehKelolaProduksi } from "@/lib/permissions";
import { listPerusahaanForSwitcher } from "@/lib/queries/perusahaan";
import { PmpersadaSidebar } from "@/components/dashboard/pmpersada-sidebar";
import { KakiSidebar, TombolHalaman } from "@/components/dashboard/sidebar-kaki";
import { KELAS_HALAMAN } from "@/lib/kelas-halaman";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default async function PmpersadaLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePmpersada();

  // Akun operator produksi (is_produksi) dikurung di aplikasi HP
  // /pmpersada/produksi-app — rute itu di luar route group (dashboard) ini,
  // jadi redirect ini tidak pernah mengarah ke dirinya sendiri. Admin
  // produksi dan Direktur/superadmin tetap boleh membuka dashboard.
  if (session.user.isProduksi && !bolehKelolaProduksi(session.user) && !canAccessAllPT(session.user)) {
    redirect("/pmpersada/produksi-app");
  }

  const perusahaanList = await listPerusahaanForSwitcher();
  const canSwitchPt = canAccessAllPT(session.user);

  return (
    <SidebarProvider>
      <PmpersadaSidebar
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
