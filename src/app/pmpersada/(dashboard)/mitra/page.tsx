import { getMitraList, getWilayahOptions } from "@/lib/queries/mitra-es-balok";
import { requirePmpersadaKeuangan } from "@/lib/require-access";
import { MitraPageClient } from "./mitra-page-client";

export default async function PmpersadaMitraPage() {
  await requirePmpersadaKeuangan();
  const [cards, wilayahOptions] = await Promise.all([getMitraList("pmpersada"), getWilayahOptions("pmpersada", "utama")]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Mitra</h1>
        <p className="text-sm text-muted-foreground">PT Putra Maesa Persada — Es Balok</p>
      </div>
      <MitraPageClient cards={cards} wilayahOptions={wilayahOptions} />
    </div>
  );
}
