import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PackageSearch } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PMPERSADA_MODULES } from "@/lib/pmpersada-modules";

export async function generateMetadata({ params }: { params: Promise<{ modul: string }> }): Promise<Metadata> {
  const { modul } = await params;
  return { title: PMPERSADA_MODULES[modul] ?? "Modul" };
}

export default async function PmpersadaModulePage({ params }: { params: Promise<{ modul: string }> }) {
  const { modul } = await params;
  const label = PMPERSADA_MODULES[modul];
  if (!label) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">{label}</h1>
        <p className="text-sm text-muted-foreground">PT Putra Maesa Persada — Es Balok</p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <PackageSearch className="size-4 text-muted-foreground" />
            <CardTitle>Belum ada data</CardTitle>
          </div>
          <CardDescription>
            Modul {label} belum tersambung ke database PT Putra Maesa Persada. Halaman ini akan diisi setelah
            integrasi FINAC_ES_TB / FINAC_PMP_LOGISTIC dikerjakan.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
