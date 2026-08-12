"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { BakRow, RekMapRow } from "@/lib/queries/produksi-bak-pmpersada";
import { RekDetailDialog } from "@/components/produksi-pmpersada/rek-detail-dialog";
import { TAHAP_BADGE_CLASS } from "@/components/produksi-pmpersada/produksi-lib";
import { isiAirBaruProduksiAppAction, setBabonanProduksiAppAction, setMaintenanceProduksiAppAction } from "@/app/pmpersada/produksi-app/actions";

export function DenahProduksiAppView({ bak, rek, onAfterAksi }: { bak: BakRow[]; rek: RekMapRow[]; onAfterAksi: () => void }) {
  const [selectedBakId, setSelectedBakId] = useState(bak[0]?.BakID ?? 0);
  const [selectedRek, setSelectedRek] = useState<RekMapRow | null>(null);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {bak.map((b) => (
          <Button key={b.BakID} size="sm" variant={selectedBakId === b.BakID ? "default" : "outline"} onClick={() => setSelectedBakId(b.BakID)} className="shrink-0">
            {b.Nama}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {rek
          .filter((r) => r.BakID === selectedBakId)
          .map((r) => (
            <button
              key={r.RekID}
              type="button"
              onClick={() => setSelectedRek(r)}
              className={cn("flex flex-col gap-1 rounded-lg border p-2 text-left text-xs", TAHAP_BADGE_CLASS[r.Tahap])}
            >
              <span className="font-bold">Rek {r.NomorRek}</span>
              <span className="truncate">{r.JenisEs ?? "-"}</span>
            </button>
          ))}
      </div>
      {selectedRek && (
        <RekDetailDialog
          rek={selectedRek}
          isAdmin={false}
          onClose={() => setSelectedRek(null)}
          onIsiAirBaru={(jenisEs, jumlahCan) =>
            isiAirBaruProduksiAppAction({ rekId: selectedRek.RekID, jenisEs, jumlahCan }).then((r) => {
              if (r.success) onAfterAksi();
              return r;
            })
          }
          onSetBabonan={() =>
            setBabonanProduksiAppAction(selectedRek.RekID).then((r) => {
              if (r.success) onAfterAksi();
              return r;
            })
          }
          onSetMaintenance={() =>
            setMaintenanceProduksiAppAction(selectedRek.RekID).then((r) => {
              if (r.success) onAfterAksi();
              return r;
            })
          }
        />
      )}
    </div>
  );
}
