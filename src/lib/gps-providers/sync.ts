// Sync orchestration for the GPS Kendaraan feature — runs both providers
// (Hino Connect, SoloFleet) per cycle, isolating each one's failure so that
// one provider's broken credentials or downed API never blocks the other's
// data from landing in armada_gps_riwayat. Consumed by Task 10's
// syncVehicleGpsPositionsAction.

import { hinoConnectProvider } from "@/lib/gps-providers/hino-connect";
import { solofleetProvider } from "@/lib/gps-providers/solofleet";
import { normalizePlate } from "@/lib/gps-providers/types";
import { getArmadaList } from "@/lib/queries/armada";
import { insertVehiclePositions, cleanupOldVehiclePositions } from "@/lib/queries/armada-gps";

export interface ProviderSyncStatus {
  provider: "hino" | "solofleet";
  ok: boolean;
  error: string | null;
  syncedAt: string;
}

export async function syncVehicleGpsPositions(): Promise<ProviderSyncStatus[]> {
  // Step 1: build the plate -> armadaId map once per sync, from the live
  // ERP Armada list (MSSQL), skipping rows with a blank/null PlatNomor.
  const armadaList = await getArmadaList();
  const armadaByPlate = new Map(
    armadaList
      .filter((a) => a.PlatNomor)
      .map((a) => [normalizePlate(a.PlatNomor ?? ""), a.ArmadaID])
  );

  // Step 2: run both providers in isolated try/catch — one provider's
  // failure must never block the other's.
  const providers = [hinoConnectProvider, solofleetProvider];
  const statuses: ProviderSyncStatus[] = [];
  for (const p of providers) {
    try {
      const positions = await p.fetchPositions();
      await insertVehiclePositions(positions, armadaByPlate);
      statuses.push({ provider: p.provider, ok: true, error: null, syncedAt: new Date().toISOString() });
    } catch (err) {
      statuses.push({
        provider: p.provider,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        syncedAt: new Date().toISOString(),
      });
    }
  }
  await cleanupOldVehiclePositions();
  return statuses;
}
