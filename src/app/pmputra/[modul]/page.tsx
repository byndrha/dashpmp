import { notFound } from "next/navigation";
import { PackageSearch } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PMPUTRA_MODULES } from "@/lib/pmputra-modules";

export default async function PmputraModulePage({ params }: { params: Promise<{ modul: string }> }) {
  const { modul } = await params;
  const label = PMPUTRA_MODULES[modul];
  if (!label) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">{label}</h1>
        <p className="text-sm text-muted-foreground">PT Prima Maesa Putra — Es Balok</p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <PackageSearch className="size-4 text-muted-foreground" />
            <CardTitle>Belum ada data</CardTitle>
          </div>
          <CardDescription>
            Modul {label} belum tersambung ke database PT Prima Maesa Putra. Halaman ini akan diisi setelah
            integrasi FINAC_ES_PO / FINAC_LOGISTIC_PO dikerjakan.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
