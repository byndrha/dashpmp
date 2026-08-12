import { requirePmpersada, canAccessAllPT } from "@/lib/require-access";
import { getBakListAction, getRekMapAction, getKonfigurasiAction, getRiwayatBatchAction, getAuditLogAction } from "@/app/pmpersada/(dashboard)/produksi/actions";
import { ProduksiDashboardClient } from "@/components/produksi-pmpersada/produksi-dashboard-client";

export default async function PmpersadaProduksiPage() {
  const session = await requirePmpersada();
  const [bakResult, rekResult, konfigResult, riwayatResult, auditResult] = await Promise.all([
    getBakListAction(),
    getRekMapAction(),
    getKonfigurasiAction(),
    getRiwayatBatchAction(),
    getAuditLogAction(),
  ]);
  if (!bakResult.success) throw new Error(bakResult.error);
  if (!rekResult.success) throw new Error(rekResult.error);
  if (!konfigResult.success) throw new Error(konfigResult.error);
  if (!riwayatResult.success) throw new Error(riwayatResult.error);
  if (!auditResult.success) throw new Error(auditResult.error);

  return (
    <ProduksiDashboardClient
      initialBak={bakResult.data}
      initialRek={rekResult.data}
      initialKonfigurasi={konfigResult.data}
      initialRiwayat={riwayatResult.data}
      initialAudit={auditResult.data}
      isAdmin={!session.user.isProduksi || canAccessAllPT(session.user)}
    />
  );
}
