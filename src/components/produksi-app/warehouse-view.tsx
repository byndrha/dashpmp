import { PetaWarehouse } from "@/components/produksi/peta-warehouse";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";

export function WarehouseView({ posisi }: { posisi: PalletPosisiRow[] }) {
  return (
    <div className="p-4">
      <PetaWarehouse posisi={posisi} />
    </div>
  );
}
