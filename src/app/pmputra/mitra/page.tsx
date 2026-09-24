import { getMitraList, getWilayahOptions } from "@/lib/queries/mitra-es-balok";
import { requirePmputra } from "@/lib/require-access";
import { MitraPageClient } from "./mitra-page-client";

export default async function PmputraMitraPage() {
  await requirePmputra();
  const [cards, wilayahOptions] = await Promise.all([getMitraList("pmputra"), getWilayahOptions("pmputra", "utama")]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Mitra</h1>
        <p className="text-sm text-muted-foreground">PT Prima Maesa Putra — Es Balok</p>
      </div>
      <MitraPageClient cards={cards} wilayahOptions={wilayahOptions} />
    </div>
  );
}
