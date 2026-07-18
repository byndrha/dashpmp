import { getMitraList, getTermOfPaymentOptions } from "@/lib/queries/mitra";
import { MitraList } from "@/components/dashboard/mitra-list";

export default async function MitraPage() {
  const [mitra, termOptions] = await Promise.all([getMitraList(), getTermOfPaymentOptions()]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Mitra</h1>
      <MitraList mitra={mitra} termOptions={termOptions} />
    </div>
  );
}
