import { requireModuleAccess } from "@/lib/require-access";
import { getPrintQueueHistory } from "@/lib/queries/print-queue";
import { getPrintFormatSettings } from "@/lib/queries/print-format-settings";
import { getBusinessDateISO } from "@/lib/business-date";
import { PrintManagementView } from "@/components/dashboard/print-management-view";

export default async function PrintManagementPage() {
  await requireModuleAccess("delivery");
  const todayISO = getBusinessDateISO();

  const [history, settings] = await Promise.all([
    getPrintQueueHistory({ dateFrom: todayISO, dateTo: todayISO }),
    getPrintFormatSettings(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Manajemen Cetak</h1>
      <PrintManagementView initialHistory={history} initialSettings={settings} businessDate={todayISO} />
    </div>
  );
}
