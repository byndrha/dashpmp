import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const metadata: Metadata = { title: "Beranda" };

export default function PmputraHomePage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">PT Prima Maesa Putra</h1>
        <p className="text-sm text-muted-foreground">Es Balok</p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-muted-foreground" />
            <CardTitle>Integrasi database belum dihubungkan</CardTitle>
          </div>
          <CardDescription>
            Modul di sisi kiri sudah disiapkan mengikuti struktur dashboard PT Mitra Kelola Esindo, tapi datanya
            belum tersambung ke database PT Prima Maesa Putra (FINAC_ES_PO / FINAC_LOGISTIC_PO). Pilih modul di
            sidebar untuk melihat status masing-masing.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
