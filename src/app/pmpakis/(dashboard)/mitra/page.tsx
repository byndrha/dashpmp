import { getMitraList, getWilayahOptions } from "@/lib/queries/mitra-es-balok";
import { requirePmpakis } from "@/lib/require-access";
import { MitraPageClient } from "./mitra-page-client";

export default async function PmpakisMitraPage() {
  await requirePmpakis();
  const [cards, wilayahOptions] = await Promise.all([getMitraList("pmpakis"), getWilayahOptions("pmpakis", "utama")]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Mitra</h1>
        <p className="text-sm text-muted-foreground">PT Panen Mutiara Pakis — Es Balok</p>
      </div>
      <MitraPageClient cards={cards} wilayahOptions={wilayahOptions} />
    </div>
  );
}
